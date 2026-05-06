import type { Disposable, Logger, ServiceContext } from "@bilibili-notify/internal";
import type { Context } from "koishi";

/**
 * 把 Koishi `Context` 包成业务核心可消费的 ServiceContext。
 * - logger: ctx.logger(loggerName)，可选 .level 覆盖（koishi 用数字 level）
 * - setInterval / setTimeout: koishi 返回 dispose 函数 () => boolean，包装为 Disposable
 * - onDispose: ctx.on("dispose", fn)
 */
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
