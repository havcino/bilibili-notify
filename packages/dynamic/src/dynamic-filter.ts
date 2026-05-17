import type { Logger } from "@bilibili-notify/internal";
import type { Dynamic, DynamicFilterConfig, DynamicFilterResult } from "./types";
import { DynamicFilterReason as Reason } from "./types";

function collectRichText(dynamic: Dynamic, texts: string[]): void {
	const richTextNodes = dynamic.modules?.module_dynamic?.desc?.rich_text_nodes;
	if (richTextNodes?.length) {
		texts.push(richTextNodes.map((n) => n.text ?? "").join(""));
	}
	const summaryNodes = dynamic.modules?.module_dynamic?.major?.opus?.summary?.rich_text_nodes;
	if (summaryNodes?.length) {
		texts.push(summaryNodes.map((n) => n.text ?? "").join(""));
	}
	const title = dynamic.modules?.module_dynamic?.major?.opus?.title;
	if (title) texts.push(title);
	const archiveTitle = dynamic.modules?.module_dynamic?.major?.archive?.title;
	if (archiveTitle) texts.push(archiveTitle);
}

function getDynamicText(dynamic: Dynamic): string {
	const texts: string[] = [];
	collectRichText(dynamic, texts);
	if (dynamic.orig) collectRichText(dynamic.orig, texts);
	return texts.join("\n");
}

const MAX_REGEX_PATTERN_LEN = 200;
const MAX_REGEX_TEST_TEXT_LEN = 10_000;

/**
 * 粗筛灾难性回溯(指数级 ReDoS)的教科书构造:对「内部含无界量词的分组」
 * 整体再施加量词 —— `(a+)+` / `(.*)*` / `(\w+\s?)+` / `(?:a+)*` 等。这是
 * 启发式(非完备 ReDoS 分析,完备需 RE2/safe-regex 依赖,超出范围),只覆盖
 * 真实世界绝大多数单组嵌套量词形态;命中即拒,按"无效正则"语义返回 false。
 */
function looksCatastrophic(src: string): boolean {
	return /\((?:\?[:=!][^)]*|[^)]*)[+*][^)]*\)\s*[+*]/.test(src);
}

function safeRegexTest(pattern: string | undefined, text: string, logger?: Logger): boolean {
	if (!pattern) return false;
	if (pattern.length > MAX_REGEX_PATTERN_LEN || looksCatastrophic(pattern)) {
		// logger 缺省 = silent(纯函数语义);引擎层应传入 ctx.logger 让 warn 走标准日志通道。
		logger?.warn(
			`[bilibili-notify-dynamic] 拒绝执行高风险/超长正则(疑似 ReDoS):"${pattern.slice(0, 80)}"`,
		);
		return false;
	}
	try {
		// 仅对前 N 字符求值,封顶最坏输入规模(多项式回溯的输入侧上限;指数类
		// 已在上面被嵌套量词启发式拦掉)。
		const subject =
			text.length > MAX_REGEX_TEST_TEXT_LEN ? text.slice(0, MAX_REGEX_TEST_TEXT_LEN) : text;
		return new RegExp(pattern).test(subject);
	} catch (e) {
		logger?.warn(
			`[bilibili-notify-dynamic] 无效的正则表达式 "${pattern}": ${(e as Error).message}`,
		);
		return false;
	}
}

function testKeywordMatched(text: string, keywords: string[] | undefined): boolean {
	if (!keywords?.length) return false;
	return keywords.some((kw) => kw && text.includes(kw));
}

export function filterDynamic(
	dynamic: Dynamic,
	config: DynamicFilterConfig,
	logger?: Logger,
): DynamicFilterResult {
	const cfg = {
		enable: false,
		regex: "",
		keywords: [] as string[],
		forward: false,
		article: false,
		whitelistEnable: false,
		whitelistRegex: "",
		whitelistKeywords: [] as string[],
		...config,
	};

	const text = getDynamicText(dynamic);

	if (cfg.enable) {
		if (cfg.forward && dynamic.type === "DYNAMIC_TYPE_FORWARD") {
			return { blocked: true, reason: Reason.BlacklistForward };
		}
		if (cfg.article && dynamic.type === "DYNAMIC_TYPE_ARTICLE") {
			return { blocked: true, reason: Reason.BlacklistArticle };
		}
		if (safeRegexTest(cfg.regex, text, logger) || testKeywordMatched(text, cfg.keywords)) {
			return { blocked: true, reason: Reason.BlacklistKeyword };
		}
	}

	if (cfg.whitelistEnable) {
		const hasRule = !!cfg.whitelistRegex || cfg.whitelistKeywords.length > 0;
		if (
			hasRule &&
			!safeRegexTest(cfg.whitelistRegex, text, logger) &&
			!testKeywordMatched(text, cfg.whitelistKeywords)
		) {
			return { blocked: true, reason: Reason.WhitelistUnmatched };
		}
	}

	return { blocked: false };
}

export type { DynamicFilterConfig, DynamicFilterResult };
export { Reason as DynamicFilterReason };
