/**
 * B 站直播间 / UP 主简介等富文本字段(如 `room_info.description`)由 B 站后台
 * 富文本编辑器输出,会直接带 `<p>...</p>` `<br>` 之类的 HTML 标签;部分接口还会
 * 把同样内容做一次 HTML entity 编码 (`&lt;p&gt;...`)。我们把它丢进 Vue JSX
 * 文本插值时,JSX 会自动 escape(同 React),用户在卡片上看到字面 `<p>xxxx</p>`
 * 或 `&lt;p&gt;xxxx&lt;/p&gt;`。
 *
 * 直播卡片的简介区域只想展示纯文本,这里把上面两种 input 都规范化成纯文本:
 *   1. 先 strip 真正的 HTML 标签(`<p>` `<br>` 等);
 *   2. 解码常见 HTML entities(`&lt;` `&gt;` `&amp;` `&quot;` `&#39;` `&nbsp;`
 *      及数字 / hex 字符引用);
 *   3. 解码后再 strip 一次,处理「原始数据是 entity-encoded HTML」的情况;
 *   4. 折叠多余空白。
 *
 * 用 regex 而非 JSDOM 解析:这条路径在 SSR 渲染热路径上,DOMParser 开销可观;
 * B 站简介体量小、结构简单,正则两遍 strip 足够鲁棒。
 */

const TAG_RE = /<\/?[a-zA-Z][^>]*>/g;

function decodeEntities(s: string): string {
	return (
		s
			// 命名 entities(常见集合)
			.replace(/&nbsp;/g, " ")
			.replace(/&quot;/g, '"')
			.replace(/&apos;|&#39;/g, "'")
			.replace(/&lt;/g, "<")
			.replace(/&gt;/g, ">")
			// 数字 / hex 字符引用
			.replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
			.replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCharCode(Number.parseInt(code, 16)))
			// &amp; 放最后,避免 `&amp;lt;` 先变 `&lt;` 又被前面的规则二次解码
			.replace(/&amp;/g, "&")
	);
}

/**
 * 把可能含 HTML 标签 / HTML entities 的富文本字段转为纯文本,供 JSX 文本插值
 * 安全展示。`null` / `undefined` / 空串返回空串。
 */
export function htmlToPlain(input: string | null | undefined): string {
	if (!input) return "";
	// 标签替换成空格而不是空串,否则 `<p>第一段</p><p>第二段</p>` 会被拼成
	// 「第一段第二段」无分隔。末尾的空白折叠会把意外多出来的空格收回。
	const stripped = input.replace(TAG_RE, " ");
	const decoded = decodeEntities(stripped);
	// 第二轮 strip:原始是 entity-encoded HTML(`&lt;p&gt;...`)时,decode 后才出现 tag。
	const finalStripped = decoded.replace(TAG_RE, " ");
	return finalStripped.replace(/\s+/g, " ").trim();
}
