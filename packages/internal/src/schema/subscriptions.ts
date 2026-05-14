import { z } from "zod";
import {
	AIPersonaSchema,
	CardStylePartialSchema,
	ContentFiltersPartialSchema,
	FEATURE_KEYS,
	FeatureFlagsPartialSchema,
	type FeatureKey,
	ScheduleConfigPartialSchema,
	TemplateBundlePartialSchema,
} from "./common";

/**
 * 路由：每个特性 → PushTarget.id[]。空数组 = 该特性不推。
 * 用 record + 显式 keys 而不是 partial，便于 UI 始终展示所有特性的开关。
 */
export const SubscriptionRoutingSchema = z.object(
	Object.fromEntries(FEATURE_KEYS.map((k) => [k, z.array(z.uuid())])) as {
		[K in FeatureKey]: z.ZodArray<z.ZodUUID>;
	},
);
export type SubscriptionRouting = z.infer<typeof SubscriptionRoutingSchema>;

/**
 * 缓存的 UP 主档案，用于 UI 显示。non-authoritative，启动 / 心跳时刷新。
 */
export const CachedProfileSchema = z.object({
	name: z.string(),
	avatar: z.string(),
	sign: z.string(),
	fans: z.number().int().min(0),
	lastRefreshedAt: z.string(),
});
export type CachedProfile = z.infer<typeof CachedProfileSchema>;

/**
 * 特别关注用户：进房 / 弹幕 触发自定义模板推送。
 */
export const SpecialUserSchema = z.object({
	uid: z.string(),
	kinds: z.array(z.enum(["enter", "danmaku"])).min(1),
	template: z.string().optional(),
});
export type SpecialUser = z.infer<typeof SpecialUserSchema>;

/**
 * AI 覆盖：preset 决定使用哪一份 persona/prompt。
 * - 'inherit'：直接继承 GlobalConfig.defaults.ai（其它字段被 resolveAI 忽略）
 * - 'custom'：使用本对象中的 persona/dynamicPrompt/liveSummaryPrompt（缺失项继承全局）
 * - 任意其它字符串：解读为 GlobalConfig.defaults.ai.presets 中对应 preset.id；
 *   解析失败时回退到 'custom' 行为（用本对象现存字段）
 *
 * 单 schema 设计：persona/prompts 字段无论 preset 取何值都允许（"inherit" 时它们仅被忽略）。
 * 这样避免 TS 在 z.union 中对 "inherit" / "custom" / 任意 preset.id 的 narrowing 失败。
 */
export const AIOverrideSchema = z.object({
	preset: z.string(),
	persona: AIPersonaSchema.optional(),
	dynamicPrompt: z.string().optional(),
	liveSummaryPrompt: z.string().optional(),
	temperature: z.number().min(0).max(2).optional(),
});
export type AIOverride = z.infer<typeof AIOverrideSchema>;

/**
 * @全体 修饰符。dynamic / live 是 PushTarget.id 列表,语义:**在该 target 收到对应主推送时**
 * 额外追加 `{ type: "at-all" }` 段。约束:必须是 routing[feature] 的子集 ——「单独开 @」无效。
 *
 * - `atAll.dynamic ⊆ routing.dynamic`:某 target 在 atAll.dynamic 但不在 routing.dynamic 时
 *   不发任何东西(不会单独发 @)。
 * - `atAll.live ⊆ routing.live`:仅作用于 LivePushType.Live (开播),不冲 liveEnd / SC /
 *   上舰 / 词云 / AI 总结。这些子事件即便对应 target 在 atAll.live 里也不 @。
 *
 * SubscriptionSchema.refine() 强制子集约束;违反约束的旧数据 parse 时报错。
 */
export const SubscriptionAtAllSchema = z.object({
	dynamic: z.array(z.uuid()).default([]),
	live: z.array(z.uuid()).default([]),
});
export type SubscriptionAtAll = z.infer<typeof SubscriptionAtAllSchema>;

/**
 * 单 UP 的覆盖配置；任意字段为 undefined 表示继承 GlobalConfig.defaults。
 */
export const SubscriptionOverridesSchema = z.object({
	features: FeatureFlagsPartialSchema.optional(),
	filters: ContentFiltersPartialSchema.optional(),
	schedule: ScheduleConfigPartialSchema.optional(),
	templates: TemplateBundlePartialSchema.optional(),
	ai: AIOverrideSchema.optional(),
	cardStyle: CardStylePartialSchema.optional(),
});
export type SubscriptionOverrides = z.infer<typeof SubscriptionOverridesSchema>;

/**
 * fans 时序的「订阅起点」基线。FansPoller 第一次给该订阅取到 fans 值时写入,
 * 此后永不变。24h / 7d 的 delta 由后端读取 fans jsonl 时序计算,不在 schema 中。
 */
export const FansBaselineSchema = z.object({
	value: z.number().int().min(0),
	ts: z.string(),
});
export type FansBaseline = z.infer<typeof FansBaselineSchema>;

/**
 * 运行时状态。Dashboard 只读展示；不持久化到 koishi config，独立端持久化到 state.json。
 */
export const SubscriptionStateSchema = z.object({
	lastDynamicId: z.string().optional(),
	lastPushedAt: z.object({
		dynamic: z.string().optional(),
		live: z.string().optional(),
	}),
	liveStatus: z.enum(["idle", "live", "unknown"]),
	fansBaseline: FansBaselineSchema.optional(),
});
export type SubscriptionState = z.infer<typeof SubscriptionStateSchema>;

/**
 * 单一订阅模型，统一 SubItem (基础) + AdvancedSubItem (高级) 两套。
 * id 与 uid 分离：id 是 dashboard 内部稳定标识；uid 是 B 站用户 ID。
 */
export const SubscriptionSchema = z
	.object({
		id: z.uuid(),
		uid: z.string().regex(/^\d+$/, "uid must be a numeric Bilibili UID string"),
		enabled: z.boolean(),
		groups: z.array(z.string()).default([]),
		notes: z.string().optional(),
		cachedProfile: CachedProfileSchema.optional(),
		routing: SubscriptionRoutingSchema,
		atAll: SubscriptionAtAllSchema.default({ dynamic: [], live: [] }),
		overrides: SubscriptionOverridesSchema,
		specialUsers: z.array(SpecialUserSchema).default([]),
		state: SubscriptionStateSchema,
	})
	.refine((s) => s.atAll.dynamic.every((t) => s.routing.dynamic.includes(t)), {
		message: "atAll.dynamic must be a subset of routing.dynamic",
		path: ["atAll", "dynamic"],
	})
	.refine((s) => s.atAll.live.every((t) => s.routing.live.includes(t)), {
		message: "atAll.live must be a subset of routing.live",
		path: ["atAll", "live"],
	});
export type Subscription = z.infer<typeof SubscriptionSchema>;

/** 工厂：创建一个完全继承全局默认的空 Subscription（routing 全空、overrides 全 undefined）。 */
export function makeEmptySubscription(opts: { id: string; uid: string }): Subscription {
	const emptyRouting = Object.fromEntries(
		FEATURE_KEYS.map((k) => [k, [] as string[]]),
	) as SubscriptionRouting;
	return {
		id: opts.id,
		uid: opts.uid,
		enabled: true,
		groups: [],
		notes: undefined,
		cachedProfile: undefined,
		routing: emptyRouting,
		atAll: { dynamic: [], live: [] },
		overrides: {},
		specialUsers: [],
		state: {
			lastDynamicId: undefined,
			lastPushedAt: {},
			liveStatus: "unknown",
		},
	};
}
