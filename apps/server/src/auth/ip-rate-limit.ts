import { getConnInfo } from "@hono/node-server/conninfo";
import type { Context } from "hono";

/**
 * Per-IP failure token-bucket. Extracted from the removed
 * `basic-auth-rate-limited.ts` (P0-5). Under the cookie-session model the
 * brute-force surface moved off `/api/*` (now a cheap HMAC verify) onto
 * `POST /api/session/login` — this limiter guards that one endpoint.
 *
 * IP = `getConnInfo(c).remote.address` (the directly-connected client). We do
 * NOT read `X-Forwarded-For` (forgeable); the service convention is: behind a
 * reverse proxy, enforce auth at the proxy. `getConnInfo` throws on hono's
 * in-memory `app.request()` (unit tests) → we fall back to "unknown", so all
 * test requests share one bucket — exactly the predictable behaviour tests
 * want, with no production impact (real sockets get real IPs).
 */
export type IpRateLimitEvent =
	| { type: "blocked"; ip: string; retryAfterMs: number }
	| { type: "failure"; ip: string; failures: number }
	| { type: "success"; ip: string };

export interface IpRateLimiterOptions {
	/** Failures before the IP is blocked. Default 5. */
	maxFailures?: number;
	/** Block duration once tripped, ms. Default 60s. */
	blockMs?: number;
	onEvent?: (event: IpRateLimitEvent) => void;
}

export interface IpRateLimiter {
	/** Resolve the client IP for a hono ctx ("unknown" for in-memory reqs). */
	ip(c: Context): string;
	/**
	 * Remaining block time in ms if `ip` is currently blocked, else null. Pure
	 * query — emits NO event (an attacker can hammer a blocked endpoint
	 * arbitrarily fast; logging on every probe was a pre-auth log/disk DoS).
	 * The `blocked` event is edge-triggered from {@link fail} instead.
	 */
	blocked(ip: string): number | null;
	/**
	 * Record an auth failure; emits a `failure` event, plus a one-shot
	 * `blocked` event on the transition into a (re)blocked state. Returns the
	 * post-state. Contract: callers MUST check {@link blocked} first and skip
	 * `fail` while actively blocked (the session route does) — the limiter
	 * additionally guards the edge internally so a misbehaving caller can't
	 * re-emit `blocked` every call.
	 */
	fail(ip: string): { failures: number; blocked: boolean };
	/** Clear failure state after a successful auth. */
	succeed(ip: string): void;
}

interface IpState {
	failures: number;
	blockedUntil?: number;
}

export function createIpRateLimiter(opts: IpRateLimiterOptions = {}): IpRateLimiter {
	const maxFailures = opts.maxFailures ?? 5;
	const blockMs = opts.blockMs ?? 60_000;
	const state = new Map<string, IpState>();

	return {
		ip(c) {
			try {
				return getConnInfo(c).remote.address ?? "unknown";
			} catch {
				return "unknown";
			}
		},
		blocked(ip) {
			const entry = state.get(ip);
			if (!entry?.blockedUntil) return null;
			const remaining = entry.blockedUntil - Date.now();
			return remaining > 0 ? remaining : null;
		},
		fail(ip) {
			const entry = state.get(ip);
			const wasActivelyBlocked = !!entry?.blockedUntil && entry.blockedUntil > Date.now();
			const failures = (entry?.failures ?? 0) + 1;
			const next: IpState = { failures };
			const blocked = failures >= maxFailures;
			if (blocked) next.blockedUntil = Date.now() + blockMs;
			state.set(ip, next);
			opts.onEvent?.({ type: "failure", ip, failures });
			// Edge-trigger: emit `blocked` once on the transition into a block,
			// not on every failure past the threshold. Combined with callers
			// short-circuiting on `blocked()`, a sustained attack costs ~1
			// `blocked` log per block window instead of one per request.
			if (blocked && !wasActivelyBlocked) {
				opts.onEvent?.({ type: "blocked", ip, retryAfterMs: blockMs });
			}
			return { failures, blocked };
		},
		succeed(ip) {
			if (state.has(ip)) state.delete(ip);
			opts.onEvent?.({ type: "success", ip });
		},
	};
}
