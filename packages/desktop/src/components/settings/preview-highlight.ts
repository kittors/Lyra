/**
 * Colouring a sample by *which kind of thing* each run is, rather than by a stylesheet.
 *
 * The settings pages need something the editor does not: two palettes applied to one piece of
 * code at the same time, side by side. `highlightStyle` cannot do that — it emits CSS classes
 * whose colours are written with `light-dark()` and resolved from `color-scheme`, and there is
 * one of those per document. Both specimens would come out in whichever scheme the page is in.
 *
 * So the parse is separated from the palette. `highlightTree` runs once against a highlighter
 * whose "classes" are the names of the fields in `CodeThemeSpec.tokens`, and the caller looks
 * each one up in whichever theme it is drawing. One parse, two colourings, no stylesheet.
 *
 * The same function backs 代码格式化's preview, where the point is to show any of a hundred
 * languages in the theme currently in force.
 */

import { tagHighlighter, tags as t } from "@lezer/highlight";
import type { Language } from "@codemirror/language";
import type { CodeThemeSpec } from "../../lib/code/themes.ts";
import { GRAMMARS, grammarKeyFor } from "../../lib/code/highlight.ts";

/** The token names a theme declares a colour for. */
export type TokenName = keyof CodeThemeSpec["tokens"];

export interface Piece {
	text: string;
	/** Which colour to use, or null for text no rule claimed. */
	token: TokenName | null;
}

/**
 * Lezer tags mapped onto the eleven names a theme knows about.
 *
 * Deliberately the same groupings as `highlightStyle` in `highlight.ts` — a specimen that
 * coloured `propertyName` differently from the editor would be showing something that does not
 * exist. The comment about `definition(propertyName)` there applies here for the same reason:
 * YAML and object literals mark their keys that way, and grouped with plain definitions they
 * inherit body text and a config file comes out as one undifferentiated wall.
 */
const HIGHLIGHTER = tagHighlighter([
	{ tag: [t.keyword, t.modifier, t.controlKeyword, t.definitionKeyword, t.moduleKeyword], class: "keyword" },
	{ tag: [t.string, t.special(t.string)], class: "string" },
	{ tag: [t.number, t.bool, t.null, t.atom], class: "number" },
	{ tag: [t.comment, t.blockComment, t.lineComment], class: "comment" },
	/*
	 * A name being *defined* carries the colour; a name being used does not.
	 *
	 * These were grouped with plain `variableName`, so `func Greet(...)` and `const answer = 42`
	 * put their most informative word — the one the line exists to introduce — in body text, while
	 * `fmt.Sprintf` on the next line was coloured for being a call. Backwards, and it is most of
	 * why a dark theme looked like white text with occasional accents: in ordinary code, most
	 * identifiers appear at their definition.
	 */
	{
		tag: [
			t.function(t.variableName),
			t.function(t.propertyName),
			t.definition(t.propertyName),
			t.definition(t.variableName),
			t.propertyName,
		],
		class: "function",
	},
	{ tag: [t.typeName, t.className, t.namespace, t.constant(t.variableName), t.standard(t.variableName), t.special(t.variableName)], class: "type" },
	{ tag: [t.variableName, t.content, t.labelName], class: "variable" },
	{ tag: [t.operator], class: "operator" },
	{ tag: [t.punctuation, t.separator, t.bracket], class: "punctuation" },
	{ tag: [t.tagName], class: "tag" },
	{ tag: [t.attributeName], class: "attribute" },
	{ tag: [t.attributeValue, t.quote], class: "string" },
	{ tag: [t.meta, t.processingInstruction], class: "comment" },
	{ tag: [t.escape, t.regexp], class: "attribute" },
	{ tag: [t.heading], class: "function" },
	{ tag: [t.link, t.url], class: "function" },
	{ tag: [t.invalid], class: "tag" },
	/*
	 * A patch's added and removed lines.
	 *
	 * The `diff` mode emits these two and nothing else of substance, so without them a `.patch`
	 * file renders almost entirely as body text — 90% of it, measured. Mapped onto colours that
	 * exist in every theme rather than to new fields: what a diff needs is for the two to be
	 * *told apart*, and the viewer already carries the row backgrounds that say which is which.
	 */
	{ tag: [t.inserted], class: "string" },
	{ tag: [t.deleted], class: "number" },
]);

const cache = new Map<string, Promise<Language | null>>();

/** Load a grammar by key, once. Returns null for keys nothing can parse. */
export function grammarFor(key: string): Promise<Language | null> {
	let pending = cache.get(key);
	if (!pending) {
		const load = GRAMMARS[key];
		pending = load ? load().then(asLanguage, () => null) : Promise.resolve(null);
		cache.set(key, pending);
	}
	return pending;
}

/**
 * Unwrap whatever a grammar module hands back.
 *
 * The same three shapes `highlight.ts` deals with: a `LanguageSupport` with a `.language`, a bare
 * `Language` from `StreamLanguage.define`, or an array containing one. Getting this wrong is
 * silent — the grammar loads, nothing matches, and the sample renders as one flat colour.
 */
function asLanguage(loaded: unknown): Language | null {
	if (Array.isArray(loaded)) {
		for (const member of loaded) {
			const found = asLanguage(member);
			if (found) return found;
		}
		return null;
	}
	const support = loaded as { language?: Language };
	const candidate = support?.language ?? (loaded as Language | null);
	return candidate && typeof (candidate as Language).parser === "object" ? candidate : null;
}

/**
 * Split code into runs, each labelled with the token it is.
 *
 * Unparseable or unknown languages come back as one unlabelled run, which renders as plain body
 * text — the honest result, and the same thing the editor does.
 */
export async function highlightPieces(code: string, grammarKey: string | null): Promise<Piece[]> {
	const language = grammarKey ? await grammarFor(grammarKey) : null;
	if (!language) return [{ text: code, token: null }];

	const { highlightTree } = await import("@lezer/highlight");
	const tree = language.parser.parse(code);
	const pieces: Piece[] = [];
	let at = 0;

	highlightTree(tree, HIGHLIGHTER, (from, to, name) => {
		// The gaps `highlightTree` skips — whitespace, unclaimed punctuation — have to be filled in
		// or the sample renders with pieces missing.
		if (from > at) pieces.push({ text: code.slice(at, from), token: null });
		/*
		 * One name, even when several rules claim the same run.
		 *
		 * `tagHighlighter` joins every matching class with a space, so a Markdown heading — which
		 * is both `heading` and `processingInstruction` — arrives as "function comment". Looked up
		 * whole that is `undefined`, and the run renders as plain body text: the exact symptom of
		 * no highlighting at all, on the language where headings matter most. The first name wins,
		 * which is the earliest matching rule in the table above.
		 */
		const first = name ? name.split(" ")[0] : null;
		pieces.push({ text: code.slice(from, to), token: (first || null) as TokenName | null });
		at = to;
	});
	if (at < code.length) pieces.push({ text: code.slice(at), token: null });

	return pieces;
}

/** Which grammar a filename would get, for previews that are named rather than chosen. */
export { grammarKeyFor };
