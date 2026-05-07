import { randomUUID } from "node:crypto";
import {
	type AIScene,
	CommentaryGenerator,
	type CommentaryGeneratorConfig,
	type SessionContext,
	type SubManagement,
	type Subscriptions,
} from "@bilibili-notify/ai";
import type { BilibiliAPI } from "@bilibili-notify/api";
import {
	BILIBILI_NOTIFY_TOKEN,
	FEATURE_KEYS,
	makeEmptySubscription,
} from "@bilibili-notify/internal";
import { makeKoishiServiceContext } from "@bilibili-notify/koishi-runtime";
import { type Awaitable, type Context, Service } from "koishi";
import type {} from "koishi-plugin-bilibili-notify";
import { aiCommands } from "./commands";
import type { BilibiliNotifyAIConfig } from "./config";

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

/** Convert a SubscriptionStore to the Subscriptions map the AI tools expect. */
// biome-ignore lint/suspicious/noExplicitAny: store type from InternalsShape
function storeToAiSubs(store: any): Subscriptions {
	const subs: Subscriptions = {};
	for (const sub of store.list()) {
		subs[sub.uid] = {
			uid: sub.uid,
			uname: sub.cachedProfile?.name ?? sub.uid,
			dynamic: (sub.routing.dynamic?.length ?? 0) > 0,
			live: (sub.routing.live?.length ?? 0) > 0,
		};
	}
	return subs;
}

export class BilibiliNotifyAI extends Service<BilibiliNotifyAIConfig> {
	static readonly [Service.provide] = SERVICE_NAME;
	static readonly inject = ["bilibili-notify"];

	readonly engine: CommentaryGenerator;

	constructor(ctx: Context, config: BilibiliNotifyAIConfig) {
		super(ctx, SERVICE_NAME);
		this.config = config;
		const serviceCtx = makeKoishiServiceContext(ctx, SERVICE_NAME, config.logLevel);
		// Lazy api proxy: resolved in start()
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
		(this as unknown as { _apiHolder: typeof apiHolder })._apiHolder = apiHolder;
		aiCommands.call(this);
	}

	protected start(): Awaitable<void> {
		const internals = this.ctx["bilibili-notify"].getInternals(BILIBILI_NOTIFY_TOKEN);
		if (!internals) throw new Error("无法获取 bilibili-notify 内部实例，请确认核心插件已启动");
		const holder = (this as unknown as { _apiHolder: { api: BilibiliAPI | null } })._apiHolder;
		holder.api = internals.api;

		const { store } = internals;

		// Build SubManagement wrapping store for AI CRUD tools
		const subMgmt: SubManagement = {
			addSub: async (params) => {
				const {
					uid,
					name,
					dynamic = true,
					dynamicAtAll = false,
					live = true,
					liveAtAll = false,
					liveGuardBuy = false,
					superchat = false,
					wordcloud = true,
					liveSummary = true,
				} = params;
				const sub = makeEmptySubscription({ id: randomUUID(), uid });
				const targetIds: string[] = [randomUUID()]; // placeholder target id
				const routing = Object.fromEntries(FEATURE_KEYS.map((k) => [k, [] as string[]]));
				if (dynamic) routing.dynamic = [...targetIds];
				if (dynamicAtAll) routing.dynamicAtAll = [...targetIds];
				if (live) routing.live = [...targetIds];
				if (liveAtAll) routing.liveAtAll = [...targetIds];
				if (liveGuardBuy) routing.liveGuardBuy = [...targetIds];
				if (superchat) routing.superchat = [...targetIds];
				if (wordcloud) routing.wordcloud = [...targetIds];
				if (liveSummary) routing.liveSummary = [...targetIds];
				sub.routing = routing as typeof sub.routing;
				store.upsert(sub);
				return `已成功订阅 ${name}（UID: ${uid}）`;
			},
			removeSub: (uid) => {
				const sub = store.findByUid(uid);
				if (!sub) return `UID: ${uid} 不在订阅列表中`;
				store.removeById(sub.id);
				return `已成功取消订阅（UID: ${uid}）`;
			},
			updateSub: async (params) => {
				const sub = store.findByUid(params.uid);
				if (!sub) return `UID: ${params.uid} 不在订阅列表中`;
				const updated = { ...sub };
				const targetIds = Object.values(sub.routing)
					.flat()
					.filter((id, i, arr) => arr.indexOf(id) === i);
				const routing = { ...sub.routing };
				if (params.dynamic !== undefined) routing.dynamic = params.dynamic ? targetIds : [];
				if (params.dynamicAtAll !== undefined)
					routing.dynamicAtAll = params.dynamicAtAll ? targetIds : [];
				if (params.live !== undefined) routing.live = params.live ? targetIds : [];
				if (params.liveAtAll !== undefined) routing.liveAtAll = params.liveAtAll ? targetIds : [];
				if (params.liveGuardBuy !== undefined)
					routing.liveGuardBuy = params.liveGuardBuy ? targetIds : [];
				if (params.superchat !== undefined) routing.superchat = params.superchat ? targetIds : [];
				if (params.wordcloud !== undefined) routing.wordcloud = params.wordcloud ? targetIds : [];
				if (params.liveSummary !== undefined)
					routing.liveSummary = params.liveSummary ? targetIds : [];
				updated.routing = routing;
				store.upsert(updated);
				return `已成功更新（UID: ${params.uid}）的订阅设置`;
			},
		};

		this.engine.setSubManagement({
			getSubs: () => {
				const fresh = this.ctx["bilibili-notify"].getInternals(BILIBILI_NOTIFY_TOKEN);
				if (!fresh) return null;
				return storeToAiSubs(fresh.store);
			},
			subMgmt,
		});
		this.engine.start();
	}

	protected stop(): Awaitable<void> {
		this.engine.stop();
	}

	// ── proxy to engine ────────────────────────────────────────────────

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
