/**
 * A structural view of a source file: declarations kept, bodies folded away.
 *
 * Reading a 300-line file to find out what it exports costs 300 lines of context, and the cost is
 * not only tokens — the answer the agent wanted is now buried in code it did not need. Twenty such
 * reads in one session is most of a context window spent on material nobody looked at twice.
 *
 * So a bare `read` of a long source file returns the shape: imports, declarations, the comments
 * that explain them, and a marker where each body used to be. The footer says exactly how to get
 * any of it back, and the prompt says never to guess at what was folded — a summary the model
 * treats as complete is worse than no summary.
 *
 * The declaration patterns are the ones `index/symbols.ts` already uses, imported rather than
 * copied: two regex tables that drift apart would make `symbol` and `read` disagree about what a
 * declaration is.
 *
 * Folding is refused rather than done badly. If the file does not parse into enough structure, or
 * if folding would not actually save much, the caller gets the original text — a wrong outline is
 * far more expensive than a long file.
 */

import { CODE_EXTENSIONS, PATTERNS } from "../index/symbols.ts";

/** Below this, folding is not worth the indirection. */
const MIN_LINES = 80;
/** A run shorter than this stays verbatim: the marker would cost as much as the lines. */
const MIN_RUN = 4;
/** If folding does not remove at least this share of the file, return the original. */
const MIN_SAVING = 0.3;

export interface Outline {
	text: string;
	/** Lines the model can see. */
	shownLines: number;
	/** Lines replaced by markers. */
	foldedLines: number;
	/**
	 * Inclusive 1-indexed ranges actually displayed, merged where contiguous.
	 *
	 * `edit` checks against these, so an edit to a folded body is refused rather than applied
	 * against lines the model never saw. That refusal is the outline's safety net: without it,
	 * folding would quietly widen what the model is willing to guess at.
	 */
	shownRanges: [number, number][];
}

/** Whether this path is a language whose declarations we can recognise. */
export function isOutlineable(path: string): boolean {
	const dot = path.lastIndexOf(".");
	return dot !== -1 && CODE_EXTENSIONS.has(path.slice(dot).toLowerCase());
}

const IMPORT_RE = /^\s*(?:import|export|from|use|using|require|package|#include|require_relative)\b/;
const DOC_OPEN_RE = /^\s*\/\*\*?/;
const DOC_CLOSE_RE = /\*\/\s*$/;
const LINE_COMMENT_RE = /^\s*(?:\/\/|#|--)/;
/** A closing brace at low indentation is structure, not body — keeping it makes the shape legible. */
const CLOSER_RE = /^[\t ]{0,2}[)}\]]+[;,]?\s*$/;

/** Indentation depth in tab-equivalents; four spaces count as one level. */
function depthOf(line: string): number {
	const indent = /^[\t ]*/.exec(line)?.[0] ?? "";
	return indent.replaceAll("    ", "\t").replaceAll(" ", "").length;
}

/**
 * Whether this line is structure rather than body.
 *
 * The patterns come from `index/symbols.ts` — one table, so `symbol` and `read` cannot disagree
 * about what a declaration is. But the two uses want different depths, and the difference is not
 * cosmetic: `symbol` wants every definition anywhere, while an outline wants only the ones that
 * describe the file's shape.
 *
 * The `const` pattern is where that bites. It matches `const step = compute()` inside a function
 * body just as happily as a module-level constant, and a body full of locals reads as 96 more
 * "declarations" — enough to push the kept share past the threshold and make the file refuse to
 * fold at all. Measured on a 163-line fixture: 108 lines "kept", outline abandoned.
 *
 * So bindings must sit at the top level, while functions, classes, types and methods are allowed
 * one level in — that is where a class's members live.
 */
function isDeclaration(line: string): boolean {
	const depth = depthOf(line);
	if (depth > 1) return false;
	for (const { kind, re } of PATTERNS) {
		if (!re.test(line)) continue;
		if (kind === "const" && depth > 0) continue;
		return true;
	}
	return false;
}

