/**
 * The edit formats under test, and the appliers that decide whether a call landed.
 *
 * Three, because "is the new format better" cannot be answered by measuring one of them:
 *
 *   str-replace  what Lyra ships today — anchor on the exact old bytes, hand back the new bytes.
 *   hunk-text    a line-anchored mini-language; the model writes only the replacement lines.
 *   hunk-json    the same operations as a structured array, to separate "line anchoring helps"
 *                from "a terse text syntax helps".
 *
 * The appliers are deliberately strict. A format that silently repairs a malformed call would
 * measure the repair, not the format — and the repair is not what ships.
 */

import type { JsonSchema, ToolSpec } from "../../packages/core/src/types.ts";

export type FormatId = "str-replace" | "hunk-text" | "hunk-json" | "production";

export interface ApplyResult {
	ok: boolean;
	content?: string;
	error?: string;
}

export interface EditFormat {
	id: FormatId;
	spec: ToolSpec;
	/** Rendered into the prompt so the model knows what `read` gave it. */
	renderFile(path: string, content: string, tag: string): string;
	apply(args: Record<string, unknown>, current: string, tag: string): ApplyResult;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Split keeping the trailing-newline distinction, so round-tripping is lossless. */
function toLines(content: string): { lines: string[]; trailingNewline: boolean } {
	const trailingNewline = content.endsWith("\n");
	const body = trailingNewline ? content.slice(0, -1) : content;
	return { lines: body.split("\n"), trailingNewline };
}

function fromLines(lines: string[], trailingNewline: boolean): string {
	return lines.join("\n") + (trailingNewline ? "\n" : "");
}

/**
 * 4-hex fingerprint of the file, FNV-1a.
 *
 * Not a security primitive — it exists so an edit written against yesterday's read is rejected
 * instead of silently landing on top of someone else's change. 65536 buckets is plenty for
 * "did this file change since you looked at it".
 */
export function snapshotTag(content: string): string {
	let h = 0x811c9dc5;
	for (let i = 0; i < content.length; i++) {
		h ^= content.charCodeAt(i);
		h = Math.imul(h, 0x01000193);
	}
	return ((h >>> 0) & 0xffff).toString(16).toUpperCase().padStart(4, "0");
}

function numberedLines(content: string): string {
	const { lines } = toLines(content);
	const width = String(lines.length).length;
	return lines.map((line, i) => `${String(i + 1).padStart(width, " ")}→${line}`).join("\n");
}

// ---------------------------------------------------------------------------
// Hunk model, shared by the two hunk formats
// ---------------------------------------------------------------------------

type Hunk =
	| { op: "replace"; start: number; end: number; lines: string[] }
	| { op: "insert"; after: number; lines: string[] }
	| { op: "delete"; start: number; end: number };

/**
 * Apply hunks against original line numbers.
 *
 * Descending order is the whole trick: applied bottom-up, no hunk shifts the numbers any later
 * hunk refers to, so the model never has to do arithmetic about its own edits. Overlap is an
 * error rather than a merge — two hunks touching one line means the intent is ambiguous.
 */
function applyHunks(hunks: Hunk[], current: string): ApplyResult {
	const { lines, trailingNewline } = toLines(current);
	const total = lines.length;

	const touched = new Set<number>();
	for (const hunk of hunks) {
		if (hunk.op === "insert") {
			if (hunk.after < 0 || hunk.after > total) return { ok: false, error: `INSERT AFTER ${hunk.after} is out of range (file has ${total} lines)` };
			continue;
		}
		if (hunk.start < 1 || hunk.end > total) return { ok: false, error: `range ${hunk.start}-${hunk.end} is out of range (file has ${total} lines)` };
		if (hunk.start > hunk.end) return { ok: false, error: `range ${hunk.start}-${hunk.end} is inverted` };
		for (let n = hunk.start; n <= hunk.end; n++) {
			if (touched.has(n)) return { ok: false, error: `line ${n} is touched by more than one hunk` };
			touched.add(n);
		}
	}

	const anchorOf = (h: Hunk) => (h.op === "insert" ? h.after + 0.5 : h.start);
	const ordered = [...hunks].sort((a, b) => anchorOf(b) - anchorOf(a));

	const out = [...lines];
	for (const hunk of ordered) {
		if (hunk.op === "insert") out.splice(hunk.after, 0, ...hunk.lines);
		else if (hunk.op === "delete") out.splice(hunk.start - 1, hunk.end - hunk.start + 1);
		else out.splice(hunk.start - 1, hunk.end - hunk.start + 1, ...hunk.lines);
	}
	return { ok: true, content: fromLines(out, trailingNewline) };
}

// ---------------------------------------------------------------------------
// A · str-replace (what ships today)
// ---------------------------------------------------------------------------

const strReplaceParams: JsonSchema = {
	type: "object",
	properties: {
		path: { type: "string", description: "File path." },
		old_string: { type: "string", description: "Exact text to replace." },
		new_string: { type: "string", description: "Replacement text. Must differ from old_string." },
		replace_all: { type: "boolean", description: "Replace every occurrence instead of requiring uniqueness." },
	},
	required: ["path", "old_string", "new_string"],
	additionalProperties: false,
};

export const strReplace: EditFormat = {
	id: "str-replace",
	spec: {
		name: "edit",
		description:
			"Replace an exact string in a file. `old_string` must match the file byte for byte, including indentation, " +
			"and must be unique unless `replace_all` is true. " +
			"Include a few surrounding lines in `old_string` when the snippet would otherwise be ambiguous.",
		parameters: strReplaceParams,
	},
	renderFile(path, content) {
		return `${path}:\n\`\`\`\n${numberedLines(content)}\n\`\`\``;
	},
	apply(args, current) {
		const oldStr = typeof args.old_string === "string" ? args.old_string : null;
		const newStr = typeof args.new_string === "string" ? args.new_string : null;
		if (oldStr === null || newStr === null) return { ok: false, error: "old_string and new_string must both be strings" };
		if (oldStr === newStr) return { ok: false, error: "old_string and new_string are identical" };

		const count = current.split(oldStr).length - 1;
		if (count === 0) return { ok: false, error: "old_string not found in file" };
		if (count > 1 && args.replace_all !== true) return { ok: false, error: `old_string appears ${count} times; not unique` };

		return { ok: true, content: args.replace_all === true ? current.split(oldStr).join(newStr) : current.replace(oldStr, newStr) };
	},
};

// ---------------------------------------------------------------------------
// B · hunk-text
// ---------------------------------------------------------------------------

const HUNK_SYNTAX = `Patch syntax — one operation per header line, payload lines start with "+":

REPLACE <start>-<end>
+new line 1
+new line 2

INSERT AFTER <line>
+new line

DELETE <start>-<end>

Rules:
- Line numbers are the ORIGINAL numbers from the file you were shown. They never shift, no matter
  how many operations you write.
- A payload line is everything after the leading "+", verbatim, including indentation. A blank line
  is a bare "+". A line whose own text starts with "+" is written "++".
- The range names the original lines you are REPLACING. The payload may be longer or shorter.
- Never widen a range to retype lines you want to keep — use INSERT AFTER instead.
- To delete, use DELETE. Never use REPLACE with an empty payload.
- Ranges must not overlap. Single line: REPLACE 7-7.`;

const hunkTextParams: JsonSchema = {
	type: "object",
	properties: {
		path: { type: "string", description: "File path." },
		// No example value here on purpose. With "e.g. A1B2" in the description, gemini-2.5-flash-lite
		// copied the literal example into the argument instead of reading the header — measured
		// 2026-09-04, it was one of the two hunk-text failures in a 45-case run.
		tag: { type: "string", description: "Copy the 4-character tag from the [path#TAG] header of the file you were shown. Do not invent it." },
		patch: { type: "string", description: `The patch. ${HUNK_SYNTAX}` },
	},
	required: ["path", "tag", "patch"],
	additionalProperties: false,
};

/** A line that is unambiguously an operation header rather than payload. */
const HEADER_RE = /^\s*(?:REPLACE\s+\d+\s*-\s*\d+|INSERT\s+AFTER\s+\d+|DELETE\s+\d+\s*-\s*\d+)\s*:?\s*$/i;

/**
 * Parse the patch language.
 *
 * Payload lines SHOULD carry a leading `+`, and the prompt teaches that — it makes the boundary
 * between a header and its content explicit, and it is how a blank payload line is written.
 * But the `+` is not required, because measurement said so: on `gemini-2.5-flash-lite` the single
 * most common failure was a correct edit with the prefix omitted, and rejecting it bought nothing.
 * A payload line is ambiguous only when it exactly matches the header grammar, which real source
 * lines do not.
 *
 * `looseLines` counts how often that tolerance was used, so the cost of dropping the `+` from the
 * prompt entirely could be argued from data later rather than guessed at.
 */
export function parseHunkText(patch: string): { ok: true; hunks: Hunk[]; looseLines: number } | { ok: false; error: string } {
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
				// Trailing blank lines belong to the patch's own formatting, not to the payload.
				const restIsBlank = lines.slice(i).every((l) => l.trim() === "");
				if (restIsBlank) break;
				payload.push(line);
				if (line.trim() !== "") looseLines += 1;
			}
			i += 1;
		}
		return payload;
	};

	while (i < lines.length) {
		const line = lines[i];
		if (line.trim() === "") { i += 1; continue; }

		let match = /^\s*REPLACE\s+(\d+)\s*-\s*(\d+)\s*:?\s*$/i.exec(line);
		if (match) {
			i += 1;
			const payload = readPayload();
			if (payload.length === 0) return { ok: false, error: `REPLACE ${match[1]}-${match[2]} has no payload; use DELETE to remove lines` };
			hunks.push({ op: "replace", start: Number(match[1]), end: Number(match[2]), lines: payload });
			continue;
		}

		match = /^\s*INSERT\s+AFTER\s+(\d+)\s*:?\s*$/i.exec(line);
		if (match) {
			i += 1;
			const payload = readPayload();
			if (payload.length === 0) return { ok: false, error: `INSERT AFTER ${match[1]} has no payload` };
			hunks.push({ op: "insert", after: Number(match[1]), lines: payload });
			continue;
		}

		match = /^\s*DELETE\s+(\d+)\s*-\s*(\d+)\s*:?\s*$/i.exec(line);
		if (match) {
			i += 1;
			hunks.push({ op: "delete", start: Number(match[1]), end: Number(match[2]) });
			continue;
		}

		if (line.startsWith("+")) return { ok: false, error: `payload line with no preceding operation header: ${JSON.stringify(line.slice(0, 40))}` };
		return { ok: false, error: `unrecognised line: ${JSON.stringify(line.slice(0, 40))}` };
	}

	if (hunks.length === 0) return { ok: false, error: "patch contains no operations" };
	return { ok: true, hunks, looseLines };
}

