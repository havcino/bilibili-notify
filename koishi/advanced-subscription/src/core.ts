/**
 * Advanced subscription adapter.
 *
 * Previously had its own runtime path (building SubItem[] and emitting Subscriptions).
 * Now it is purely a "config-shape adapter": converts the rich per-UP koishi Schema
 * into Subscription[] (new canonical format) and injects them into the main store
 * via the `bilibili-notify/advanced-sub` event.
 *
 * No independent runtime path remains — this package is a config translator.
 */

import {
	FEATURE_KEYS,
	type FeatureKey,
	makeEmptySubscription,
	type Subscription,
	type SubscriptionRouting,
} from "@bilibili-notify/internal";
import { type Context, Schema } from "koishi";
import type {} from "koishi-plugin-bilibili-notify";

// ---- Schema definition (preserved for UI) ----

type ChannelFeatureKey = FeatureKey;

type ChannelConfig = Partial<Record<ChannelFeatureKey, boolean>> & { channelId: string };

interface TargetConfig {
	platform: string;
	channelArr: ChannelConfig[];
}

const _MASTER_FEATURE_KEYS: readonly FeatureKey[] = [
	"dynamic",
	"dynamicAtAll",
	"live",
	"liveAtAll",
	"liveEnd",
	"liveGuardBuy",
	"superchat",
	"wordcloud",
	"liveSummary",
] as const;

type MasterFlagMap = Partial<Record<FeatureKey, boolean>>;

type SubItemRawConfig = MasterFlagMap & {
	uid: string;
	roomId: string;
	target: TargetConfig[];
	customLiveSummary: { enable: boolean; liveSummary?: string[] };
	customLiveMsg: {
		enable: boolean;
		customLiveStart?: string;
		customLive?: string;
		customLiveEnd?: string;
	};
	customCardStyle: {
		enable: boolean;
		cardColorStart?: string;
		cardColorEnd?: string;
		cardBasePlateColor?: string;
		cardBasePlateBorder?: string;
	};
	customGuardBuy: {
		enable: boolean;
		guardBuyMsg?: string;
		captainImgUrl?: string;
		supervisorImgUrl?: string;
		governorImgUrl?: string;
	};
	customSpecialDanmakuUsers: {
		enable: boolean;
		specialDanmakuUsers?: string[];
		msgTemplate?: string;
	};
	customSpecialUsersEnterTheRoom: {
		enable: boolean;
		specialUsersEnterTheRoom?: string[];
		msgTemplate?: string;
	};
};

export interface BilibiliNotifyAdvancedSubConfig {
	subs: Record<string, SubItemRawConfig>;
}

