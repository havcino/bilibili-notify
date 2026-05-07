import type { PushTarget } from "@bilibili-notify/internal";

/**
 * Simple in-memory target registry for the koishi side.
 * The standalone side uses ConfigStore; the koishi side synthesizes targets
 * from the legacy flat config and holds them here.
 */
export class TargetRegistry {
	private readonly targets: Map<string, PushTarget> = new Map();

	get(id: string): PushTarget | undefined {
		return this.targets.get(id);
	}

	set(target: PushTarget): void {
		this.targets.set(target.id, target);
	}

	delete(id: string): void {
		this.targets.delete(id);
	}

	all(): PushTarget[] {
		return [...this.targets.values()];
	}

	clear(): void {
		this.targets.clear();
	}

	findByPlatformAndChannel(platform: string, channelId: string): PushTarget | undefined {
		for (const t of this.targets.values()) {
			if (t.platform === platform) {
				const cfg = t.config as { channelId?: string };
				if (cfg.channelId === channelId) return t;
			}
		}
		return undefined;
	}
}
