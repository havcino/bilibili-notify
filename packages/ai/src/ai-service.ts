import {
	type AIScene,
	CommentaryGenerator,
	type CommentaryGeneratorConfig,
	type SessionContext,
	type SubManagement,
} from "@bilibili-notify/ai-engine";
import type { BilibiliAPI } from "@bilibili-notify/api";
import { BILIBILI_NOTIFY_TOKEN } from "@bilibili-notify/internal";
import { type Awaitable, type Context, Service } from "koishi";
import type {} from "koishi-plugin-bilibili-notify";
import { aiCommands } from "./commands";
import type { BilibiliNotifyAIConfig } from "./config";
import { makeKoishiServiceContext } from "./koishi-runtime";

declare module "koishi" {
	interface Context {
		"bilibili-notify-ai": BilibiliNotifyAI;
	}
}

const SERVICE_NAME = "bilibili-notify-ai";

export type { AIScene };

function toEngineConfig(config: BilibiliNotifyAIConfig): CommentaryGeneratorConfig {
	return {
		apiKey: config.apiKey,
		baseURL: config.baseURL,
		model: config.model,
		persona: config.persona,
		dynamicPrompt: config.dynamicPrompt,
		liveSummaryPrompt: config.liveSummaryPrompt,
		enableConversation: config.enableConversation,
		maxHistory: config.maxHistory,
		enableThinking: config.enableThinking,
		enableSearch: config.enableSearch,
		enableVision: config.enableVision,
	};
}

export class BilibiliNotifyAI extends Service<BilibiliNotifyAIConfig> {
	static readonly [Service.provide] = SERVICE_NAME;
	static readonly inject = ["bilibili-notify"];

	readonly engine: CommentaryGenerator;

	constructor(ctx: Context, config: BilibiliNotifyAIConfig) {
		super(ctx, SERVICE_NAME);
		this.config = config;
		const serviceCtx = makeKoishiServiceContext(ctx, SERVICE_NAME, config.logLevel);
		// 引擎构造期需要 api，但 internals 在 start() 之后才稳定可见。这里传入一个
		// 延迟代理：start() 时把 api 实例放进 holder，引擎调用 api 方法时按需拿；
		// 缺失则抛错（与原服务实现的 'AI apiKey 未配置' 等错误处理一致）。
		const apiHolder: { api: BilibiliAPI | null } = { api: null };
		const apiProxy = new Proxy({} as BilibiliAPI, {
			get(_, prop) {
				if (!apiHolder.api) {
					throw new Error("BilibiliAPI 尚未就绪，请确认 bilibili-notify 核心插件已启动");
				}
				const value = (apiHolder.api as unknown as Record<PropertyKey, unknown>)[prop];
				if (typeof value === "function") {
					return (value as (...args: unknown[]) => unknown).bind(apiHolder.api);
				}
				return value;
			},
		});
		this.engine = new CommentaryGenerator({
			serviceCtx,
			api: apiProxy,
			config: toEngineConfig(config),
		});
		// 把 holder 暴露到实例上，供 start() 注入 api。
		(this as unknown as { _apiHolder: typeof apiHolder })._apiHolder = apiHolder;
		aiCommands.call(this);
	}

	protected start(): Awaitable<void> {
		const internals = this.ctx["bilibili-notify"].getInternals(BILIBILI_NOTIFY_TOKEN);
		if (!internals) throw new Error("无法获取 bilibili-notify 内部实例，请确认核心插件已启动");
		const holder = (this as unknown as { _apiHolder: { api: BilibiliAPI | null } })._apiHolder;
		holder.api = internals.api;

		const subMgmt: SubManagement = {
			addSub: internals.addSub,
			removeSub: internals.removeSub,
			updateSub: internals.updateSub,
		};
		this.engine.setSubManagement({
			getSubs: () => this.ctx["bilibili-notify"].getInternals(BILIBILI_NOTIFY_TOKEN)?.subs ?? null,
			subMgmt,
		});
		this.engine.start();
	}

	protected stop(): Awaitable<void> {
		this.engine.stop();
	}

	// ── 代理至 engine（保留原始 Service 公共 API） ───────────────────────────

	getSystemPrompt(scene?: AIScene, summary?: string): string {
		return this.engine.getSystemPrompt(scene, summary);
	}

	comment(content: string, scene?: AIScene, imageUrls?: string[]): Promise<string> {
		return this.engine.comment(content, scene, imageUrls);
	}

	chat(
		content: string,
		sessionId: string,
		imageUrls?: string[],
		sessionCtx?: SessionContext,
	): Promise<{ result: string; pendingActions: Array<() => Promise<void>> }> {
		return this.engine.chat(content, sessionId, imageUrls, sessionCtx);
	}

	clearSession(sessionId: string): void {
		this.engine.clearSession(sessionId);
	}

	flushPendingSubActions(pendingActions: Array<() => Promise<void>>): Promise<void> {
		return this.engine.flushPendingSubActions(pendingActions);
	}

	get sessionCount(): number {
		return this.engine.sessionCount;
	}
}
