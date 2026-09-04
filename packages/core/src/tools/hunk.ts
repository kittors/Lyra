/**
 * The line-anchored patch language behind `edit`.
 *
 * The model names the ORIGINAL line numbers it wants to change and writes only the replacement
 * lines. It never retypes the lines it is keeping, and it never has to reproduce existing bytes
 * exactly — which is what `old_string` demanded and what models are worst at.
 *
 * Measured against the `str_replace` form on this repository's own source
 * (`docs/dev-log/01-edit-format-eval.md`, 270 real calls):
 *
 *   gemini-2.5-flash-lite   first-attempt 78% → 96%, output tokens −49%
 *   gemini-3.7-flash-high   first-attempt 96% → 100%, output tokens −74%
 *
 * The bigger win is not the pass rate. Under `str_replace` ten of the failures were
 * `wrong-result` — the edit applied and produced the wrong file, with nothing to tell anyone.
 * Under this format every failure was a rejection the model could see and retry, because line
 * ranges can be checked against the file and byte anchors cannot.
 */

/** Every operation names original line numbers; nothing shifts as hunks are applied. */
export type Hunk =
	| { op: "replace"; start: number; end: number; lines: string[] }
	| { op: "insert"; after: number; lines: string[] }
	| { op: "delete"; start: number; end: number };

export interface ParseResult {
	hunks: Hunk[];
	/**
	 * Payload lines that arrived without the `+` prefix.
	 *
	 * Tolerated (see `parsePatch`), but counted: if this stays at zero in practice the prompt is
	 * carrying its weight, and if it is high the prefix is costing more than it buys.
	 */
	looseLines: number;
}

export class PatchError extends Error {}

/** Split so a trailing newline round-trips instead of being invented or lost. */
function toLines(content: string): { lines: string[]; trailingNewline: boolean } {
	const trailingNewline = content.endsWith("\n");
	return { lines: (trailingNewline ? content.slice(0, -1) : content).split("\n"), trailingNewline };
}

/**
 * A 4-hex fingerprint of the file, FNV-1a.
 *
 * Not a security primitive. Its whole job is to make "you are editing a file that changed since
 * you read it" a rejection instead of a silent overwrite — the case where a formatter, another
 * agent, or the user touched the file between the read and the edit.
 */
export function snapshotTag(content: string): string {
	let h = 0x811c9dc5;
	for (let i = 0; i < content.length; i++) {
		h ^= content.charCodeAt(i);
		h = Math.imul(h, 0x01000193);
	}
	return ((h >>> 0) & 0xffff).toString(16).toUpperCase().padStart(4, "0");
}

/** A line that is unambiguously an operation header rather than payload. */
const HEADER_RE = /^\s*(?:REPLACE\s+\d+\s*-\s*\d+|INSERT\s+AFTER\s+\d+|DELETE\s+\d+\s*-\s*\d+)\s*:?\s*$/i;

/**
 * Parse the patch language.
 *
 * Payload lines should carry a leading `+` — it makes the header/content boundary explicit and it
 * is how a blank line is written. The prefix is not *required*, because measurement said so: on
 * `gemini-2.5-flash-lite` the most common failure was a correct edit with the prefix omitted, and
 * rejecting it bought nothing. A payload line is ambiguous only when it exactly matches the header
 * grammar, and real source lines do not look like `REPLACE 3-7`.
 */
