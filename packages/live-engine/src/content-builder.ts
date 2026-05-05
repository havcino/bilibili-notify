/**
 * Platform-neutral content-builder injection point.
 *
 * The original koishi `BilibiliNotifyLive` constructed messages with
 * `h("message", [...])` / `h.image(buffer, mime)` / `h.text(...)` / `h.image(url)`
 * and `h.at("all")` and shipped them straight to `BilibiliPush.broadcastToTargets`.
 *
 * To stay decoupled from `koishi`'s `h(...)` factory, live-engine builds these
 * fragments through a `LiveContentBuilder` provided by the adapter. The koishi
 * shell wires the builder to the real `h` exports; the standalone runtime maps
 * each call onto its own `NotificationPayload` shape.
 *
 * Each method returns an opaque `unknown` — the engine never inspects the
 * result; it only passes the value back to the adapter via `PushLike`.
 */
export interface LiveContentBuilder {
	/** Wrap a plain text run. Equivalent to `h.text(text)`. */
	text(text: string): unknown;
	/**
	 * Wrap a remote image URL or in-memory buffer.
	 * `mime` is provided when `source` is a `Buffer`.
	 */
	image(source: string | Buffer, mime?: string): unknown;
	/** Equivalent to `h.at("all")` (i.e. mention everyone in a group / channel). */
	atAll(): unknown;
	/**
	 * Compose a message with an array of segments (text / image / atAll fragments
	 * created by this same builder, plus `null` / `undefined` placeholders that
	 * are dropped). Equivalent to `h("message", segments)`.
	 */
	message(segments: Array<unknown>): unknown;
}
