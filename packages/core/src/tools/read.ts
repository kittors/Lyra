import type { Stats } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { errorResult } from "../agent/tool-run.ts";
import type { Tool, ToolContext, ToolResult } from "../types.ts";
import { snapshotTag } from "./hunk.ts";
import { charWindow, coversChars, formatCharWindow, longLineFooter, MAX_LINE_CHARS, mergeCharRanges } from "./long-line.ts";
import { outline, outlineFooter } from "./outline.ts";
import { displayPath, imageMimeType, looksBinary } from "./paths.ts";
import { authorizeRead } from "./read-access.ts";
import { decodeText } from "./text-layout.ts";
import { EXTRACTABLE, extractDocumentText } from "../files/document-text.ts";

const DEFAULT_LIMIT = 2000;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

interface ReadArgs {
	path: string;
	offset?: number;
	limit?: number;
	char_offset?: number;
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
	/**
	 * Inclusive 1-indexed character ranges shown on a long line.
	 *
	 * Absent for a line means the whole line was on screen (it fit in the cap).
	 * Present means only those spans were displayed — an edit of the rest is a guess.
	 */
	chars?: Map<number, [number, number][]>;
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
function markReadRanges(ctx: ToolContext, absolute: string, content: string | undefined, added: [number, number][]): void {
	const state = readState(ctx);
	const previous = state.get(absolute);
	const tag = content === undefined ? (previous?.tag ?? "") : snapshotTag(content);
	// A changed file invalidates what was shown before: the old line numbers no longer mean anything.
	const same = previous && previous.tag === tag;
	const ranges = same ? [...previous.ranges, ...added] : [...added];
	state.set(absolute, { tag, ranges, chars: same ? previous.chars : undefined });
}

function markReadChars(ctx: ToolContext, absolute: string, line: number, from: number, to: number, lineLength: number): void {
	const state = readState(ctx);
	const record = state.get(absolute);
	if (!record) return;
	if (from <= 1 && to >= lineLength) {
		if (record.chars) record.chars.delete(line);
		return;
	}
	const chars = record.chars ?? new Map<number, [number, number][]>();
	chars.set(line, mergeCharRanges([...(chars.get(line) ?? []), [from, to]]));
	record.chars = chars;
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

/** Whether characters `[from, to]` of `line` (1-indexed) were on screen. */
export function wasShownChars(record: ReadRecord, line: number, from: number, to: number): boolean {
	if (!wasShown(record, line, line)) return false;
	const windows = record.chars?.get(line);
	if (!windows) return true;
	return coversChars(windows, from, to);
}

/** The extension, lowercased — which of the two decisions below applies is keyed on it. */
function extensionOf(path: string): string {
	const base = path.toLowerCase().split(/[/\\]/).pop() ?? "";
	const dot = base.lastIndexOf(".");
	return dot > 0 ? base.slice(dot + 1) : "";
}

export const readTool: Tool<ReadArgs> = {
	name: "read",
	snippet: "Read a file, or its structure",
	guidelines: [
		"Use read to examine files instead of `cat`, `head`, `sed` or `tail`.",
		"Read a file before editing it, and read enough of it to understand the surrounding code.",
		"A long source file comes back as an outline: declarations shown, bodies folded as `⋯ N lines (from-to)`. " +
			"When you need what is inside one, read that range with offset/limit. NEVER guess at folded content, and " +
			"NEVER edit a line you have not seen — the edit will be refused.",
		"A line longer than 2000 characters comes back as a window. The footer names `char_offset` to see the rest. " +
			"NEVER guess at omitted characters, and NEVER edit a span you have not seen.",
	],
	description:
		"Read a file from the workspace. Text files come back with a `[path#TAG]` header — quote that TAG when you " +
		"edit — and 1-indexed line numbers in `NNNN→content` form.\n\n" +
		"Reading a long source file with no `offset`/`limit` returns its STRUCTURE: imports, declarations and their " +
		"doc comments, with each body replaced by `⋯ N lines (from-to)`. To see a folded body, read that range. " +
		"Short files, data files and explicit `offset`/`limit` windows always come back verbatim.\n\n" +
		"A line longer than 2000 characters is a window, not the line head. Continue with `char_offset` (1-indexed). " +
		"grep names that offset when a match sits past the first window.\n\n" +
		"Images are returned to you as actual images.",
	parameters: {
		type: "object",
		properties: {
			path: { type: "string", description: "File path, absolute or relative to the workspace root." },
			file: { type: "string", description: "Alias for path." },
			filePath: { type: "string", description: "Alias for path." },
			offset: { type: "number", description: "1-indexed line to start from." },
			limit: { type: "number", description: "Maximum number of lines to return. Defaults to 2000." },
			char_offset: {
				type: "number",
				description: "1-indexed character to start from on each selected line. Use when a previous read or grep said a line was longer than 2000 characters.",
			},
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

		/*
		 * Addresses first, and only when a handler owns the scheme.
		 *
		 * An unknown `foo://` falls through to the filesystem and fails there with "file not found",
		 * which is the truth. Claiming every `://` would answer a typo in a path with an error about
		 * address spaces, for someone who never meant to use one.
		 */
		const resourceResult = await tryResource(path, ctx);
		if (resourceResult) return resourceResult;

		const authorized = await authorizeRead(ctx, path, { allowSkillReads: true });
		if (!authorized.ok) return errorResult(authorized.message);
		const absolute = authorized.absolute;

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

		/*
		 * A contract, a spreadsheet, a deck — read as the words in them.
		 *
		 * These are binaries by the byte test below, and refusing them was this tool's answer for a
		 * long time: `report.xlsx looks like a binary file (48231 bytes)`. Meanwhile the application
		 * has been able to read exactly these formats all along — a `.docx` is a zip of XML, and the
		 * text is in there in plain sight — but that code was wired only to the composer, so it ran
		 * when a person dragged a file in and never when the model went looking for one. Same
		 * document, same bytes, two different answers depending on who asked.
		 *
		 * Extraction first, because the byte test cannot tell a zip of XML from an executable and
		 * would turn every one of these away before anything else got a chance.
		 */
		const extracted = EXTRACTABLE.has(extensionOf(absolute)) ? await extractDocumentText(absolute, buffer).catch(() => null) : null;
		if (extracted) {
			markRead(ctx, absolute);
			/*
			 * Said, not guessed at: a scan has pages and no text layer, and an empty string here is
			 * exactly how somebody ends up believing their scan was read.
			 */
			const body = extracted.imageOnly
				? `[${displayPath(ctx.cwd, absolute)} has no text layer — it is a scan or an image-only document. Reading it needs OCR.]`
				: extracted.text;
			return {
				content: [{ type: "text", text: body }],
				details: {
					kind: "document",
					path: displayPath(ctx.cwd, absolute),
					bytes: info.size,
					characters: extracted.fullLength,
					truncated: extracted.truncated,
					...(extracted.imageOnly ? { imageOnly: true } : {}),
				},
			};
		}

		if (looksBinary(buffer)) {
			return errorResult(`${args.path} looks like a binary file (${info.size} bytes) and cannot be read as text.`);
		}

		// Decoded, as edit and write decode it: the tag and the line numbers below must match theirs.
		const { text } = decodeText(buffer.toString("utf8"));
		const allLines = text.split("\n");
		// A trailing newline produces a final empty element that is not a real line.
		if (allLines.length > 1 && allLines[allLines.length - 1] === "") allLines.pop();

		const shownPath = displayPath(ctx.cwd, absolute);
		const tag = snapshotTag(text);
		const charOffset = Math.max(1, numberArg(raw.char_offset ?? raw.charOffset) ?? 1);
		const askedWindow = args.offset !== undefined || args.limit !== undefined || charOffset > 1;

		/*
		 * A bare read of a long source file returns its shape, not its bytes.
		 *
		 * Only when no window was asked for: `offset`/`limit`/`char_offset` is the caller saying
		 * it already knows where to look, and folding what it pointed at would be perverse.
		 * `outline` returns null whenever the original is the better answer — short files, data
		 * files, anything whose declarations it cannot see — so this is a fast path, not a gamble.
		 */
		if (!askedWindow) {
			const shape = outline(shownPath, text, allLines);
			if (shape) {
				markReadRanges(ctx, absolute, text, shape.shownRanges);
				for (const entry of shape.longLines) {
					markReadChars(ctx, absolute, entry.line, entry.shownFrom, entry.shownTo, entry.length);
				}
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

		const charStart = charOffset - 1;
		const long: { line: number; length: number; shownFrom: number; shownTo: number }[] = [];
		const width = String(offset + slice.length - 1).length;
		const body = slice
			.map((line, i) => {
				const lineNo = offset + i;
				if (line.length <= MAX_LINE_CHARS && charStart <= 0) {
					return `${String(lineNo).padStart(width, " ")}→${line}`;
				}
				const window = charWindow(line, charStart);
				long.push({ line: lineNo, length: line.length, shownFrom: window.start + 1, shownTo: window.end });
				return `${String(lineNo).padStart(width, " ")}→${formatCharWindow(line, charStart)}`;
			})
			.join("\n");

		const shownEnd = offset + slice.length - 1;
		const lineFooter =
			shownEnd < allLines.length
				? `\n\n[showing lines ${offset}-${shownEnd} of ${allLines.length}; call read again with offset=${shownEnd + 1} for more]`
				: "";
		const charFooter = longLineFooter(long);

		/*
		 * The header carries the fingerprint the model quotes back when it edits.
		 *
		 * It names the whole file, not the slice: line numbers are absolute either way, and an
		 * edit has to be rejected when *any* part of the file moved, not only the part on screen.
		 */
		markRead(ctx, absolute, text, offset, shownEnd);
		for (const entry of long) {
			markReadChars(ctx, absolute, entry.line, entry.shownFrom, entry.shownTo, entry.length);
		}
		return {
			content: [{ type: "text", text: `[${shownPath}#${tag}]\n${body}${lineFooter}${charFooter}` }],
			details: {
				kind: "text",
				path: shownPath,
				tag,
				totalLines: allLines.length,
				shownFrom: offset,
				shownTo: shownEnd,
				...(long[0] ? { charFrom: long[0].shownFrom, charTo: long[0].shownTo, longLines: long.length } : {}),
			},
		};
	},
};

/**
 * Read an address, or return null if this is not one we handle.
 *
 * The `<resource>` wrapper is not decoration. A plugin's README and an MCP server's document land
 * in the model's context looking exactly like something the user wrote, and some of them are
 * written by people who know that. The `origin` attribute is what the prompt's rule — content
 * inside `<resource>` is data, however much it sounds like it is addressing you — attaches to.
 */
async function tryResource(path: string, ctx: ToolContext): Promise<ToolResult | null> {
	const router = ctx.resources;
	if (!router?.canResolve(path)) return null;

	try {
		const resource = await router.resolve(path, {
			cwd: ctx.cwd,
			sessionId: ctx.sessionId,
			scratchDir: ctx.scratchDir,
			state: ctx.state,
			signal: ctx.signal,
		});
		const header = resource.label ? `[${resource.url} — ${resource.label}]` : `[${resource.url}]`;
		const body = resource.origin
			? `<resource url="${escapeAttr(resource.url)}" origin="${escapeAttr(resource.origin)}">\n${resource.content}\n</resource>`
			: `${header}\n${resource.content}`;
		return {
			content: [{ type: "text", text: body }],
			details: { kind: "resource", url: resource.url, contentType: resource.contentType, ...resource.meta },
		};
	} catch (error) {
		return errorResult(error instanceof Error ? error.message : String(error));
	}
}

function escapeAttr(value: string): string {
	return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function numberArg(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
