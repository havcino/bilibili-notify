import type { ImageRenderer } from "@bilibili-notify/image-engine";
import type { Logger } from "@bilibili-notify/internal";

/**
 * Threshold for refusing to render a wordcloud — stays in sync with the
 * original `live-service` heuristic: a board-level wordcloud needs a baseline
 * vocabulary or it looks empty.
 */
export const WORDCLOUD_MIN_WORDS = 50;

/** Cap on how many top words are passed into the wordcloud renderer. */
export const WORDCLOUD_TOP_WORDS = 90;

/**
 * Wraps {@link ImageRenderer.generateWordCloudImg} with the engine's gating
 * logic (≥50 unique words required) and surfaces logger messages identical to
 * the original live-service.
 *
 * The output is a `Buffer` so the caller decides how to wrap it for the target
 * platform (e.g. via `LiveContentBuilder.image`).
 */
export class WordcloudGenerator {
	private readonly imageRenderer: ImageRenderer | null;
	private readonly logger: Logger;

	constructor(opts: { imageRenderer: ImageRenderer | null; logger: Logger }) {
		this.imageRenderer = opts.imageRenderer;
		this.logger = opts.logger;
	}

	/**
	 * Render a wordcloud image for `(masterName, masterAvatarUrl)`.
	 *
	 * Returns `undefined` when:
	 * - There are fewer than {@link WORDCLOUD_MIN_WORDS} unique words.
	 * - No `ImageRenderer` was injected (image-engine isn't installed).
	 * - The renderer threw; the error is logged and swallowed so the rest of
	 *   the live-end pipeline (summary + downstream push) keeps running.
	 */
	async generate(
		sortedWords: Array<[string, number]>,
		masterName: string,
		masterAvatarUrl?: string,
	): Promise<Buffer | undefined> {
		if (sortedWords.length < WORDCLOUD_MIN_WORDS) {
			this.logger.debug(`[wordcloud] 热词不足${WORDCLOUD_MIN_WORDS}个，放弃生成弹幕词云`);
			return undefined;
		}
		if (!this.imageRenderer?.generateWordCloudImg) return undefined;
		try {
			return await this.imageRenderer.generateWordCloudImg(
				sortedWords.slice(0, WORDCLOUD_TOP_WORDS),
				masterName,
				masterAvatarUrl,
			);
		} catch (e) {
			this.logger.error(`[wordcloud] 生成词云失败：${(e as Error).message}`);
			return undefined;
		}
	}
}