export const BilibiliNotifyAdvancedSubConfig: Schema<BilibiliNotifyAdvancedSubConfig> =
	Schema.object({
		subs: Schema.dict(
			Schema.object({
				uid: Schema.string().required().description("要订阅的UP主的UID"),
				roomId: Schema.string().default("").description("直播间号，留空则自动查询"),
				dynamic: Schema.boolean().default(true).description("是否订阅动态通知（总开关）"),
				dynamicAtAll: Schema.boolean()
					.default(false)
					.description("是否在动态通知中@所有人（总开关）"),
				live: Schema.boolean().default(true).description("是否订阅直播开播通知（总开关）"),
				liveAtAll: Schema.boolean().default(true).description("是否在开播通知中@所有人（总开关）"),
				liveEnd: Schema.boolean().default(true).description("是否订阅直播下播通知（总开关）"),
				liveGuardBuy: Schema.boolean().default(false).description("是否订阅上舰通知（总开关）"),
				superchat: Schema.boolean().default(false).description("是否订阅SC通知（总开关）"),
				wordcloud: Schema.boolean().default(true).description("是否订阅弹幕词云（总开关）"),
				liveSummary: Schema.boolean().default(true).description("是否订阅直播总结（总开关）"),

				target: Schema.array(
					Schema.object({
						platform: Schema.string()
							.required()
							.description("消息推送平台（如 onebot、qq、discord）"),
						channelArr: Schema.array(
							Schema.object({
								channelId: Schema.string().required().description("频道或群组号"),
								dynamic: Schema.boolean().default(true).description("动态通知"),
								dynamicAtAll: Schema.boolean().default(false).description("动态@所有人"),
								live: Schema.boolean().default(true).description("直播通知"),
								liveAtAll: Schema.boolean().default(true).description("开播@所有人"),
								liveEnd: Schema.boolean().default(true).description("下播通知"),
								liveGuardBuy: Schema.boolean().default(false).description("上舰通知"),
								superchat: Schema.boolean().default(false).description("SC通知"),
								wordcloud: Schema.boolean().default(true).description("弹幕词云"),
								liveSummary: Schema.boolean().default(true).description("直播总结"),
								specialDanmaku: Schema.boolean().default(true).description("特别关注弹幕"),
								specialUserEnter: Schema.boolean().default(true).description("特别关注进入直播间"),
							}),
						)
							.role("table")
							.required()
							.description("推送目标配置"),
					}),
				).description("推送平台和频道/群组列表"),

				customLiveSummary: Schema.intersect([
					Schema.object({
						enable: Schema.boolean().default(false).description("是否启用自定义直播总结"),
					}),
					Schema.union([
						Schema.object({
							enable: Schema.const(true).required(),
							liveSummary: Schema.array(String)
								.default([
									"🔍【弹幕情报站】本场直播数据如下：",
									"🧍‍♂️ 总共 -dmc 位-mdn上线",
									"💬 共计 -dca 条弹幕飞驰而过",
									"📊 热词云图已生成，快来看看你有没有上榜！",
									"👑 本场顶级输出选手：",
									"🥇 -un1 - 弹幕输出 -dc1 条",
									"🥈 -un2 - 弹幕 -dc2 条，萌力惊人",
									"🥉 -un3 - -dc3 条精准狙击",
									"🎖️ 特别嘉奖：-un4 & -un5",
									"你们的弹幕，我们都记录在案！🕵️‍♀️",
								])
								.role("table")
								.description(
									"直播总结模板，支持变量：-dmc（弹幕发言人数）、-mdn（勋章名）、-dca（弹幕总数）、-un1~5（弹幕排行用户）、-dc1~5（弹幕排行数量）",
								),
						}),
						Schema.object({}),
					]),
				]),

				customLiveMsg: Schema.intersect([
					Schema.object({
						enable: Schema.boolean().default(false).description("是否启用自定义直播消息"),
					}),
					Schema.union([
						Schema.object({
							enable: Schema.const(true).required(),
							customLiveStart: Schema.string().description(
								"开播消息模板，支持变量：-name（UP主名字）、-follower（粉丝数）、-link（直播间链接）",
							),
							customLive: Schema.string().description(
								"直播中消息模板，支持变量：-name（UP主名字）、-time（开播时长）、-watched（观看人数）、-link（直播间链接）",
							),
							customLiveEnd: Schema.string().description(
								"下播消息模板，支持变量：-name（UP主名字）、-follower_change（粉丝变化）、-time（开播时长）",
							),
						}),
						Schema.object({}),
					]),
				]),

				customCardStyle: Schema.intersect([
					Schema.object({
						enable: Schema.boolean().default(false).description("是否启用自定义卡片样式"),
					}),
					Schema.union([
						Schema.object({
							enable: Schema.const(true).required(),
							cardColorStart: Schema.string()
								.pattern(/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/)
								.description("卡片渐变起始颜色（16进制）"),
							cardColorEnd: Schema.string()
								.pattern(/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/)
								.description("卡片渐变结束颜色（16进制）"),
							cardBasePlateColor: Schema.string()
								.pattern(/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/)
								.description("底板颜色（16进制）"),
							cardBasePlateBorder: Schema.string()
								.pattern(/\d*\.?\d+(?:px|em|rem|%|vh|vw|vmin|vmax)/)
								.description("底板边框宽度（需带单位）"),
						}),
						Schema.object({}),
					]),
				]),

				customGuardBuy: Schema.intersect([
					Schema.object({
						enable: Schema.boolean().default(false).description("是否启用自定义上舰消息"),
					}),
					Schema.union([
						Schema.object({
							enable: Schema.const(true).required(),
							guardBuyMsg: Schema.string()
								.default("【-mname的直播间】-uname加入了大航海（-guard）")
								.description(
									"上舰消息模板，支持变量：-uname（用户昵称）、-mname（主播名字）、-guard（舰长类别）",
								),
							captainImgUrl: Schema.string()
								.default(
									"https://s1.hdslb.com/bfs/static/blive/live-pay-mono/relation/relation/assets/captain-Bjw5Byb5.png",
								)
								.description("舰长图片链接"),
							supervisorImgUrl: Schema.string()
								.default(
									"https://s1.hdslb.com/bfs/static/blive/live-pay-mono/relation/relation/assets/supervisor-u43ElIjU.png",
								)
								.description("提督图片链接"),
							governorImgUrl: Schema.string()
								.default(
									"https://s1.hdslb.com/bfs/static/blive/live-pay-mono/relation/relation/assets/governor-DpDXKEdA.png",
								)
								.description("总督图片链接"),
						}),
						Schema.object({}),
					]),
				]),

				customSpecialDanmakuUsers: Schema.intersect([
					Schema.object({
						enable: Schema.boolean().default(false).description("是否启用特别关注弹幕用户监测"),
					}),
					Schema.union([
						Schema.object({
							enable: Schema.const(true).required(),
							specialDanmakuUsers: Schema.array(String)
								.role("table")
								.description("特别关注弹幕用户列表（请填写UID），每个UID单独一行"),
							msgTemplate: Schema.string()
								.default("【-mastername的直播间】⭐ 特别关注弹幕 -uname: -msg")
								.description(
									"特别关注弹幕消息模板，支持变量：-mastername（主播名字）、-uname（用户昵称）、-msg（弹幕内容）",
								),
						}),
						Schema.object({}),
					]),
				]),

				customSpecialUsersEnterTheRoom: Schema.intersect([
					Schema.object({
						enable: Schema.boolean()
							.default(false)
							.description("是否启用特别关注用户进入直播间监测"),
					}),
					Schema.union([
						Schema.object({
							enable: Schema.const(true).required(),
							specialUsersEnterTheRoom: Schema.array(String)
								.role("table")
								.description("特别关注进入直播间用户列表（请填写UID），每个UID单独一行"),
							msgTemplate: Schema.string()
								.default("【-mastername的直播间】🌟 特别关注用户 -uname 进入了直播间")
								.description(
									"特别关注进入直播间消息模板，支持变量：-mastername（主播名字）、-uname（用户昵称）",
								),
						}),
						Schema.object({}),
					]),
				]),
			}).collapse(),
		),
	});

