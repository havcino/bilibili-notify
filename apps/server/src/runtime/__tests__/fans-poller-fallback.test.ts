/**
 * 测试 — FansPoller 在 24h/7d 窗口不足时,fallback 到 jsonl 最早样本算 delta,
 * 并通过 delta24hAsOf / delta7dAsOf 携带最早样本 ts,前端据此显示 ⓘ。
 *
 * 守护契约:
 *   1. 窗口足额(findNearestBefore 命中)→ delta 正常,asOf 不设
 *   2. 窗口不足 + 有更早样本 → delta 用 earliest 算,asOf = earliest.ts
 *   3. 完全没样本 → delta=null,asOf 不设
 */

import type { GlobalConfig } from "@bilibili-notify/internal";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const cronMock = vi.hoisted(() => {
	const instances: Array<{ cronTime: string; onTick: () => void }> = [];
	class FakeCronJob {
		running = false;
		constructor(
			public cronTime: string,
			public onTick: () => void,
		) {
			instances.push(this);
		}
		start(): void {
			this.running = true;
		}
		stop(): void {
			this.running = false;
		}
	}
	return { instances, FakeCronJob };
});
vi.mock("cron", () => ({ CronJob: cronMock.FakeCronJob }));

const { startFansPoller } = await import("../fans-poller.js");
const { createNodeMessageBus } = await import("../message-bus.js");

const GLOBALS = { app: { dynamicCron: "*/2 * * * *" } } as unknown as GlobalConfig;
const SUB = { id: "sub-1", uid: "12345", enabled: true };

function makeApi(fans: number) {
	return {
		getUserCardInfo: vi.fn(async () => ({
			code: 0,
			data: { card: { mid: SUB.uid, name: "X", face: "f", sign: "s", fans } },
		})),
	};
}

function runPoller(opts: {
	findNearestBefore: ReturnType<typeof vi.fn>;
	findEarliest: ReturnType<typeof vi.fn>;
	api: ReturnType<typeof makeApi>;
}) {
	const bus = createNodeMessageBus();
	const rtGet = vi.fn(() => undefined);
	const rtPatch = vi.fn(async () => {});
	return {
		bus,
		rtPatch,
		handle: startFansPoller({
			bus,
			logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as never,
			configStore: { getGlobals: () => GLOBALS, patchSubscription: vi.fn() } as never,
			subscriptionStore: { list: () => [SUB] } as never,
			subRuntimeStore: {
				get: rtGet,
				getAll: () => ({}),
				patch: rtPatch,
				prune: vi.fn(async () => {}),
				load: vi.fn(async () => {}),
			} as never,
			fansStore: {
				append: vi.fn(async () => {}),
				findNearestBefore: opts.findNearestBefore,
				findEarliest: opts.findEarliest,
				dropUid: vi.fn(async () => {}),
			} as never,
			api: opts.api as never,
			serviceCtx: {
				setTimeout: vi.fn(() => undefined),
				setInterval: vi.fn(() => undefined),
			} as never,
		}),
	};
}

let handle: { dispose(): void } | undefined;

beforeEach(() => {
	cronMock.instances.length = 0;
	vi.restoreAllMocks();
});

afterEach(() => {
	handle?.dispose();
	handle = undefined;
});

