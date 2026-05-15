import type { FeatureKey } from "@bilibili-notify/internal";

/**
 * Map LivePushType numeric values to FeatureKey strings.
 *
 * 独立文件避免被 live-service.ts 的 koishi import 链拖累 — 单元测试可以 import
 * 本模块而不会触发 @koishijs/loader 等运行时只在 koishi 进程里能起的代码。
 *
 * LivePushType values: Live=0, StartBroadcasting=3, LiveGuardBuy=4,
 *   WordCloudAndLiveSummary=5, Superchat=6, UserDanmakuMsg=7, UserActions=8,
 *   LiveEnd=9, LiveSummary=10
 *
 * 必须与 `apps/server/src/runtime/engines.ts` 的同名函数保持一致 — 两端 adapter
 * 翻译表分歧会让同一业务核心在双端给出不同路由。
 */
export function liveTypeToFeature(type: number): FeatureKey {
	switch (type) {
		case 0:
		case 3:
			return "live";
		case 4:
			return "liveGuardBuy";
		case 5:
			return "wordcloud";
		case 6:
			return "superchat";
		case 7:
			return "specialDanmaku";
		case 8:
			return "specialUserEnter";
		case 9:
			return "liveEnd";
		case 10:
			return "liveSummary";
		default:
			return "live";
	}
}
