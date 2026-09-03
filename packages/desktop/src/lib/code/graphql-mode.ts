/**
 * GraphQL, which had no grammar and was being parsed as JavaScript.
 *
 * The stand-in was defensible — braces and field names read acceptably — and wrong in the one
 * place it matters: GraphQL comments start with `#`, JavaScript's do not, so every comment in
 * every query rendered as body text. A `.graphql` file is mostly names and braces, and the
 * comment is often the only line explaining what the query is for.
 *
 * Small enough to write out. The whole language, for highlighting purposes, is: a comment, a
 * string, a number, a keyword, a `$variable`, an `@directive`, a Type (capitalised by convention
 * and by nearly universal practice), and a field name. Written as a `StreamLanguage` for the same
 * reason `ignore-mode.ts` is — no tree is needed to colour it, and a line-at-a-time pass is
 * exactly what the format wants.
 */

import { StreamLanguage, type StreamParser } from "@codemirror/language";

/**
 * The words that open or name a definition.
 *
 * `on` is in here because it is what makes a fragment readable — `... on User` — and reading it
 * as a field name is the one mistake that changes what a query appears to do.
 */
const KEYWORDS = new Set([
	"query",
	"mutation",
	"subscription",
	"fragment",
	"on",
	"type",
	"input",
	"enum",
	"interface",
	"union",
	"scalar",
	"schema",
	"directive",
	"extend",
	"implements",
	"repeatable",
	"true",
	"false",
	"null",
]);

interface State {
	/** Inside a `"""block string"""`, which spans lines. */
	block: boolean;
}

const parser: StreamParser<State> = {
	name: "graphql",
	startState: () => ({ block: false }),

	token(stream, state) {
		if (state.block) {
			// Consume to the closing triple quote, or to the end of the line if it is not here.
			while (!stream.eol()) {
				if (stream.match('"""')) {
					state.block = false;
					return "string";
				}
				stream.next();
			}
			return "string";
		}

		if (stream.eatSpace()) return null;

		// A comment runs to the end of the line, and is the whole reason this file exists.
		if (stream.peek() === "#") {
			stream.skipToEnd();
			return "comment";
		}

		if (stream.match('"""')) {
			state.block = true;
			return "string";
		}

		if (stream.peek() === '"') {
			stream.next();
			let escaped = false;
			while (!stream.eol()) {
				const ch = stream.next();
				if (escaped) {
					escaped = false;
					continue;
				}
				if (ch === "\\") escaped = true;
				else if (ch === '"') break;
			}
			return "string";
		}

		// `$id` — a variable, and the thing you actually pass in.
		if (stream.match(/^\$[A-Za-z_][\w]*/)) return "variableName";
		// `@include` — a directive.
		if (stream.match(/^@[A-Za-z_][\w]*/)) return "meta";
		if (stream.match(/^-?\d+(\.\d+)?([eE][+-]?\d+)?/)) return "number";
		// `...` spreads a fragment in; without it a spread reads as three separate dots.
		if (stream.match("...")) return "punctuation";

		// `match` returns the array for a regex, or `true` for a string — narrowed here so the
		// captured text is reachable.
		const word = stream.match(/^[A-Za-z_][\w]*/);
		if (word && word !== true) {
			const text = word[0];
			if (KEYWORDS.has(text)) return "keyword";
			/*
			 * Capitalised means a type, in every GraphQL schema anyone has written.
			 *
			 * Not part of the grammar — the spec has no such rule — but it is the convention the
			 * whole ecosystem follows, and it is what makes `User` in `... on User` read as a type
			 * rather than as another field. Treated the way an editor treats it, not the way a
			 * validator would.
			 */
			return /^[A-Z]/.test(text) ? "typeName" : "propertyName";
		}

		if (stream.match(/^[[\]{}()!:=|&,]/)) return "punctuation";
		stream.next();
		return null;
	},
};

/** The language, for `GRAMMARS` to hand to CodeMirror. */
export const graphqlLanguage = StreamLanguage.define(parser);
