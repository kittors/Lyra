/**
 * 流式输出写到一半的最后一段，先把没收口的标记补上。
 *
 * 一段回复是一个字一个字进来的，而 markdown 的标记要等收口才成立。不补的话，读的人会看到：
 *
 * - `这是 **加粗` 先原样露出两个星号，写完 `**` 才一下子变粗；
 * - `[文档](https://exa` 先露出 `[文档](`，后面半截地址还被当成裸链接画成蓝字；
 * - 表格先是一行带竖线的正文，分隔行写完才突然变成表格。
 *
 * 每一种都是「先错一下再跳对」。这里只改**最后一段**的显示用文本，规则照着 `inline.ts` 和
 * `blocks.ts` 的匹配来；写完之后画的是原文，这里不再参与。
 *
 * **屏幕上的字只增不减。** 这是整个文件的准绳。强调补上收口是安全的：补与不补，字都是那些字。
 * 代码跨度和链接不行——补上收口的行内代码，路径每进一个字就在「代码」和「只显示文件名的文件
 * 卡片」之间来回切（`src/a.ts` 是文件，`src/a.ts:` 不是），实测就是一直在闪。所以这两种写完
 * 之前先不画，写完一次出来。
 *
 * 不补的：行内公式。`$` 也是货币符号，`花了 $5` 后面永远不会有收口，补上反而会把它画成公式。
 * 半截公式先原样露着，等它自己收口。
 */

