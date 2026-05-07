import type { BilibiliPush } from "@bilibili-notify/push";
import type { Context, Logger } from "koishi";

const AUTH_LOST_NOTIFY_DEBOUNCE_MS = 60_000;

export interface HealthCheckOptions {
	ctx: Context;
	logger: Logger;
	getPush: () => BilibiliPush | null;
}

/**
 * Health-check / cookie-loss reporting on the koishi side.
 */
export class HealthCheck {
	private readonly opts: HealthCheckOptions;
	private lastNotifiedAt = 0;

	constructor(opts: HealthCheckOptions) {
		this.opts = opts;
	}

	install(): void {
		this.opts.ctx.on("bilibili-notify/auth-lost", () => {
			void this.notifyMaster();
		});
	}

	private async notifyMaster(): Promise<void> {
		const now = Date.now();
		if (now - this.lastNotifiedAt < AUTH_LOST_NOTIFY_DEBOUNCE_MS) return;
		this.lastNotifiedAt = now;
		try {
			await this.opts.getPush()?.sendPrivateMsg("账号登录已失效，请在控制台重新扫码登录");
		} catch (e) {
			this.opts.logger.warn(`[auth] 失效通知私信失败：${e}`);
		}
	}
}

/** Re-exported so the bootstrap can compute the bridge's `healthCheckMs` consistently. */
export const HEALTH_CHECK_AUTH_LOST_DEBOUNCE_MS = AUTH_LOST_NOTIFY_DEBOUNCE_MS;
