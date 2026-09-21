import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { readdir, readFile, stat } from "node:fs/promises";
import { basename, join, relative, sep } from "node:path";
import { errorResult } from "../agent/tool-run.ts";
import type { Tool, ToolContext, ToolResult } from "../types.ts";
import { globToRegExp } from "./glob.ts";
import { formatMatchWindow, formatMatchWindowAt, utf8ByteOffsetToIndex, type MatchOptions } from "./long-line.ts";
import { looksBinary } from "./paths.ts";
import { authorizeRead } from "./read-access.ts";

const MAX_MATCHES = 200;
// About 3.4k estimated tokens across all matches; more requires a narrower search.
const MAX_OUTPUT_CHARS = 12_000;

/**
 * Keep the file:line address. On a long line, keep a window around the match — not the
 * first 2 000 characters — and name `char_offset` so read can open the rest.
 */
function shortenLine(line: string, pattern?: string, options?: MatchOptions, matchAt?: number): string {
	const { address, content } = splitGrepLine(line);
	const body = matchAt === undefined ? formatMatchWindow(content, pattern, options) : formatMatchWindowAt(content, matchAt);
	return address ? `${address}${body}` : body;
}

/** `path:line:rest` from ripgrep / the fallback. Paths themselves are not windowed. */
function splitGrepLine(line: string): { address: string; content: string } {
	const found = line.match(/^(.+?:)(\d+:)(.*)$/s);
	if (!found) return { address: "", content: line };
	return { address: found[1] + found[2], content: found[3] };
}

/** Shared with offline audit replay so its estimate measures the production output policy. */
export function boundedGrepLines(lines: string[], pattern?: string): string[] {
	return boundCollectedLines(lines.map((line) => shortenLine(line, pattern)));
}

/** Collectors already shorten each line; applying that twice would replace the omission count. */
function boundCollectedLines(lines: string[]): string[] {
	const shown: string[] = [];
	let size = 0;
	for (const line of lines) {
		if (size + line.length + 1 > MAX_OUTPUT_CHARS) break;
		shown.push(line);
		size += line.length + 1;
	}
	return shown;
}
const SKIP_DIRS = new Set([
	"node_modules", ".git", "dist", "build", "out", ".next", "target",
	"__pycache__", ".venv", "venv", ".turbo", ".cache", ".expo",
]);

interface GrepArgs {
	pattern: string;
	description?: string;
	path?: string;
	glob?: string;
	case_insensitive?: boolean;
	context?: number;
	files_only?: boolean;
	limit?: number;
}

