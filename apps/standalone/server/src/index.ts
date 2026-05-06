import { type ServerType, serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { loadBootstrapConfig } from "./config/loader.js";
import { createAppRuntime } from "./runtime/bootstrap.js";

async function main(): Promise<void> {
	const bootstrap = loadBootstrapConfig();
	const runtime = createAppRuntime(bootstrap);
	const log = runtime.serviceCtx.logger;

	log.info(
		`starting bilibili-notify standalone server: host=${bootstrap.server.host} port=${bootstrap.server.port} dataDir=${bootstrap.dataDir} logLevel=${bootstrap.logLevel}`,
	);

	// Load on-disk runtime config (state/globals.json, state/subscriptions.json, state/targets.json).
	// Seeds defaults on first boot. Failure here is fatal — we don't want to start serving HTTP
	// against a corrupt or unreadable state dir.
	await runtime.configStore.load();

	const app = createApp(runtime);
	let server: ServerType | undefined;
	await new Promise<void>((resolve) => {
		server = serve(
			{
				fetch: app.fetch,
				hostname: bootstrap.server.host,
				port: bootstrap.server.port,
			},
			(info) => {
				log.info(`listening on http://${info.address}:${info.port}`);
				resolve();
			},
		);
	});

	let shuttingDown = false;
	const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
		if (shuttingDown) return;
		shuttingDown = true;
		log.info(`received ${signal}, shutting down…`);
		try {
			if (server) {
				await new Promise<void>((resolve) => {
					server?.close(() => resolve());
				});
			}
			await runtime.dispose();
		} catch (err) {
			log.error("error during shutdown", err);
		} finally {
			process.exit(0);
		}
	};
	process.on("SIGINT", () => void shutdown("SIGINT"));
	process.on("SIGTERM", () => void shutdown("SIGTERM"));
	process.on("uncaughtException", (err) => {
		log.error("uncaughtException", err);
	});
	process.on("unhandledRejection", (err) => {
		log.error("unhandledRejection", err);
	});
}

main().catch((err) => {
	console.error("fatal startup error", err);
	process.exit(1);
});
