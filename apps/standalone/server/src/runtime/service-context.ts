import type { Disposable, Logger, ServiceContext } from "@bilibili-notify/internal";
import { pino } from "pino";

export interface NodeServiceContextOptions {
	/** Component name; surfaces as `name` in pino output. */
	name: string;
	/** pino level. Defaults to `info`. */
	level?: string;
	/** Pretty-print to stdout in dev. Defaults to true when stdout is a TTY. */
	pretty?: boolean;
}

/**
 * Standalone-end ServiceContext. Mirrors the koishi-runtime adapter shape:
 *  - logger: pino (real production logger, not console)
 *  - setInterval / setTimeout: returns Disposable that clears the underlying timer
 *  - onDispose: queues a teardown hook; flushed by `dispose()` (and the bootstrap loop on SIGINT)
 *
 * The `dispose()` method on the returned object is the standalone-side equivalent of
 * koishi's "the plugin scope was torn down" — it clears every still-pending timer and
 * runs every queued onDispose hook in LIFO order.
 */
export interface NodeServiceContext extends ServiceContext {
	/** Tear down all pending timers + onDispose hooks (LIFO). Idempotent. */
	dispose(): Promise<void>;
}

export function createNodeServiceContext(opts: NodeServiceContextOptions): NodeServiceContext {
	const pretty = opts.pretty ?? Boolean(process.stdout.isTTY);
	const baseLogger = pino({
		name: opts.name,
		level: opts.level ?? "info",
		...(pretty
			? {
					transport: {
						target: "pino-pretty",
						options: { colorize: true, translateTime: "SYS:HH:MM:ss.l" },
					},
				}
			: {}),
	});

	// pino's per-method overloads collide with our `(msg: string, ...args: unknown[])`
	// shape because pino expects either `(msg, ...string[])` or `(obj, msg?, ...args)`.
	// We funnel through a tiny adapter that forwards verbatim.
	const callPino = (fn: (...a: unknown[]) => void, msg: string, args: readonly unknown[]): void => {
		fn(msg, ...args);
	};
	const logger: Logger = {
		info: (msg, ...args) => callPino(baseLogger.info.bind(baseLogger) as never, msg, args),
		warn: (msg, ...args) => callPino(baseLogger.warn.bind(baseLogger) as never, msg, args),
		error: (msg, ...args) => callPino(baseLogger.error.bind(baseLogger) as never, msg, args),
		debug: (msg, ...args) => callPino(baseLogger.debug.bind(baseLogger) as never, msg, args),
	};

	const intervals = new Set<NodeJS.Timeout>();
	const timeouts = new Set<NodeJS.Timeout>();
	const disposeHooks: Array<() => void | Promise<void>> = [];
	let disposed = false;

	const wrapInterval = (handle: NodeJS.Timeout): Disposable => ({
		dispose() {
			if (intervals.delete(handle)) clearInterval(handle);
		},
	});

	const wrapTimeout = (handle: NodeJS.Timeout): Disposable => ({
		dispose() {
			if (timeouts.delete(handle)) clearTimeout(handle);
		},
	});

	return {
		logger,
		setInterval(fn, ms) {
			const handle = setInterval(fn, ms);
			intervals.add(handle);
			return wrapInterval(handle);
		},
		setTimeout(fn, ms) {
			const handle: NodeJS.Timeout = setTimeout(() => {
				timeouts.delete(handle);
				fn();
			}, ms);
			timeouts.add(handle);
			return wrapTimeout(handle);
		},
		onDispose(fn) {
			if (disposed) {
				// Mirror "scope already torn down" semantics: schedule asap so callers don't leak.
				queueMicrotask(() => {
					Promise.resolve(fn()).catch((err: unknown) =>
						logger.error("onDispose hook (post-dispose) threw", err),
					);
				});
				return;
			}
			disposeHooks.push(fn);
		},
		async dispose() {
			if (disposed) return;
			disposed = true;
			for (const h of intervals) clearInterval(h);
			intervals.clear();
			for (const h of timeouts) clearTimeout(h);
			timeouts.clear();
			while (disposeHooks.length > 0) {
				const fn = disposeHooks.pop();
				if (!fn) continue;
				try {
					await fn();
				} catch (err) {
					logger.error("onDispose hook threw", err);
				}
			}
		},
	};
}
