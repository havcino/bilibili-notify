// changesets/action 的 publish 步骤入口。CI 与本地 `pnpm release` 共用。
//
// 它做两件 `pnpm publish` 本身不会做的事:
//
// 1. 定 npm dist-tag。每次发布都必须把新版本挂到某个 dist-tag,缺省是 latest,
//    pnpm 不会因为版本号带 -alpha 就自动改。这里从 .changeset/pre.json 读 changeset
//    的 pre 模式:pre 模式发到它的 tag(如 alpha),否则 latest。pre.json 是唯一
//    开关 —— `changeset pre enter` / `changeset pre exit` 自动切换,脚本与 workflow
//    都不用手改。
//
// 2. CI 上带 --provenance。不走 `changeset publish` 是因为它不会把 --provenance
//    透传给底层的 pnpm publish,而 pnpm 11 原生发布只认 --provenance flag。
//    provenance 仅在受支持的 CI(OIDC)下可用,本地跑会直接报错,故按 CI 开关。

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { argv, env } from "node:process";
import { pathToFileURL } from "node:url";

const PRE_JSON = new URL("../.changeset/pre.json", import.meta.url);

/**
 * 按 changeset pre 模式决定 npm dist-tag。
 *
 * @param {{ mode?: string; tag?: string } | null | undefined} pre
 *   .changeset/pre.json 的解析结果;文件不存在时传 null。
 * @returns {string} pre 模式且带 tag 时返回该 tag,否则 "latest"。
 */
export function resolveDistTag(pre) {
	if (pre?.mode === "pre" && pre.tag) {
		return pre.tag;
	}
	return "latest";
}

/**
 * 组装 `pnpm publish` 的参数。
 *
 * @param {{ tag: string; provenance: boolean }} opts
 * @returns {string[]} 传给 `pnpm` 的参数数组。
 */
export function buildPublishArgs({ tag, provenance }) {
	// -r 递归全 workspace:版本号已由 changeset version 写进各 package.json,pnpm 只发
	// registry 上不存在的版本、跳过 private、改写 workspace: 协议依赖。
	// --access public:scoped 的 @bilibili-notify/* 首发需要(对 unscoped 包是 no-op)。
	// --no-git-checks:跳过 pnpm 的分支 / 工作区洁净度检查。
	const args = ["publish", "-r", "--tag", tag, "--access", "public", "--no-git-checks"];
	if (provenance) {
		args.push("--provenance");
	}
	return args;
}

function readPreJson() {
	if (!existsSync(PRE_JSON)) {
		return null;
	}
	return JSON.parse(readFileSync(PRE_JSON, "utf8"));
}

function main() {
	const tag = resolveDistTag(readPreJson());
	const provenance = Boolean(env.CI);
	console.log(`[publish] dist-tag = ${tag} · provenance = ${provenance}`);
	execFileSync("pnpm", buildPublishArgs({ tag, provenance }), { stdio: "inherit" });
}

if (argv[1] && import.meta.url === pathToFileURL(argv[1]).href) {
	main();
}
