import { cut as jiebaCut } from "jieba-wasm";

/**
 * Per-room danmaku buffer powering the wordcloud + live-summary post-processing.
 *
 * - `recordDanmaku(roomId, content, username)` segments the danmaku via jieba
 *   and updates both word-frequency and per-user count maps for that room.
 * - `snapshot(roomId)` returns the sorted word list + raw sender map for
 *   passing to {@link WordcloudGenerator} / {@link LiveSummaryRequester}.
 * - `clear(roomId)` is invoked at live-end after the wordcloud + summary have
 *   been dispatched (or the start of a new live session for that room).
 *
 * The collector intentionally does NOT decide whether collection is enabled —
 * the listener-manager checks the wordcloud / liveSummary master+target gates
 * before calling `recordDanmaku`. This keeps the collector zero-config.
 */
export class DanmakuCollector {
	/** roomId → { word: count } */
	private readonly weightByRoom = new Map<string, Record<string, number>>();
	/** roomId → { username: count } */
	private readonly senderByRoom = new Map<string, Record<string, number>>();

	private readonly stopwords: Set<string>;

	constructor(stopwords: Iterable<string>) {
		this.stopwords = new Set(stopwords);
	}

	/** Replace the active stop-word set (called on config update). */
	setStopwords(stopwords: Iterable<string>): void {
		this.stopwords.clear();
		for (const w of stopwords) this.stopwords.add(w);
	}

	/** Make sure a room is being tracked (called when listener starts). */
	registerRoom(roomId: string): void {
		if (!this.weightByRoom.has(roomId)) this.weightByRoom.set(roomId, {});
		if (!this.senderByRoom.has(roomId)) this.senderByRoom.set(roomId, {});
	}

	/**
	 * Tokenise an incoming danmaku and update word-frequency + per-user count.
	 * Words shorter than 2 characters or in the stop-word set are dropped.
	 */
	recordDanmaku(roomId: string, content: string, username: string): void {
		this.registerRoom(roomId);
		const wordRecord = this.weightByRoom.get(roomId);
		const senderRecord = this.senderByRoom.get(roomId);
		if (!wordRecord || !senderRecord) return;

		jiebaCut(content, true)
			.filter((word: string) => word.length >= 2 && !this.stopwords.has(word))
			.forEach((w: string) => {
				wordRecord[w] = (wordRecord[w] || 0) + 1;
			});
		senderRecord[username] = (senderRecord[username] || 0) + 1;
	}

	/**
	 * Read a sorted snapshot of the current buffer for a room.
	 *
	 * - `sortedWords`: descending by frequency.
	 * - `senderRecord`: raw username → count map (consumer decides ordering).
	 * - `senderCount`: number of distinct usernames.
	 * - `danmakuCount`: total danmaku recorded.
	 */
	snapshot(roomId: string): {
		sortedWords: Array<[string, number]>;
		senderRecord: Record<string, number>;
		senderCount: number;
		danmakuCount: number;
	} {
		const weights = this.weightByRoom.get(roomId) ?? {};
		const senders = this.senderByRoom.get(roomId) ?? {};
		const sortedWords = Object.entries(weights).sort((a, b) => b[1] - a[1]);
		const senderCount = Object.keys(senders).length;
		const danmakuCount = Object.values(senders).reduce((sum, val) => sum + val, 0);
		return {
			sortedWords,
			senderRecord: { ...senders },
			senderCount,
			danmakuCount,
		};
	}

	/** Drop all collected data for a room (called at live-end / room-stop). */
	clear(roomId: string): void {
		this.weightByRoom.delete(roomId);
		this.senderByRoom.delete(roomId);
	}

	/** Drop everything (called on engine stop / auth-lost). */
	clearAll(): void {
		this.weightByRoom.clear();
		this.senderByRoom.clear();
	}
}
