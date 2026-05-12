import { useEffect } from "react";
import { onWsEvent, subscribeChannels } from "../services/wsSingleton";
import { useAlertStore } from "../store/alerts";

/**
 * 订阅 WS `log` 频道并过滤出 `engine-error` 帧塞进 `useAlertStore`。
 *
 * Server contract (apps/server/src/ws/channels.ts):
 *   envelope = { type: "log", event: "engine-error", data: [source, message] }
 */
export function useAlertChannel(): void {
	const push = useAlertStore((s) => s.push);
	useEffect(() => {
		subscribeChannels(["log"]);
		return onWsEvent((env) => {
			if (env.type !== "log") return;
			if (env.event !== "engine-error") return;
			const data = env.data;
			if (!Array.isArray(data) || data.length < 2) return;
			const [source, message] = data as [unknown, unknown];
			if (typeof source !== "string" || typeof message !== "string") return;
			push({ source, message });
		});
	}, [push]);
}