describe("FansPoller — 24h/7d fallback 到 jsonl 最早样本", () => {
	it("窗口内无样本 + 有更早样本 → delta 用 earliest 算,asOf 携带 earliest.ts", async () => {
		const earliestTs = new Date(Date.now() - 12 * 3600 * 1000).toISOString();
		const find = vi.fn(async () => null); // 24h 前 / 7d 前 都没样本
		const findEarliest = vi.fn(async () => ({ ts: earliestTs, value: 1000 }));
		const api = makeApi(1100); // 12h 内涨了 100

		const refreshedSpy = vi.fn();
		const {
			bus,
			rtPatch,
			handle: h,
		} = runPoller({
			findNearestBefore: find,
			findEarliest,
			api,
		});
		handle = h;
		bus.on("fans-refreshed", refreshedSpy);

		cronMock.instances[0]?.onTick();
		await vi.waitFor(() => expect(rtPatch).toHaveBeenCalledTimes(1), {
			timeout: 2000,
			interval: 10,
		});
		await vi.waitFor(() => expect(refreshedSpy).toHaveBeenCalled(), {
			timeout: 2000,
			interval: 10,
		});

		// findEarliest 应只被调一次(两个窗口缺时复用同一查询)
		expect(findEarliest).toHaveBeenCalledTimes(1);
		// restoreFromDisk 也可能在 tick 之前 emit 一次(取 jsonl 最近一条),
		// 所以取 last call 才是 tick emit 的快照。
		const entries = refreshedSpy.mock.calls.at(-1)?.[0] as Array<Record<string, unknown>>;
		expect(entries).toHaveLength(1);
		expect(entries[0]).toMatchObject({
			uid: "12345",
			current: 1100,
			delta24h: 100,
			delta24hAsOf: earliestTs,
			delta7d: 100,
			delta7dAsOf: earliestTs,
		});
	});

	it("24h 前有样本(足额)→ delta24h 用它算,asOf 不设;7d 仍 fallback", async () => {
		const oneDayAgo = new Date(Date.now() - 25 * 3600 * 1000).toISOString();
		const earliestTs = new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString(); // 3 天前
		const find = vi.fn(async (_uid: string, target: string) => {
			// restoreFromDisk 用 futureIso "9999...";忽略以免它 emit 干扰 tick 断言。
			if (target.startsWith("9999")) return null;
			// target24h 命中 oneDayAgo;target7d 查不到(只有 3 天前)
			const targetMs = Date.parse(target);
			const oneDayAgoMs = Date.parse(oneDayAgo);
			return oneDayAgoMs <= targetMs ? { ts: oneDayAgo, value: 950 } : null;
		});
		const findEarliest = vi.fn(async () => ({ ts: earliestTs, value: 800 }));
		const api = makeApi(1100);

		const refreshedSpy = vi.fn();
		const {
			bus,
			rtPatch,
			handle: h,
		} = runPoller({
			findNearestBefore: find,
			findEarliest,
			api,
		});
		handle = h;
		bus.on("fans-refreshed", refreshedSpy);

		cronMock.instances[0]?.onTick();
		await vi.waitFor(() => expect(rtPatch).toHaveBeenCalledTimes(1), {
			timeout: 2000,
			interval: 10,
		});
		await vi.waitFor(() => expect(refreshedSpy).toHaveBeenCalled(), {
			timeout: 2000,
			interval: 10,
		});

		// restoreFromDisk 也可能在 tick 之前 emit 一次(取 jsonl 最近一条),
		// 所以取 last call 才是 tick emit 的快照。
		const entries = refreshedSpy.mock.calls.at(-1)?.[0] as Array<Record<string, unknown>>;
		expect(entries[0]).toMatchObject({
			delta24h: 150, // 1100 - 950
			delta7d: 300, // 1100 - 800
			delta7dAsOf: earliestTs,
		});
		// 24h 足额 → 不设 asOf
		expect(entries[0]).not.toHaveProperty("delta24hAsOf");
	});

	it("完全没样本(append 失败 / 空文件)→ delta 都是 null,asOf 都不设", async () => {
		const find = vi.fn(async () => null);
		const findEarliest = vi.fn(async () => undefined);
		const api = makeApi(500);

		const refreshedSpy = vi.fn();
		const {
			bus,
			rtPatch,
			handle: h,
		} = runPoller({
			findNearestBefore: find,
			findEarliest,
			api,
		});
		handle = h;
		bus.on("fans-refreshed", refreshedSpy);

		cronMock.instances[0]?.onTick();
		await vi.waitFor(() => expect(rtPatch).toHaveBeenCalledTimes(1), {
			timeout: 2000,
			interval: 10,
		});
		await vi.waitFor(() => expect(refreshedSpy).toHaveBeenCalled(), {
			timeout: 2000,
			interval: 10,
		});

		// restoreFromDisk 也可能在 tick 之前 emit 一次(取 jsonl 最近一条),
		// 所以取 last call 才是 tick emit 的快照。
		const entries = refreshedSpy.mock.calls.at(-1)?.[0] as Array<Record<string, unknown>>;
		expect(entries[0]).toMatchObject({ delta24h: null, delta7d: null });
		expect(entries[0]).not.toHaveProperty("delta24hAsOf");
		expect(entries[0]).not.toHaveProperty("delta7dAsOf");
	});
});
