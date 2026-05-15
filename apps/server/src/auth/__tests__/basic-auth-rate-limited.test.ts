/**
 * 回归守护 — P0-5 fix(security): basic-auth rate limit
 *
 * 锁三条关键不变量:
 *   c) 5 次失败 → 429 + Retry-After 头
 *   d) block 期间正确凭证仍返回 429(check-order 不能反 — 否则 4 次错 + 1 次对绕过)
 *   e) 成功一次后失败计数清零(合法用户偶尔输错不被永久累积)
 *
 * 测试通过 `app.request()` 走 hono 内存模拟。getConnInfo 在该场景下抛错,中间件
 * fallback 为 ip="unknown",所有请求共享同一桶 — 这是测试可预测性的代价,与生产
 * 行为(真实 socket 给真 IP)无冲突。
 */

import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { createRateLimitedBasicAuth } from "../basic-auth-rate-limited";

function basicHeader(user: string, pass: string): string {
	return `Basic ${Buffer.from(`${user}:${pass}`, "utf8").toString("base64")}`;
}

function makeApp(maxFailures = 5, blockMs = 60_000): Hono {
	const app = new Hono();
	app.use(
		"/api/*",
		createRateLimitedBasicAuth({ username: "admin", password: "s3cret", maxFailures, blockMs }),
	);
	app.get("/api/probe", (c) => c.text("ok"));
	return app;
}

describe("createRateLimitedBasicAuth — P0-5", () => {
	it("c) 同 IP 失败 ≥ maxFailures 次 → 429 + Retry-After 头", async () => {
		const app = makeApp(5);

		// 前 5 次错误密码:都应该 401(失败累加但还没 block)
		for (let i = 0; i < 5; i++) {
			const r = await app.request("/api/probe", {
				headers: { Authorization: basicHeader("admin", "wrong") },
			});
			expect(r.status).toBe(401);
		}
		// 第 6 次任意请求 → 已 block,429 + Retry-After
		const blocked = await app.request("/api/probe", {
			headers: { Authorization: basicHeader("admin", "wrong") },
		});
		expect(blocked.status).toBe(429);
		expect(blocked.headers.get("Retry-After")).toBeTruthy();
	});

	it("d) block 期间正确凭证也返回 429(check-order 不能反)", async () => {
		const app = makeApp(3); // 三次失败触发,便于测试

		for (let i = 0; i < 3; i++) {
			await app.request("/api/probe", {
				headers: { Authorization: basicHeader("admin", "wrong") },
			});
		}
		// block 已生效,带正确密码也必须 429 — 否则攻击者可"3 次错 + 1 次对"绕过
		const r = await app.request("/api/probe", {
			headers: { Authorization: basicHeader("admin", "s3cret") },
		});
		expect(r.status).toBe(429);
	});

	it("e) 一次成功后失败计数清零", async () => {
		const app = makeApp(3);

		// 错 2 次(还没 block)
		for (let i = 0; i < 2; i++) {
			const r = await app.request("/api/probe", {
				headers: { Authorization: basicHeader("admin", "wrong") },
			});
			expect(r.status).toBe(401);
		}
		// 1 次成功 → 计数清零
		const ok = await app.request("/api/probe", {
			headers: { Authorization: basicHeader("admin", "s3cret") },
		});
		expect(ok.status).toBe(200);

		// 再错 2 次,应该仍是 401(若清零失败,这里会进 block 提前 429)
		for (let i = 0; i < 2; i++) {
			const r = await app.request("/api/probe", {
				headers: { Authorization: basicHeader("admin", "wrong") },
			});
			expect(r.status).toBe(401);
		}
	});
});
