import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { onWsEvent, subscribeChannels } from "../services/wsSingleton";

/**
 * Subscribes to the WS `state` channel and invalidates relevant queries when
 * the server reports a config change. Mounted once at the app root so the
 * cache stays fresh across pages without each page re-subscribing.
 *
 * 处理两种帧:
 *   - `hydrate`(订阅时 + 重连后立即发一次):无脑 invalidate 全部三类 query,让
 *     断线期间错过的 globals/subs/targets 变化能在重连后自动重 fetch — 这是 WS
 *     重连唯一的"赶上 missed change"机制(WS 不重放历史事件)。
 *   - `config-changed`(运行时配置写入):按 scope 精准 invalidate 单一 query。
 *
 * Server scopes (`config-changed.scope`):
 *   - "subscriptions" → invalidate ["subscriptions"]
 *   - "targets"       → invalidate ["targets"]
 *   - "globals"       → invalidate ["globals"]
 *   - "secrets"       → no client cache, ignored
 */
export function useStateChannel(): void {
	const qc = useQueryClient();
	useEffect(() => {
		subscribeChannels(["state"]);
		return onWsEvent((env) => {
			if (env.type !== "state") return;
			if (env.event === "hydrate") {
				qc.invalidateQueries({ queryKey: ["globals"] });
				qc.invalidateQueries({ queryKey: ["subscriptions"] });
				qc.invalidateQueries({ queryKey: ["targets"] });
				return;
			}
			if (env.event !== "config-changed") return;
			const scope = (env.data as { scope?: string } | undefined)?.scope;
			if (scope === "subscriptions") qc.invalidateQueries({ queryKey: ["subscriptions"] });
			else if (scope === "targets") qc.invalidateQueries({ queryKey: ["targets"] });
			else if (scope === "globals") qc.invalidateQueries({ queryKey: ["globals"] });
		});
	}, [qc]);
}