export const grepTool: Tool<GrepArgs> = {
	name: "grep",
	snippet: "Search file contents by regular expression",
	description:
		"Search file contents with a regular expression. Uses ripgrep when it is installed and falls back to a built-in " +
		"scanner otherwise. Put the regex in `pattern` (aliases: `query`, `search`). Narrow the search with `glob` (e.g. `*.ts`) and use `context` to include surrounding lines. " +
		"A matching line longer than 2000 characters returns a window around the hit and names `char_offset` so `read` can open more of that line.",
	parameters: {
		type: "object",
		properties: {
			pattern: { type: "string", description: "Regular expression to search for. Prefer this field; `query` and `search` are aliases." },
			query: { type: "string", description: "Alias for pattern." },
			search: { type: "string", description: "Alias for pattern." },
			path: { type: "string", description: "Directory or file to search. Defaults to the workspace root." },
			glob: { type: "string", description: "Only search files matching this glob, e.g. `**/*.ts`." },
			case_insensitive: { type: "boolean", description: "Ignore case." },
			context: { type: "number", description: "Lines of context around each match." },
			files_only: { type: "boolean", description: "List matching file paths instead of matching lines." },
			limit: { type: "number", description: "Maximum matches to return. Default 200." },
		},
		additionalProperties: true,
	},
	summarize: (args) => {
		const raw = args as unknown as Record<string, unknown>;
		const term = String(raw.pattern ?? raw.query ?? raw.search ?? extractGrepPattern(raw.description) ?? "");
		return term ? `Search "${term}"` : "Search";
	},

	async execute(args, ctx): Promise<ToolResult> {
		const raw = args as unknown as Record<string, unknown>;
		const pattern = typeof raw.pattern === "string" && raw.pattern
			? raw.pattern
			: typeof raw.query === "string" && raw.query
				? raw.query
				: typeof raw.search === "string" && raw.search
					? raw.search
					: typeof raw.description === "string"
						? extractGrepPattern(raw.description)
						: "";

		if (!pattern) return errorResult("`pattern` is required. Please specify the regex/pattern to search for in the `pattern` parameter, e.g. {\"pattern\": \"your_regex\"}.");
		const normalizedArgs: GrepArgs = {
			...args,
			pattern,
			path: typeof raw.path === "string" ? raw.path : typeof raw.dir === "string" ? raw.dir : typeof raw.cwd === "string" ? raw.cwd : undefined,
		};

		let root = ctx.cwd;
		if (normalizedArgs.path) {
			const authorized = await authorizeRead(ctx, normalizedArgs.path);
			if (!authorized.ok) return errorResult(authorized.message);
			root = authorized.absolute;
		}

		const viaRipgrep = await runRipgrep(normalizedArgs, root, ctx);
		if (viaRipgrep) return viaRipgrep;

		/*
		 * A pattern that is not a regular expression is almost always meant as text.
		 *
		 * Models reach for this tool with things like `foo(bar` or `arr[0]` — a fragment of the code
		 * being looked for, not an expression — and a search that fails on it teaches nothing except
		 * to try again. Retried as a literal it finds exactly what was wanted. The retry goes through
		 * ripgrep too: falling straight through to the built-in scanner would walk the whole tree in
		 * JavaScript for a query ripgrep answers in milliseconds.
		 */
		if (!compiles(normalizedArgs.pattern)) {
			const literally = await runRipgrep(normalizedArgs, root, ctx, true);
			if (literally) return literally;
		}
		return runFallback(normalizedArgs, root, ctx);
	},
};

/** Whether the pattern is a regular expression at all, or only a piece of text that looks like one. */
function compiles(pattern: string): boolean {
	try {
		return Boolean(new RegExp(pattern));
	} catch {
		return false;
	}
}

async function runRipgrep(args: GrepArgs, root: string, ctx: ToolContext, literal = false): Promise<ToolResult | null> {
	const limit = Math.min(args.limit ?? MAX_MATCHES, MAX_MATCHES);
	if (args.files_only) return runRipgrepText(args, root, ctx, literal, limit, true);
	const fromJson = await runRipgrepJson(args, root, ctx, literal, limit);
	if (fromJson) return fromJson;
	return runRipgrepText(args, root, ctx, literal, limit, false);
}

/**
 * ripgrep already knows the match offset (`submatches.start`). Using that
 * beat searching the formatted line again — a lookaround or engine mismatch
 * used to drop us back on the line head.
 */
async function runRipgrepJson(args: GrepArgs, root: string, ctx: ToolContext, literal: boolean, limit: number): Promise<ToolResult | null> {
	const argv = ["--json", "--max-count", String(limit)];
	if (literal) argv.push("--fixed-strings");
	if (args.case_insensitive) argv.push("-i");
	if (args.context) argv.push("-C", String(args.context));
	if (args.glob) argv.push("--glob", args.glob);
	argv.push("--", args.pattern, root);
	return collectRipgrep(argv, ctx, (line, lines, keep) => {
		let event: { type?: string; data?: { path?: { text?: string }; lines?: { text?: string }; line_number?: number; submatches?: { start?: number }[] } };
		try {
			event = JSON.parse(line) as typeof event;
		} catch {
			return false;
		}
		if (event.type !== "match" && event.type !== "context") return false;
		if (!keep) return true;
		const pathText = event.data?.path?.text ?? "";
		const raw = (event.data?.lines?.text ?? "").replace(/\r?\n$/, "");
		const lineNo = event.data?.line_number ?? 0;
		const rel = pathText.startsWith(`${root}${sep}`) ? pathText.slice(root.length + 1) : pathText;
		const byteStart = event.type === "match" ? event.data?.submatches?.[0]?.start : undefined;
		const matchAt = typeof byteStart === "number" ? utf8ByteOffsetToIndex(raw, byteStart) : undefined;
		lines.push(shortenLine(`${rel}:${lineNo}:${raw}`, args.pattern, { literal, ignoreCase: args.case_insensitive }, matchAt));
		return true;
	}, limit, (code, lines, count) => {
		if (code !== 0 && code !== 1) return null;
		return formatMatches(lines, args, limit, literal, count);
	});
}

