import type { FeatureKey } from "@bilibili-notify/internal";
import type { FlatSubConfigItem } from "@bilibili-notify/subscription";
import { Schema } from "koishi";

export type { FlatSubConfigItem };

/**
 * 订阅级 features 总开关。任一关闭则 koishi 端「全局」该特性的监听 / build / 推送都
 * 不再进行——是 PR2 接通的 BilibiliPush.broadcastToFeature 头部 gate +
 * 派生视图 gate 的配置入口。per-UP 想精细控制目前只能走 dashboard;koishi 端
 * 目前只暴露全局默认。
 */
export type KoishiFeaturesConfig = Partial<Record<FeatureKey, boolean>>;

/** 免打扰时段:落进任一区间内的推送直接丢弃,粒度按「时」,半开区间 [start, end)。 */
export interface KoishiQuietHourRange {
	start: number;
	end: number;
}

export interface BilibiliNotifyConfig {
	advancedSub: boolean;
	subs: FlatSubConfigItem[];
	logLevel: number;
	userAgent?: string;
	loginHealthCheckMinutes: number;
	master: {
		enable: boolean;
		platform?: string;
		masterAccount?: string;
		masterAccountGuildId?: string;
	};
	defaults?: {
		features?: KoishiFeaturesConfig;
		quietHours?: KoishiQuietHourRange[];
	};
}

export const BilibiliNotifyConfigSchema: Schema<BilibiliNotifyConfig> = Schema.object({
	advancedSub: Schema.boolean()
		.default(false)
		.description(
			"这个开关决定是否使用高级订阅功能喔～如果主人想要超级灵活的订阅内容，就请开启并安装 bilibili-notify-advanced-subscription 呀 (๑•̀ㅂ•́)و♡",
		),

	subs: Schema.array(
		Schema.object({
			name: Schema.string().required().description("UP昵称"),
			uid: Schema.string().required().description("UID"),
			dynamic: Schema.boolean().default(true).description("动态"),
			dynamicAtAll: Schema.boolean()
				.default(false)
				.description("动态推送时是否 @全体(订阅级默认;per-target 可在 dashboard 里单独覆写)"),
			live: Schema.boolean().default(true).description("直播"),
			liveAtAll: Schema.boolean()
				.default(true)
				.description("开播推送时是否 @全体(订阅级默认;只冲开播,不冲 SC/上舰/总结)"),
			liveEnd: Schema.boolean().default(true).description("下播通知"),
			liveGuardBuy: Schema.boolean().default(false).description("上舰消息"),
			superchat: Schema.boolean().default(false).description("SC消息"),
			wordcloud: Schema.boolean().default(true).description("弹幕词云"),
			liveSummary: Schema.boolean().default(true).description("直播总结"),
			platform: Schema.string().required().description("平台名"),
			target: Schema.string().required().description("群号/频道号"),
		}),
	)
		.role("table")
		.description(
			"在这里填写主人的订阅信息～UP 昵称、UID、roomid、平台、群号都要填正确，不然女仆会迷路哒 (；>_<)如果多个群聊/频道，请用英文逗号分隔哦～女仆会努力送到每一个地方的！",
		),

	logLevel: Schema.number()
		.min(1)
		.max(3)
		.step(1)
		.default(1)
		.description(
			"这里可以设置日志等级喔～3 是最详细的调试信息，1 是只显示错误信息。主人可以根据需要选择合适的等级，让女仆更好地为您服务 (๑•̀ㅂ•́)و✧",
		),

	userAgent: Schema.string().description(
		"这里可以设置请求头的 User-Agent 哦～如果请求出现了 -352 的奇怪错误，主人可以试着在这里换一个看看 (；>_<)",
	),

	loginHealthCheckMinutes: Schema.number()
		.min(5)
		.max(180)
		.step(1)
		.default(30)
		.description(
			"登录状态周期检测的间隔（分钟）。女仆会按这个频率悄悄帮主人确认账号还在线哦～如果发现失效会立刻汇报呢 (๑•̀ㅂ•́)و✧",
		),

	master: Schema.intersect([
		Schema.object({
			enable: Schema.boolean()
				.default(false)
				.description(
					"要不要让笨笨女仆开启主人账号功能呢？(>﹏<)如果机器人遭遇了奇怪的小错误，女仆会立刻跑来向主人报告的！不、不过……如果没有私聊权限的话，女仆就联系不到主人了……请不要打开这个开关喔 (；´д｀)ゞ",
				),
		}).description("主人的特别区域……女仆会乖乖侍奉的！(>///<)"),
		Schema.union([
			Schema.object({
				enable: Schema.const(true).required(),
				platform: Schema.union([
					"qq",
					"qqguild",
					"onebot",
					"discord",
					"red",
					"telegram",
					"satori",
					"chronocat",
					"lark",
				]).description(
					"主人想让女仆在哪个平台伺候您呢？请从这里选一个吧～(〃´-`〃)♡女仆会乖乖待在主人选的地方哒！",
				),
				masterAccount: Schema.string()
					.role("secret")
					.required()
					.description(
						"请主人把自己的账号告诉女仆嘛……不然女仆会找不到主人哒 (つ﹏⊂)在 Q 群的话用 QQ 号就可以了～其他平台请用 inspect 插件告诉女仆主人的 ID 哦 (´｡• ᵕ •｡`) ♡",
					),
				masterAccountGuildId: Schema.string()
					.role("secret")
					.description(
						"如果是在 QQ 频道、Discord 这种地方……主人的群组 ID 也要告诉女仆喔 (；>_<)不然女仆会迷路找不到主人……请用 inspect 插件带女仆去看看嘛～(〃ﾉωﾉ)",
					),
			}),
			Schema.object({}),
		]),
	]),

	defaults: Schema.object({
		features: Schema.object({
			dynamic: Schema.boolean().default(true).description("是否监听动态(关掉则所有 UP 都不拉取动态)"),
			live: Schema.boolean().default(true).description("是否监听直播开播"),
			liveEnd: Schema.boolean().default(true).description("是否推送下播"),
			liveGuardBuy: Schema.boolean().default(true).description("是否推送上舰"),
			superchat: Schema.boolean().default(true).description("是否推送 SC"),
			wordcloud: Schema.boolean().default(true).description("是否生成弹幕词云"),
			liveSummary: Schema.boolean().default(true).description("是否生成直播 AI 总结"),
			specialDanmaku: Schema.boolean().default(true).description("是否监听特别关注弹幕"),
			specialUserEnter: Schema.boolean().default(true).description("是否监听特别关注进直播间"),
		}).description(
			"订阅级总开关:任一关闭则该特性在所有 UP 上停止监听 / 推送。这是 source-side gate, 跟 routing 解耦——关掉 features.X 时连 WS / cron 都不开,routing 配了也没用。",
		),
		quietHours: Schema.array(
			Schema.object({
				start: Schema.number().min(0).max(23).step(1).required().description("起始小时(0-23)"),
				end: Schema.number().min(0).max(23).step(1).required().description("结束小时(0-23,不含)"),
			}),
		)
			.role("table")
			.default([])
			.description(
				"免打扰时段:落进任一区间的推送直接丢弃,不补推。粒度按「时」,半开区间 [start, end);end<start 视为跨午夜(如 22 → 7 表示晚 22 点到次日 7 点)。",
			),
	}).description("全局默认值:features 总开关 + 免打扰时段。dashboard 端有同步入口。"),
});
