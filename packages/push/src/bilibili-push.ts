import type {
	DeliveryResult,
	FeatureKey,
	Logger,
	NotificationPayload,
	NotificationSink,
	PushTarget,
} from "@bilibili-notify/internal";
import type { SubscriptionStore } from "@bilibili-notify/subscription";

const INITIAL_RETRY_DELAY_MS = 3000;
const MAX_RETRY_DELAY_MS = INITIAL_RETRY_DELAY_MS * 2 ** 5;

/** Options for constructing a BilibiliPush instance. */
export interface BilibiliPushOptions {
	/** Platform-neutral push sink — translates targetId → platform delivery. */
	sink: NotificationSink;
	/** Subscription store — used to resolve routing per uid+feature. */
	store: SubscriptionStore;
	/** Optional master PushTarget for private error notifications. */
	master?: PushTarget | null;
	/** Logger instance. */
	logger: Logger;
}

/**
 * Platform-neutral push router.
 *
 * Replaces the old koishi-coupled BilibiliPush. Routing comes from
 * store.findByUid(uid)?.routing[feature] → targetId[] → sink.send(targetId, payload).
 * The old pushArrMap, broadcastToTargets, sendPrivateMsg/sendErrorMsg are gone.
 */
export class BilibiliPush {
	private readonly sink: NotificationSink;
	private readonly store: SubscriptionStore;
	private readonly master: PushTarget | null;
	private readonly logger: Logger;
	private disposed = false;

	constructor(opts: BilibiliPushOptions) {
		this.sink = opts.sink;
		this.store = opts.store;
		this.master = opts.master ?? null;
		this.logger = opts.logger;
	}

	start(): void {
		this.disposed = false;
		if (this.master && !this.sink.isAvailable(this.master.id)) {
			this.logger.warn("[push] master 目标当前不可达，运行状态通知将无法发送");
		}
	}

	stop(): void {
		this.disposed = true;
	}

	/**
	 * Broadcast a notification to all targets registered for a given uid + feature.
	 * Returns an array of DeliveryResult (one per target).
	 */
	async broadcastToFeature(
		uid: string,
		feature: FeatureKey,
		payload: NotificationPayload,
	): Promise<DeliveryResult[]> {
		if (this.disposed) return [];

		const sub = this.store.findByUid(uid);
		if (!sub) {
			this.logger.debug(`[push] uid=${uid} 无订阅记录，跳过 feature=${feature}`);
			return [];
		}

		const targetIds = sub.routing[feature] ?? [];
		if (targetIds.length === 0) {
			this.logger.debug(`[push] uid=${uid} feature=${feature} 无目标，跳过`);
			return [];
		}

		this.logger.info(`[push] uid=${uid} feature=${feature} → ${targetIds.length} 个目标`);
		return this.sendBatch(targetIds, payload);
	}

	/**
	 * Send a notification to all targets in the list.
	 * Failures are captured per-target; does not throw.
	 */
	async sendBatch(targetIds: string[], payload: NotificationPayload): Promise<DeliveryResult[]> {
		if (this.disposed) return [];
		const results: DeliveryResult[] = [];
		for (const id of targetIds) {
			const result = await this.sendToTarget(id, payload);
			results.push(result);
		}
		return results;
	}

	/**
	 * Send a notification to a single target.
	 * Retries with exponential back-off if the sink indicates the target is temporarily unavailable.
	 */
	async sendToTarget(
		targetId: string,
		payload: NotificationPayload,
		opts?: { private?: boolean },
	): Promise<DeliveryResult> {
		if (this.disposed) return { ok: false, latencyMs: 0, err: "disposed" };

		let delay = INITIAL_RETRY_DELAY_MS;
		while (!this.disposed) {
			if (!this.sink.isAvailable(targetId)) {
				if (delay > MAX_RETRY_DELAY_MS) {
					const msg = `target=${targetId} 持续不可达，放弃推送`;
					this.logger.error(`[push] ${msg}`);
					return { ok: false, latencyMs: 0, err: msg };
				}
				this.logger.warn(`[push] target=${targetId} 暂不可达，${delay / 1000}s 后重试`);
				await this.sleep(delay);
				delay *= 2;
				continue;
			}

			const t0 = Date.now();
			try {
				const result = opts?.private
					? await this.sink.sendPrivate(targetId, payload)
					: await this.sink.send(targetId, payload);
				return result;
			} catch (e) {
				const err = e instanceof Error ? e.message : String(e);
				this.logger.error(`[push] target=${targetId} 发送失败: ${err}`);
				return { ok: false, latencyMs: Date.now() - t0, err };
			}
		}
		return { ok: false, latencyMs: 0, err: "disposed" };
	}

	/**
	 * Send a private message to the configured master target.
	 * No-op if no master is configured or target is unavailable.
	 */
	async sendToMaster(payload: NotificationPayload): Promise<DeliveryResult | null> {
		if (this.disposed || !this.master) return null;
		if (!this.sink.isAvailable(this.master.id)) {
			this.logger.warn("[push] master 目标不可达，跳过私信通知");
			return null;
		}
		return this.sendToTarget(this.master.id, payload, { private: true });
	}

	/** Convenience: send a plain-text error message to the master. */
	async sendPrivateMsg(text: string): Promise<void> {
		await this.sendToMaster({ kind: "text", text });
	}

	/** Convenience: log the error and optionally notify master. */
	async sendErrorMsg(reason: string): Promise<void> {
		this.logger.error(`[push] ${reason}`);
		await this.sendPrivateMsg(reason);
	}

	private sleep(ms: number): Promise<void> {
		if (this.disposed) return Promise.resolve();
		return new Promise((resolve) => setTimeout(resolve, ms));
	}
}
