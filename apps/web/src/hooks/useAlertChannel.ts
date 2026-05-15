import { useEffect } from "react";
import type { WsEnvelope } from "../services/ws";
import { onWsEvent, subscribeChannels } from "../services/wsSingleton";
import { useAlertStore } from "../store/alerts";

/**
 * 处理 `log` 频道单条 envelope:过滤 `engine-error` + 数据形状校验,通过则 push
 * 进 alert store。提取成 export 纯函数让单测能覆盖 envelope 形状不合法时的
 * silent-drop 契约,无需渲染 hook。
 *
 * Server contract (apps/server/src/ws/channels.ts):
 *   envelope = { type: "log", event: "engine-error", data: [source, message] }
 */
export function handleLogEnvelope(env: WsEnvelope): void {
	if (env.type !== "log") return;
	if (env.event !== "engine-error") return;
	const data = env.data;
	if (!Array.isArray(data) || data.length < 2) return;
	const [source, message] = data as [unknown, unknown];
	if (typeof source !== "string" || typeof message !== "string") return;
	useAlertStore.getState().push({ source, message });
}

export function useAlertChannel(): void {
	useEffect(() => {
		subscribeChannels(["log"]);
		return onWsEvent(handleLogEnvelope);
	}, []);
}