async function runRipgrepText(args: GrepArgs, root: string, ctx: ToolContext, literal: boolean, limit: number, filesOnly: boolean): Promise<ToolResult | null> {
	const argv = ["--no-heading", "--with-filename", "--line-number", "--color=never", "--max-count", String(limit)];
	if (literal) argv.push("--fixed-strings");
	if (args.case_insensitive) argv.push("-i");
	if (filesOnly) argv.push("--files-with-matches");
	if (args.context) argv.push("-C", String(args.context));
	if (args.glob) argv.push("--glob", args.glob);
	argv.push("--", args.pattern, root);
	return collectRipgrep(argv, ctx, (line, lines, keep) => {
		if (!keep) return true;
		const shown = line.startsWith(`${root}${sep}`) ? line.slice(root.length + 1) : line;
		lines.push(shortenLine(shown, args.pattern, { literal, ignoreCase: args.case_insensitive }));
		return true;
	}, limit, (code, lines, count) => {
		if (code !== 0 && code !== 1) return null;
		return formatMatches(lines, args, limit, literal, count);
	});
}

function collectRipgrep(
	argv: string[],
	ctx: ToolContext,
	onLine: (line: string, lines: string[], keep: boolean) => boolean,
	limit: number,
	finish: (code: number | null, lines: string[], count: number) => ToolResult | null,
): Promise<ToolResult | null> {
	return new Promise<ToolResult | null>((resolve) => {
		let child: ChildProcessWithoutNullStreams;
		try {
			child = spawn("rg", argv, { cwd: ctx.cwd });
		} catch {
			resolve(null);
			return;
		}

		const lines: string[] = [];
		let count = 0;
		let failed = false;
		const reader = createInterface({ input: child.stdout });
		reader.on("line", (line) => {
			if (!line) return;
			if (onLine(line, lines, lines.length < limit)) count++;
		});
		child.on("error", () => {
			failed = true;
			resolve(null);
		});
		const abort = () => { child.kill("SIGKILL"); };
		ctx.signal?.addEventListener("abort", abort, { once: true });
		if (ctx.signal?.aborted) abort();

		child.on("close", (code) => {
			ctx.signal?.removeEventListener("abort", abort);
			reader.close();
			if (failed) return;
			resolve(finish(code, lines, count));
		});
	});
}

