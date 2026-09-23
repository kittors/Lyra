/**
 * Line diff used for edit previews and approval prompts.
 *
 * A longest-common-subsequence table over the lines that differ — not Myers, as this used to
 * say: time and memory go as (changed old lines) × (changed new lines), with no shortcut when the
 * two sides share little, which is why the table has a ceiling (`MAX_TABLE_CELLS`). The UI needs
 * hunks with context (not just counts) to render a proper side-by-side view, so the backtrace is kept.
 */

export interface DiffLine {
	type: "context" | "add" | "remove";
	text: string;
	oldLine?: number;
	newLine?: number;
}

export interface DiffHunk {
	oldStart: number;
	newStart: number;
	lines: DiffLine[];
}

export interface FileDiff {
	added: number;
	removed: number;
	hunks: DiffHunk[];
}

const CONTEXT_LINES = 3;
/**
 * The largest table built, in cells. Past it the changed middle is shown as one block replaced.
 *
 * Measured without a ceiling: 6000 lines that all differed — a CRLF checkout diffed against its LF
 * blob — built 36M cells in 934ms and grew the heap by 282MB, to report "every line changed"
 * anyway. 2000 × 2000 takes 95ms and 32MB and is kept exact: a formatter re-indenting a file that
 * size is an ordinary edit, and one block replaced would hide which lines it actually moved. This
 * also runs per file in the desktop's main process, which is why the ceiling is not higher.
 */
const MAX_TABLE_CELLS = 4_000_000;

export function computeDiff(before: string, after: string, contextLines = CONTEXT_LINES): FileDiff {
	const oldLines = splitLines(before);
	const newLines = splitLines(after);
	const ops = diffLines(oldLines, newLines);

	let added = 0;
	let removed = 0;
	for (const op of ops) {
		if (op.type === "add") added++;
		else if (op.type === "remove") removed++;
	}

	return { added, removed, hunks: groupHunks(ops, contextLines) };
}

function splitLines(text: string): string[] {
	if (text === "") return [];
	const lines = text.split("\n");
	if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
	return lines;
}

/** Longest common subsequence via dynamic programming, then a backtrace into edit ops. */
function diffLines(a: string[], b: string[]): DiffLine[] {
	const n = a.length;
	const m = b.length;

	// Trim the common prefix/suffix first: real edits touch a few lines in a large file,
	// and the O(n*m) table would otherwise be built over the entire file for no reason.
	let prefix = 0;
	while (prefix < n && prefix < m && a[prefix] === b[prefix]) prefix++;
	let suffix = 0;
	while (suffix < n - prefix && suffix < m - prefix && a[n - 1 - suffix] === b[m - 1 - suffix]) suffix++;

	const midA = a.slice(prefix, n - suffix);
	const midB = b.slice(prefix, m - suffix);

	const out: DiffLine[] = [];
	let oldLine = 1;
	let newLine = 1;
	const keep = (text: string) => out.push({ type: "context", text, oldLine: oldLine++, newLine: newLine++ });
	const remove = (text: string) => out.push({ type: "remove", text, oldLine: oldLine++ });
	const add = (text: string) => out.push({ type: "add", text, newLine: newLine++ });

	for (let i = 0; i < prefix; i++) keep(a[i]);

	if (midA.length * midB.length > MAX_TABLE_CELLS) {
		for (const line of midA) remove(line);
		for (const line of midB) add(line);
	} else {
		const table: number[][] = Array.from({ length: midA.length + 1 }, () => Array.from<number>({ length: midB.length + 1 }).fill(0));
		for (let i = midA.length - 1; i >= 0; i--) {
			for (let j = midB.length - 1; j >= 0; j--) {
				table[i][j] = midA[i] === midB[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
			}
		}

		let i = 0;
		let j = 0;
		while (i < midA.length && j < midB.length) {
			if (midA[i] === midB[j]) {
				keep(midA[i]);
				i++;
				j++;
			} else if (table[i + 1][j] >= table[i][j + 1]) {
				remove(midA[i++]);
			} else {
				add(midB[j++]);
			}
		}
		while (i < midA.length) remove(midA[i++]);
		while (j < midB.length) add(midB[j++]);
	}

	for (let k = 0; k < suffix; k++) keep(a[n - suffix + k]);

	return out;
}

function groupHunks(ops: DiffLine[], contextLines: number): DiffHunk[] {
	const changedIndexes = ops.map((op, index) => (op.type === "context" ? -1 : index)).filter((i) => i !== -1);
	if (changedIndexes.length === 0) return [];

	const hunks: DiffHunk[] = [];
	let start = Math.max(0, changedIndexes[0] - contextLines);
	let end = Math.min(ops.length - 1, changedIndexes[0] + contextLines);

	for (const index of changedIndexes.slice(1)) {
		if (index - contextLines <= end + 1) {
			end = Math.min(ops.length - 1, index + contextLines);
			continue;
		}
		hunks.push(makeHunk(ops.slice(start, end + 1)));
		start = Math.max(0, index - contextLines);
		end = Math.min(ops.length - 1, index + contextLines);
	}
	hunks.push(makeHunk(ops.slice(start, end + 1)));
	return hunks;
}

function makeHunk(lines: DiffLine[]): DiffHunk {
	return {
		oldStart: lines.find((l) => l.oldLine !== undefined)?.oldLine ?? 1,
		newStart: lines.find((l) => l.newLine !== undefined)?.newLine ?? 1,
		lines,
	};
}

/** Render a diff as unified text for approval prompts and tool output. */
export function formatDiff(diff: FileDiff, path: string, maxLines = 200): string {
	if (diff.hunks.length === 0) return `${path}: no changes`;
	const out: string[] = [`--- ${path}`, `+++ ${path}`];
	let emitted = 0;
	for (const hunk of diff.hunks) {
		out.push(`@@ -${hunk.oldStart} +${hunk.newStart} @@`);
		for (const line of hunk.lines) {
			if (emitted >= maxLines) {
				out.push(`… diff truncated (+${diff.added} / -${diff.removed} total)`);
				return out.join("\n");
			}
			out.push(`${line.type === "add" ? "+" : line.type === "remove" ? "-" : " "}${line.text}`);
			emitted++;
		}
	}
	return out.join("\n");
}
