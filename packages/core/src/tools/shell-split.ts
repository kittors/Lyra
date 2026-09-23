/**
 * Taking a command line apart.
 *
 * `&&`, `||`, `;`, `|` and newlines each start a new command; `$( )`, backticks and `<( )` nest one
 * inside another. Nothing here judges anything — it exists so that whatever does can look at one
 * command at a time, because a chain is exactly as dangerous as its most dangerous link.
 *
 * One scanner, four views. `splitCommands` is the flat list every rule used to work from,
 * `pipelines` keeps the `|` relationship that one question needs (a fetch feeding an interpreter
 * later in the same pipeline), `sequence` keeps the operators between the line's own commands
 * (which of them decided the exit status), and `splitWords` is the quote-aware word split that lets
 * a rule ask what `bash -c "…"` actually contains. Written once because a second hand-rolled shell
 * scanner is a second place for the same class of mistake.
 *
 * The scanner has to agree with bash about where a command ends, and every place it did not was a
 * way around the rules that read it. Measured against the classifier before this was rewritten,
 * each of these was judged safe while bash ran `rm -rf ~`:
 *
 *   echo \"; rm -rf ~                  — the backslash was ignored, so `"` opened a quote
 *   echo $'it\'s'; rm -rf ~            — ANSI-C quoting, where `\'` does not end the string
 *   # it's fine⏎rm -rf ~               — the apostrophe in a comment opened a quote
 *   cat <<EOF⏎it's done⏎EOF⏎rm -rf ~   — the same, in a heredoc body
 *
 * and `curl u |& sh` was two pipelines instead of one. The rule for this file: where bash and the
 * scanner could disagree, the scanner does what bash does — and where it cannot tell, it must not
 * be the one that skips text bash would run.
 */

/**
 * Which grammar the line is in.
 *
 * `posix` is bash and zsh — the agent's shell almost everywhere, Git Bash on Windows included.
 * `powershell` is the Windows fallback where Git is not installed, and it disagrees about the one
 * character that matters most here: `\` is a path separator there, not an escape, and the escape
 * is a backtick. Read with bash's rules, `cat C:\Users\me\.ssh\id_rsa` lost its backslashes and the
 * credential rule never saw the path PowerShell was about to open.
 */
export type Dialect = "posix" | "powershell";

/** A frame on the scanner's stack: what it is currently inside of. */
type Frame =
	/** `'…'` — nothing at all is special. */
	| { kind: "'" }
	/** `$'…'` — ANSI-C quoting: a backslash escapes, including `\'`. */
	| { kind: "$'" }
	/** `"…"` — a backslash escapes, and substitutions really are substitutions. */
	| { kind: '"' }
	/** `$( … )` — a command substitution; `parens` counts the `(` it contains so `)` pairs up. */
	| { kind: "$("; parens: number }
	/** `` `…` `` — the old spelling of the same thing. */
	| { kind: "`" }
	/** `<( … )` or `>( … )` — process substitution, which runs a command just the same. */
	| { kind: "<("; parens: number }
	/** `( … )` — a subshell. Its commands are the line's commands; the frame only pairs the `)`. */
	| { kind: "(" }
	/**
	 * `$(( … ))` or `(( … ))` — arithmetic, where `;` and `<<` mean nothing about commands.
	 * `expansion` is the `$` form, which sits inside a word; the bare form is a command of its own.
	 */
	| { kind: "(("; parens: number; expansion: boolean }
	/** A heredoc body. `expands` is false when the delimiter was quoted: then it is pure data. */
	| { kind: "heredoc"; delimiter: string; stripTabs: boolean; expands: boolean };

type HeredocFrame = Extract<Frame, { kind: "heredoc" }>;

/**
 * What ended a piece, so the commands can be put back together.
 *
 * `sub` is a substitution opening in the middle of the piece; `close` is one ending, which also
 * ends the command that was running inside it.
 */
type Separator = ";" | "|" | "&" | "&&" | "||" | "\n" | "sub" | "close" | "end";

interface Piece {
	text: string;
	after: Separator;
	/** How many substitutions (or heredoc bodies) deep the text sits. 0 is the line itself. */
	depth: number;
	/** The text is a heredoc body's, which is data rather than a command. */
	body: boolean;
}

/** The frames that start a new level of commands; quotes, subshells and arithmetic do not. */
const NESTING = new Set<Frame["kind"]>(["$(", "`", "<(", "heredoc"]);

/** Where a heredoc delimiter word ends. */
const DELIMITER_END = /[\s;&|<>()]/;

