/**
 * 回归守护 — P0-1 fix(live): route live-summary independently from wordcloud。
 *
 * adapter 的 typeToFeature 映射表是 koishi 端 PushLike → BilibiliPush.broadcastToFeature
 * 之间的唯一翻译层。任何人删错一行,直播相关路由静默错位。这里锁住所有 LivePushType
 * 数字的目标 FeatureKey。
 */

import { describe, expect, it } from "vitest";
import { liveTypeToFeature } from "../live-type-map";

describe("koishi/live adapter typeToFeature", () => {
	it("LivePushType 完整映射表", () => {
		expect(liveTypeToFeature(0)).toBe("live"); // Live
		expect(liveTypeToFeature(3)).toBe("live"); // StartBroadcasting
		expect(liveTypeToFeature(4)).toBe("liveGuardBuy");
		expect(liveTypeToFeature(5)).toBe("wordcloud"); // WordCloudAndLiveSummary → 仅词云
		expect(liveTypeToFeature(6)).toBe("superchat");
		expect(liveTypeToFeature(7)).toBe("specialDanmaku");
		expect(liveTypeToFeature(8)).toBe("specialUserEnter");
		expect(liveTypeToFeature(9)).toBe("liveEnd");
		expect(liveTypeToFeature(10)).toBe("liveSummary"); // P0-1 新加,与 5 解耦
	});

	it("未知 type 兜底为 live", () => {
		expect(liveTypeToFeature(999)).toBe("live");
	});
});
