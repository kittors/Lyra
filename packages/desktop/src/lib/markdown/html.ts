/**
 * The HTML people actually write inside markdown.
 *
 * Not a parser for HTML — a reader for the dozen tags that turn up in pull request descriptions
 * and model output. Nothing here produces markup; every branch returns tokens the renderer builds
 * elements from, so no attribute an author wrote can become part of the DOM.
 *
 * The lists are the point. Treating every `<…>` as a tag loses the type parameter in `Vec<T>` and
 * turns `a < b` into an unterminated element, so anything not named here is left as it was typed.
 */

import type { Inline } from "./inline.ts";

/** HTML we draw as itself. Everything here has a meaning we can honour. */
export type InlineTag = "kbd" | "sub" | "sup" | "mark";
const RENDERED = new Set<string>(["kbd", "sub", "sup", "mark"]);

/** HTML that maps onto a token we already have. */
const ALIASED: Record<string, "strong" | "em" | "del" | "code"> = {
	b: "strong",
	strong: "strong",
	i: "em",
	em: "em",
	s: "del",
	del: "del",
	strike: "del",
	code: "code",
};

/**
 * Tags we recognise but draw nothing for — the tag goes, the contents stay.
 *
 * Recognising them matters more than rendering them. The alternative is treating every `<…>` as a
 * tag, and then `Vec<T>` in a sentence about Rust loses its type parameter. Anything not on one of
 * these lists is left exactly as it was typed.
 */
const TRANSPARENT = new Set<string>([
	"span",
	"div",
	"p",
	"a",
	"font",
	"small",
	"big",
	"u",
	"ins",
	"abbr",
	"cite",
	"q",
	"samp",
	"var",
	"time",
	"picture",
	"summary",
	"details",
	"table",
	"thead",
	"tbody",
	"tr",
	"td",
	"th",
	"ul",
	"ol",
	"li",
	"blockquote",
	"pre",
	"h1",
	"h2",
	"h3",
	"h4",
	"h5",
	"h6",
	"center",
	"figure",
	"figcaption",
]);

const VOID = new Set<string>(["br", "img", "hr", "wbr", "source", "input"]);

/**
 * An HTML tag, or something that merely looks like one.
 *
 * Comments vanish: a pull request opened from a template is half `<!-- describe your change -->`,
 * and showing those is showing the reader the scaffolding.
 */
export function matchHtml(
	source: string,
	start: number,
	/** Re-scan a tag's contents. Injected so this file does not have to import the scanner it feeds. */
	parse: (text: string) => Inline[],
): { tokens: Inline[]; next: number } | null {
	if (source.startsWith("<!--", start)) {
		const close = source.indexOf("-->", start + 4);
		return { tokens: [], next: close === -1 ? source.length : close + 3 };
	}

	const open = /^<([a-zA-Z][a-zA-Z0-9]*)((?:\s+[^<>]*?)?)\/?>/.exec(source.slice(start));
	if (!open) return null;
	const name = open[1].toLowerCase();
	const attrs = open[2] ?? "";
	const after = start + open[0].length;

	if (VOID.has(name)) {
		if (name === "br") return { tokens: [{ kind: "break" }], next: after };
		if (name === "img") {
			const src = attr(attrs, "src");
			if (!src) return { tokens: [], next: after };
			return {
				tokens: [{ kind: "image", src, alt: attr(attrs, "alt") ?? "", width: size(attrs, "width"), height: size(attrs, "height") }],
				next: after,
			};
		}
		return { tokens: [], next: after };
	}

	const rendered = RENDERED.has(name);
	const aliased = ALIASED[name];
	if (!rendered && !aliased && !TRANSPARENT.has(name)) return null;

	// An opening tag with no close is not a tag — otherwise `a < b > c` eats the rest of the line.
	const close = findClose(source, name, after);
	if (close === -1) return null;
	const inner = source.slice(after, close);
	const next = close + name.length + 3;

	if (name === "a") {
		const href = attr(attrs, "href");
		if (href) return { tokens: [{ kind: "link", href, children: parse(inner) }], next };
	}
	if (aliased === "code") return { tokens: [{ kind: "code", text: inner }], next };
	if (aliased) return { tokens: [{ kind: aliased, children: parse(inner) }], next };
	if (rendered) return { tokens: [{ kind: "tag", name: name as InlineTag, children: parse(inner) }], next };
	return { tokens: parse(inner), next };
}

/** The matching close tag, skipping over nested copies of the same element. */
function findClose(source: string, name: string, from: number): number {
	const pattern = new RegExp(`<(/?)${name}(?:\\s[^<>]*)?/?>`, "gi");
	pattern.lastIndex = from;
	let depth = 1;
	let match = pattern.exec(source);
	while (match) {
		depth += match[1] === "/" ? -1 : 1;
		if (depth === 0) return match.index;
		match = pattern.exec(source);
	}
	return -1;
}

function attr(attrs: string, name: string): string | null {
	const match = new RegExp(`(?:^|\\s)${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(attrs);
	return match ? (match[2] ?? match[3] ?? match[4] ?? null) : null;
}

/**
 * A dimension an author wrote on an `<img>`.
 *
 * `width="200"` is how a README says "this logo is a logo, not a screenshot", and without it a
 * 1024px source fills the pane. Only bare pixel counts are honoured: `width="50%"` is a different
 * kind of instruction, and the number it would produce — 50 — is wrong rather than merely ignored.
 */
function size(attrs: string, name: "width" | "height"): number | undefined {
	const raw = attr(attrs, name);
	if (!raw || !/^\d+$/.test(raw.trim())) return undefined;
	const value = Number(raw.trim());
	return value > 0 && value <= 4096 ? value : undefined;
}