/**
 * The command line as pieces and the separators between them.
 *
 * A substitution — `$(…)`, a backtick pair, `<(…)` — ends the piece it interrupts and its contents
 * become pieces of their own, one level deeper. That flattening is deliberate: a substitution runs
 * before the command it sits inside, so for the purpose of "what does this line run" it is a
 * sibling, not a child. `depth` is kept so the views that need the enclosing command whole can
 * rebuild it.
 */
function scan(command: string, dialect: Dialect = "posix"): Piece[] {
	const posix = dialect === "posix";
	/** What takes the next character out of the grammar: `\` in bash, a backtick in PowerShell. */
	const escape = posix ? "\\" : "`";
	const pieces: Piece[] = [];
	const stack: Frame[] = [];
	const heredocs: HeredocFrame[] = [];
	let current = "";
	/** Whether the next character would begin a word — the only place `#` starts a comment. */
	let wordStart = true;
	/** True when the scanner stands at the first character of a heredoc body line. */
	let lineStart = false;
	let i = 0;

	const top = (): Frame | undefined => stack[stack.length - 1];
	const depth = (): number => stack.reduce((n, frame) => (NESTING.has(frame.kind) ? n + 1 : n), 0);
	const flush = (after: Separator) => {
		pieces.push({ text: current, after, depth: depth(), body: top()?.kind === "heredoc" });
		current = "";
	};
	/** A substitution opens: what came before it belongs to the outer level. */
	const open = (frame: Frame) => {
		flush("sub");
		stack.push(frame);
		wordStart = true;
	};
	/** A substitution closes: what came before it belongs to the inner level, and ends there. */
	const close = () => {
		flush("close");
		stack.pop();
		// `$(date)#x` is one word; the `#` in it is not a comment.
		wordStart = false;
	};
	/** A separator ends the command, and the next character begins a word. */
	const separate = (after: Separator, width: number) => {
		flush(after);
		i += width;
		wordStart = true;
	};
	/** Bash reads a heredoc's body from the line after the operator, whatever it is nested in. */
	const startHeredoc = () => {
		const next = heredocs.shift();
		if (!next) return;
		stack.push(next);
		lineStart = true;
	};

	while (i < command.length) {
		const char = command[i];
		const next = command[i + 1];
		const frame = top();

		if (frame?.kind === "heredoc") {
			if (lineStart) {
				const end = command.indexOf("\n", i);
				const lineEnd = end === -1 ? command.length : end;
				const line = command.slice(i, lineEnd);
				if ((frame.stripTabs ? line.replace(/^\t+/, "") : line) === frame.delimiter) {
					flush("close");
					stack.pop();
					i = lineEnd + 1;
					lineStart = false;
					wordStart = true;
					startHeredoc();
					continue;
				}
				lineStart = false;
				// A quoted delimiter makes the body data, all of it: skip the line whole.
				if (!frame.expands) {
					i = lineEnd + 1;
					lineStart = true;
					continue;
				}
			}
			/*
			 * An unquoted body is expanded like a double-quoted string, except that `"` means
			 * nothing — so a substitution in it runs, and nothing else in it is a command.
			 */
			if (char === "\\") {
				i += 2;
				continue;
			}
			if (char === "$" && next === "(" && command[i + 2] === "(") {
				stack.push({ kind: "((", parens: 0, expansion: true });
				i += 3;
				continue;
			}
			if (char === "$" && next === "(") {
				open({ kind: "$(", parens: 0 });
				i += 2;
				continue;
			}
			if (char === "`") {
				open({ kind: "`" });
				i++;
				continue;
			}
			if (char === "\n") lineStart = true;
			i++;
			continue;
		}

		// Inside single quotes nothing at all is special.
		if (frame?.kind === "'") {
			if (char === "'") stack.pop();
			current += char;
			i++;
			continue;
		}

		// ANSI-C quotes: `$'it\'s'` is one string, and the `\'` in it does not end it.
		if (frame?.kind === "$'") {
			if (char === "\\") {
				current += char + (next ?? "");
				i += 2;
				continue;
			}
			if (char === "'") stack.pop();
			current += char;
			i++;
			continue;
		}

		/*
		 * Inside double quotes only a substitution is special — and it really is.
		 *
		 * This branch used to recognise `$(` and then do nothing about it, appending the `$` and
		 * continuing exactly as the fall-through would have. So `echo "$(rm -rf ~)"` was one piece
		 * whose first word is `echo`, and the command inside it was never looked at by anything.
		 *
		 * A backslash escapes the character after it: `"say \"hi\""` is one string, and `\$(` is a
		 * dollar sign and a parenthesis, not a command.
		 */
		if (frame?.kind === '"') {
			if (char === escape) {
				current += char + (next ?? "");
				i += 2;
				continue;
			}
			if (char === '"') {
				stack.pop();
				current += char;
				i++;
				continue;
			}
			if (posix && char === "$" && next === "(" && command[i + 2] === "(") {
				stack.push({ kind: "((", parens: 0, expansion: true });
				current += "$((";
				i += 3;
				continue;
			}
			if (char === "$" && next === "(") {
				open({ kind: "$(", parens: 0 });
				i += 2;
				continue;
			}
			if (posix && char === "`") {
				open({ kind: "`" });
				i++;
				continue;
			}
			current += char;
			i++;
			continue;
		}

		/*
		 * Arithmetic. `for ((i = 0; i < 3; i++))` has two semicolons and runs no commands, and
		 * `(( x <<= 1 ))` has a `<<` that starts no heredoc — read as one, it would swallow every
		 * line after it looking for a delimiter called `=`.
		 */
		if (frame?.kind === "((") {
			if (char === "\\") {
				current += char + (next ?? "");
				i += 2;
				continue;
			}
			if (char === "(") frame.parens++;
			if (char === ")") {
				if (frame.parens > 0) frame.parens--;
				else if (next === ")") {
					stack.pop();
					current += "))";
					i += 2;
					// `$((1))#x` is one word; after a bare `(( ))` the next word is a new one.
					wordStart = !frame.expansion;
					continue;
				}
			}
			if (char === "$" && next === "(" && command[i + 2] !== "(") {
				open({ kind: "$(", parens: 0 });
				i += 2;
				continue;
			}
			if (char === "`") {
				open({ kind: "`" });
				i++;
				continue;
			}
			current += char;
			i++;
			continue;
		}

		// Code: the top level, the inside of a substitution, or a subshell.

		/*
		 * A backslash takes the next character out of the grammar: `\;` is an argument and `\"` is
		 * a quote character, not a quote. A backslash before a newline is removed with it, joining
		 * the lines — which is how every long `docker run \` is written, and each of its lines used
		 * to be a command. Joined with nothing between, because that is what bash does: `r\⏎m` is `rm`.
		 */
		if (char === escape) {
			if (next !== "\n") {
				current += char + (next ?? "");
				wordStart = false;
			}
			i += 2;
			continue;
		}

		/*
		 * A comment runs to the end of the line, and whatever it contains is not code.
		 *
		 * `#` only starts one at the beginning of a word: `a#b` is a word and `${#x}` is a length.
		 * The newline itself is left for the separator below.
		 */
		if (char === "#" && wordStart) {
			const end = command.indexOf("\n", i);
			i = end === -1 ? command.length : end;
			continue;
		}

		if (char === "'") {
			stack.push({ kind: "'" });
			current += char;
			i++;
			wordStart = false;
			continue;
		}
		if (posix && char === "$" && next === "'") {
			stack.push({ kind: "$'" });
			current += "$'";
			i += 2;
			wordStart = false;
			continue;
		}
		if (char === '"') {
			stack.push({ kind: '"' });
			current += char;
			i++;
			wordStart = false;
			continue;
		}
		if (posix && char === "$" && next === "(" && command[i + 2] === "(") {
			stack.push({ kind: "((", parens: 0, expansion: true });
			current += "$((";
			i += 3;
			continue;
		}
		if (posix && char === "(" && next === "(" && wordStart) {
			stack.push({ kind: "((", parens: 0, expansion: false });
			current += "((";
			i += 2;
			continue;
		}
		if (char === "$" && next === "(") {
			open({ kind: "$(", parens: 0 });
			i += 2;
			continue;
		}
		if (posix && (char === "<" || char === ">") && next === "(") {
			open({ kind: "<(", parens: 0 });
			i += 2;
			continue;
		}
		if (posix && char === "`") {
			if (frame?.kind === "`") close();
			else open({ kind: "`" });
			i++;
			continue;
		}
		if (char === "(" && wordStart) {
			stack.push({ kind: "(" });
			current += char;
			i++;
			continue;
		}
		if (char === ")" && frame?.kind === "(") {
			stack.pop();
			current += char;
			i++;
			wordStart = true;
			continue;
		}
		if (frame?.kind === "$(" || frame?.kind === "<(") {
			if (char === "(") frame.parens++;
			if (char === ")") {
				if (frame.parens > 0) frame.parens--;
				else {
					close();
					i++;
					continue;
				}
			}
		}

		/*
		 * A heredoc: the operator stays with its command, and the body — from the next line to the
		 * delimiter — is read as data. `<<<` is a here-string and is just a word.
		 */
		if (posix && char === "<" && next === "<" && command[i + 2] !== "<") {
			const heredoc = readHeredocOperator(command, i);
			if (heredoc) {
				heredocs.push(heredoc.frame);
				current += command.slice(i, heredoc.end);
				i = heredoc.end;
				wordStart = false;
				continue;
			}
		}

		if (char === "\n") {
			separate("\n", 1);
			startHeredoc();
			continue;
		}
		if (char === ";") {
			separate(";", 1);
			continue;
		}
		if (char === "&" && next === "&") {
			separate("&&", 2);
			continue;
		}
		if (char === "|" && next === "|") {
			separate("||", 2);
			continue;
		}
		// `|&` pipes stderr along with stdout: still one pipeline.
		if (char === "|" && next === "&") {
			separate("|", 2);
			continue;
		}
		if (char === "|") {
			// `>|` overrides noclobber; it is a redirection, not a pipe.
			if (current.endsWith(">")) {
				current += char;
				i++;
			} else separate("|", 1);
			continue;
		}
		if (char === "&") {
			// `&>`, `&>>`, `>&2` and `2>&1` are redirections, not a job sent to the background.
			if (next === ">" || current.endsWith(">") || current.endsWith("<")) {
				current += char;
				i++;
				wordStart = false;
			} else separate("&", 1);
			continue;
		}
		current += char;
		i++;
		wordStart = /\s/.test(char);
	}
	flush("end");
	return pieces;
}

