import { Hono } from "hono";
import { createHealthRoute } from "./routes/health.js";
import type { AppRuntime } from "./runtime/bootstrap.js";

/**
 * Build the top-level Hono app. Stage 2.1 only mounts `/api/health`;
 * REST CRUD / WS upgrade / Sink wiring come in 2.2 / 2.3 / 2.4.
 */
export function createApp(runtime: AppRuntime): Hono {
	const app = new Hono();

	app.onError((err, c) => {
		runtime.serviceCtx.logger.error("unhandled request error", err);
		return c.json({ error: "internal_error", message: String(err) }, 500);
	});

	app.notFound((c) => c.json({ error: "not_found" }, 404));

	app.route("/api/health", createHealthRoute(runtime));

	return app;
}