/**
 * Decide which lines survive.
 *
 * Comments immediately above a declaration are kept with it: a doc comment is usually the most
 * informative thing on the screen, and orphaning it from what it documents is worse than dropping
 * both.
 */
function keepMask(lines: string[]): boolean[] {
	const keep = lines.map((line) => isDeclaration(line) || IMPORT_RE.test(line) || CLOSER_RE.test(line));

	for (let i = 0; i < lines.length; i++) {
		if (!keep[i]) continue;
		// Walk up through an attached comment block and keep it with its declaration.
		let j = i - 1;
		while (j >= 0 && !keep[j]) {
			const line = lines[j];
			if (LINE_COMMENT_RE.test(line) || DOC_CLOSE_RE.test(line) || DOC_OPEN_RE.test(line) || line.trim().startsWith("*") || line.trim() === "") {
				// A blank line only survives if it sits inside the comment block, not before it.
				if (line.trim() === "" && !(j > 0 && !keep[j - 1] && (LINE_COMMENT_RE.test(lines[j - 1]) || lines[j - 1].trim().startsWith("*")))) break;
				keep[j] = true;
				if (DOC_OPEN_RE.test(line)) break;
				j -= 1;
				continue;
			}
			break;
		}
	}
	return keep;
}

/**
 * Build the outline, or return null when the original text is the better answer.
 *
 * `null` is not a failure path — it is the common case for short files, data files, and anything
 * whose declarations we cannot see. The caller falls back to verbatim content.
 */
export function outline(path: string, content: string, lines: string[]): Outline | null {
	if (!isOutlineable(path)) return null;
	if (lines.length < MIN_LINES) return null;

	const keep = keepMask(lines);
	const kept = keep.filter(Boolean).length;
	// Nothing recognisable, or a file that is all declarations: an outline adds nothing.
	if (kept < 3 || kept / lines.length > 1 - MIN_SAVING) return null;

	const width = String(lines.length).length;
	const out: string[] = [];
	let folded = 0;
	let run: number[] = [];
	const displayed: number[] = [];

	const show = (index: number) => {
		out.push(`${String(index + 1).padStart(width, " ")}→${lines[index]}`);
		displayed.push(index + 1);
	};

	const flush = () => {
		if (run.length === 0) return;
		if (run.length < MIN_RUN) {
			// Too short to be worth a marker; show it.
			for (const index of run) show(index);
		} else {
			out.push(`${" ".repeat(width)}  ⋯ ${run.length} lines (${run[0] + 1}-${run[run.length - 1] + 1})`);
			folded += run.length;
		}
		run = [];
	};

	for (let i = 0; i < lines.length; i++) {
		if (keep[i]) {
			flush();
			show(i);
		} else {
			run.push(i);
		}
	}
	flush();

	if (folded / lines.length < MIN_SAVING) return null;

	// Merge the displayed line numbers into ranges so `edit`'s check stays cheap.
	const shownRanges: [number, number][] = [];
	for (const line of displayed) {
		const last = shownRanges[shownRanges.length - 1];
		if (last && line === last[1] + 1) last[1] = line;
		else shownRanges.push([line, line]);
	}

	return { text: out.join("\n"), shownLines: displayed.length, foldedLines: folded, shownRanges };
}

/**
 * The line that tells the model what it is looking at and how to get the rest.
 *
 * "Never guess" is the load-bearing half. Without it a model will happily write about the contents
 * of a body it has not seen, and an outline it treats as complete is worse than the whole file.
 */
export function outlineFooter(path: string, result: Outline, totalLines: number): string {
	return (
		`\n\n[结构视图：显示 ${result.shownLines} 行声明，折叠 ${result.foldedLines} 行实现（共 ${totalLines} 行）。` +
		`需要某段实现时用 offset/limit 读它的行范围，例如 read ${path} offset=<起> limit=<行数>。` +
		`绝不要猜测 ⋯ 折叠掉的内容。]`
	);
}
