import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Constant-time string compare. `===` short-circuits and leaks the matching
 * prefix length (rate-limiting mitigates but does not eliminate the oracle).
 * Hashing both sides to a fixed-length SHA-256 digest first makes the compare
 * both constant-time and length-independent.
 *
 * Extracted from the removed `basic-auth-rate-limited.ts`; now used by the
 * session-login credential check.
 */
export function safeEqual(a: string, b: string): boolean {
	const ha = createHash("sha256").update(a).digest();
	const hb = createHash("sha256").update(b).digest();
	return timingSafeEqual(ha, hb);
}
