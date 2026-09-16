/**
 * 把一段大到画不动的正文切成片。
 *
 * 起因是一条 12.26 MB 的消息：193 行，最长的一行 1.3 MB。画它的时候 Chromium 要给一千三百万个
 * 字符算换行，主线程一占几十秒——实测一个 `<p>` 装下全部，45 秒还没画完。切成 50 KB 一片、每片
 * 挂 `content-visibility: auto` 之后是 17 毫秒，因为屏幕外的那些浏览器根本不去布局。
 *
 * **为什么优先切在换行上。** 片是块级元素（`content-visibility` 在 `inline-block` 上实测无效，
 * 同样 45 秒不出来），而块级元素之间，浏览器在复制时会插一个换行。切在原本就有换行的地方，复制
 * 出来的东西就和原文逐字一致；只有一行本身就超过上限时才不得不从中间断开，那一行复制出来会多一个
 * 换行。整条消息的无损副本另有出处——`MessageActions` 的复制按钮直接从数据走，不经过 DOM。
 *
 * 上限取 50 KB 是量出来的：`parseInline` 在这个尺寸上约 3 ms，一帧之内；再大就开始掉帧，因为它
 * 对每个 `[`、`*`、`` ` `` 都要往后找配对，找不到就白扫一趟到结尾。
 */

import type { Inline } from "./inline.ts";

/** 超过这么大的一块才值得切。小于它的一切照旧，一行代码都不多走。 */
export const HUGE_BLOCK = 64 * 1024;

/** 一片的目标大小。 */
const SLICE = 50_000;

/**
 * 切片。片与片拼回去必须**逐字**等于原文（换行也在片里，不靠拼接补），这条由测试守着：
 * 一旦某天为了对齐边界而吞掉一个空白，复制出来的东西就和看到的不是一回事了。
 */
function sliceHuge(text: string, limit = SLICE): string[] {
	if (text.length <= limit) return [text];

	const out: string[] = [];
	let buffer = "";

	// `split` 会把换行吃掉，这里再补回去——除了最后一行，它本来就没有。
	const lines = text.split("\n");
	for (let i = 0; i < lines.length; i++) {
		const line = i < lines.length - 1 ? `${lines[i]}\n` : lines[i];

		// 一行自己就超了：先把攒着的交出去，再把这行从中间断开。
		if (line.length > limit) {
			if (buffer) {
				out.push(buffer);
				buffer = "";
			}
			for (let at = 0; at < line.length; at += limit) out.push(line.slice(at, at + limit));
			continue;
		}

		// 加上这行会超，就先断在上一行的行尾——那是个天然的边界。
		if (buffer.length + line.length > limit && buffer) {
			out.push(buffer);
			buffer = "";
		}
		buffer += line;
	}

	if (buffer) out.push(buffer);
	return out;
}

/** 一个 token 有多少字要画。 */
function weigh(token: Inline): number {
	if (token.kind === "text") return token.text.length;
	if (token.kind === "code") return token.text.length;
	if (token.kind === "math") return token.tex.length;
	return 16;
}

/**
 * 把解析好的 token 分成几组，每组小到能一帧画完。
 *
 * 为什么分组而不是分段解析：整段解析一次是 964 ms，先切成 283 片再逐片解析反而要 1443 ms——片
 * 边界会打断匹配，而且多了几百次函数调用。所以解析只做一次，切只为画。
 *
 * 组与组之间会成为两个块级元素，而块级元素之间浏览器复制时要插一个换行。所以**只在 text token
 * 的换行处**开新组：那里本来就有换行，复制出来和原文一致。一个 text token 自己就超过上限时才
 * 从中间断开，那处会多一个换行——整条消息的无损副本走 `MessageActions` 的复制按钮，不经过 DOM。
 */
export function groupTokens(tokens: Inline[], limit = SLICE): Inline[][] {
	const flat: Inline[] = [];
	for (const token of tokens) {
		if (token.kind === "text" && token.text.length > limit) {
			for (const part of sliceHuge(token.text, limit)) flat.push({ kind: "text", text: part });
		} else {
			flat.push(token);
		}
	}

	const groups: Inline[][] = [];
	let current: Inline[] = [];
	let size = 0;
	for (const token of flat) {
		const w = weigh(token);
		if (size + w > limit && current.length) {
			groups.push(current);
			current = [];
			size = 0;
		}
		current.push(token);
		size += w;
	}
	if (current.length) groups.push(current);
	return groups;
}
