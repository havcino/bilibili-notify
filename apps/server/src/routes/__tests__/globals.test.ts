import { makeDefaultGlobalConfig } from "@bilibili-notify/internal";
import { describe, expect, it } from "vitest";
import { shouldRunAiEnableCheck } from "../globals.js";

/** 默认 globals + AI 启用 + 连接字段齐备。 */
function enabledAiGlobals() {
	const g = makeDefaultGlobalConfig();
	g.defaults.ai.enabled = true;
	g.defaults.ai.apiKey = "k";
	g.defaults.ai.baseUrl = "https://api.example.com";
	return g;
}

describe("shouldRunAiEnableCheck", () => {
	it("改 persona 不触发探活", () => {
		const cur = enabledAiGlobals();
		expect(shouldRunAiEnableCheck(cur, { defaults: { ai: { persona: { name: "恶魔兔" } } } })).toBe(
			false,
		);
	});

	it("改 temperature / prompt 不触发探活", () => {
		const cur = enabledAiGlobals();
		expect(shouldRunAiEnableCheck(cur, { defaults: { ai: { temperature: 0.9 } } })).toBe(false);
		expect(shouldRunAiEnableCheck(cur, { defaults: { ai: { dynamicPrompt: "x" } } })).toBe(false);
	});

	it("改连接字段 apiKey / baseUrl / model 触发探活", () => {
		const cur = enabledAiGlobals();
		expect(shouldRunAiEnableCheck(cur, { defaults: { ai: { apiKey: "k2" } } })).toBe(true);
		expect(shouldRunAiEnableCheck(cur, { defaults: { ai: { baseUrl: "https://x" } } })).toBe(true);
		expect(shouldRunAiEnableCheck(cur, { defaults: { ai: { model: "m2" } } })).toBe(true);
	});

	it("enabled 由 false→true 触发探活(即使本次没带连接字段)", () => {
		const cur = makeDefaultGlobalConfig(); // ai.enabled 默认 false
		cur.defaults.ai.apiKey = "k";
		cur.defaults.ai.baseUrl = "https://api.example.com";
		expect(shouldRunAiEnableCheck(cur, { defaults: { ai: { enabled: true } } })).toBe(true);
	});

	it("AI 最终为禁用态:改任何字段都不探活", () => {
		const cur = makeDefaultGlobalConfig(); // disabled
		expect(shouldRunAiEnableCheck(cur, { defaults: { ai: { persona: { name: "x" } } } })).toBe(
			false,
		);
		expect(shouldRunAiEnableCheck(cur, { defaults: { ai: { apiKey: "k2" } } })).toBe(false);
	});

	it("已启用态重复保存 persona(enabled 维持 true)不触发探活", () => {
		const cur = enabledAiGlobals();
		expect(
			shouldRunAiEnableCheck(cur, { defaults: { ai: { enabled: true, persona: { name: "x" } } } }),
		).toBe(false);
	});
});
