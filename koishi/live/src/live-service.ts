import type { SubscriptionOp } from "@bilibili-notify/internal";
import { BILIBILI_NOTIFY_TOKEN } from "@bilibili-notify/internal";
import { makeKoishiServiceContext } from "@bilibili-notify/koishi-runtime";
import {
	type LiveContentBuilder,
	LiveEngine,
	type LiveEngineConfig,
	type LiveSubscriptionOp,
	type PushLike,
	type SubItemView,
	type SubscriptionsView,
} from "@bilibili-notify/live";
import type { BilibiliPush } from "@bilibili-notify/push";
import { type Awaitable, type Context, h, Service } from "koishi";
// biome-ignore lint/correctness/noUnusedImports: module augmentation for ctx["bilibili-notify"]
import type {} from "koishi-plugin-bilibili-notify";
import { liveCommands } from "./commands";
import type { BilibiliNotifyLiveConfig } from "./config";

declare module "koishi" {
	interface Context {
		"bilibili-notify-live": BilibiliNotifyLive;
	}
	interface Events {
		"bilibili-notify/subscription-changed"(ops: SubscriptionOp[]): void;
		"bilibili-notify/plugin-error"(source: string, message: string): void;
		"bilibili-notify/auth-lost"(): void;
		"bilibili-notify/auth-restored"(): void;
	}
}

const SERVICE_NAME = "bilibili-notify-live";

/**
 * Adapt the new BilibiliPush to the PushLike interface that LiveEngine expects.
 * LiveEngine calls broadcastToTargets(uid, content, LivePushType) where content is
 * a koishi h() element. We translate LivePushType → FeatureKey and content → NotificationPayload.
 */
function adaptPush(push: BilibiliPush): PushLike {
	return {
		async broadcastToTargets(uid, content, type) {
			// Map LivePushType numeric values to FeatureKey strings
			// LivePushType values: Live=0, StartBroadcasting=3, LiveGuardBuy=4,
			//   WordCloudAndLiveSummary=5, Superchat=6, UserDanmakuMsg=7, UserActions=8, LiveEnd=9
			type FeatureKey = import("@bilibili-notify/internal").FeatureKey;
			const typeToFeature: Record<number, FeatureKey> = {
				0: "live",
				3: "live",
				4: "liveGuardBuy",
				5: "wordcloud", // wordcloud+liveSummary: use wordcloud as primary
				6: "superchat",
				7: "specialDanmaku",
				8: "specialUserEnter",
				9: "liveEnd",
			};
			const feature = typeToFeature[type as number] ?? "live";

			// content is a koishi h() element; we convert to a text payload
			// by calling toString() which gives the XML-like koishi serialization.
			// For a richer translation, cast to string then wrap as text.
			const textContent = typeof content === "string" ? content : String(content);
			const payload: import("@bilibili-notify/internal").NotificationPayload = {
				kind: "text",
				text: textContent,
			};
			await push.broadcastToFeature(uid, feature, payload);
		},
		sendPrivateMsg(content) {
			return push.sendPrivateMsg(content);
		},
	};
}

