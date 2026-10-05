/**
 * The last paragraph of a reply still being written, with its unclosed markers closed first.
 *
 * A reply arrives a few characters at a time, and a Markdown marker only means something once it is
 * closed. Left alone, the reader sees:
 *
 * - `这是 **加粗` show its two asterisks as typed, then turn bold the moment `**` arrives;
 * - `[文档](https://exa` show `[文档](`, with the half-written address drawn blue as a bare link;
 * - a table be a line of text with pipes in it until the separator row is written, then turn into one.
 *
 * Each is "wrong for a moment, then jumps to right". Only the display text of the **last paragraph**
 * is changed here, following the matching in `inline.ts` and `blocks.ts`; once the reply is complete
 * the original text is drawn and this takes no part.
 *
 * **Characters on screen only ever increase.** That is the rule this whole file answers to. Closing an
 * emphasis early is safe: closed or not, the characters are the same characters. Code spans and links
 * are not — an inline code closed early flips, with every character of a path, between "code" and "a
 * file chip showing only the name" (`src/a.ts` is a file, `src/a.ts:` is not), which measured as
 * constant flicker. So those two are not drawn until they are written, and then appear once.
 *
 * Not closed: inline math. `$` is also a currency sign — `花了 $5` will never be closed, and closing it
 * would draw it as math. A half-written formula stays as written until it closes itself.
 */

const FENCE_OPEN = /^\s*(\x60{3,}|~{3,})(\S*)\s*$/;
const TABLE_SEPARATOR = /^\s*\|?[\s:|-]+\|[\s:|-]*$/;
/** A line that is only a block marker so far, with nothing after it: `#`, `-`, `1.`, `>`. */
const BARE_MARKER = /^\s*(#{1,6}|[-*+]|\d+[.)]|>)\s*$/;
/**
 * How many characters an unfinished code span or link may be held back for.
 *
 * A lone `` ` `` or `[` (`区间 [0, 1)`) never gets its closer, and without a cap everything after it
 * would stay hidden to the end of the paragraph. Real inline code and link text are shorter than this.
 */
const HOLD = 120;
/** Where a line starts an inline unit of its own: list items and headings. */
const UNIT_START = /^\s*(?:[-*+]\s|\d+[.)]\s|#{1,6}\s)/;

export function completeTail(source: string): string {
	const lines = source.split("\n");
	const last = lines.length - 1;

	/*
	 * Where the last paragraph starts, and whether it stops inside an unclosed code fence or math block.
	 *
	 * Inside a fence the text is left alone: it is not Markdown, and `blocks.ts` already draws an
	 * unclosed fence to the end. A blank last line does not end a paragraph — it is only a newline that
	 * has just arrived.
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
	 * Stopped inside a fence, only the last line is touched; the code is left as it is:
	 *
	 * - an opening line still being typed: half a language name, so the block's title goes `t` → `ts`;
	 * - a closing line half written: two backticks show as the code's last line first;
	 * - a newline just arrived: the code ends in an empty line that disappears once it closes.
	 */
	if (fence) {
		if (fenceAt === last) return [...lines.slice(0, last), ""].join("\n");
		if (/^\s*(\x60*|~*)\s*$/.test(lines[last])) return lines.slice(0, last).join("\n");
		return source;
	}
	if (math || start > last) return source;

	const tail = lines.slice(start);

	// A last line that is only a block marker draws as a lone `#` or an empty bullet.
	if (BARE_MARKER.test(tail[tail.length - 1])) tail[tail.length - 1] = "";

	holdTableHeader(tail);

	// Inline markers do not span list items or headings, so only the last unit is looked at.
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
 * A table whose header is written and whose separator row is not is not drawn yet.
 *
 * `blocks.ts` only recognises a table once its separator row is complete; before that the header is a
 * line of text with pipes, run on from the paragraph above. Only a line starting with `|` after a line
 * that is not part of a table counts, so a sentence that merely mentions a pipe is not hidden — and if
 * one is, it comes back as soon as the next line arrives.
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
 * Unclosed code, links and emphasis in one inline unit, closed or held back by `inline.ts`'s rules.
 *
 * Emphasis is closed; code spans and links are held until written (see the top of the file); a marker
 * with not one character after it yet is not drawn.
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
			// An unclosed code span: not drawn until written. Too long or across a line, it is a lone backtick, left as is.
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
				// The address is still being written: a link keeps only its text for now, an image nothing.
				end = i;
				suffix = char === "!" ? "" : link.label;
				break;
			}
			// Bracket not closed, or just closed with no telling yet whether an address follows: not drawn, so it cannot show and then vanish.
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
			// A run of markers just typed, with nothing after it yet.
			if (!text.slice(i + width).trim()) {
				end = i;
				break scan;
			}
			const after = text[i + fence.length];
			/*
			 * A single `*` / `_` right after a Latin letter or digit opens nothing: `a*b` is most likely a
			 * multiplication and `snake_case` a name. Closing it would draw it italic while the reply streams
			 * and turn it back afterwards — exactly the jump this file removes. Chinese is not held to this:
			 * in 「每帧都会*整条*」 the character before it is a word, and `inline.ts` draws it italic too.
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

/** Where a run of exactly `width` `char`s starts; a longer run does not count, as with `inline.ts`'s code spans. */
function findRun(text: string, from: number, char: string, width: number): number {
	for (let at = from; at < text.length; at++) {
		if (text[at] !== char) continue;
		const run = runOf(text, at, char);
		if (run === width) return at;
		at += run - 1;
	}
	return -1;
}

/** Where a formula starting at `$` ends, or `null` if it is not one. The rules of `inline.ts`'s `matchMath`. */
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
 * How far `[label](href)` has been written.
 *
 * `open`: the bracket is not closed, or only just closed with nothing after it — it may still be a link.
 * `none`: it can already be seen not to be one.
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
