/**
 * 回归守护 — P1-C 短期-c:RoomSession.cancel() 阻断退避重连。
 *
 * 关键不变量:
 *   - cancel() 后再触发 onError → 不重连、不告警、什么都不做
 *   - 重连 sleep 期间 cancel() → 醒来时 cancelled 检测命中,不调 startLiveRoomListener
 *
 * 这两条契约失效 = ListenerManager.stopForUid 之后旧 session 还会被自动接回来 → 用户
 * 关了 listener 反而越关越多。
 */

import type { ServiceContext } from "@bilibili-notify/internal";
import { describe, expect, it, vi } from "vitest";
import type { SubItemView } from "../push-like";
import type { RoomContext } from "../room-helpers";
import { RoomSession } from "../room-session";

function makeSub(): SubItemView {
	return {
		uid: "u1",
		uname: "U1",
		roomId: "r1",
		dynamic: false,
		live: true,
		liveEnd: true,
		liveGuardBuy: false,
		superchat: false,
		wordcloud: false,
		liveSummary: false,
		target: {},
		customCardStyle: { enable: false },
		customLiveMsg: { enable: false },
		customGuardBuy: { enable: false },
		customLiveSummary: { enable: false },
		customSpecialDanmakuUsers: { enable: false, msgTemplate: "" },
		customSpecialUsersEnterTheRoom: { enable: false, msgTemplate: "" },
	};
}

interface ScheduledItem {
	fn: () => void;
	ms: number;
}

interface MockBag {
	closeListener: ReturnType<typeof vi.fn>;
	startLiveRoomListener: ReturnType<typeof vi.fn>;
	emitEngineError: ReturnType<typeof vi.fn>;
	emitLiveState: ReturnType<typeof vi.fn>;
	scheduled: ScheduledItem[]; // 待跑的 sleep callback + 对应 delay
	delays: () => number[]; // 至今 schedule 过的 delay 列表(按顺序)
	runScheduled: () => Promise<void>; // 把队列里所有 callback 跑一遍
	flushAll: (maxIters?: number) => Promise<void>; // 反复 runScheduled 直到队列空
}

function makeMockCtx(opts?: {
	startThrows?: boolean;
}): { ctx: RoomContext; mocks: MockBag } {
	const scheduled: ScheduledItem[] = [];
	const delayLog: number[] = [];
	const fakeServiceCtx: ServiceContext = {
		logger: { debug() {}, info() {}, warn() {}, error() {} },
		setInterval: vi.fn(),
		// 把每个 setTimeout 的 callback + delay 收集起来,测试手动驱动 + 校验退避序列
		setTimeout: (fn, ms) => {
			scheduled.push({ fn, ms });
			delayLog.push(ms);
			return { dispose: () => {} };
		},
		onDispose: () => {},
	};

	const mocks: MockBag = {
		closeListener: vi.fn(),
		startLiveRoomListener: vi.fn(async () => {
			if (opts?.startThrows) throw new Error("network blip");
		}),
		emitEngineError: vi.fn(),
		emitLiveState: vi.fn(),
		scheduled,
		delays: () => [...delayLog],
		runScheduled: async () => {
			// snapshot 后清空,避免新 schedule 立即被同一轮跑掉造成递归
			const batch = [...scheduled];
			scheduled.length = 0;
			for (const item of batch) item.fn();
			// 让 microtask 跑一轮
			await new Promise((r) => setImmediate(r));
		},
		flushAll: async (maxIters = 50) => {
			for (let i = 0; i < maxIters && scheduled.length > 0; i++) {
				const batch = [...scheduled];
				scheduled.length = 0;
				for (const item of batch) item.fn();
				await new Promise((r) => setImmediate(r));
			}
		},
	};

	const ctx = {
		serviceCtx: fakeServiceCtx,
		logger: fakeServiceCtx.logger,
		isDisposed: () => false,
		closeListener: mocks.closeListener,
		startLiveRoomListener: mocks.startLiveRoomListener,
		emitEngineError: mocks.emitEngineError,
		emitLiveState: mocks.emitLiveState,
		livePushTimerManager: new Map<string, () => void>(), // cancelPeriodicTimer 需要
		danmakuCollector: { clear: () => {}, registerRoom: () => {} },
		push: { sendPrivateMsg: async () => {}, broadcastToTargets: async () => {} },
		contentBuilder: {
			text: (t: string) => ({ kind: "text", text: t }),
			image: () => ({ kind: "image" }),
			message: (segs: unknown[]) => segs,
		},
		isSubscribed: () => false,
		hasTargets: () => false,
		templateRenderer: { renderSpecialDanmaku: () => "" },
	} as unknown as RoomContext;

	return { ctx, mocks };
}

