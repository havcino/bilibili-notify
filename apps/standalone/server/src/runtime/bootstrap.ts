import type { MessageBus } from "@bilibili-notify/internal";
import type { BootstrapConfig } from "../config/schema.js";
import { type ConfigStore, createConfigStore } from "../config/store.js";
import { createNodeMessageBus } from "./message-bus.js";
import { createNodeServiceContext, type NodeServiceContext } from "./service-context.js";

export interface AppRuntime {
	bootstrap: BootstrapConfig;
	serviceCtx: NodeServiceContext;
	bus: MessageBus;
	configStore: ConfigStore;
	/** Tear down everything (timers, onDispose hooks). Idempotent. */
	dispose(): Promise<void>;
}

/**
 * Glues a parsed bootstrap config + a fresh NodeServiceContext + NodeMessageBus + ConfigStore
 * into a single object. Higher layers (Hono routes, engines, sinks) consume this.
 *
 * Stage 2.1 keeps this minimal — no engines, no API client, no sink. Those wire in stage 2.2+.
 */
export function createAppRuntime(bootstrap: BootstrapConfig): AppRuntime {
	const serviceCtx = createNodeServiceContext({
		name: "bilibili-notify",
		level: bootstrap.logLevel,
	});
	const bus = createNodeMessageBus();
	const configStore = createConfigStore({ bootstrap, bus, serviceCtx });

	return {
		bootstrap,
		serviceCtx,
		bus,
		configStore,
		dispose: () => serviceCtx.dispose(),
	};
}
