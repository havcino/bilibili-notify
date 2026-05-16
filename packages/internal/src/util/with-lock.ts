/**
 * Run an async fn with a single-slot lock: while a previous call is still
 * running, subsequent invocations are dropped (not queued). Useful for cron
 * tasks where a slow tick should not pile up overlapping runs.
 */
export function withLock(fn: () => Promise<void>, onError?: (err: unknown) => void): () => void {
	let locked = false;
	return () => {
		if (locked) return;
		locked = true;
		// fn 同步调用以保持原有时序语义(锁同步获取、fn 同步进入)。但若 fn 在
		// 返回 Promise 前**同步抛出**(首个 await 之前的同步代码报错),裸
		// `fn().catch().finally()` 会让异常绕过 .finally(),locked 永远停在
		// true → 该锁后续所有触发被静默丢弃(cron tick 全死)。故用 try 捕获
		// 同步抛出,手动释放锁 + 转 onError,再用 .finally 处理异步路径。
		let running: Promise<void>;
		try {
			running = fn();
		} catch (err) {
			locked = false;
			onError?.(err);
			return;
		}
		running
			.catch((err) => {
				onError?.(err);
			})
			.finally(() => {
				locked = false;
			});
	};
}
