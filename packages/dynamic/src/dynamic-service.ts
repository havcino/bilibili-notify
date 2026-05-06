import {
	DynamicEngine,
	type DynamicEngineConfig,
	type PushKind,
	type PushLike,
	type PushSegment,
	type SubscriptionsView,
} from "@bilibili-notify/dynamic-engine";
import { BILIBILI_NOTIFY_TOKEN } from "@bilibili-notify/internal";
import { makeKoishiMessageBus, makeKoishiServiceContext } from "@bilibili-notify/koishi-runtime";
import type { BilibiliPush } from "@bilibili-notify/push";
import { PushType } from "@bilibili-notify/push";
import { type Awaitable, type Context, h, Service } from "koishi";
import type { SubscriptionOp } from "koishi-plugin-bilibili-notify";
import type {} from "koishi-plugin-bilibili-notify-ai";
import { dynamicCommands } from "./commands";
import type { BilibiliNotifyDynamicConfig } from "./config";

declare module "koishi" {
	interface Context {
		"bilibili-notify-dynamic": BilibiliNotifyDynamic;
	}
	interface Events {
		"bilibili-notify/subscription-changed"(ops: SubscriptionOp[]): void;
		"bilibili-notify/plugin-error"(source: string, message: string): void;
		"bilibili-notify/auth-lost"(): void;
		"bilibili-notify/auth-restored"(): void;
	}
}

const SERVICE_NAME = "bilibili-notify-dynamic";

/**
 * koishi 端 PushLike adapter。把 dynamic-engine 的 PushSegment[] / PushKind 翻译为
 * koishi `h(...)` 元素并交给 BilibiliPush.broadcastToTargets。私聊与错误信息直接走
 * push 自带的 sendPrivateMsg / sendErrorMsg。
 */
function adaptPush(push: BilibiliPush): PushLike {
	const segmentToKoishi = (seg: PushSegment) => {
		switch (seg.type) {
			case "text":
				return h.text(seg.text);
			case "image":
				return h.image(seg.buffer, seg.mime);
			case "image-group":
				// dynamic-engine 仅在 forward=true（DYNAMIC_TYPE_DRAW 转发图集）时下发 image-group
				return h(
					"message",
					{ forward: seg.forward },
					seg.urls.map((url) => h.img(url)),
				);
		}
	};

	return {
		async broadcastDynamic(uid, segments, kind: PushKind) {
			// dynamic-engine 当前只发 "dynamic" / "dynamic-images" 两种 kind；二者最终都映射到
			// PushType.Dynamic（原 dynamic-service.ts 同样统一用 PushType.Dynamic）。
			void kind;
			const koishiSegments = segments.map(segmentToKoishi);
			// image-group 已经是一个完整 message 节点；非 image-group 则用 message 包一层。
			const isOnlyImageGroup = segments.length === 1 && segments[0].type === "image-group";
			const content = isOnlyImageGroup ? koishiSegments[0] : h("message", koishiSegments);
			await push.broadcastToTargets(uid, content, PushType.Dynamic);
		},
		sendPrivateMsg(content) {
			return push.sendPrivateMsg(content);
		},
		sendErrorMsg(reason) {
			return push.sendErrorMsg(reason);
		},
	};
}

export class BilibiliNotifyDynamic extends Service<BilibiliNotifyDynamicConfig> {
	static readonly [Service.provide] = SERVICE_NAME;
	static readonly inject = ["bilibili-notify"];

	private engine?: DynamicEngine;

	constructor(ctx: Context, config: BilibiliNotifyDynamicConfig) {
		super(ctx, SERVICE_NAME);
		this.config = config;
	}

	private toEngineConfig(config: BilibiliNotifyDynamicConfig): DynamicEngineConfig {
		return {
			dynamicUrl: config.dynamicUrl,
			dynamicCron: config.dynamicCron,
			dynamicVideoUrlToBV: config.dynamicVideoUrlToBV,
			pushImgsInDynamic: config.pushImgsInDynamic,
			filter: config.filter,
		};
	}

	protected start(): Awaitable<void> {
		const internals = this.ctx["bilibili-notify"].getInternals(BILIBILI_NOTIFY_TOKEN);
		if (!internals) throw new Error("无法获取 bilibili-notify 内部实例，请确认核心插件已启动");

		const serviceCtx = makeKoishiServiceContext(this.ctx, SERVICE_NAME, this.config.logLevel);
		const bus = makeKoishiMessageBus(this.ctx);
		const pushLike = adaptPush(internals.push);

		this.engine = new DynamicEngine({
			serviceCtx,
			bus,
			api: internals.api,
			push: pushLike,
			image: this.ctx.get("bilibili-notify-image")?.engine,
			ai: this.ctx.get("bilibili-notify-ai")?.engine,
			config: this.toEngineConfig(this.config),
			getSubs: () => {
				const fresh = this.ctx["bilibili-notify"].getInternals(BILIBILI_NOTIFY_TOKEN);
				return (fresh?.subs ?? null) as SubscriptionsView | null;
			},
		});

		this.engine.start();

		// koishi 端订阅事件 → engine.applyOps（engine 自身只监听 auth-restored）
		this.ctx.on("bilibili-notify/subscription-changed", (ops: SubscriptionOp[]) => {
			this.engine?.applyOps(ops);
		});

		dynamicCommands.call(this);
	}

	protected stop(): Awaitable<void> {
		this.engine?.stop();
		this.engine = undefined;
	}

	get isActive(): boolean {
		return this.engine?.isActive ?? false;
	}
}
