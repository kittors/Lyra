import { spawn } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { errorResult } from "../agent/tool-run.ts";
import type { Tool, ToolContext, ToolResult } from "../types.ts";
import { globToRegExp } from "./glob.ts";
import { looksBinary, resolveWorkspacePath } from "./paths.ts";

const MAX_MATCHES = 200;
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
		"scanner otherwise. Narrow the search with `glob` (e.g. `*.ts`) and use `context` to include surrounding lines.",
	parameters: {
		type: "object",
		properties: {
			description: { type: "string", description: "Optional description of what this search operation is doing." },
			pattern: { type: "string", description: "Regular expression to search for." },
			query: { type: "string", description: "Alias for pattern." },
			search: { type: "string", description: "Alias for pattern." },
			path: { type: "string", description: "Directory or file to search. Defaults to the workspace root." },
			glob: { type: "string", description: "Only search files matching this glob, e.g. `**/*.ts`." },
			case_insensitive: { type: "boolean", description: "Ignore case." },
			context: { type: "number", description: "Lines of context around each match." },
			files_only: { type: "boolean", description: "List matching file paths instead of matching lines." },
			limit: { type: "number", description: "Maximum matches to return. Default 200." },
		},
		required: ["pattern"],
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

		if (!pattern) return errorResult("`pattern` is required.");
		const normalizedArgs: GrepArgs = {
			...args,
			pattern,
			path: typeof raw.path === "string" ? raw.path : typeof raw.dir === "string" ? raw.dir : typeof raw.cwd === "string" ? raw.cwd : undefined,
		};

		let root: string;
		try {
			root = normalizedArgs.path ? resolveWorkspacePath(ctx.cwd, normalizedArgs.path) : ctx.cwd;
		} catch (error) {
			return errorResult(error instanceof Error ? error.message : String(error));
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
	const argv = ["--no-heading", "--line-number", "--color=never", "--max-count", String(limit)];
	if (literal) argv.push("--fixed-strings");
	if (args.case_insensitive) argv.push("-i");
	if (args.files_only) argv.push("--files-with-matches");
	if (args.context) argv.push("-C", String(args.context));
	if (args.glob) argv.push("--glob", args.glob);
	argv.push("--", args.pattern, root);

	return new Promise<ToolResult | null>((resolve) => {
		let child: ReturnType<typeof spawn>;
		try {
			child = spawn("rg", argv, { cwd: root });
		} catch {
			resolve(null);
			return;
		}

		let stdout = "";
		let failed = false;
		child.stdout?.on("data", (chunk: Buffer) => {
			stdout += chunk.toString("utf8");
		});
		// ENOENT here just means ripgrep is not installed; the fallback handles it.
		child.on("error", () => {
			failed = true;
			resolve(null);
		});
		ctx.signal?.addEventListener("abort", () => child.kill("SIGKILL"), { once: true });

		child.on("close", (code) => {
			if (failed) return;
			// rg exits 1 when there are no matches, and 2+ on real errors.
			if (code !== 0 && code !== 1) {
				resolve(null);
				return;
			}
			const lines = stdout.split("\n").filter(Boolean).map((line) => line.replace(`${root}/`, ""));
			resolve(formatMatches(lines, args, limit, literal));
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
		const rel = relative(root, path).split(sep).join("/");
		const fileLines = buffer.toString("utf8").split("\n");

		for (let i = 0; i < fileLines.length && lines.length < limit; i++) {
			if (!regex.test(fileLines[i])) continue;
			if (args.files_only) {
				lines.push(rel);
				return;
			}
			for (let c = Math.max(0, i - contextLines); c <= Math.min(fileLines.length - 1, i + contextLines); c++) {
				lines.push(`${rel}:${c + 1}:${fileLines[c]}`);
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

	await walk(root);
	return formatMatches(lines, args, limit, literal);
}

/**
 * @param literal Whether the pattern was searched for as text because it is not a valid regular
 *   expression. Said in the result rather than left silent: otherwise a search whose metacharacters
 *   were quietly disarmed reads as a search that ran as written and found nothing.
 */
function formatMatches(lines: string[], args: GrepArgs, limit: number, literal = false): ToolResult {
	const note = literal ? `\`${args.pattern}\` is not a valid regular expression, so it was searched for literally.` : "";
	if (lines.length === 0) {
		const text = literal ? `${note}\nNo matches.` : `No matches for /${args.pattern}/.`;
		return {
			content: [{ type: "text", text }],
			details: { kind: "grep", pattern: args.pattern, count: 0, literal },
		};
	}
	const shown = lines.slice(0, limit);
	const header = literal ? `${note}\n\n` : "";
	const footer = lines.length > shown.length ? `\n\n[truncated at ${limit} matches]` : "";
	return {
		content: [{ type: "text", text: header + shown.join("\n") + footer }],
		details: { kind: "grep", pattern: args.pattern, count: lines.length, matches: shown, literal },
	};
}

/** Extract a grep regex pattern when the model embeds it in a description string. */
export function extractGrepPattern(desc: unknown): string {
	if (typeof desc !== "string" || !desc.trim()) return "";
	const labeled = desc.match(/(?:pattern|regex|query|search)[:=\s]+[`'"]?([^`'")\s]+)/i);
	if (labeled?.[1]) return labeled[1].replace(/[`'"]+$/, "").trim();
	const quoted = desc.match(/[`'"]([^`'"]+)['`"]/);
	if (quoted?.[1]) return quoted[1].trim();
	return "";
}