/**
 * `<<WORD`, `<<-WORD`, `<<'WORD'`, `<< "WORD"`, `<<\WORD` — the delimiter and whether it was quoted.
 *
 * Any quoting at all makes the body literal, which is bash's rule and the reason it is worth
 * knowing: a literal body cannot run anything, an unquoted one can run every `$(…)` in it.
 */
function readHeredocOperator(command: string, at: number): { frame: HeredocFrame; end: number } | null {
	let i = at + 2;
	const stripTabs = command[i] === "-";
	if (stripTabs) i++;
	while (command[i] === " " || command[i] === "\t") i++;
	let delimiter = "";
	let quoted = false;
	let quote: "'" | '"' | null = null;
	for (; i < command.length; i++) {
		const char = command[i];
		if (quote) {
			if (char === quote) quote = null;
			else delimiter += char;
			continue;
		}
		if (char === "'" || char === '"') {
			quote = char;
			quoted = true;
			continue;
		}
		if (char === "\\" && i + 1 < command.length) {
			quoted = true;
			delimiter += command[++i];
			continue;
		}
		if (DELIMITER_END.test(char)) break;
		delimiter += char;
	}
	if (!delimiter) return null;
	return { frame: { kind: "heredoc", delimiter, stripTabs, expands: !quoted }, end: i };
}