describe("RoomSession.cancel() — P1-C 短期-c", () => {
	it("cancel() 之后触发 onError 不重连(直接 return,不动 startLiveRoomListener / emitEngineError)", async () => {
		const { ctx, mocks } = makeMockCtx();
		const session = new RoomSession(ctx, makeSub());
		session.cancel();

		// 触发内部 onError;它是 private,用 cast 调用。
		// biome-ignore lint/suspicious/noExplicitAny: 测试 private 方法
		await (session as any).onError();

		expect(mocks.closeListener).not.toHaveBeenCalled();
		expect(mocks.startLiveRoomListener).not.toHaveBeenCalled();
		expect(mocks.emitEngineError).not.toHaveBeenCalled();
		expect(mocks.scheduled).toHaveLength(0); // 没排重连
	});

	it("sleep 期间 cancel() → 醒来时 cancelled 命中,不调 startLiveRoomListener", async () => {
		const { ctx, mocks } = makeMockCtx();
		const session = new RoomSession(ctx, makeSub());

		// biome-ignore lint/suspicious/noExplicitAny: 测试 private 方法
		const errorPromise = (session as any).onError();

		// 第一阶段 — onError 进入退避 sleep,schedule 了一个 callback
		await new Promise((r) => setImmediate(r));
		expect(mocks.scheduled.length).toBeGreaterThanOrEqual(1);
		expect(mocks.closeListener).toHaveBeenCalledTimes(1);

		// 用户取消(对应 ListenerManager.stopForUid 路径)
		session.cancel();
		await mocks.runScheduled();
		await errorPromise;

		expect(mocks.startLiveRoomListener).not.toHaveBeenCalled();
		expect(mocks.emitEngineError).not.toHaveBeenCalled();
	});

	it("无 cancel 时 sleep 后正常发起 startLiveRoomListener", async () => {
		const { ctx, mocks } = makeMockCtx();
		const session = new RoomSession(ctx, makeSub());

		// biome-ignore lint/suspicious/noExplicitAny: 测试 private 方法
		const errorPromise = (session as any).onError();
		await new Promise((r) => setImmediate(r));
		await mocks.runScheduled();
		await errorPromise;

		expect(mocks.startLiveRoomListener).toHaveBeenCalledTimes(1);
		expect(mocks.emitEngineError).not.toHaveBeenCalled();
	});
});

describe("RoomSession 退避状态机 — codex review minor-4", () => {
	it("连续失败 5 次 → 退避序列 = [1000, 2000, 4000, 8000, 16000]", async () => {
		const { ctx, mocks } = makeMockCtx({ startThrows: true });
		const session = new RoomSession(ctx, makeSub());

		// biome-ignore lint/suspicious/noExplicitAny: 测试 private 方法
		void (session as any).onError();
		// catch 路径用 setTimeout(0) 再次进入 onError;flushAll 把全链路 drive 出来
		// 直到第 5 次 schedule 完(16s)或耗尽。
		await mocks.flushAll();

		// delays 应该恰好按退避表的 5 档出现一次(setTimeout(0) 的让出栈不在此表里
		// — 它的 ms 是 0,backoff 表是 [1000..16000],期望过滤掉 0)。
		const backoffOnly = mocks.delays().filter((d) => d > 0);
		expect(backoffOnly).toEqual([1000, 2000, 4000, 8000, 16000]);
	});

	it("第 6 次失败时退避耗尽 → emitEngineError + 不再 schedule 新 backoff", async () => {
		const { ctx, mocks } = makeMockCtx({ startThrows: true });
		const session = new RoomSession(ctx, makeSub());

		// biome-ignore lint/suspicious/noExplicitAny: 测试 private 方法
		void (session as any).onError();
		await mocks.flushAll();

		// 5 次 startLiveRoomListener 都失败 → 第 6 次 onError 入口检测耗尽
		expect(mocks.startLiveRoomListener).toHaveBeenCalledTimes(5);
		expect(mocks.emitEngineError).toHaveBeenCalledTimes(1);
		expect(mocks.emitEngineError.mock.calls[0][0]).toMatch(/重试 5 次后放弃监听/);

		// 耗尽路径之后不应该再 schedule 新 backoff
		const backoffOnly = mocks.delays().filter((d) => d > 0);
		expect(backoffOnly).toHaveLength(5); // 不会多出第 6 个 backoff
	});

	it("重连成功 → reconnectAttempts 复位,下一轮 onError 从 1000ms 重新开始", async () => {
		// 第一次 startLiveRoomListener 抛错,第二次成功;第三次再抛错。期望 delay
		// 序列:第一轮 [1000(失败) → 1000(再次进入 onError 因 catch)]…等等。
		// 改用 vi.fn 行为脚本:第 1 次 throw,第 2 次 ok,第 3 次 throw。
		const { ctx, mocks } = makeMockCtx();
		mocks.startLiveRoomListener
			.mockRejectedValueOnce(new Error("blip 1"))
			.mockResolvedValueOnce(undefined)
			.mockRejectedValueOnce(new Error("blip 2"));

		const session = new RoomSession(ctx, makeSub());
		// 第一轮 onError(failure)
		// biome-ignore lint/suspicious/noExplicitAny: 测试 private 方法
		void (session as any).onError();
		await mocks.flushAll();
		// 期望:1000ms backoff → startListener 抛 → catch setTimeout(0) → onError →
		//      2000ms backoff → startListener resolve → reconnectAttempts 复位
		expect(mocks.delays().filter((d) => d > 0)).toEqual([1000, 2000]);
		expect(mocks.startLiveRoomListener).toHaveBeenCalledTimes(2);

		// 第二轮 onError(failure):因为上一轮 success 复位,下一轮还是从 1000 开始
		// biome-ignore lint/suspicious/noExplicitAny: 测试 private 方法
		void (session as any).onError();
		await mocks.flushAll();
		const round2 = mocks.delays().filter((d) => d > 0).slice(2);
		expect(round2[0]).toBe(1000); // 不是 4000 / 8000
	});
});
