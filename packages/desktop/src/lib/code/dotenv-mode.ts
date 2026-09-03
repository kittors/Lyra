/**
 * `.env`, which the properties grammar renders as two shades of the same thing.
 *
 * `KEY=value` is the whole language, and the properties mode marks both halves as definitions —
 * so the name and the secret came out in one colour with an uncoloured `=` between them. That is
 * the one file where telling the two apart matters most: scanning for which variable is set to
 * what is the only reason anyone opens it.
 *
 * The parts worth seeing, and why:
 *
 *     # comment            usually says where a value comes from
 *     KEY                  the name, which is what you are looking for
 *     =                    the divider, so a value containing `=` cannot be misread
 *     "quoted value"       quoting is meaningful here — it is what preserves spaces and `#`
 *     ${OTHER}             interpolation, which several loaders support and which is not literal
 *
 * A `StreamLanguage` for the same reason `ignore-mode.ts` is one: line-oriented, no tree needed.
 */

import { StreamLanguage, type StreamParser } from "@codemirror/language";

interface State {
	/** Everything after the first `=` on a line is the value, however many `=` it contains. */
	inValue: boolean;
}

const parser: StreamParser<State> = {
	name: "dotenv",
	startState: () => ({ inValue: false }),

	token(stream, state) {
		if (stream.sol()) state.inValue = false;
		if (stream.eatSpace()) return null;

		// A comment is only a comment at the start of a line, or after a space in the value —
		// `PASSWORD=a#b` is a password with a hash in it, not a comment.
		if (!state.inValue && stream.peek() === "#") {
			stream.skipToEnd();
			return "comment";
		}

		if (!state.inValue) {
			// `export FOO=bar` is valid and common in files meant to be sourced.
			if (stream.match(/^export\b/)) return "keyword";
			if (stream.match(/^[A-Za-z_][\w.]*/)) return "propertyName";
			if (stream.peek() === "=") {
				stream.next();
				state.inValue = true;
				return "operator";
			}
			stream.next();
			return null;
		}

		// Interpolation, which is a reference rather than text — worth seeing as one.
		if (stream.match(/^\$\{[^}]*\}/) || stream.match(/^\$[A-Za-z_]\w*/)) return "variableName";

		const quote = stream.peek();
		if (quote === '"' || quote === "'") {
			stream.next();
			let escaped = false;
			while (!stream.eol()) {
				const ch = stream.next();
				if (escaped) {
					escaped = false;
					continue;
				}
				if (ch === "\\") escaped = true;
				else if (ch === quote) break;
			}
			return "string";
		}

		/*
		 * An unquoted value runs to a comment or to the end of the line.
		 *
		 * ` #` — space then hash — is where a trailing comment starts, per every loader that
		 * supports them. Without the space it is part of the value, which is how a URL fragment
		 * or a colour survives.
		 */
		while (!stream.eol()) {
			if (stream.peek() === "$") break;
			const next = stream.next();
			if (next === " " && stream.peek() === "#") {
				stream.backUp(1);
				break;
			}
		}
		return "string";
	},
};

export const dotenvLanguage = StreamLanguage.define(parser);
