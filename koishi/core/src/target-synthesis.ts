import { randomUUID } from "node:crypto";
import type { PushTarget } from "@bilibili-notify/internal";

/**
 * Synthesize a PushTarget from a legacy flat-config channel entry.
 *
 * Example:
 *   platform = "koishi-onebot", channelId = "12345678"
 *   → PushTarget { id: <uuid>, name: "onebot:12345678", platform: "koishi-onebot",
 *                  scope: "group", config: { botPlatform: "onebot", channelId: "12345678" },
 *                  enabled: true }
 */
export function synthesizeTargetsForFlatSub(koishiPlatform: string, channelId: string): PushTarget {
	const botPlatform = koishiPlatform.startsWith("koishi-")
		? koishiPlatform.slice("koishi-".length)
		: koishiPlatform;

	return {
		id: randomUUID(),
		name: `${botPlatform}:${channelId}`,
		platform: koishiPlatform,
		scope: "group",
		config: {
			botPlatform,
			channelId,
		},
		enabled: true,
	};
}

/**
 * Synthesize a PushTarget for the master account (private message).
 *
 * Example:
 *   platform = "koishi-onebot", userId = "987654321"
 *   → PushTarget { ..., scope: "private", config: { botPlatform: "onebot", userId: "987654321" } }
 */
export function synthesizeMasterTarget(
	platform: string,
	userId: string,
	guildId?: string,
): PushTarget {
	const koishiPlatform = platform.startsWith("koishi-") ? platform : `koishi-${platform}`;
	const botPlatform = koishiPlatform.slice("koishi-".length);
	return {
		id: randomUUID(),
		name: `master:${botPlatform}:${userId}`,
		platform: koishiPlatform,
		scope: "private",
		config: {
			botPlatform,
			userId,
			guildId,
		},
		enabled: true,
	};
}
