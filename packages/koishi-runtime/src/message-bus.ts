import type { BiliEvents, MessageBus } from "@bilibili-notify/internal";
import type { Context } from "koishi";

/**
 * Koishi event 命名空间前缀。internal 的 BiliEvents 用裸事件名（"auth-lost" 等），
 * koishi events declarations 习惯加 `bilibili-notify/` 前缀，本 adapter 在这里翻译。
 */
const BUS_PREFIX = "bilibili-notify/";

/**
 * 把 Koishi `Context` 包成业务核心可消费的 MessageBus。
 * - emit("auth-lost") → ctx.emit("bilibili-notify/auth-lost")
 * - on("auth-lost", h) → ctx.on("bilibili-notify/auth-lost", h)，返回 Disposable
 */
export function makeKoishiMessageBus(ctx: Context): MessageBus {
	return {
		emit<E extends keyof BiliEvents>(event: E, ...args: Parameters<BiliEvents[E]>) {
			// biome-ignore lint/suspicious/noExplicitAny: koishi Events typing lives in module augmentation
			(ctx as any).emit(`${BUS_PREFIX}${event}`, ...args);
		},
		on<E extends keyof BiliEvents>(event: E, handler: BiliEvents[E]) {
			// biome-ignore lint/suspicious/noExplicitAny: koishi handler signature varies
			const release = ctx.on(`${BUS_PREFIX}${event}` as any, handler as any);
			return {
				dispose() {
					release();
				},
			};
		},
	};
}
