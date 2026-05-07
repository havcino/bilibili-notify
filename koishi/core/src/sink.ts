import type {
	DeliveryResult,
	KoishiTargetConfig,
	NotificationPayload,
	NotificationSink,
	PushTarget,
} from "@bilibili-notify/internal";
import type { Context } from "koishi";
import { type Bot, h, Universal } from "koishi";

/** Factory for creating the Koishi-side NotificationSink. */
export interface KoishiSinkOptions {
	ctx: Context;
	/** Function to resolve a PushTarget by id; usually store.findTargetById or a map lookup. */
	resolveTarget: (id: string) => PushTarget | undefined;
}

/**
 * Translates a platform-neutral NotificationPayload into koishi h(...) elements
 * and delivers them via bot.sendMessage / bot.sendPrivateMessage.
 *
 * Supported platform values: `koishi-<botPlatform>` (e.g. `koishi-onebot`).
 * The `koishi-` prefix is stripped and used to select the correct bot.
 *
 * PushTarget.config must be a KoishiTargetConfig:
 *   { botPlatform, selfId?, channelId?, guildId?, userId? }
 *
 * Scope mapping:
 *   - "group"   → bot.sendMessage(channelId, content, guildId?)
 *   - "channel" → bot.sendMessage(channelId, content, guildId?)
 *   - "private" → bot.sendPrivateMessage(userId, content, guildId?)
 */
export function createKoishiSink(opts: KoishiSinkOptions): NotificationSink {
	const { ctx, resolveTarget } = opts;

	function getBot(botPlatform: string, selfId?: string): Bot | undefined {
		// biome-ignore lint/suspicious/noExplicitAny: Bot generic context compatibility
		return ctx.bots.find(
			(b: Bot) => b.platform === botPlatform && (!selfId || selfId === "" || b.selfId === selfId),
		) as Bot | undefined;
	}

	function payloadToKoishi(payload: NotificationPayload): unknown {
		switch (payload.kind) {
			case "text":
				return h.text(payload.text);
			case "image": {
				const img = h.image(payload.image.buffer, payload.image.mime);
				if (payload.caption) {
					return h("message", [img, h.text(payload.caption)]);
				}
				return h("message", [img]);
			}
			case "composite": {
				const parts = payload.segments.map((seg) => {
					if (seg.type === "text") return h.text(seg.text);
					if (seg.type === "image") return h.image(seg.buffer, seg.mime);
					if (seg.type === "link") return h.text(seg.href);
					return h.text("");
				});
				return h("message", parts);
			}
		}
	}

	async function deliver(
		targetId: string,
		payload: NotificationPayload,
		forcePrivate: boolean,
	): Promise<DeliveryResult> {
		const t0 = Date.now();

		const target = resolveTarget(targetId);
		if (!target) {
			return { ok: false, latencyMs: 0, err: `target ${targetId} not found` };
		}
		if (!target.enabled) {
			return { ok: false, latencyMs: 0, err: `target ${targetId} is disabled` };
		}

		// Only handle koishi-* platforms
		if (!target.platform.startsWith("koishi-")) {
			return {
				ok: false,
				latencyMs: 0,
				err: `unsupported platform ${target.platform} for KoishiSink`,
			};
		}

		const botPlatform = target.platform.slice("koishi-".length);
		const cfg = target.config as KoishiTargetConfig;
		const bot = getBot(botPlatform, cfg.selfId);

		if (!bot) {
			return {
				ok: false,
				latencyMs: 0,
				err: `no bot found for platform ${botPlatform}`,
			};
		}

		if (bot.status !== Universal.Status.ONLINE) {
			return {
				ok: false,
				latencyMs: 0,
				err: `bot ${bot.selfId} is not online`,
			};
		}

		const content = payloadToKoishi(payload);
		const isPrivate = forcePrivate || target.scope === "private";

		try {
			if (isPrivate) {
				if (!cfg.userId) {
					return { ok: false, latencyMs: 0, err: `private target ${targetId} missing userId` };
				}
				await bot.sendPrivateMessage(
					cfg.userId,
					content as Parameters<typeof bot.sendPrivateMessage>[1],
					cfg.guildId,
				);
			} else {
				if (!cfg.channelId) {
					return { ok: false, latencyMs: 0, err: `group target ${targetId} missing channelId` };
				}
				await bot.sendMessage(
					cfg.channelId,
					content as Parameters<typeof bot.sendMessage>[1],
					cfg.guildId,
				);
			}
			return { ok: true, latencyMs: Date.now() - t0 };
		} catch (e) {
			const err = e instanceof Error ? e.message : String(e);
			return { ok: false, latencyMs: Date.now() - t0, err };
		}
	}

	return {
		send(targetId, payload) {
			return deliver(targetId, payload, false);
		},
		sendPrivate(targetId, payload) {
			return deliver(targetId, payload, true);
		},
		resolve(targetId) {
			return resolveTarget(targetId);
		},
		isAvailable(targetId) {
			const target = resolveTarget(targetId);
			if (!target?.enabled) return false;
			if (!target.platform.startsWith("koishi-")) return false;
			const botPlatform = target.platform.slice("koishi-".length);
			const cfg = target.config as KoishiTargetConfig;
			const bot = getBot(botPlatform, cfg.selfId);
			return bot?.status === Universal.Status.ONLINE;
		},
	};
}
