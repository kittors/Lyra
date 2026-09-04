/**
 * What "who uses this symbol" means, and how sure we are about the answer.
 *
 * The whole reason this layer exists is one failure that does not announce itself. `grep` cannot
 * see an aliased import — `import { parse as p }` and then `p(...)` at the call site — and it
 * cannot follow a re-export chain. So a rename done with text tools finds most of the callsites,
 * misses some, and looks finished. The compiler catches it, or the runtime does.
 *
 * Which is why `confidence` is on every result rather than implied. "Found 6 places" and "text
 * search found 6 places, which may be missing aliased imports" are different pieces of information
 * to act on: the second one is a reason to check.
 */

export type CodeIntelOperation = "references" | "definition" | "diagnostics" | "rename";

/** A place in a file. Lines and columns are 1-based, matching what `read` shows. */
export interface CodeLocation {
	path: string;
	line: number;
	column: number;
	/** The source line, for a result a person can read without opening anything. */
	text?: string;
}

export interface Diagnostic {
	path: string;
	line: number;
	column: number;
	severity: "error" | "warning" | "info";
	message: string;
	code?: string | number;
}

export interface TextEdit {
	path: string;
	line: number;
	column: number;
	endLine: number;
	endColumn: number;
	newText: string;
}

/**
 * How the answer was obtained, which decides how much it can be trusted.
 *
 * `exact` is a language server that understands the program. `textual` is a regex over the source,
 * which is what we had — and the point of naming it is that the model reads this and behaves
 * differently. A `textual` answer to "who calls this" is a starting point, not a list.
 */
export type Confidence = "exact" | "textual";

export interface CodeIntelResult<T> {
	items: T[];
	confidence: Confidence;
	/** Why the answer is `textual`, when it is. Shown to the model verbatim. */
	caveat?: string;
	/** Which backend answered, for diagnostics. */
	backend: string;
}

/**
 * One language's code intelligence.
 *
 * The interface is deliberately narrow. omp's LSP layer is 8487 lines and covers hover, completion,
 * formatting, semantic tokens, inlay hints and call hierarchy; none of those help an agent. It
 * reads source directly rather than hovering, it writes whole functions rather than completing
 * them, and the project's own formatter is more correct than the server's.
 */
export interface CodeIntelBackend {
	name: string;
	/** File extensions this backend can answer for, lowercase and dotted. */
	extensions: string[];
	/** Whether the backend can run at all — a binary that is not installed is not an error. */
	available(): Promise<boolean>;
	/** Bring it up for a project root. Safe to call repeatedly. */
	start(root: string): Promise<void>;
	/** Whether it can answer now. A finished handshake is not the same as a built program. */
	ready(): boolean;
	references(file: string, line: number, column: number): Promise<CodeLocation[]>;
	definition(file: string, line: number, column: number): Promise<CodeLocation[]>;
	diagnostics(file: string): Promise<Diagnostic[]>;
	rename(file: string, line: number, column: number, newName: string): Promise<TextEdit[]>;
	dispose(): Promise<void>;
}