const FENCE_OPEN = /^\s*(\x60{3,}|~{3,})(\S*)\s*$/;
const TABLE_SEPARATOR = /^\s*\|?[\s:|-]+\|[\s:|-]*$/;
/** 只写出了块标记、还没有内容的一行：`#`、`-`、`1.`、`>`。 */
const BARE_MARKER = /^\s*(#{1,6}|[-*+]|\d+[.)]|>)\s*$/;
/**
 * 没写完的代码跨度、链接最多先藏这么多字。
 *
 * 一个落单的 `` ` `` 或 `[`（`区间 [0, 1)`）永远等不到收口，不设上限的话它后面整段都会一直藏到
 * 段落结束。真实的行内代码和链接文字都比这短。
 */
const HOLD = 120;
/** 一行内容自成一个行内单元的开头：列表项和标题。 */
const UNIT_START = /^\s*(?:[-*+]\s|\d+[.)]\s|#{1,6}\s)/;

export function completeTail(source: string): string {
	const lines = source.split("\n");
	const last = lines.length - 1;

	/*
	 * 最后一段从哪一行开始，以及是不是停在还没收口的代码围栏或公式块里。
	 *
	 * 停在围栏里就什么都不做：里面的字不是 markdown，而没收口的围栏 `blocks.ts` 本来就会画到结尾。
	 * 最后一行是空行不算段落结束——那只是刚进来一个换行。
	 */
	let fence: RegExp | null = null;
	let fenceAt = -1;
	let math = false;
	let start = 0;
	for (let i = 0; i <= last; i++) {
		const line = lines[i];
		if (fence) {
			if (fence.test(line)) {
				fence = null;
				start = i + 1;
			}
			continue;
		}
		if (math) {
			if (/\$\$\s*$/.test(line)) {
				math = false;
				start = i + 1;
			}
			continue;
		}
		const open = FENCE_OPEN.exec(line);
		if (open) {
			fence = open[1][0] === "`" ? /^\s*\x60{3,}\s*$/ : /^\s*~{3,}\s*$/;
			fenceAt = i;
			continue;
		}
		if (/^\s*\$\$/.test(line)) {
			if (/^\s*\$\$(.+?)\$\$\s*$/.test(line)) start = i + 1;
			else math = true;
			continue;
		}
		if (!line.trim() && i < last) start = i + 1;
	}
	/*
	 * 停在围栏里时只管最后一行，里面的代码原样：
	 *
	 * - 还在写的开头行：语言名写到一半，代码块标题会从 `t` 变成 `ts`；
	 * - 写到一半的收尾行：两个反引号会先作为代码的最后一行露出来；
	 * - 刚进来的换行：代码末尾先多出一个空行，收尾之后又没了。
	 */
	if (fence) {
		if (fenceAt === last) return [...lines.slice(0, last), ""].join("\n");
		if (/^\s*(\x60*|~*)\s*$/.test(lines[last])) return lines.slice(0, last).join("\n");
		return source;
	}
	if (math || start > last) return source;

	const tail = lines.slice(start);

	// 只敲出了一个块标记的最后一行，画出来是一个孤零零的 `#` 或一个空圆点。
	if (BARE_MARKER.test(tail[tail.length - 1])) tail[tail.length - 1] = "";

	holdTableHeader(tail);

	// 行内标记不跨列表项和标题，只看最后一个单元。
	let unit = 0;
	for (let i = tail.length - 1; i > 0; i--) {
		if (UNIT_START.test(tail[i]) || (tail[i].includes("|") && tail[i - 1].includes("|"))) {
			unit = i;
			break;
		}
	}
	const closed = closeInline(tail.slice(unit).join("\n"));

	return [...lines.slice(0, start), ...tail.slice(0, unit), closed].join("\n");
}

/**
 * 表头已经写了、分隔行还没写完的时候，先不画这张表。
 *
 * `blocks.ts` 要看到完整的分隔行才认表格，在那之前表头只是一行带竖线的正文，接在上一段后面。
 * 只认以 `|` 开头、上一行不是表格的行，免得把一句提到竖线的话也藏起来——而即使藏错了，下一行
 * 一进来它就回来了。
 */
function holdTableHeader(tail: string[]): void {
	let end = tail.length - 1;
	while (end >= 0 && !tail[end].trim()) end--;
	if (end < 0) return;

	const isHeader = (i: number) => tail[i].trimStart().startsWith("|") && (i === 0 || !tail[i - 1].includes("|"));
	let header = -1;
	if (isHeader(end)) header = end;
	else if (end > 0 && isHeader(end - 1) && /^\s*\|?[\s:|-]*$/.test(tail[end]) && !TABLE_SEPARATOR.test(tail[end])) header = end - 1;
	if (header >= 0) tail.length = header;
}

/**
 * 一个行内单元里没收口的代码、链接和强调，按 `inline.ts` 的规则补上或先藏起来。
 *
 * 强调补上收口；代码跨度和链接藏到写完（理由见文件开头）；只写出了开头标记、后面还一个字都没有
 * 的，先不画。
 */
function closeInline(text: string): string {
	const open: { fence: string; at: number }[] = [];
	let end = text.length;
	let suffix = "";
	let i = 0;

	scan: while (i < text.length) {
		const char = text[i];

		if (char === "\\") {
			i += 2;
			continue;
		}

		if (char === "`") {
			const width = runOf(text, i, "`");
			const close = findRun(text, i + width, "`", width);
			if (close >= 0) {
				i = close + width;
				continue;
			}
			// 代码跨度没收口：写完之前不画。太长或跨了行的是个落单的反引号，照原样。
			const rest = text.slice(i + width);
			if (rest.length <= HOLD && !rest.includes("\n")) {
				end = i;
				break;
			}
			i += width;
			continue;
		}

		if (char === "$") {
			i = mathEnd(text, i) ?? i + 1;
			continue;
		}

		if (char === "[" || (char === "!" && text[i + 1] === "[")) {
			const from = char === "!" ? i + 1 : i;
			const link = scanLink(text, from);
			if (link.state === "closed") {
				i = link.next;
				continue;
			}
			if (link.state === "href") {
				// 地址还在写：链接先只剩下它的字，图片先什么都不留。
				end = i;
				suffix = char === "!" ? "" : link.label;
				break;
			}
			// 方括号还没收口，或者刚收口、还看不出后面跟不跟地址：先不画，免得方括号露出来再消失。
			if (link.state === "open" && text.length - from <= HOLD && !text.slice(from).includes("\n")) {
				end = i;
				break;
			}
			i = from + 1;
			continue;
		}

		if (char === "*" || char === "_" || char === "~") {
			const width = runOf(text, i, char);
			const fence = width >= 2 ? char + char : char;
			const before = text[i - 1];

			const top = open.findLastIndex((entry) => entry.fence === fence);
			if (top >= 0 && before && !/\s/.test(before)) {
				open.length = top;
				i += fence.length;
				continue;
			}
			// 刚敲出来、后面还没有字的一串标记。
			if (!text.slice(i + width).trim()) {
				end = i;
				break scan;
			}
			const after = text[i + fence.length];
			/*
			 * 单个 `*` / `_` 前面贴着英文字母或数字时不当开头：`a*b` 多半是乘号，`snake_case` 是名字。
			 * 补上收口会把它们在输出途中画成斜体，写完又变回来——正是这里要消掉的那种跳。
			 * 中文不受此限：「每帧都会*整条*」前面贴着的就是字，`inline.ts` 也把它画成斜体。
			 */
			const glued = fence.length === 1 && before !== undefined && /[A-Za-z0-9]/.test(before);
			if (char !== "~" || fence.length === 2) {
				if (after && !/\s/.test(after) && !glued) {
					open.push({ fence, at: i });
					i += fence.length;
					continue;
				}
			}
			i += width;
			continue;
		}

		i++;
	}

	let body = text.slice(0, end) + suffix;
	const space = /\s*$/.exec(body)?.[0] ?? "";
	body = body.slice(0, body.length - space.length);

	let closers = "";
	for (let k = open.length - 1; k >= 0; k--) {
		const { fence, at } = open[k];
		if (at >= body.length) continue;
		if (body.length === at + fence.length) body = body.slice(0, at);
		else closers += fence;
	}
	return body + closers + space;
}

function runOf(text: string, at: number, char: string): number {
	let width = 0;
	while (text[at + width] === char) width++;
	return width;
}

/** 恰好 `width` 个 `char` 的一串从哪里开始；更长的一串不算，和 `inline.ts` 的代码跨度一样。 */
function findRun(text: string, from: number, char: string, width: number): number {
	for (let at = from; at < text.length; at++) {
		if (text[at] !== char) continue;
		const run = runOf(text, at, char);
		if (run === width) return at;
		at += run - 1;
	}
	return -1;
}

/** 从 `$` 开始的公式在哪里结束；不是公式时为 `null`。规则同 `inline.ts` 的 `matchMath`。 */
function mathEnd(text: string, start: number): number | null {
	const display = text[start + 1] === "$";
	const fence = display ? "$$" : "$";
	const from = start + fence.length;
	if (!text[from] || /\s/.test(text[from])) return null;
	for (let i = from; i < text.length; i++) {
		if (text[i] === "\\") {
			i++;
			continue;
		}
		if (!display && text[i] === "\n") return null;
		if (text.startsWith(fence, i) && !/\s/.test(text[i - 1])) {
			if (!display && /\d/.test(text[i + 1] ?? "")) return null;
			return i + fence.length;
		}
	}
	return null;
}

/**
 * `[label](href)` 写到了哪一步。
 *
 * `open`：方括号还没收口，或者刚收口、后面还没有字——都还可能是链接。`none`：已经看得出不是。
 */
function scanLink(
	text: string,
	start: number,
): { state: "closed"; next: number } | { state: "href"; label: string } | { state: "open" } | { state: "none" } {
	let depth = 0;
	let i = start;
	for (; i < text.length; i++) {
		if (text[i] === "\\") i++;
		else if (text[i] === "[") depth++;
		else if (text[i] === "]") {
			depth--;
			if (depth === 0) break;
		}
	}
	if (depth !== 0 || i + 1 === text.length) return { state: "open" };
	if (text[i + 1] !== "(") return { state: "none" };

	let paren = 0;
	for (let j = i + 1; j < text.length; j++) {
		if (text[j] === "\\") j++;
		else if (text[j] === "(") paren++;
		else if (text[j] === ")") {
			paren--;
			if (paren === 0) return { state: "closed", next: j + 1 };
		}
	}
	return { state: "href", label: text.slice(start + 1, i) };
}