/**
 * Splits a command line into the individual commands it runs.
 *
 * `&&`, `||`, `;`, `|` and newlines all start a new command; `$( )` and backticks nest one
 * inside another. Every piece is judged on its own, because a chain is exactly as dangerous as
 * its most dangerous link.
 */
export function splitCommands(command: string, dialect: Dialect = "posix"): string[] {
	return scan(command, dialect)
		.filter((piece) => !piece.body)
		.map((piece) => piece.text.trim())
		.filter(Boolean);
}

/** One command put back together, with what followed it. */
interface Rebuilt {
	text: string;
	after: Separator;
	depth: number;
}

/**
 * The pieces rebuilt into whole commands.
 *
 * A substitution interrupts the command it sits in; for the views that need that command whole
 * — the one whose exit status counts, the stage of a pipeline — the interruption is folded back in
 * as `…`, and the substitution's own commands come out separately, when they close.
 *
 * An empty piece is dropped along with its separator. That is bash's reading too: after `|`, `&&`
 * or `||` a newline is skipped, so `curl u |⏎sh` is one pipeline and must not come out as two.
 */
function rebuild(command: string, dialect: Dialect = "posix"): Rebuilt[] {
	const out: Rebuilt[] = [];
	const open: string[] = [];
	for (const piece of scan(command, dialect)) {
		if (piece.body) continue;
		open[piece.depth] = (open[piece.depth] ?? "") + piece.text;
		if (piece.after === "sub") {
			open[piece.depth] += "…";
			continue;
		}
		const text = open[piece.depth].trim();
		open[piece.depth] = "";
		if (text) out.push({ text, after: piece.after, depth: piece.depth });
	}
	return out;
}

/**
 * The same line, grouped into pipelines.
 *
 * One question needs the `|` relationship rather than a flat list: downloading something and
 * handing it to an interpreter is dangerous because of the join, and `curl url` and `python3`
 * are each unremarkable alone. Asking it against the flat list cannot distinguish
 * `curl u | python3` from `curl u; python3 app.py`.
 *
 * Built from whole commands, so a substitution in a stage does not cut the pipeline in two:
 * `curl $(cat url.txt) | sh` is one pipeline whose first stage is `curl …`.
 */
