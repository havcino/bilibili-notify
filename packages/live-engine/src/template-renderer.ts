import type { CustomGuardBuyLike, CustomLiveMsgLike, SubItemView } from "./push-like";
import type { MasterInfo } from "./types";

/**
 * Plain string-substitution based template renderer for live-related notification
 * text. Mirrors the per-occurrence templates supported in the koishi schema:
 *
 * - `customLiveStart` / `customLive` / `customLiveEnd`
 * - `customGuardBuy.guardBuyMsg`
 * - `customSpecialDanmakuUsers.msgTemplate`
 * - `customSpecialUsersEnterTheRoom.msgTemplate`
 *
 * The variable syntax follows the existing `-name` / `-time` / `-watched` style
 * (NOT the `{key}` syntax used by `@bilibili-notify/internal`'s `interpolate`),
 * because that's what users have in their existing Koishi configs and we keep
 * 1:1 backward compatibility.
 */

/** Defaults applied when neither sub-level nor global config provides a template. */
export const DEFAULT_LIVE_TEMPLATES = {
	liveStart: "-name 开播啦，当前粉丝数：-follower\n-link",
	liveOngoing: "-name 正在直播，已播 -time，累计观看：-watched\n-link",
	liveEnd: "-name 下播啦，本次直播了 -time，粉丝变化 -follower_change",
	liveSummaryFallback: "弹幕总结",
} as const;

/**
 * Replace every variable token in one pass, then expand `\\n` escape into a
 * real newline (kept identical to live-service's `applyTemplate`).
 */
function applyTemplate(template: string, vars: Record<string, string>): string {
	let result = template;
	for (const [key, value] of Object.entries(vars)) {
		result = result.replaceAll(key, value);
	}
	return result.replaceAll("\\n", "\n");
}

/**
 * Format follower-change as a signed magnitude string with a 1万 (10K) cutoff,
 * mirroring live-service's inline formatting.
 */
export function formatFollowerChange(n: number): string {
	if (n > 0) return n >= 10_000 ? `+${(n / 10000).toFixed(1)}万` : `+${n}`;
	if (n <= -10_000) return `${(n / 10000).toFixed(1)}万`;
	return n.toString();
}

/** Format follower count, abbreviating ≥10K to `X.X万`. */
export function formatFollowerCount(n: number): string {
	return n >= 10_000 ? `${(n / 10000).toFixed(1)}万` : n.toString();
}

/** Build the canonical room link from `LiveRoomInfo.data` style fields. */
export function buildRoomLink(info: { short_id: number; room_id: number }): string {
	return `https://live.bilibili.com/${info.short_id === 0 ? info.room_id : info.short_id}`;
}

/**
 * Resolve the effective template string for a sub at a given occurrence,
 * preferring per-sub override → global config → built-in default.
 */
function resolveCustomLive(
	subCustom: CustomLiveMsgLike,
	globalCustom: CustomLiveMsgLike | undefined,
	field: "customLiveStart" | "customLive" | "customLiveEnd",
	fallback: string,
): string {
	return subCustom[field] ?? globalCustom?.[field] ?? fallback;
}

export class LiveTemplateRenderer {
	/** Compose the "开播" notification text for a sub. */
	renderLiveStart(params: {
		sub: SubItemView;
		globalCustom?: CustomLiveMsgLike;
		master: MasterInfo;
		diffTime: string;
		followerNum: string;
		roomLink: string;
	}): string {
		const tmpl = resolveCustomLive(
			params.sub.customLiveMsg,
			params.globalCustom,
			"customLiveStart",
			DEFAULT_LIVE_TEMPLATES.liveStart,
		);
		return applyTemplate(tmpl, {
			"-name": params.master.username,
			"-time": params.diffTime,
			"-follower": params.followerNum,
			"-link": params.roomLink,
		});
	}

	/** Compose the periodic "正在直播" notification text. */
	renderLiveOngoing(params: {
		sub: SubItemView;
		globalCustom?: CustomLiveMsgLike;
		master: MasterInfo;
		diffTime: string;
		watched: string;
		roomLink: string;
	}): string {
		const tmpl = resolveCustomLive(
			params.sub.customLiveMsg,
			params.globalCustom,
			"customLive",
			DEFAULT_LIVE_TEMPLATES.liveOngoing,
		);
		return applyTemplate(tmpl, {
			"-name": params.master.username,
			"-time": params.diffTime,
			"-watched": params.watched,
			"-link": params.roomLink,
		});
	}

	/** Compose the "下播" notification text. */
	renderLiveEnd(params: {
		sub: SubItemView;
		globalCustom?: CustomLiveMsgLike;
		master: MasterInfo;
		diffTime: string;
		followerChange: number;
	}): string {
		const tmpl = resolveCustomLive(
			params.sub.customLiveMsg,
			params.globalCustom,
			"customLiveEnd",
			DEFAULT_LIVE_TEMPLATES.liveEnd,
		);
		return applyTemplate(tmpl, {
			"-name": params.master.username,
			"-time": params.diffTime,
			"-follower_change": formatFollowerChange(params.followerChange),
		});
	}

	/**
	 * Compose the "上舰" notification text using the effective custom-guard
	 * config (resolved by listener-manager).
	 */
	renderGuardBuy(params: {
		guardBuyConfig: CustomGuardBuyLike;
		uname: string;
		master: MasterInfo | undefined;
		giftName: string;
	}): string {
		return applyTemplate(params.guardBuyConfig.guardBuyMsg ?? "", {
			"-uname": params.uname,
			"-mname": params.master?.username ?? "",
			"-guard": params.giftName,
		});
	}

	/** Compose the "特别关注弹幕" notification text. */
	renderSpecialDanmaku(params: {
		template: string;
		uname: string;
		master: MasterInfo | undefined;
		content: string;
	}): string {
		return applyTemplate(params.template, {
			"-mastername": params.master?.username ?? "",
			"-uname": params.uname,
			"-msg": params.content,
		});
	}

	/** Compose the "特别关注进入直播间" notification text. */
	renderSpecialUserEnter(params: {
		template: string;
		uname: string;
		master: MasterInfo | undefined;
	}): string {
		return applyTemplate(params.template, {
			"-mastername": params.master?.username ?? "",
			"-uname": params.uname,
		});
	}

	/**
	 * Compose the templated "弹幕总结" text used as the fallback when AI
	 * summarisation is unavailable. Variables: `-dmc` (sender count), `-mdn`
	 * (master medal name), `-dca` (total danmaku), `-un1..5` (top usernames),
	 * `-dc1..5` (top counts).
	 */
	renderLiveSummary(params: {
		template: string;
		senderCount: number;
		master: MasterInfo | undefined;
		danmakuCount: number;
		topSenders: Array<[string, number]>;
	}): string {
		const top = params.topSenders;
		return applyTemplate(params.template, {
			"-dmc": `${params.senderCount}`,
			"-mdn": params.master?.medalName ?? "",
			"-dca": `${params.danmakuCount}`,
			"-un1": top[0][0],
			"-dc1": `${top[0][1]}`,
			"-un2": top[1][0],
			"-dc2": `${top[1][1]}`,
			"-un3": top[2][0],
			"-dc3": `${top[2][1]}`,
			"-un4": top[3][0],
			"-dc4": `${top[3][1]}`,
			"-un5": top[4][0],
			"-dc5": `${top[4][1]}`,
		});
	}
}
