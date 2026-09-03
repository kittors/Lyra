/**
 * Colouring the two things these panels actually show: a shell command, and a JSON argument.
 *
 * The editor's highlighter is a CodeMirror grammar loaded on demand — right for a file, wrong here.
 * A panel row must colour a twenty-character command the instant it opens, and CodeMirror ships no
 * shell grammar at all, so the alternative was a dependency and an async load for something a small
 * scanner does synchronously and exactly.
 *
 * The categories are deliberately few. A command line is worth reading for four things: what is
 * being run, what is being passed to it, which parts are literal text, and where one command ends
 * and the next begins. Colouring more than that is decoration, and decoration in a diagnostic view
 * is noise.
 *
 * Colours come from the editor's palette rather than new ones, so a command reads the same here as
 * it does in a code block in the transcript.
 */

export type TokenKind =
	/** The program being run, and its subcommand. */
	| "command"
	/** `-f`, `--force=x`. */
	| "flag"
	| "string"
	| "number"
	/** `&&`, `|`, `;`, `>`, and JSON's braces and colons. */
	| "operator"
	/** `$HOME`, `${x}`. */
	| "variable"
	/** A JSON key. */
	| "key"
	| "comment"
	| "plain";

export interface Token {
	text: string;
	kind: TokenKind;
}

/** One class per kind, defined in the stylesheet against the editor's own colours. */
export const TOKEN_CLASS: Record<TokenKind, string> = {
	command: "ly-tok-command",
	flag: "ly-tok-flag",
	string: "ly-tok-string",
	number: "ly-tok-number",
	operator: "ly-tok-operator",
	variable: "ly-tok-variable",
	key: "ly-tok-key",
	comment: "ly-tok-comment",
	plain: "",
};

/** Where one command ends and the next begins. */
const SHELL_OPERATOR = /^(\|\||&&|;|\||>>|>|<|&)/;

/**
 * Scan a command line.
 *
 * The one piece of state is whether the next bare word is a program name: true at the start and
 * after every operator, false once something has been read. That single rule is what makes
 * `cd x && npm run build` colour `cd` and `npm` and nothing else.
 */
export function tokenizeShell(input: string): Token[] {
	const tokens: Token[] = [];
	let at = 0;
	let expectCommand = true;

	const push = (text: string, kind: TokenKind) => {
		if (text) tokens.push({ text, kind });
	};

	while (at < input.length) {
		const rest = input.slice(at);

		const space = /^\s+/.exec(rest);
		if (space) {
			push(space[0], "plain");
			at += space[0].length;
			continue;
		}

		if (rest.startsWith("#") && (at === 0 || /\s/.test(input[at - 1]))) {
			const end = rest.indexOf("\n");
			const text = end < 0 ? rest : rest.slice(0, end);
			push(text, "comment");
			at += text.length;
			continue;
		}

		const operator = SHELL_OPERATOR.exec(rest);
		if (operator) {
			push(operator[0], "operator");
			at += operator[0].length;
			expectCommand = true;
			continue;
		}

		const quoted = /^'[^']*'?|^"(?:[^"\\]|\\.)*"?/.exec(rest);
		if (quoted) {
			push(quoted[0], "string");
			at += quoted[0].length;
			expectCommand = false;
			continue;
		}

		const variable = /^\$\{[^}]*\}|^\$[A-Za-z_][A-Za-z0-9_]*/.exec(rest);
		if (variable) {
			push(variable[0], "variable");
			at += variable[0].length;
			expectCommand = false;
			continue;
		}

		const word = /^[^\s'"|&;<>#]+/.exec(rest);
		if (!word) {
			push(rest[0], "plain");
			at += 1;
			continue;
		}

		if (word[0].startsWith("-")) push(word[0], "flag");
		else if (expectCommand) {
			push(word[0], "command");
			expectCommand = false;
		} else if (/^-?\d+(\.\d+)?$/.test(word[0])) push(word[0], "number");
		else push(word[0], "plain");

		at += word[0].length;
	}

	return tokens;
}

/**
 * Scan JSON.
 *
 * A key is a string followed by a colon, which is the only thing worth looking ahead for — it is
 * also the distinction that makes an argument object readable at a glance.
 */
export function tokenizeJson(input: string): Token[] {
	const tokens: Token[] = [];
	let at = 0;

	while (at < input.length) {
		const rest = input.slice(at);

		const space = /^\s+/.exec(rest);
		if (space) {
			tokens.push({ text: space[0], kind: "plain" });
			at += space[0].length;
			continue;
		}

		const string = /^"(?:[^"\\]|\\.)*"?/.exec(rest);
		if (string) {
			const after = rest.slice(string[0].length);
			tokens.push({ text: string[0], kind: /^\s*:/.test(after) ? "key" : "string" });
			at += string[0].length;
			continue;
		}

		const number = /^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(rest);
		if (number) {
			tokens.push({ text: number[0], kind: "number" });
			at += number[0].length;
			continue;
		}

		const literal = /^(true|false|null)\b/.exec(rest);
		if (literal) {
			tokens.push({ text: literal[0], kind: "number" });
			at += literal[0].length;
			continue;
		}

		if ("{}[],:".includes(rest[0])) {
			tokens.push({ text: rest[0], kind: "operator" });
			at += 1;
			continue;
		}

		tokens.push({ text: rest[0], kind: "plain" });
		at += 1;
	}

	return tokens;
}
