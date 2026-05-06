import type { SubItemView } from "./push-like";
import type { ListenerManagerConfig, RoomContextOptions } from "./room-context";
import { RoomContext } from "./room-helpers";
import { RoomSession } from "./room-session";

export type { ListenerManagerConfig } from "./room-context";

/**
 * Constructor options for {@link ListenerManager}. Same shape as
 * {@link RoomContextOptions}; the manager builds its `RoomContext` internally.
 */
export type ListenerManagerOptions = RoomContextOptions;

/**
 * Top-level lifecycle for live-room listeners.
 *
 * Owns:
 * - the per-uid {@link SubItemView} registry (mutable clones we update through
 *   `bilibili-notify/subscription-changed` ops).
 * - the underlying {@link RoomContext} (which in turn owns the listener
 *   record + periodic-timer record and exposes shared helpers consumed by
 *   {@link RoomSession}).
 *
 * Per-room state and the dispatcher closure live in {@link RoomSession}; the
 * manager only orchestrates start / stop / clearAll.
 */
export class ListenerManager {
	private readonly ctx: RoomContext;
	private readonly subRecord: Map<string, SubItemView> = new Map();

	constructor(opts: ListenerManagerOptions) {
		this.ctx = new RoomContext(opts);
	}

	/** Replace runtime config (called when the adapter receives a config update). */
	updateConfig(config: ListenerManagerConfig): void {
		this.ctx.updateConfig(config);
	}

	isDisposed(): boolean {
		return this.ctx.isDisposed();
	}

	getListenerCount(): number {
		return this.ctx.getListenerCount();
	}

	/** Active mutable sub by uid (used by `applyOps` to detect existence). */
	getActiveSub(uid: string): SubItemView | undefined {
		return this.subRecord.get(uid);
	}

	/** Whether any feature on this sub requires the live-room WS connection. */
	needsLiveMonitor(sub: SubItemView): boolean {
		return this.ctx.needsLiveMonitor(sub);
	}

	/** Start listeners for everything in `subs` that needs one. */
	startAll(subs: Record<string, SubItemView>): void {
		this.ctx.setDisposed(false);
		this.ctx.clearPushTimers();
		this.ctx.clearListeners();
		this.subRecord.clear();

		const liveSubUids = Object.values(subs)
			.filter((s) => this.ctx.needsLiveMonitor(s))
			.map((s) => s.uid);
		this.ctx.logger.debug(
			`[start] 启动直播监听，共 ${liveSubUids.length} 个 UID：${liveSubUids.join(", ")}`,
		);
		for (const sub of Object.values(subs)) {
			if (this.ctx.needsLiveMonitor(sub)) this.startForUid(sub, "[start]");
		}
	}

	/** Start a single sub's listener via a fresh {@link RoomSession}. */
	startForUid(sub: SubItemView, logPrefix = "[ops]"): void {
		const mutable: SubItemView = structuredClone(sub);
		this.subRecord.set(sub.uid, mutable);
		this.ctx.danmakuCollector.registerRoom(sub.roomId);
		const session = new RoomSession(this.ctx, mutable);
		session.bootstrap().catch((e) => {
			this.ctx.logger.error(`${logPrefix} 启动直播监听失败 UID=${sub.uid}：${e}`);
		});
	}

	/** Stop a single sub's listener and drop its bookkeeping. */
	stopForUid(uid: string): void {
		const sub = this.subRecord.get(uid);
		if (!sub) return;
		const timer = this.ctx.livePushTimerManager.get(sub.roomId);
		timer?.();
		this.ctx.livePushTimerManager.delete(sub.roomId);
		this.ctx.closeListener(sub.roomId);
		this.ctx.danmakuCollector.clear(sub.roomId);
		this.subRecord.delete(uid);
	}

	/** Tear down everything. Used by engine `stop()` / `auth-lost`. */
	disposeAll(): void {
		this.ctx.logSideEffectState("stop:before-clear");
		this.ctx.setDisposed(true);
		this.ctx.clearPushTimers();
		this.ctx.clearListeners();
		this.subRecord.clear();
		this.ctx.danmakuCollector.clearAll();
		this.ctx.logSideEffectState("stop:after-clear");
	}

	/** Tear down listeners + timers but keep registry / disposed flag intact. */
	clearListeners(): void {
		this.ctx.clearListeners();
	}

	/** Cancel every periodic "正在直播" timer. */
	clearPushTimers(): void {
		this.ctx.clearPushTimers();
	}
}
