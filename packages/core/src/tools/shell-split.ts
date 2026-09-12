/**
 * Taking a command line apart.
 *
 * `&&`, `||`, `;`, `|` and newlines each start a new command; `$( )` and backticks nest one inside
 * another. Nothing here judges anything — it exists so that whatever does can look at one command
 * at a time, because a chain is exactly as dangerous as its most dangerous link.
 *
 * One scanner, three views. `splitCommands` is the flat list every rule used to work from,
 * `pipelines` keeps the `|` relationship that one question needs (a fetch feeding an interpreter
 * later in the same pipeline), and `splitWords` is the quote-aware word split that lets a rule ask
 * what `bash -c "…"` actually contains. Written once because a second hand-rolled shell scanner is
 * a second place for the same class of mistake.
 */

/** What the scanner is currently inside of. */
type Context = "'" | '"' | "$(" | "`";

/** What ended a piece, so a pipeline can be put back together. */
export type Separator = ";" | "|" | "&" | "&&" | "||" | "\n" | "sub" | "end";

interface Piece {
	text: string;
	after: Separator;
}

/**
 * The command line as pieces and the separators between them.
 *
 * A substitution — `$(…)` or a backtick pair — ends the piece it interrupts and its contents
 * become pieces of their own, marked `sub`. That flattening is deliberate: a substitution runs
 * before the command it sits inside, so for the purpose of "what does this line run" it is a
 * sibling, not a child.
 */
function scan(command: string): Piece[] {
	const pieces: Piece[] = [];
	let current = "";
	const stack: Context[] = [];
	const top = (): Context | undefined => stack[stack.length - 1];
	const flush = (after: Separator) => {
		pieces.push({ text: current, after });
		current = "";
	};

	for (let i = 0; i < command.length; i++) {
		const char = command[i];
		const next = command[i + 1];
		const context = top();

		// Inside single quotes nothing at all is special.
		if (context === "'") {
			if (char === "'") stack.pop();
			current += char;
			continue;
		}

		/*
		 * Inside double quotes only a substitution is — and it really is.
		 *
		 * This branch used to recognise `$(` and then do nothing about it, appending the `$` and
		 * continuing exactly as the fall-through would have. So `echo "$(rm -rf ~)"` was one piece
		 * whose first word is `echo`, and the command inside it was never looked at by anything.
		 * The comment said otherwise, which is how it survived.
		 */
		if (context === '"') {
			if (char === '"') {
				stack.pop();
				current += char;
				continue;
			}
			if (char === "$" && next === "(") {
				stack.push("$(");
				i++;
				flush("sub");
				continue;
			}
			if (char === "`") {
				stack.push("`");
				flush("sub");
				continue;
			}
			current += char;
			continue;
		}

		// Code: the top level, or the inside of a substitution.
		if (char === "'" || char === '"') {
			stack.push(char);
			current += char;
			continue;
		}
		if (char === "$" && next === "(") {
			stack.push("$(");
			i++;
			flush("sub");
			continue;
		}
		if (char === "`") {
			if (context === "`") stack.pop();
			else stack.push("`");
			flush("sub");
			continue;
		}
		if (char === ")" && context === "$(") {
			stack.pop();
			flush("sub");
			continue;
		}
		if (char === ";" || char === "\n") {
			flush(char === ";" ? ";" : "\n");
			continue;
		}
		if (char === "&" && next === "&") {
			i++;
			flush("&&");
			continue;
		}
		if (char === "|" && next === "|") {
			i++;
			flush("||");
			continue;
		}
		if (char === "|") {
			flush("|");
			continue;
		}
		if (char === "&") {
			flush("&");
			continue;
		}
		current += char;
	}
	flush("end");
	return pieces;
}

/**
 * Splits a command line into the individual commands it runs.
 *
 * `&&`, `||`, `;`, `|` and newlines all start a new command; `$( )` and backticks nest one
 * inside another. Every piece is judged on its own, because a chain is exactly as dangerous as
 * its most dangerous link.
 */
export function splitCommands(command: string): string[] {
	return scan(command)
		.map((piece) => piece.text.trim())
		.filter(Boolean);
}

/**
 * The same line, grouped into pipelines.
 *
 * One question needs the `|` relationship rather than a flat list: downloading something and
 * handing it to an interpreter is dangerous because of the join, and `curl url` and `python3`
 * are each unremarkable alone. Asking it against the flat list cannot distinguish
 * `curl u | python3` from `curl u; python3 app.py`.
 */
export function pipelines(command: string): string[][] {
	const out: string[][] = [];
	let stage: string[] = [];
	for (const piece of scan(command)) {
		const text = piece.text.trim();
		if (text) stage.push(text);
		if (piece.after === "|") continue;
		if (stage.length > 0) out.push(stage);
		stage = [];
	}
	if (stage.length > 0) out.push(stage);
	return out;
}

/**
 * One command's words, with quotes respected and then removed.
 *
 * `bash -c "rm -rf ~"` is three words, the third of which is a whole command line — and a rule
 * that wants to judge it needs the quotes gone. Splitting on whitespace instead gives five words
 * and the shape is lost.
 */
export function splitWords(command: string): string[] {
	const words: string[] = [];
	let current = "";
	let quote: "'" | '"' | null = null;
	let started = false;

	for (let i = 0; i < command.length; i++) {
		const char = command[i];
		if (quote) {
			if (char === quote) quote = null;
			else current += char;
			continue;
		}
		if (char === "'" || char === '"') {
			quote = char;
			// An empty quoted word is still a word: `--message ""` has two.
			started = true;
			continue;
		}
		if (/\s/.test(char)) {
			if (current || started) words.push(current);
			current = "";
			started = false;
			continue;
		}
		current += char;
	}
	if (current || started) words.push(current);
	return words;
}
