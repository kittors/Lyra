import type { Stats } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { errorResult } from "../agent/tool-run.ts";
import type { Tool, ToolContext, ToolResult } from "../types.ts";
import { snapshotTag } from "./hunk.ts";
import { outline, outlineFooter } from "./outline.ts";
import { displayPath, imageMimeType, looksBinary, resolveWorkspacePath } from "./paths.ts";

const DEFAULT_LIMIT = 2000;
const MAX_LINE_LENGTH = 2000;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

interface ReadArgs {
	path: string;
	offset?: number;
	limit?: number;
}

/**
 * What the agent has seen of each file: the fingerprint it saw, and which lines.
 *
 * This used to be a `Set<string>` answering only "was this read at all", which is enough to stop
 * a blind edit and not enough for anything else. Two things need more:
 *
 *   - The fingerprint turns "the file changed since you looked at it" from a silent overwrite into
 *     a rejection. A formatter, another agent, or the user can touch a file between the read and
 *     the edit, and a byte anchor would happily match anyway.
 *   - The ranges stop an edit to lines that were never displayed. Reading lines 1–200 of a
 *     900-line file says nothing about line 700.
 */
const READ_FILES_KEY = "readFiles";

export interface ReadRecord {
	/** Fingerprint of the whole file at the moment it was read. */
	tag: string;
	/** Inclusive 1-indexed line ranges actually shown. */
	ranges: [number, number][];
}

type ReadState = Map<string, ReadRecord>;

function readState(ctx: ToolContext): ReadState {
	const existing = ctx.state.get(READ_FILES_KEY);
	if (existing instanceof Map) return existing as ReadState;
	const fresh: ReadState = new Map();
	ctx.state.set(READ_FILES_KEY, fresh);
	return fresh;
}

export function markRead(ctx: ToolContext, absolute: string, content?: string, from = 1, to?: number): void {
	markReadRanges(ctx, absolute, content, to === undefined ? [] : [[from, to]]);
}

/**
 * Record several disjoint ranges at once.
 *
 * The outline view shows scattered lines rather than one window, and the ranges have to reflect
 * that: an edit to a folded body must be refused, and it can only be refused if we remember that
 * the body was never on screen.
 */
export function markReadRanges(ctx: ToolContext, absolute: string, content: string | undefined, added: [number, number][]): void {
	const state = readState(ctx);
	const previous = state.get(absolute);
	const tag = content === undefined ? (previous?.tag ?? "") : snapshotTag(content);
	// A changed file invalidates what was shown before: the old line numbers no longer mean anything.
	const ranges = previous && previous.tag === tag ? [...previous.ranges, ...added] : [...added];
	state.set(absolute, { tag, ranges });
}

export function hasRead(ctx: ToolContext, absolute: string): boolean {
	return readState(ctx).has(absolute);
}

/** What the agent last saw of this file, or undefined if it has not read it. */
export function readRecord(ctx: ToolContext, absolute: string): ReadRecord | undefined {
	return readState(ctx).get(absolute);
}

/** Whether every line in `[from, to]` was actually displayed. */
export function wasShown(record: ReadRecord, from: number, to: number): boolean {
	for (let line = from; line <= to; line++) {
		if (!record.ranges.some(([a, b]) => line >= a && line <= b)) return false;
	}
	return true;
}

