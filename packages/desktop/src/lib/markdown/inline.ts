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

export type { InlineTag } from "./html.ts";

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
	let text = "";
	let i = 0;

	const flush = () => {
		if (text) out.push({ kind: "text", text });
		text = "";
	};

	while (i < source.length) {
		const char = source[i];

		// A backslash escape is the author saying "this character is not syntax".
		if (char === "\\" && i + 1 < source.length && /[\\`*_~[\]()<>#+\-.!$|]/.test(source[i + 1])) {
			text += source[i + 1];
			i += 2;
			continue;
		}

		if (char === "\n") {
			flush();
			out.push({ kind: "break" });
			i++;
			continue;
		}

		if (char === "`") {
			const code = matchCode(source, i);
			if (code) {
				flush();
				out.push({ kind: "code", text: code.text });
				i = code.next;
				continue;
			}
		}

		if (char === "$") {
			const math = matchMath(source, i);
			if (math) {
				flush();
				out.push({ kind: "math", tex: math.tex, display: math.display });
				i = math.next;
				continue;
			}
		}

		if (char === "<") {
			const html = matchHtml(source, i, parseInline);
			if (html) {
				flush();
				out.push(...html.tokens);
				i = html.next;
				continue;
			}
		}

		if (char === "!" && source[i + 1] === "[") {
			const image = matchLink(source, i + 1);
			if (image) {
				flush();
				out.push({ kind: "image", src: image.href, alt: image.label });
				i = image.next;
				continue;
			}
		}

		if (char === "[") {
			const link = matchLink(source, i);
			if (link) {
				flush();
				out.push({ kind: "link", href: link.href, children: parseInline(link.label) });
				i = link.next;
				continue;
			}
		}

		if (char === "*" || char === "_" || char === "~") {
			const emphasis = matchEmphasis(source, i);
			if (emphasis) {
				flush();
				out.push({ kind: emphasis.kind, children: parseInline(emphasis.inner) });
				i = emphasis.next;
				continue;
			}
		}

		if ((char === "h" || char === "w") && isUrlStart(source, i)) {
			const url = matchBareUrl(source, i);
			if (url) {
				flush();
				out.push({ kind: "link", href: url.href, children: [{ kind: "text", text: url.text }] });
				i = url.next;
				continue;
			}
		}

		text += char;
		i++;
	}

	flush();
	return out;
}

/** A code span, delimited by however many backticks opened it. */
function matchCode(source: string, start: number): { text: string; next: number } | null {
	let fence = 0;
	while (source[start + fence] === "`") fence++;
	const close = source.indexOf("`".repeat(fence), start + fence);
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
	while (i < source.length) {
		if (source[i] === "\\") {
			i += 2;
			continue;
		}
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
	for (; i < source.length; i++) {
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
	for (; j < source.length; j++) {
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
	while (i < source.length) {
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
	while (end < source.length && !/[\s<>"'`一-鿿　-〿＀-￯]/.test(source[end])) end++;

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
