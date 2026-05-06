import type { ConfigScope, Disposable, MessageBus } from "@bilibili-notify/internal";
import type { BootstrapConfig } from "./schema.js";

/**
 * ConfigStore — central runtime config holder for the standalone end.
 *
 * Stage 2.1 (this commit): bootstrap layer only. The runtime layer
 * (globals.json / subscriptions.json / targets.json on disk with atomic writes
 *  + emit `'config-changed'`) lands in 2.2 / 2.3. Public surface is laid out now
 * so the runtime/bootstrap glue + downstream engines can wire against the final
 * shape without breakage.
 *
 * NOTE: every `set*` method here intentionally throws. They are NOT to be removed
 * before stage 2.2 — they exist so consumers fail loudly if they accidentally
 * skip ahead and try to wire write paths today.
 */
export interface ConfigStore {
	readonly bootstrap: BootstrapConfig;

	/** Subscribe to scope-level change notifications. Backed by MessageBus 'config-changed'. */
	onChange(handler: (scope: ConfigScope) => void): Disposable;

	// --- runtime layer (TODO 2.2 / 2.3) -----------------------------------
	getGlobals(): never;
	setGlobals(_next: unknown): never;
	getSubscriptions(): never;
	setSubscriptions(_next: unknown): never;
	getTargets(): never;
	setTargets(_next: unknown): never;
	getSecret(_key: string): never;
	setSecret(_key: string, _value: string): never;
}

export interface CreateConfigStoreOptions {
	bootstrap: BootstrapConfig;
	bus: MessageBus;
	/** Reserved for stage 2.2: where globals/subs/targets JSON files live (defaults to bootstrap.dataDir/state). */
	stateDir?: string;
}

export function createConfigStore(opts: CreateConfigStoreOptions): ConfigStore {
	const { bootstrap, bus } = opts;

	const notImplemented = (method: string): never => {
		throw new Error(
			`ConfigStore.${method}() is not implemented yet — runtime config layer ships in stage 2.2.`,
		);
	};

	return {
		bootstrap,
		onChange(handler) {
			return bus.on("config-changed", handler);
		},
		getGlobals: () => notImplemented("getGlobals"),
		setGlobals: () => notImplemented("setGlobals"),
		getSubscriptions: () => notImplemented("getSubscriptions"),
		setSubscriptions: () => notImplemented("setSubscriptions"),
		getTargets: () => notImplemented("getTargets"),
		setTargets: () => notImplemented("setTargets"),
		getSecret: () => notImplemented("getSecret"),
		setSecret: () => notImplemented("setSecret"),
	};
}