export const hunkText: EditFormat = {
	id: "hunk-text",
	spec: {
		name: "edit",
		description:
			"Edit a file by naming the original line numbers to change. You write only the replacement lines — " +
			"never retype lines you are keeping. " +
			"`tag` must be the snapshot tag from the header of the file you were shown; if the file changed since " +
			"then the edit is rejected.\n\n" +
			HUNK_SYNTAX,
		parameters: hunkTextParams,
	},
	renderFile(path, content, tag) {
		return `[${path}#${tag}]\n\`\`\`\n${numberedLines(content)}\n\`\`\``;
	},
	apply(args, current, tag) {
		if (typeof args.tag !== "string") return { ok: false, error: "tag is required" };
		if (args.tag.toUpperCase() !== tag) return { ok: false, error: `stale tag ${args.tag}: the file is now ${tag}. Re-read before editing.` };
		if (typeof args.patch !== "string") return { ok: false, error: "patch must be a string" };

		const parsed = parseHunkText(args.patch);
		if (!parsed.ok) return { ok: false, error: parsed.error };
		return applyHunks(parsed.hunks, current);
	},
};

// ---------------------------------------------------------------------------
// C · hunk-json
// ---------------------------------------------------------------------------

const hunkJsonParams: JsonSchema = {
	type: "object",
	properties: {
		path: { type: "string", description: "File path." },
		tag: { type: "string", description: "Copy the 4-character tag from the [path#TAG] header of the file you were shown. Do not invent it." },
		hunks: {
			type: "array",
			description:
				"Operations against the ORIGINAL line numbers shown in the file. Numbers never shift between hunks. " +
				"Ranges must not overlap. Use `insert` for pure additions rather than widening a `replace`.",
			items: {
				type: "object",
				properties: {
					op: {
						type: "string",
						enum: ["replace", "insert", "delete"],
						description:
							"replace: needs start, end, lines (lines must be non-empty). " +
							"insert: needs after, lines. " +
							"delete: needs start, end and NO lines — to remove lines use delete, never replace with an empty lines array.",
					},
					start: { type: "number", description: "First original line, 1-indexed. For replace and delete." },
					end: { type: "number", description: "Last original line, inclusive. For replace and delete." },
					after: { type: "number", description: "Insert after this original line. 0 means the top of the file. For insert only." },
					lines: { type: "array", items: { type: "string" }, description: "New lines, verbatim including indentation, without trailing newlines. Required and non-empty for replace and insert; omit for delete." },
				},
				required: ["op"],
				additionalProperties: false,
			},
		},
	},
	required: ["path", "tag", "hunks"],
	additionalProperties: false,
};

