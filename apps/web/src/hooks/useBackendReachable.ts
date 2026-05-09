import { useQuery } from "@tanstack/react-query";
import { api } from "../services/api";

interface HealthSnapshot {
	status: string;
	uptime: number;
}

/**
 * Sticky "is the backend reachable right now" signal, shared with every
 * useQuery(["health"]) observer in the tree (App-level probe defines the
 * cache entry; this hook only reads it). After a successful fetch, tanstack
 * keeps `data` populated even when subsequent refetches fail — relying on
 * `data`/`isError` alone makes the dashboard look healthy long after the
 * backend has gone away. dataUpdatedAt vs errorUpdatedAt is the clean way to
 * ask "did the most recent attempt land or error".
 */
export function useBackendReachable(): boolean {
	const health = useQuery({
		queryKey: ["health"],
		queryFn: () => api.get<HealthSnapshot>("/api/health"),
		retry: 0,
		refetchInterval: 5_000,
	});
	if (!health.data) return false;
	return health.dataUpdatedAt >= health.errorUpdatedAt;
}
