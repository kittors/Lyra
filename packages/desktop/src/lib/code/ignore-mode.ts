/**
 * `.gitignore`, and every file shaped like it.
 *
 * There is no grammar for these anywhere, and there are six of them in an ordinary project —
 * `.gitignore`, `.dockerignore`, `.npmignore`, `.eslintignore`, `.prettierignore`, `.vercelignore`
 * — all with the same syntax and all previously rendered as one undifferentiated colour. That is a
 * shame, because the syntax is small and every part of it is worth seeing:
 *
 *     # comments          the reason a rule exists, which is the part worth reading
 *     !not-this-one       a negation, and the single most misread line in any ignore file
 *     build/              a trailing slash means directories only
 *     *.log  src/**\/*.ts  globs, which decide how much a rule actually catches
 *
 * A negation that does not stand out is how a file nobody meant to commit ends up committed.
 *
 * Written as a `StreamLanguage` because that is what a line-oriented format wants: no tree, no
 * incremental parse, one pass over each line. Tokens are named for the standard highlight tags so
 * the app's own theme colours them alongside everything else.
 */

import { StreamLanguage, type StreamParser } from "@codemirror/language";

interface IgnoreState {
	/** Whether this line began with `!`, which inverts everything on it. */
	negated: boolean;
}

const parser: StreamParser<IgnoreState> = {
	name: "gitignore",
	startState: () => ({ negated: false }),

	token(stream, state) {
		if (stream.sol()) state.negated = false;

		if (stream.eatSpace()) return null;

		// A comment runs to the end of the line — but only when `#` is the first thing on it.
		if (stream.sol() || stream.column() === 0) {
			if (stream.peek() === "#") {
				stream.skipToEnd();
				return "comment";
			}
			if (stream.eat("!")) {
				state.negated = true;
				// Its own tag, because "this one is an exception" is the fact you are scanning for.
				return "keyword";
			}
		}

		// Globs: the part that decides what a rule catches.
		if (stream.peek() === "*" || stream.peek() === "?") {
			while (stream.eat("*") || stream.eat("?")) {
				// `**` is one token, and so is `*`; eating them together keeps the run contiguous.
			}
			return "operator";
		}

		// A character class, `[Dd]ebug`, is one unit and worth marking as such.
		if (stream.eat("[")) {
			stream.eatWhile((char: string) => char !== "]");
			stream.eat("]");
			return "operator";
		}

		// A separator, which at the end of a line means "directories only".
		if (stream.eat("/")) return "punctuation";

		// Everything else is a literal path segment.
		stream.eatWhile((char: string) => !"*?[/# \t".includes(char));
		if (stream.current().length === 0) {
			// Nothing matched — do not spin.
			stream.next();
			return null;
		}
		return state.negated ? "string" : "variableName";
	},

	languageData: {
		commentTokens: { line: "#" },
	},
};

export const ignoreLanguage = StreamLanguage.define(parser);
