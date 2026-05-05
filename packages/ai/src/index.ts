import type { Context } from "koishi";
import { BilibiliNotifyAI } from "./ai-service";
import { type BilibiliNotifyAIConfig, BilibiliNotifyAIConfigSchema } from "./config";

// 平台中立的 AI 业务核心通过 ai-engine 暴露；这里 re-export 关键类型与 preset 列表，
// 让现有 koishi-plugin-bilibili-notify-ai 的消费方仍能从同一入口拿到所需符号。
export {
	type AIScene,
	CommentaryGenerator,
	type CommentaryGeneratorConfig,
	getPresetDefaults,
	PERSONA_PRESETS,
	type PersonaConfig,
	type PersonaKey,
	type PersonaPresetDefaults,
} from "@bilibili-notify/ai-engine";
export type { BilibiliNotifyAIConfig };
export { BilibiliNotifyAI };

export const name = "bilibili-notify-ai";

export const inject = {
	required: ["bilibili-notify"],
};

export type Config = BilibiliNotifyAIConfig;
export const Config = BilibiliNotifyAIConfigSchema;

export function apply(ctx: Context, config: Config): void {
	ctx.plugin(BilibiliNotifyAI, config);
}
