/**
 * Origin allow-list — shared by the WS upgrade gate (`ws/server.ts`) and the
 * session control-plane POST routes (`routes/session.ts`).
 *
 * Semantics (single source of truth so both layers agree):
 *  - Empty / unconfigured list → gate DISABLED (everything allowed). Matches
 *    the documented "set auth.allowedOrigins for any non-localhost deploy"
 *    posture: opt-in hardening, never a hard requirement.
 *  - Configured → the request's `Origin` must be a verbatim member. A missing
 *    or non-string Origin is rejected (a browser always sends Origin on
 *    cross-site POST / WS upgrade; non-browser automation is explicitly
 *    unsupported once auth is enabled — plan Q4).
 *
 * It is a defence-in-depth layer on top of the SameSite=Strict session cookie
 * (which already blocks the meaningful cross-site cookie attacks); the residual
 * it closes is e.g. cross-site forced-logout against the unguarded
 * `/api/session/*` endpoints.
 */

export function normalizeAllowedOrigins(list: readonly string[] | undefined): string[] {
	return (list ?? []).filter((o) => o.length > 0);
}

export function isOriginAllowed(
	origin: string | undefined | null,
	allowed: readonly string[],
): boolean {
	if (allowed.length === 0) return true; // gate disabled
	if (!origin || typeof origin !== "string") return false;
	return allowed.includes(origin);
}
