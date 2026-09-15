/**
 * Inline markdown, as tokens.
 *
 * This was one long alternation of a regex, which worked while the answer was "code, bold, italic,
 * link". It cannot express the rule that actually matters — that some spans are opaque. Nothing
 * inside a code span is markdown, and nothing inside `$…$` is either: `$a_*b*$` is one formula, and
 * a regex scanning for `*…*` will find emphasis in the middle of it.
 *
 * So: a scanner. Each token either consumes its own delimiters and re-scans what is between them,
 * or consumes them and does not. That distinction is the whole design.
 *
 * Plain `.ts` so it can be tested — this is the half that can be wrong.
 */

import { type InlineTag, matchHtml } from "./html.ts";


export type Inline =
	| { kind: "text"; text: string }
	| { kind: "code"; text: string }
	| { kind: "math"; tex: string; display: boolean }
	| { kind: "break" }
	| { kind: "strong"; children: Inline[] }
	| { kind: "em"; children: Inline[] }
	| { kind: "del"; children: Inline[] }
	| { kind: "link"; href: string; children: Inline[] }
	/** `width`/`height` only ever come from an HTML `<img>`; `![](…)` has nowhere to write them. */
	| { kind: "image"; src: string; alt: string; width?: number; height?: number }
	| { kind: "tag"; name: InlineTag; children: Inline[] };

