import { BILIBILI_NOTIFY_TOKEN } from "@bilibili-notify/internal";
import {
	type LiveContentBuilder,
	LiveEngine,
	type LiveEngineConfig,
	type LiveSubscriptionOp,
	type PushLike,
	type SubItemView,
	type SubscriptionsView,
} from "@bilibili-notify/live-engine";
import type { BilibiliPush } from "@bilibili-notify/push";
import { type Awaitable, type Context, h, Service } from "koishi";
import type { SubscriptionOp } from "koishi-plugin-bilibili-notify";
import type {} from "koishi-plugin-bilibili-notify-ai";
import { liveCommands } from "./commands";
import type { BilibiliNotifyLiveConfig } from "./config";
import { makeKoishiServiceContext } from "./koishi-runtime";

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

/** koishi 端 PushLike adapter，直接转发到 BilibiliPush.broadcastToTargets / sendPrivateMsg。 */
function adaptPush(push: BilibiliPush): PushLike {
	return {
		broadcastToTargets(uid, content, type) {
			// live-engine 的 LivePushType 与 push 包的 PushType 数值同源，可直接传入。
			// content 是 koishi h(...) 元素（来自 contentBuilder），原样传给 push。
			// biome-ignore lint/suspicious/noExplicitAny: PushType 数值同源；engine 用 LivePushType 别名导出
			return push.broadcastToTargets(uid, content, type as any);
		},
		sendPrivateMsg(content) {
			return push.sendPrivateMsg(content);
		},
	};
}

/** koishi 端 LiveContentBuilder：直接桥接到 koishi 的 h(...) 工厂。 */
const koishiContentBuilder: LiveContentBuilder = {
	text(t) {
		return h.text(t);
	},
	image(source, mime) {
		// h.image 重载：string 走 URL，Buffer/ArrayBuffer 必须带 mime。
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

		// 初始化（如订阅已就绪则立即启动）
		if (internals.subs) {
			this.engine.start(internals.subs as SubscriptionsView);
		}

		// 订阅变更 → engine.applyOps（lookup 用 koishi 端实时订阅快照）
		this.ctx.on("bilibili-notify/subscription-changed", (ops: SubscriptionOp[]) => {
			this.engine?.applyOps(ops as LiveSubscriptionOp[], (uid) => {
				const subs = this.ctx["bilibili-notify"].getInternals(BILIBILI_NOTIFY_TOKEN)?.subs;
				return subs?.[uid] as SubItemView | undefined;
			});
		});

		// auth-lost → engine.teardown；auth-restored → engine.rebuildFromSubs
		this.ctx.on("bilibili-notify/auth-lost", () => this.engine?.teardown());
		this.ctx.on("bilibili-notify/auth-restored", () => {
			const fresh = this.ctx["bilibili-notify"].getInternals(BILIBILI_NOTIFY_TOKEN);
			if (fresh?.subs) this.engine?.rebuildFromSubs(fresh.subs as SubscriptionsView);
		});

		liveCommands.call(this);
	}

	protected stop(): Awaitable<void> {
		this.engine?.stop();
		this.engine = undefined;
	}
}
