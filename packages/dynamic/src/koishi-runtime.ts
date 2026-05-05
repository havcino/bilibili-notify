import type {
	BiliEvents,
	Disposable,
	Logger,
	MessageBus,
	ServiceContext,
} from "@bilibili-notify/internal";
import type { Context } from "koishi";

/**
 * 与 packages/core/src/runtime 内同名 helper 字节级一致的内联拷贝。
 * koishi 子插件无法 import koishi-plugin-bilibili-notify（无依赖边、会触发循环），
 * 因此每个子插件各自维护一份 KoishiServiceContext / KoishiMessageBus。
 */
const BUS_PREFIX = "bilibili-notify/";

export function makeKoishiServiceContext(
	ctx: Context,
	loggerName: string,
	logLevel?: number,
): ServiceContext {
	const koishiLogger = ctx.logger(loggerName);
	if (logLevel !== undefined) koishiLogger.level = logLevel;
	const logger: Logger = {
		info: (msg, ...args) => koishiLogger.info(msg, ...args),
		warn: (msg, ...args) => koishiLogger.warn(msg, ...args),
		error: (msg, ...args) => koishiLogger.error(msg, ...args),
		debug: (msg, ...args) => koishiLogger.debug(msg, ...args),
	};
	const wrap = (release: () => unknown): Disposable => ({
		dispose() {
			release();
		},
	});
	return {
		logger,
		setInterval(fn, ms) {
			return wrap(ctx.setInterval(fn, ms));
		},
		setTimeout(fn, ms) {
			return wrap(ctx.setTimeout(fn, ms));
		},
		onDispose(fn) {
			ctx.on("dispose", fn);
		},
	};
}

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