export const readTool: Tool<ReadArgs> = {
	name: "read",
	snippet: "Read file contents, with line numbers",
	guidelines: [
		"Use read to examine files instead of `cat`, `head`, `sed` or `tail`.",
		"Read a file before editing it, and read enough of it to understand the surrounding code.",
	],
	description:
		"Read a file from the workspace. Text files come back with 1-indexed line numbers in `NNNN→content` form. " +
		"Images are returned to you as actual images. Use `offset` and `limit` to page through long files; " +
		"reading without them returns the first 2000 lines.",
	parameters: {
		type: "object",
		properties: {
			path: { type: "string", description: "File path, absolute or relative to the workspace root." },
			file: { type: "string", description: "Alias for path." },
			filePath: { type: "string", description: "Alias for path." },
			offset: { type: "number", description: "1-indexed line to start from." },
			limit: { type: "number", description: "Maximum number of lines to return. Defaults to 2000." },
		},
		required: ["path"],
		additionalProperties: true,
	},
	summarize: (args) => {
		const raw = args as unknown as Record<string, unknown>;
		const path = String(raw.path ?? raw.file ?? raw.filePath ?? "");
		return path ? `Read ${path}` : "Read file";
	},

	async execute(args, ctx): Promise<ToolResult> {
		const raw = args as unknown as Record<string, unknown>;
		const path = typeof raw.path === "string" && raw.path
			? raw.path
			: typeof raw.file === "string" && raw.file
				? raw.file
				: typeof raw.filePath === "string" && raw.filePath
					? raw.filePath
					: "";

		if (!path) return errorResult("`path` is required.");

		let absolute: string;
		try {
			absolute = resolveWorkspacePath(ctx.cwd, path);
		} catch (error) {
			return errorResult(error instanceof Error ? error.message : String(error));
		}

		let info: Stats;
		try {
			info = await stat(absolute);
		} catch {
			return errorResult(`File not found: ${path}`);
		}
		if (info.isDirectory()) return errorResult(`${path} is a directory. Use \`ls\` or \`glob\` instead.`);

		const mime = imageMimeType(absolute);
		if (mime) {
			if (info.size > MAX_IMAGE_BYTES) {
				return errorResult(`Image is ${(info.size / 1024 / 1024).toFixed(1)} MB, above the 5 MB limit.`);
			}
			const data = await readFile(absolute);
			markRead(ctx, absolute);
			return {
				content: [{ type: "image", data: data.toString("base64"), mimeType: mime }],
				details: { kind: "image", path: displayPath(ctx.cwd, absolute), bytes: info.size, mimeType: mime },
			};
		}

		const buffer = await readFile(absolute);
		if (looksBinary(buffer)) {
			return errorResult(`${args.path} looks like a binary file (${info.size} bytes) and cannot be read as text.`);
		}

		const text = buffer.toString("utf8");
		const allLines = text.split("\n");
		// A trailing newline produces a final empty element that is not a real line.
		if (allLines.length > 1 && allLines[allLines.length - 1] === "") allLines.pop();

		const shownPath = displayPath(ctx.cwd, absolute);
		const tag = snapshotTag(text);

		/*
		 * A bare read of a long source file returns its shape, not its bytes.
		 *
		 * Only when no window was asked for: `offset`/`limit` is the caller saying it already knows
		 * where to look, and folding what it pointed at would be perverse. `outline` returns null
		 * whenever the original is the better answer — short files, data files, anything whose
		 * declarations it cannot see — so this is a fast path, not a gamble.
		 */
		if (args.offset === undefined && args.limit === undefined) {
			const shape = outline(shownPath, text, allLines);
			if (shape) {
				markReadRanges(ctx, absolute, text, shape.shownRanges);
				return {
					content: [{ type: "text", text: `[${shownPath}#${tag}]\n${shape.text}${outlineFooter(shownPath, shape, allLines.length)}` }],
					details: {
						kind: "text",
						path: shownPath,
						tag,
						totalLines: allLines.length,
						outlined: true,
						shownLines: shape.shownLines,
						foldedLines: shape.foldedLines,
					},
				};
			}
		}

		const offset = Math.max(1, args.offset ?? 1);
		const limit = Math.max(1, args.limit ?? DEFAULT_LIMIT);
		const slice = allLines.slice(offset - 1, offset - 1 + limit);

		if (slice.length === 0) {
			return errorResult(`Line ${offset} is past the end of the file (${allLines.length} lines).`);
		}

		const width = String(offset + slice.length - 1).length;
		const body = slice
			.map((line, i) => {
				const truncated =
					line.length > MAX_LINE_LENGTH ? `${line.slice(0, MAX_LINE_LENGTH)}… [line truncated]` : line;
				return `${String(offset + i).padStart(width, " ")}→${truncated}`;
			})
			.join("\n");

		const shownEnd = offset + slice.length - 1;
		const footer =
			shownEnd < allLines.length
				? `\n\n[showing lines ${offset}-${shownEnd} of ${allLines.length}; call read again with offset=${shownEnd + 1} for more]`
				: "";

		/*
		 * The header carries the fingerprint the model quotes back when it edits.
		 *
		 * It names the whole file, not the slice: line numbers are absolute either way, and an
		 * edit has to be rejected when *any* part of the file moved, not only the part on screen.
		 */
		markRead(ctx, absolute, text, offset, shownEnd);
		return {
			content: [{ type: "text", text: `[${shownPath}#${tag}]\n${body}${footer}` }],
			details: {
				kind: "text",
				path: shownPath,
				tag,
				totalLines: allLines.length,
				shownFrom: offset,
				shownTo: shownEnd,
			},
		};
	},
};
