import { join } from "node:path";
import type { ServiceContext } from "@bilibili-notify/internal";
import { CookieStore } from "./cookie-store";
import { KeyManager } from "./key-manager";

export type { CookieData } from "./cookie-store";
export { CookieStore } from "./cookie-store";
export { KeyManager } from "./key-manager";
export type { EncryptedFile, StoredCookies } from "./types";

export interface StorageManagerOptions {
	serviceCtx: ServiceContext;
	dataDir: string;
}

export class StorageManager {
	readonly cookieStore: CookieStore;

	constructor(opts: StorageManagerOptions) {
		const keyPath = join(opts.dataDir, "bilibili-notify", "master.key");
		const cookiePath = join(opts.dataDir, "bilibili-notify", "cookies.json");
		const keyManager = new KeyManager(keyPath, opts.serviceCtx.logger);
		this.cookieStore = new CookieStore(cookiePath, keyManager, opts.serviceCtx.logger);
	}

	async init(): Promise<void> {
		await this.cookieStore.init();
	}
}