// ---- Conversion logic ----

/**
 * Deterministic UUID from a string (same algorithm as subscription-loader.ts).
 * Must stay in sync if changed.
 */
function deterministicUuid(input: string): string {
	let h1 = 5381;
	let h2 = 52711;
	let h3 = 0xdeadbeef;
	let h4 = 0xbaddcafe;
	for (let i = 0; i < input.length; i++) {
		const c = input.charCodeAt(i);
		h1 = (Math.imul(h1, 33) ^ c) >>> 0;
		h2 = (Math.imul(h2, 37) ^ c) >>> 0;
		h3 = (Math.imul(h3, 31) ^ c) >>> 0;
		h4 = (Math.imul(h4, 29) ^ c) >>> 0;
	}
	const toHex = (n: number, len: number) => n.toString(16).padStart(len, "0");
	return `${toHex(h1, 8)}-${toHex(h2 & 0xffff, 4)}-4${toHex((h3 >> 4) & 0x0fff, 3)}-${toHex(((h4 >> 4) & 0x3fff) | 0x8000, 4)}-${toHex(h1 ^ h2, 8)}${toHex(h3 ^ h4, 4)}`;
}

function rawConfigToSubscription(_name: string, raw: SubItemRawConfig): Subscription {
	const uid = raw.uid;
	const subId = deterministicUuid(`sub:${uid}`);
	const sub = makeEmptySubscription({ id: subId, uid });

	// Build routing from the per-channel config
	const routing: SubscriptionRouting = Object.fromEntries(
		FEATURE_KEYS.map((k) => [k, [] as string[]]),
	) as SubscriptionRouting;

	for (const entry of raw.target ?? []) {
		const { platform, channelArr } = entry;
		if (!channelArr?.length) continue;
		const koishiPlatform = `koishi-${platform}`;

		for (const ch of channelArr) {
			// Synthesize a target id for this channel (deterministic by platform+channelId)
			const targetId = deterministicUuid(`target:${koishiPlatform}:${ch.channelId}`);

			for (const featureKey of FEATURE_KEYS) {
				// Channel-level enable: check ch[featureKey]
				const chEnabled = ch[featureKey as keyof typeof ch] as boolean | undefined;
				if (chEnabled === false) continue;

				// Master-level gating: if the master switch is explicitly false, skip
				const masterEnabled = raw[featureKey as keyof SubItemRawConfig] as boolean | undefined;
				if (masterEnabled === false) continue;

				if (!routing[featureKey]) routing[featureKey] = [];
				if (!routing[featureKey].includes(targetId)) {
					routing[featureKey].push(targetId);
				}
			}
		}
	}

	sub.routing = routing;

	// Map custom overrides to the new overrides schema
	const cardStyle = raw.customCardStyle;
	if (cardStyle?.enable) {
		sub.overrides.cardStyle = {
			cardColorStart: cardStyle.cardColorStart,
			cardColorEnd: cardStyle.cardColorEnd,
			cardBasePlateColor: cardStyle.cardBasePlateColor,
			cardBasePlateBorder: cardStyle.cardBasePlateBorder,
		};
	}

	const liveMsg = raw.customLiveMsg;
	if (liveMsg?.enable) {
		sub.overrides.templates = {
			...(sub.overrides.templates ?? {}),
			...(liveMsg.customLiveStart !== undefined ? { liveStart: liveMsg.customLiveStart } : {}),
			...(liveMsg.customLive !== undefined ? { liveOngoing: liveMsg.customLive } : {}),
			...(liveMsg.customLiveEnd !== undefined ? { liveEnd: liveMsg.customLiveEnd } : {}),
		};
	}

	const guardBuy = raw.customGuardBuy;
	if (guardBuy?.enable) {
		const defaultUrl = (label: string) =>
			`https://s1.hdslb.com/bfs/static/blive/live-pay-mono/relation/relation/assets/${label}`;
		sub.overrides.templates = {
			...(sub.overrides.templates ?? {}),
			guardBuy: {
				captain: {
					imageUrl: guardBuy.captainImgUrl ?? defaultUrl("captain-Bjw5Byb5.png"),
					template: guardBuy.guardBuyMsg ?? "{user} 成为了 {mastername} 的舰长！",
				},
				commander: {
					imageUrl: guardBuy.supervisorImgUrl ?? defaultUrl("supervisor-u43ElIjU.png"),
					template: guardBuy.guardBuyMsg ?? "{user} 成为了 {mastername} 的提督！",
				},
				governor: {
					imageUrl: guardBuy.governorImgUrl ?? defaultUrl("governor-DpDXKEdA.png"),
					template: guardBuy.guardBuyMsg ?? "{user} 成为了 {mastername} 的总督！",
				},
			},
		};
	}

	const liveSummary = raw.customLiveSummary;
	if (liveSummary?.enable && liveSummary.liveSummary?.length) {
		sub.overrides.templates = {
			...(sub.overrides.templates ?? {}),
			liveSummary: liveSummary.liveSummary.join("\n"),
		};
	}

	// Special users
	if (raw.customSpecialDanmakuUsers?.enable) {
		const users = raw.customSpecialDanmakuUsers.specialDanmakuUsers ?? [];
		const tmpl = raw.customSpecialDanmakuUsers.msgTemplate ?? "";
		sub.specialUsers = [
			...sub.specialUsers,
			...users.map((uid) => ({ uid, kinds: ["danmaku" as const], template: tmpl })),
		];
		if (tmpl) {
			sub.overrides.templates = {
				...(sub.overrides.templates ?? {}),
				specialDanmaku: tmpl,
			};
		}
	}

	if (raw.customSpecialUsersEnterTheRoom?.enable) {
		const users = raw.customSpecialUsersEnterTheRoom.specialUsersEnterTheRoom ?? [];
		const tmpl = raw.customSpecialUsersEnterTheRoom.msgTemplate ?? "";
		sub.specialUsers = [
			...sub.specialUsers,
			...users.map((uid) => ({ uid, kinds: ["enter" as const], template: tmpl })),
		];
		if (tmpl) {
			sub.overrides.templates = {
				...(sub.overrides.templates ?? {}),
				specialUserEnter: tmpl,
			};
		}
	}

	return sub;
}

export function applyAdvancedSub(ctx: Context, config: BilibiliNotifyAdvancedSubConfig): void {
	const buildSubs = (): Subscription[] => {
		const subs: Subscription[] = [];
		for (const [name, raw] of Object.entries(config.subs)) {
			subs.push(rawConfigToSubscription(name, raw));
		}
		return subs;
	};

	ctx.emit("bilibili-notify/advanced-sub", buildSubs());

	ctx.on("bilibili-notify/ready-to-receive", () => {
		ctx.emit("bilibili-notify/advanced-sub", buildSubs());
	});
}