export function pipelines(command: string, dialect: Dialect = "posix"): string[][] {
	const out: string[][] = [];
	const stages: string[][] = [];
	for (const entry of rebuild(command, dialect)) {
		const stage = (stages[entry.depth] ??= []);
		stage.push(entry.text);
		if (entry.after === "|") continue;
		out.push([...stage]);
		stage.length = 0;
	}
	for (const stage of stages) if (stage?.length) out.push([...stage]);
	return out;
}

/** A command of the line itself and the operator that follows it. */
export interface SequenceEntry {
	/** The command, with any substitution in it shown as `…`. */
	text: string;
	/** What follows it: `;`, `|`, `&`, `&&`, `||`, a newline, or nothing (`end`). */
	after: ";" | "|" | "&" | "&&" | "||" | "\n" | "end";
}

/**
 * The commands of the line itself, in order, with the operators between them.
 *
 * Substitutions are folded into the command they appear in; heredoc bodies are gone. This is the
 * view for a question about the line as bash runs it — which command's status became the exit
 * code — where a substitution is part of its command, not a command of the line.
 */
export function sequence(command: string): SequenceEntry[] {
	return rebuild(command)
		.filter((entry) => entry.depth === 0)
		.map((entry) => ({ text: entry.text, after: entry.after === "sub" || entry.after === "close" ? "end" : entry.after }));
}

/**
 * One command's words, with quotes and escapes respected and then removed.
 *
 * `bash -c "rm -rf ~"` is three words, the third of which is a whole command line — and a rule
 * that wants to judge it needs the quotes gone. Splitting on whitespace instead gives five words
 * and the shape is lost.
 *
 * Backslashes are resolved the way bash resolves them, because a word that keeps its backslash is
 * a different path: `cat ~/.ss\h/id_rsa` reads `~/.ssh/id_rsa`, and the credential rule only knows
 * that spelling. Outside quotes a backslash escapes anything; inside double quotes only `$`, `` ` ``,
 * `"`, `\` and a newline; inside single quotes nothing.
 */
export function splitWords(command: string, dialect: Dialect = "posix"): string[] {
	if (dialect === "powershell") return splitPowerShellWords(command);
	const words: string[] = [];
	let current = "";
	let quote: "'" | '"' | "$'" | null = null;
	let started = false;

	for (let i = 0; i < command.length; i++) {
		const char = command[i];
		const next = command[i + 1];
		if (quote === "'") {
			if (char === "'") quote = null;
			else current += char;
			continue;
		}
		if (quote === "$'") {
			if (char === "\\" && next !== undefined) {
				current += ANSI_ESCAPES[next] ?? next;
				i++;
			} else if (char === "'") quote = null;
			else current += char;
			continue;
		}
		if (quote === '"') {
			if (char === "\\" && next !== undefined && /[$`"\\\n]/.test(next)) {
				if (next !== "\n") current += next;
				i++;
			} else if (char === '"') quote = null;
			else current += char;
			continue;
		}
		if (char === "\\" && next !== undefined) {
			i++;
			if (next === "\n") continue;
			current += next;
			started = true;
			continue;
		}
		if (char === "$" && next === "'") {
			quote = "$'";
			started = true;
			i++;
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

/** The escapes `$'…'` understands that matter for reading a word; anything else stands for itself. */
const ANSI_ESCAPES: Record<string, string> = { n: "\n", t: "\t", r: "\r", "\\": "\\", "'": "'", '"': '"' };

/**
 * PowerShell's words: `\` is part of the word, a backtick escapes, `''` inside single quotes is a
 * quote. `C:\Users\me\.ssh\id_rsa` stays the path PowerShell will open.
 */
function splitPowerShellWords(command: string): string[] {
	const words: string[] = [];
	let current = "";
	let quote: "'" | '"' | null = null;
	let started = false;
	for (let i = 0; i < command.length; i++) {
		const char = command[i];
		const next = command[i + 1];
		if (quote === "'") {
			if (char === "'" && next === "'") {
				current += "'";
				i++;
			} else if (char === "'") quote = null;
			else current += char;
			continue;
		}
		if (char === "`" && next !== undefined) {
			i++;
			if (next !== "\n") current += next;
			started = true;
			continue;
		}
		if (quote === '"') {
			if (char === '"') quote = null;
			else current += char;
			continue;
		}
		if (char === "'" || char === '"') {
			quote = char;
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