export function parseInline(source: string): Inline[] {
	const out: Inline[] = [];
	let i = 0;

	/*
	 * 纯文本不是一个字符一个字符攒起来的，是记下起点、到收口时一次切下来。
	 *
	 * 原先那句 `text += char` 每个字符都造一个新字符串，一条 12 MB 的消息光垃圾回收就占了 28.7%
	 * 的时间（profiler 量的，是所有条目里最大的一项）。改成记区间之后，没有转义的那些段一次分配
	 * 都不用。
	 *
	 * `carry` 是给反斜杠转义留的：`\*` 要把 `*` 并进正文，但它和前后的文字属于同一个 text token，
	 * 位置上却是断开的。转义在真实文档里很少，所以只有它才走拼接这条路。
	 */
	let mark = 0;
	let carry = "";

	/** 把 `mark` 到当前位置的这段正文交出去，然后从 `resume` 开始新的一段。 */
	const flush = (resume = i) => {
		const text = carry + (mark < i ? source.slice(mark, i) : "");
		if (text) out.push({ kind: "text", text });
		carry = "";
		mark = resume;
	};

	while (i < source.length) {
		const char = source[i];

		// A backslash escape is the author saying "this character is not syntax".
		if (char === "\\" && i + 1 < source.length && /[\\`*_~[\]()<>#+\-.!$|]/.test(source[i + 1])) {
			carry += (mark < i ? source.slice(mark, i) : "") + source[i + 1];
			i += 2;
			mark = i;
			continue;
		}

		if (char === "\n") {
			flush(i + 1);
			out.push({ kind: "break" });
			i++;
			continue;
		}

		if (char === "`") {
			const code = matchCode(source, i);
			if (code) {
				flush(code.next);
				out.push({ kind: "code", text: code.text });
				i = code.next;
				continue;
			}
		}

		if (char === "$") {
			const math = matchMath(source, i);
			if (math) {
				flush(math.next);
				out.push({ kind: "math", tex: math.tex, display: math.display });
				i = math.next;
				continue;
			}
		}

		if (char === "<") {
			const html = matchHtml(source, i, parseInline);
			if (html) {
				flush(html.next);
				out.push(...html.tokens);
				i = html.next;
				continue;
			}
		}

		if (char === "!" && source[i + 1] === "[") {
			const image = matchLink(source, i + 1);
			if (image) {
				flush(image.next);
				out.push({ kind: "image", src: image.href, alt: image.label });
				i = image.next;
				continue;
			}
		}

		if (char === "[") {
			const link = matchLink(source, i);
			if (link) {
				flush(link.next);
				out.push({ kind: "link", href: link.href, children: parseInline(link.label) });
				i = link.next;
				continue;
			}
		}

		if (char === "*" || char === "_" || char === "~") {
			const emphasis = matchEmphasis(source, i);
			if (emphasis) {
				flush(emphasis.next);
				out.push({ kind: emphasis.kind, children: parseInline(emphasis.inner) });
				i = emphasis.next;
				continue;
			}
		}

		if ((char === "h" || char === "w") && isUrlStart(source, i)) {
			const url = matchBareUrl(source, i);
			if (url) {
				flush(url.next);
				out.push({ kind: "link", href: url.href, children: [{ kind: "text", text: url.text }] });
				i = url.next;
				continue;
			}
		}

		// 普通字符：什么都不做，它已经在 `mark` 到 `i` 这段区间里了，收口时一次切下来。
		i++;
	}

	flush();
	return out;
}

/**
 * 一个行内结构最远往后找多少个字符。
 *
 * 这些匹配全是「从这里开始往后找配对，找不到就算了」。没有上限时，**找不到的那些最贵**：一个孤零零
 * 的 `[` 会一路扫到结尾才承认自己不是链接，而下一个 `[` 再扫一遍。正文里这种字符有多少个，就白扫
 * 多少趟——平方级。实测一条 12.26 MB 的消息（一片 49 KB 里有 310 个 `[`、138 个 `_`、112 个 `$`）
 * 光 `parseInline` 就要 4.5 秒。
 *
 * 1000 不是随手定的：CommonMark 给链接标签的上限本来就是 999 字符，所以对 `[…]` 而言这不是新增
 * 限制，是把规范里写着的那条写进代码。强调、公式、代码跨度没有明文上限，但一个跨越一千字符的
 * `*…*` 在真实文档里不存在——而没有上限的代价是整页卡死。
 *
 * URL 单给一个更大的：地址确实可能长，而且它的扫描本来就在遇到空白时停，不会像那几个一样扫穿。
 */
const SPAN = 1000;
const URL_SPAN = 2048;

/** A code span, delimited by however many backticks opened it. */
function matchCode(source: string, start: number): { text: string; next: number } | null {
	let fence = 0;
	while (source[start + fence] === "`") fence++;
	// 手写这个循环而不是 `indexOf`：`indexOf` 找不到时照样会把剩下的全扫一遍，上限就落不下来。
	const fenceRun = "`".repeat(fence);
	const stop = Math.min(source.length - fence, start + fence + SPAN);
	let close = -1;
	for (let at = start + fence; at <= stop; at++) {
		if (source.startsWith(fenceRun, at)) {
			close = at;
			break;
		}
	}
	if (close === -1) return null;
	// A run longer than the fence is content, not the close — `` a ``` b `` is one span.
	if (source[close + fence] === "`") return null;

	const inner = source.slice(start + fence, close);
	// One space either side is padding that lets a span start or end with a backtick.
	const text = inner.startsWith(" ") && inner.endsWith(" ") && inner.trim() ? inner.slice(1, -1) : inner;
	return { text, next: close + fence };
}

/**
 * A formula.
 *
 * `$` is also a currency symbol, and "costs $5 to $10" must not become a formula containing "5 to".
 * The rule that separates them is whitespace: an opening `$` is followed by non-space, a closing
 * `$` is preceded by non-space, and a closing `$` is not followed by a digit. That last clause is
 * what saves "$5 and $10" — the same rule KaTeX's own auto-render uses.
 */
function matchMath(source: string, start: number): { tex: string; display: boolean; next: number } | null {
	const display = source[start + 1] === "$";
	const fence = display ? "$$" : "$";
	const from = start + fence.length;
	if (!source[from] || /\s/.test(source[from])) return null;

	let i = from;
	const stop = Math.min(source.length, from + SPAN);
	while (i < stop) {
		if (source[i] === "\\") {
			i += 2;
			continue;
		}
		/*
		 * 行内公式碰到换行就收手。
		 *
		 * 下面那句 `tex.includes("\n")` 说的是同一条规则，但它是**找到配对之后**才否决——也就是说
		 * 一个落单的 `$` 要先扫过整段正文，才承认自己只是个美元号。规则既然是「不跨行」，就该在
		 * 跨行的那一刻停，而不是在终点回头看。
		 */
		if (!display && source[i] === "\n") return null;
		if (source.startsWith(fence, i) && !/\s/.test(source[i - 1])) {
			const after = source[i + fence.length];
			if (!display && after && /\d/.test(after)) return null;
			const tex = source.slice(from, i);
			// Inline formulas do not span lines; a stray `$` should not swallow a paragraph.
			if (!display && tex.includes("\n")) return null;
			return { tex, display, next: i + fence.length };
		}
		i++;
	}
	return null;
}

/** `[label](href)`, with nesting allowed in the label and balanced parens in the href. */
function matchLink(source: string, start: number): { label: string; href: string; next: number } | null {
	let depth = 0;
	let i = start;
	// 标签的上限是 CommonMark 自己的 999 字符；扫过这条线还没收口的，不是链接。
	const labelStop = Math.min(source.length, start + SPAN);
	for (; i < labelStop; i++) {
		if (source[i] === "\\") i++;
		else if (source[i] === "[") depth++;
		else if (source[i] === "]") {
			depth--;
			if (depth === 0) break;
		}
	}
	if (depth !== 0 || source[i + 1] !== "(") return null;

	const label = source.slice(start + 1, i);
	let paren = 0;
	let j = i + 1;
	const hrefStop = Math.min(source.length, i + URL_SPAN);
	for (; j < hrefStop; j++) {
		if (source[j] === "\\") j++;
		else if (source[j] === "(") paren++;
		else if (source[j] === ")") {
			paren--;
			if (paren === 0) break;
		}
	}
	if (paren !== 0) return null;

	// A title after the URL — [x](url "title") — is not shown, but must not end up in the href.
	const href = source
		.slice(i + 2, j)
		.trim()
		.replace(/\s+["'(].*$/, "");
	return { label, href, next: j + 1 };
}

/** `**strong**`, `*em*`, `~~del~~`. Underscores only outside words, so `a_b_c` stays literal. */
function matchEmphasis(
	source: string,
	start: number,
): { kind: "strong" | "em" | "del"; inner: string; next: number } | null {
	const char = source[start];
	const double = source[start + 1] === char;
	const fence = double ? char + char : char;

	if (char === "~" && !double) return null;
	if (char === "_" && start > 0 && /[\p{L}\p{N}]/u.test(source[start - 1])) return null;

	const from = start + fence.length;
	if (!source[from] || /\s/.test(source[from])) return null;

	let i = from;
	const stop = Math.min(source.length, from + SPAN);
	while (i < stop) {
		if (source[i] === "\\") {
			i += 2;
			continue;
		}
		// Never close inside a code span — `**a `b**` c**` closes at the last pair, not the first.
		if (source[i] === "`") {
			const code = matchCode(source, i);
			if (code) {
				i = code.next;
				continue;
			}
		}
		if (source.startsWith(fence, i) && !/\s/.test(source[i - 1])) {
			if (!double && source[i + 1] === char) {
				i++;
				continue;
			}
			if (char === "_" && /[\p{L}\p{N}]/u.test(source[i + fence.length] ?? "")) {
				i++;
				continue;
			}
			const inner = source.slice(from, i);
			if (!inner) return null;
			const kind = char === "~" ? "del" : double ? "strong" : "em";
			return { kind, inner, next: i + fence.length };
		}
		i++;
	}
	return null;
}

function isUrlStart(source: string, i: number): boolean {
	if (i > 0 && /[\p{L}\p{N}/@._-]/u.test(source[i - 1])) return false;
	return source.startsWith("http://", i) || source.startsWith("https://", i) || source.startsWith("www.", i);
}

/**
 * A URL somebody typed without link syntax.
 *
 * Trailing punctuation is the whole difficulty: a sentence ending "see https://x.com/a." means the
 * full stop is prose, while "https://en.wikipedia.org/wiki/Foo_(bar)" ends in a bracket that is
 * part of the address. Trailing closers are kept only when the URL opened them.
 */
function matchBareUrl(source: string, start: number): { href: string; text: string; next: number } | null {
	let end = start;
	// 没有空白的长数据里，这个循环本来会一路跑到结尾——而那样长的东西不是地址。
	const stop = Math.min(source.length, start + URL_SPAN);
	while (end < stop && !/[\s<>"'`一-鿿　-〿＀-￯]/.test(source[end])) end++;
	if (end === stop && stop < source.length) return null;

	let url = source.slice(start, end);
	while (url.length > 0) {
		const last = url[url.length - 1];
		if (/[.,;:!?]/.test(last)) {
			url = url.slice(0, -1);
			continue;
		}
		if (last === ")" && (url.match(/\(/g)?.length ?? 0) < (url.match(/\)/g)?.length ?? 0)) {
			url = url.slice(0, -1);
			continue;
		}
		break;
	}

	// Bare "www.x.com" has no scheme; it still needs one to be opened.
	if (url.length < 8 || !/^[a-z]+:\/\/|^www\./.test(url)) return null;
	return { href: url.startsWith("www.") ? `https://${url}` : url, text: url, next: start + url.length };
}
