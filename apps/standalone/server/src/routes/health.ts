import { Hono } from "hono";
import type { AppRuntime } from "../runtime/bootstrap.js";

interface HealthResponse {
	status: "ok";
	version: string;
	uptime: number;
	/** Timestamp of when this server process started, ISO 8601. */
	startedAt: string;
	/** Stage 2.1 stub fields — populated for real once the engines wire in (2.3 / 2.4). */
	login: string | null;
	push: string | null;
	dynamicCron: string | null;
	history: string | null;
}

const SERVER_PKG_VERSION = "0.0.0";
const startedAtMs = Date.now();

/** Mounts `GET /api/health` onto a new Hono app. */
export function createHealthRoute(_runtime: AppRuntime): Hono {
	const app = new Hono();
	app.get("/", (c) => {
		const body: HealthResponse = {
			status: "ok",
			version: SERVER_PKG_VERSION,
			uptime: Math.floor((Date.now() - startedAtMs) / 1000),
			startedAt: new Date(startedAtMs).toISOString(),
			login: null,
			push: null,
			dynamicCron: null,
			history: null,
		};
		return c.json(body);
	});
	return app;
}