export function parsePatch(patch: string): ParseResult {
	const hunks: Hunk[] = [];
	const lines = patch.replace(/\r\n/g, "\n").split("\n");
	let i = 0;
	let looseLines = 0;

	const readPayload = (): string[] => {
		const payload: string[] = [];
		while (i < lines.length) {
			const line = lines[i];
			if (HEADER_RE.test(line)) break;
			if (line.startsWith("+")) {
				payload.push(line.slice(1));
			} else {
				// Blank lines at the very end belong to the patch's own formatting, not the payload.
				if (lines.slice(i).every((l) => l.trim() === "")) break;
				payload.push(line);
				if (line.trim() !== "") looseLines += 1;
			}
			i += 1;
		}
		return payload;
	};

	while (i < lines.length) {
		const line = lines[i];
		if (line.trim() === "") {
			i += 1;
			continue;
		}

		let match = /^\s*REPLACE\s+(\d+)\s*-\s*(\d+)\s*:?\s*$/i.exec(line);
		if (match) {
			i += 1;
			const payload = readPayload();
			if (payload.length === 0) {
				throw new PatchError(`REPLACE ${match[1]}-${match[2]} has no replacement lines. To remove lines use DELETE ${match[1]}-${match[2]}.`);
			}
			hunks.push({ op: "replace", start: Number(match[1]), end: Number(match[2]), lines: payload });
			continue;
		}

		match = /^\s*INSERT\s+AFTER\s+(\d+)\s*:?\s*$/i.exec(line);
		if (match) {
			i += 1;
			const payload = readPayload();
			if (payload.length === 0) throw new PatchError(`INSERT AFTER ${match[1]} has no lines to insert.`);
			hunks.push({ op: "insert", after: Number(match[1]), lines: payload });
			continue;
		}

		match = /^\s*DELETE\s+(\d+)\s*-\s*(\d+)\s*:?\s*$/i.exec(line);
		if (match) {
			i += 1;
			hunks.push({ op: "delete", start: Number(match[1]), end: Number(match[2]) });
			continue;
		}

		if (line.startsWith("+")) {
			throw new PatchError(`Payload line with no operation header above it: ${JSON.stringify(line.slice(0, 48))}`);
		}
		throw new PatchError(
			`Cannot read this as an operation: ${JSON.stringify(line.slice(0, 48))}. ` +
				`Each operation starts with REPLACE <start>-<end>, INSERT AFTER <line>, or DELETE <start>-<end>.`,
		);
	}

	if (hunks.length === 0) throw new PatchError("The patch contains no operations.");
	return { hunks, looseLines };
}

/**
 * Apply hunks to a file.
 *
 * Bottom-up is the whole trick: applied in descending order, no hunk shifts the numbers a later
 * hunk refers to, so every range in the patch means what it said against the file the model was
 * shown. Overlap is rejected rather than merged — two hunks touching one line is an ambiguous
 * intent, and guessing at it is how a patch quietly does the wrong thing.
 */
export function applyHunks(hunks: Hunk[], content: string): string {
	const { lines, trailingNewline } = toLines(content);
	const total = lines.length;

	const touched = new Set<number>();
	for (const hunk of hunks) {
		if (hunk.op === "insert") {
			if (hunk.after < 0 || hunk.after > total) {
				throw new PatchError(`INSERT AFTER ${hunk.after} is out of range: the file has ${total} lines. Use 0 to insert at the top.`);
			}
			continue;
		}
		if (hunk.start < 1 || hunk.end > total) {
			throw new PatchError(`Lines ${hunk.start}-${hunk.end} are out of range: the file has ${total} lines.`);
		}
		if (hunk.start > hunk.end) throw new PatchError(`Range ${hunk.start}-${hunk.end} is inverted.`);
		for (let n = hunk.start; n <= hunk.end; n++) {
			if (touched.has(n)) throw new PatchError(`Line ${n} is changed by more than one operation. Ranges must not overlap.`);
			touched.add(n);
		}
	}

	// An insert sits between lines, so it sorts just after the line it follows.
	const anchorOf = (h: Hunk) => (h.op === "insert" ? h.after + 0.5 : h.start);
	const ordered = [...hunks].sort((a, b) => anchorOf(b) - anchorOf(a));

	const out = [...lines];
	for (const hunk of ordered) {
		if (hunk.op === "insert") out.splice(hunk.after, 0, ...hunk.lines);
		else if (hunk.op === "delete") out.splice(hunk.start - 1, hunk.end - hunk.start + 1);
		else out.splice(hunk.start - 1, hunk.end - hunk.start + 1, ...hunk.lines);
	}
	return out.join("\n") + (trailingNewline ? "\n" : "");
}

/**
 * The syntax, as the model reads it.
 *
 * Deliberately free of a concrete example tag: with `e.g. A1B2` in the parameter description,
 * `gemini-2.5-flash-lite` copied that literal string into the argument instead of reading the
 * file header. Examples of *syntax* are useful; an example of a *value the model must copy from
 * elsewhere* is an invitation to copy the example.
 */
export const PATCH_SYNTAX = `Operations, one header line each. Payload lines start with "+".

REPLACE <start>-<end>
+replacement line 1
+replacement line 2

INSERT AFTER <line>
+new line

DELETE <start>-<end>

Rules:
- Line numbers are the ORIGINAL numbers shown in the file. They NEVER shift, however many
  operations you write.
- A payload line is everything after the leading "+", verbatim, including indentation. A blank
  line is a bare "+".
- The range names the original lines you are replacing; the payload may be longer or shorter.
- NEVER widen a range to retype lines you are keeping — use INSERT AFTER instead.
- To remove lines use DELETE, never REPLACE with an empty payload.
- Ranges must not overlap. One line is REPLACE 7-7.
- Several operations in one call is normal and preferred over several calls.`;
