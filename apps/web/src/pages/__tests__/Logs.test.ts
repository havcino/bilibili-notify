import { describe, expect, it } from "vitest";
import { formatLocalTime } from "../Logs";

describe("formatLocalTime", () => {
	it("返回浏览器本地时区的 HH:MM:SS.sss 字面格式", () => {
		const out = formatLocalTime("2026-05-20T01:02:03.004Z");
		expect(out).toMatch(/^\d{2}:\d{2}:\d{2}\.\d{3}$/);
	});

	it("毫秒位永远 3 位 padding(避免出现 :3 而非 :003)", () => {
		const out = formatLocalTime("2026-05-20T01:02:03.004Z");
		const ms = out.split(".")[1];
		expect(ms).toHaveLength(3);
	});

	it("ISO 解析失败时回退到原字符串的 slice(11,23)", () => {
		// 不是合法 ISO,new Date() → Invalid Date → getTime() = NaN → 走回退分支
		expect(formatLocalTime("not-an-iso")).toBe("");
		expect(formatLocalTime("2026-05-20Tinvalid")).toBe("invalid");
	});
});