/** Build SubscriptionsView from SubscriptionStore for LiveEngine. */
// biome-ignore lint/suspicious/noExplicitAny: store type from InternalsShape
function storeToLiveView(store: any): SubscriptionsView {
	const view: SubscriptionsView = {};
	for (const sub of store.list()) {
		if (!sub.enabled) continue;

		const liveView: SubItemView = {
			uid: sub.uid,
			uname: sub.cachedProfile?.name ?? sub.uid,
			roomId: "", // live engine resolves roomId via API
			dynamic: (sub.routing.dynamic?.length ?? 0) > 0,
			dynamicAtAll: (sub.routing.dynamicAtAll?.length ?? 0) > 0,
			live: (sub.routing.live?.length ?? 0) > 0,
			liveAtAll: (sub.routing.liveAtAll?.length ?? 0) > 0,
			liveEnd: (sub.routing.liveEnd?.length ?? 0) > 0,
			liveGuardBuy: (sub.routing.liveGuardBuy?.length ?? 0) > 0,
			superchat: (sub.routing.superchat?.length ?? 0) > 0,
			wordcloud: (sub.routing.wordcloud?.length ?? 0) > 0,
			liveSummary: (sub.routing.liveSummary?.length ?? 0) > 0,
			target: sub.routing, // routing is structurally compatible as Partial<Record<LivePushFeature, unknown[]>>
			customCardStyle: sub.overrides.cardStyle
				? {
						enable: true,
						cardColorStart: sub.overrides.cardStyle.cardColorStart,
						cardColorEnd: sub.overrides.cardStyle.cardColorEnd,
						cardBasePlateColor: sub.overrides.cardStyle.cardBasePlateColor,
						cardBasePlateBorder: sub.overrides.cardStyle.cardBasePlateBorder,
					}
				: { enable: false },
			customLiveMsg: sub.overrides.templates?.liveStart
				? {
						enable: true,
						customLiveStart: sub.overrides.templates.liveStart,
						customLive: sub.overrides.templates.liveOngoing,
						customLiveEnd: sub.overrides.templates.liveEnd,
					}
				: { enable: false },
			customGuardBuy: sub.overrides.templates?.guardBuy
				? {
						enable: true,
						captainImgUrl: sub.overrides.templates.guardBuy.captain.imageUrl,
						supervisorImgUrl: sub.overrides.templates.guardBuy.commander.imageUrl,
						governorImgUrl: sub.overrides.templates.guardBuy.governor.imageUrl,
					}
				: { enable: false },
			customLiveSummary: sub.overrides.templates?.liveSummary
				? { enable: true, liveSummary: sub.overrides.templates.liveSummary }
				: { enable: false },
			customSpecialDanmakuUsers: (sub.specialUsers as { uid: string; kinds: string[] }[]).some(
				(u) => u.kinds.includes("danmaku"),
			)
				? {
						enable: true,
						specialDanmakuUsers: (sub.specialUsers as { uid: string; kinds: string[] }[])
							.filter((u) => u.kinds.includes("danmaku"))
							.map((u) => u.uid),
						msgTemplate: sub.overrides.templates?.specialDanmaku ?? "",
					}
				: { enable: false, msgTemplate: "" },
			customSpecialUsersEnterTheRoom: (sub.specialUsers as { uid: string; kinds: string[] }[]).some(
				(u) => u.kinds.includes("enter"),
			)
				? {
						enable: true,
						specialUsersEnterTheRoom: (sub.specialUsers as { uid: string; kinds: string[] }[])
							.filter((u) => u.kinds.includes("enter"))
							.map((u) => u.uid),
						msgTemplate: sub.overrides.templates?.specialUserEnter ?? "",
					}
				: { enable: false, msgTemplate: "" },
		};
		view[sub.uid] = liveView;
	}
	return view;
}

/** koishi 端 LiveContentBuilder：直接桥接到 koishi 的 h(...) 工厂。 */
const koishiContentBuilder: LiveContentBuilder = {
	text(t) {
		return h.text(t);
	},
	image(source, mime) {
		if (typeof source === "string") return h.image(source);
		return h.image(source, mime ?? "image/jpeg");
	},
	atAll() {
		return h("at", { type: "all" });
	},
	message(segments) {
		return h("message", segments as Parameters<typeof h>[1]);
	},
};

export class BilibiliNotifyLive extends Service<BilibiliNotifyLiveConfig> {
	static readonly [Service.provide] = SERVICE_NAME;
	static readonly inject = ["bilibili-notify"];

	private engine?: LiveEngine;

	constructor(ctx: Context, config: BilibiliNotifyLiveConfig) {
		super(ctx, SERVICE_NAME);
		this.config = config;
	}

	private toEngineConfig(config: BilibiliNotifyLiveConfig): LiveEngineConfig {
		return {
			wordcloudStopWords: config.wordcloudStopWords,
			pushTime: config.pushTime,
			restartPush: config.restartPush,
			minScPrice: config.minScPrice,
			minGuardLevel: config.minGuardLevel,
			liveSummaryDefault: config.liveSummary.join("\n"),
			customGuardBuy: config.customGuardBuy,
			customLiveMsg: config.customLiveMsg,
		};
	}

