/**
 * 回归守护 — P1-B 短期-a:BilibiliPush.stop() 唤醒 sleepWakers,retry 循环立即收敛。
 *
 * 不变量:sendToTarget 在 target 持续不可达 → 进入 sleep retry 循环;若此时 stop()
 * 触发,sleep 应立即返回,sendToTarget 在下一轮检测 disposed=true 后返回失败结果,
 * 不必等到 32s backoff 全跑完。
 *
 * 关键 bug 复发点:任何人重构 stop() 漏调 sleepWakers wake / 或者把 sleep 改回
 * 裸 setTimeout 但忘了对接 wake,这条契约立刻挂。
 */

import type {
	DeliveryResult,
	Logger,
	NotificationSink,
	PushTarget,
	ServiceContext,
} from "@bilibili-notify/internal";
import type { SubscriptionStore } from "@bilibili-notify/subscription";
import { describe, expect, it, vi } from "vitest";
import { BilibiliPush } from "../bilibili-push";

const silentLogger: Logger = {
	debug: () => {},
	info: () => {},
	warn: () => {},
	error: () => {},
};

function makeUnreachableSink(): NotificationSink {
	return {
		isAvailable: () => false, // 永远不可达 → sendToTarget 进入 sleep retry 循环
		send: async (): Promise<DeliveryResult> => ({ ok: false, latencyMs: 0, err: "unreachable" }),
		sendPrivate: async (): Promise<DeliveryResult> => ({
			ok: false,
			latencyMs: 0,
			err: "unreachable",
		}),
		resolve: (id) => ({ id, name: id, platform: "test" }) as unknown as PushTarget,
	};
}

const emptyStore = { list: () => [] } as unknown as SubscriptionStore;

describe("BilibiliPush.stop() — P1-B 短期-a sleepWakers 唤醒", () => {
	it("fake serviceCtx 永不自动 fire timer:sendToTarget 必须靠 stop() 唤醒才返回", async () => {
		// 这个 fake setTimeout 故意不自动 invoke fn — 把 sleep 拘在 pending 态。
		// 任何"伪造唤醒"或被 release.dispose 误触发的代码路径都会让本 case 在
		// stop() 之前就提前 resolve;断言会因此失败。
		const pendingTimers: Array<() => void> = [];
		const fakeServiceCtx: ServiceContext = {
			logger: silentLogger,
			setInterval: vi.fn(),
			setTimeout: (fn) => {
				pendingTimers.push(fn);
				// dispose 仅从 pendingTimers 移除,**不** invoke fn(否则就退化成 setTimeout(0))
				return {
					dispose: () => {
						const idx = pendingTimers.indexOf(fn);
						if (idx >= 0) pendingTimers.splice(idx, 1);
					},
				};
			},
			onDispose: () => {},
		};

		const push = new BilibiliPush({
			sink: makeUnreachableSink(),
			store: emptyStore,
			logger: silentLogger,
			serviceCtx: fakeServiceCtx,
		});
		push.start();

		let settled = false;
		const sendPromise = push
			.sendToTarget("target-x", { kind: "text", text: "x" })
			.then((r) => {
				settled = true;
				return r;
			});

		// 给 sendToTarget 跑到第一次 sleep 调用的机会
		await new Promise((r) => setImmediate(r));
		await new Promise((r) => setImmediate(r));

		// 关键断言 #1:stop() 之前 sendPromise 必须 pending。
		// 如果 wake 逻辑被改坏,setTimeout 在 fake 下永不 fire,Promise 永远不 resolve,
		// settled 应保持 false。
		expect(settled).toBe(false);
		expect(pendingTimers.length).toBeGreaterThanOrEqual(1);

		// 关键断言 #2:stop() 后必须立即 wake → sleep resolve → 下一轮 disposed=true → return。
		push.stop();
		const result = await sendPromise;
		expect(settled).toBe(true);
		expect(result.ok).toBe(false);
		expect(result.err).toBe("disposed");
	});

	it("不传 serviceCtx(退化路径)也能被 stop() 唤醒", async () => {
		const push = new BilibiliPush({
			sink: makeUnreachableSink(),
			store: emptyStore,
			logger: silentLogger,
			// 故意不传 serviceCtx,走 sleep 内裸 setTimeout 路径
		});
		push.start();

		const sendPromise = push.sendToTarget("target-y", { kind: "text", text: "y" });
		await new Promise((r) => setImmediate(r));
		const t0 = Date.now();
		push.stop();
		const result = await sendPromise;
		expect(result.ok).toBe(false);
		expect(Date.now() - t0).toBeLessThan(100); // < 3s backoff
	});
});