export const hunkJson: EditFormat = {
	id: "hunk-json",
	spec: {
		name: "edit",
		description:
			"Edit a file by naming the original line numbers to change. You supply only the replacement lines — " +
			"never retype lines you are keeping. " +
			"`tag` must be the snapshot tag from the header of the file you were shown; if the file changed since " +
			"then the edit is rejected.",
		parameters: hunkJsonParams,
	},
	renderFile(path, content, tag) {
		return `[${path}#${tag}]\n\`\`\`\n${numberedLines(content)}\n\`\`\``;
	},
	apply(args, current, tag) {
		if (typeof args.tag !== "string") return { ok: false, error: "tag is required" };
		if (args.tag.toUpperCase() !== tag) return { ok: false, error: `stale tag ${args.tag}: the file is now ${tag}. Re-read before editing.` };
		if (!Array.isArray(args.hunks) || args.hunks.length === 0) return { ok: false, error: "hunks must be a non-empty array" };

		const hunks: Hunk[] = [];
		for (const raw of args.hunks as Record<string, unknown>[]) {
			const op = raw?.op;
			const lines = Array.isArray(raw?.lines) ? (raw.lines as unknown[]).map(String) : [];
			if (op === "replace") {
				if (typeof raw.start !== "number" || typeof raw.end !== "number") return { ok: false, error: "replace needs numeric start and end" };
				if (lines.length === 0) return { ok: false, error: "replace with no lines; use delete instead" };
				hunks.push({ op: "replace", start: raw.start, end: raw.end, lines });
			} else if (op === "insert") {
				if (typeof raw.after !== "number") return { ok: false, error: "insert needs a numeric after" };
				if (lines.length === 0) return { ok: false, error: "insert with no lines" };
				hunks.push({ op: "insert", after: raw.after, lines });
			} else if (op === "delete") {
				if (typeof raw.start !== "number" || typeof raw.end !== "number") return { ok: false, error: "delete needs numeric start and end" };
				hunks.push({ op: "delete", start: raw.start, end: raw.end });
			} else {
				return { ok: false, error: `unknown op ${JSON.stringify(op)}` };
			}
		}
		return applyHunks(hunks, current);
	},
};