async function runFallback(args: GrepArgs, root: string, ctx: ToolContext): Promise<ToolResult> {
	let regex: RegExp;
	let literal = false;
	try {
		regex = new RegExp(args.pattern, args.case_insensitive ? "i" : "");
	} catch {
		// Same reasoning as the ripgrep retry: a pattern that will not compile was meant as text.
		literal = true;
		try {
			const escaped = args.pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
			regex = new RegExp(escaped, args.case_insensitive ? "i" : "");
		} catch (error) {
			return errorResult(`Invalid regular expression: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	const limit = Math.min(args.limit ?? MAX_MATCHES, MAX_MATCHES);
	const globRegex = args.glob ? globToRegExp(args.glob) : null;
	const lines: string[] = [];
	const contextLines = args.context ?? 0;

	const scanFile = async (path: string): Promise<void> => {
		if (lines.length >= limit) return;
		const buffer = await readFile(path).catch(() => null);
		if (!buffer || looksBinary(buffer)) return;
		const rel = relative(root, path).split(sep).join("/") || basename(path);
		const fileLines = buffer.toString("utf8").split("\n");

		for (let i = 0; i < fileLines.length && lines.length < limit; i++) {
			const found = regex.exec(fileLines[i]);
			if (!found) {
				regex.lastIndex = 0;
				continue;
			}
			regex.lastIndex = 0;
			if (args.files_only) {
				lines.push(shortenLine(rel));
				return;
			}
			const opts = { literal, ignoreCase: args.case_insensitive };
			for (let c = Math.max(0, i - contextLines); c <= Math.min(fileLines.length - 1, i + contextLines); c++) {
				lines.push(shortenLine(`${rel}:${c + 1}:${fileLines[c]}`, args.pattern, opts, c === i ? found.index : undefined));
			}
		}
	};

	const walk = async (dir: string): Promise<void> => {
		if (lines.length >= limit || ctx.signal?.aborted) return;
		const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
		for (const entry of entries) {
			const full = join(dir, entry.name);
			if (entry.isDirectory()) {
				if (SKIP_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;
				await walk(full);
				continue;
			}
			if (!entry.isFile()) continue;
			const rel = relative(root, full).split(sep).join("/");
			if (globRegex && !globRegex.test(rel)) continue;
			await scanFile(full);
		}
	};

	if ((await stat(root).catch(() => null))?.isFile()) await scanFile(root);
	else await walk(root);
	return formatMatches(lines, args, limit, literal);
}

/**
 * @param literal Whether the pattern was searched for as text because it is not a valid regular
 *   expression. Said in the result rather than left silent: otherwise a search whose metacharacters
 *   were quietly disarmed reads as a search that ran as written and found nothing.
 */
function formatMatches(lines: string[], args: GrepArgs, limit: number, literal = false, count = lines.length): ToolResult {
	const note = literal ? `\`${args.pattern}\` is not a valid regular expression, so it was searched for literally.` : "";
	if (lines.length === 0) {
		const text = literal ? `${note}\nNo matches.` : `No matches for /${args.pattern}/.`;
		return {
			content: [{ type: "text", text }],
			details: { kind: "grep", pattern: args.pattern, count: 0, literal },
			/* A search that found nothing says nothing that will be asked again. */
			uneventful: true,
		};
	}
	const shown = boundCollectedLines(lines.slice(0, limit));
	const header = literal ? `${note}\n\n` : "";
	const footer = count > shown.length ? `\n\n[truncated: ${count - shown.length} collected matching/context lines omitted; narrow pattern, path or glob]` : "";
	return {
		content: [{ type: "text", text: header + shown.join("\n") + footer }],
		details: { kind: "grep", pattern: args.pattern, count, matches: shown, literal },
	};
}

/** Extract a grep regex pattern when the model embeds it in a description string. */
function extractGrepPattern(desc: unknown): string {
	if (typeof desc !== "string" || !desc.trim()) return "";
	const labeled = extractLabeledValue(desc, ["pattern", "regex", "query", "search"]);
	if (labeled) return labeled;
	const quoted = desc.match(/[`'"]([^`'"]+)['`"]/);
	if (quoted?.[1]) return quoted[1].trim();
	/* Fallback: if the model passed the raw pattern directly as description */
	return desc.trim();
}

/** Quoted first so `pattern: "foo|bar baz"` keeps spaces and alternation. */
function extractLabeledValue(desc: string, labels: string[]): string {
	const names = labels.join("|");
	const quoted = desc.match(new RegExp(`(?:${names})[:=]\\s*[\`'"]([^\\\`'"]+)[\`'"]`, "i"));
	if (quoted?.[1]) return quoted[1].trim();
	const bare = desc.match(new RegExp(`(?:${names})[:=]\\s*(\\S+)`, "i"));
	if (bare?.[1]) return bare[1].replace(/[)\].,;]+$/, "").trim();
	return "";
}