	protected start(): Awaitable<void> {
		const internals = this.ctx["bilibili-notify"].getInternals(BILIBILI_NOTIFY_TOKEN);
		if (!internals) throw new Error("无法获取 bilibili-notify 内部实例，请确认核心插件已启动");

		const serviceCtx = makeKoishiServiceContext(this.ctx, SERVICE_NAME, this.config.logLevel);
		const pushLike = adaptPush(internals.push);
		const { store } = internals;

		this.engine = new LiveEngine({
			serviceCtx,
			api: internals.api,
			push: pushLike,
			contentBuilder: koishiContentBuilder,
			imageRenderer: this.ctx.get("bilibili-notify-image")?.engine ?? null,
			commentary: this.ctx.get("bilibili-notify-ai")?.engine ?? null,
			config: this.toEngineConfig(this.config),
			emitPluginError: (message) =>
				this.ctx.emit("bilibili-notify/plugin-error", SERVICE_NAME, message),
		});

		// Initialize with current subs
		const initialView = storeToLiveView(store);
		if (Object.keys(initialView).length > 0) {
			this.engine.start(initialView);
		}

		// Subscription changes → engine.applyOps
		this.ctx.on("bilibili-notify/subscription-changed", (ops: SubscriptionOp[]) => {
			const liveOps: LiveSubscriptionOp[] = ops.map((op) => {
				if (op.type === "add") {
					return { type: "add" as const, sub: storeToSubItemView(op.sub) };
				}
				if (op.type === "remove") {
					return { type: "delete" as const, uid: op.id };
				}
				// update
				return {
					type: "update" as const,
					uid: op.sub.uid,
					changes: [
						{
							scope: "live" as const,
							live: (op.sub.routing.live?.length ?? 0) > 0,
							liveEnd: (op.sub.routing.liveEnd?.length ?? 0) > 0,
							liveGuardBuy: (op.sub.routing.liveGuardBuy?.length ?? 0) > 0,
							superchat: (op.sub.routing.superchat?.length ?? 0) > 0,
							wordcloud: (op.sub.routing.wordcloud?.length ?? 0) > 0,
							liveSummary: (op.sub.routing.liveSummary?.length ?? 0) > 0,
						},
					],
				};
			});
			this.engine?.applyOps(liveOps, (uid) => {
				const fresh = this.ctx["bilibili-notify"].getInternals(BILIBILI_NOTIFY_TOKEN);
				if (!fresh) return undefined;
				const sub = fresh.store.findByUid(uid);
				if (!sub) return undefined;
				return storeToSubItemView(sub);
			});
		});

		// auth-lost → engine.teardown; auth-restored → engine.rebuildFromSubs
		this.ctx.on("bilibili-notify/auth-lost", () => this.engine?.teardown());
		this.ctx.on("bilibili-notify/auth-restored", () => {
			const fresh = this.ctx["bilibili-notify"].getInternals(BILIBILI_NOTIFY_TOKEN);
			if (fresh) this.engine?.rebuildFromSubs(storeToLiveView(fresh.store));
		});

		liveCommands.call(this);
	}

	protected stop(): Awaitable<void> {
		this.engine?.stop();
		this.engine = undefined;
	}
}

/** Convert a single Subscription to SubItemView. */
function storeToSubItemView(sub: import("@bilibili-notify/internal").Subscription): SubItemView {
	return {
		uid: sub.uid,
		uname: sub.cachedProfile?.name ?? sub.uid,
		roomId: "",
		dynamic: (sub.routing.dynamic?.length ?? 0) > 0,
		dynamicAtAll: (sub.routing.dynamicAtAll?.length ?? 0) > 0,
		live: (sub.routing.live?.length ?? 0) > 0,
		liveAtAll: (sub.routing.liveAtAll?.length ?? 0) > 0,
		liveEnd: (sub.routing.liveEnd?.length ?? 0) > 0,
		liveGuardBuy: (sub.routing.liveGuardBuy?.length ?? 0) > 0,
		superchat: (sub.routing.superchat?.length ?? 0) > 0,
		wordcloud: (sub.routing.wordcloud?.length ?? 0) > 0,
		liveSummary: (sub.routing.liveSummary?.length ?? 0) > 0,
		target: sub.routing,
		customCardStyle: sub.overrides.cardStyle
			? {
					enable: true,
					cardColorStart: sub.overrides.cardStyle.cardColorStart,
					cardColorEnd: sub.overrides.cardStyle.cardColorEnd,
					cardBasePlateColor: sub.overrides.cardStyle.cardBasePlateColor,
					cardBasePlateBorder: sub.overrides.cardStyle.cardBasePlateBorder,
				}
			: { enable: false },
		customLiveMsg: sub.overrides.templates?.liveStart
			? {
					enable: true,
					customLiveStart: sub.overrides.templates.liveStart,
					customLive: sub.overrides.templates.liveOngoing,
					customLiveEnd: sub.overrides.templates.liveEnd,
				}
			: { enable: false },
		customGuardBuy: sub.overrides.templates?.guardBuy
			? {
					enable: true,
					captainImgUrl: sub.overrides.templates.guardBuy.captain.imageUrl,
					supervisorImgUrl: sub.overrides.templates.guardBuy.commander.imageUrl,
					governorImgUrl: sub.overrides.templates.guardBuy.governor.imageUrl,
				}
			: { enable: false },
		customLiveSummary: sub.overrides.templates?.liveSummary
			? { enable: true, liveSummary: sub.overrides.templates.liveSummary }
			: { enable: false },
		customSpecialDanmakuUsers: sub.specialUsers.some((u) => u.kinds.includes("danmaku"))
			? {
					enable: true,
					specialDanmakuUsers: sub.specialUsers
						.filter((u) => u.kinds.includes("danmaku"))
						.map((u) => u.uid),
					msgTemplate: sub.overrides.templates?.specialDanmaku ?? "",
				}
			: { enable: false, msgTemplate: "" },
		customSpecialUsersEnterTheRoom: sub.specialUsers.some((u) => u.kinds.includes("enter"))
			? {
					enable: true,
					specialUsersEnterTheRoom: sub.specialUsers
						.filter((u) => u.kinds.includes("enter"))
						.map((u) => u.uid),
					msgTemplate: sub.overrides.templates?.specialUserEnter ?? "",
				}
			: { enable: false, msgTemplate: "" },
	};
}