export const FORMATS: Record<string, EditFormat> = {
	"str-replace": strReplace,
	"hunk-text": hunkText,
	"hunk-json": hunkJson,
};

// ---------------------------------------------------------------------------
// D · production
//
// The same evaluation, run against the code that actually ships: the tool spec from
// `editTool` and the applier from `tools/hunk.ts`. The three formats above are standalone
// re-implementations, which is what made them comparable — but a number measured on a copy
// proves nothing about the product. This one closes that gap.
// ---------------------------------------------------------------------------

import { editTool } from "../../packages/core/src/tools/edit.ts";
import { applyHunks as prodApply, parsePatch as prodParse, PatchError as ProdPatchError } from "../../packages/core/src/tools/hunk.ts";

export const production: EditFormat = {
	id: "production" as FormatId,
	spec: { name: "edit", description: editTool.description, parameters: editTool.parameters },
	renderFile(path, content, tag) {
		// Byte-identical to what readTool now emits.
		return `[${path}#${tag}]\n${numberedLines(content)}`;
	},
	apply(args, current, tag) {
		if (typeof args.tag !== "string") return { ok: false, error: "tag is required" };
		if (args.tag.trim().toUpperCase() !== tag) return { ok: false, error: `stale tag ${args.tag}: the file is now ${tag}.` };
		if (typeof args.patch !== "string") return { ok: false, error: "patch must be a string" };
		try {
			const parsed = prodParse(args.patch);
			return { ok: true, content: prodApply(parsed.hunks, current) };
		} catch (error) {
			return { ok: false, error: error instanceof ProdPatchError ? error.message : String(error) };
		}
	},
};

FORMATS["production" as FormatId] = production;
