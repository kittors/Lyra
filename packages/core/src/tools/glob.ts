import type { Dirent } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { errorResult } from "../agent/tool-run.ts";
import type { Tool, ToolResult } from "../types.ts";
import { resolveWorkspacePath } from "./paths.ts";

const MAX_RESULTS = 500;
const SKIP_DIRS = new Set([
	"node_modules", ".git", "dist", "build", "out", ".next", ".nuxt", "target",
	"__pycache__", ".venv", "venv", ".turbo", ".cache", "Pods", ".gradle", ".expo",
]);

interface GlobArgs {
	pattern: string;
	path?: string;
	limit?: number;
}

export const globTool: Tool<GlobArgs> = {
	name: "glob",
	snippet: "Find files by glob pattern, newest first",
	guidelines: ["Use glob to locate files by name; use grep to locate them by content."],
	description:
		"Find files by glob pattern, newest first. Supports `*`, `?`, `**` and `{a,b}` alternation — " +
		'for example `src/**/*.{ts,tsx}`. Build and dependency directories are skipped automatically.',
	parameters: {
		type: "object",
		properties: {
			pattern: { type: "string", description: "Glob pattern, relative to the search root." },
			query: { type: "string", description: "Alias for pattern." },
			search: { type: "string", description: "Alias for pattern." },
			path: { type: "string", description: "Directory to search. Defaults to the workspace root." },
			limit: { type: "number", description: "Maximum number of matches. Default 500." },
		},
		required: ["pattern"],
		additionalProperties: true,
	},
	summarize: (args) => {
		const raw = args as unknown as Record<string, unknown>;
		const term = String(raw.pattern ?? raw.query ?? raw.search ?? "");
		return term ? `Find ${term}` : "Find";
	},

	async execute(args, ctx): Promise<ToolResult> {
		const raw = args as unknown as Record<string, unknown>;
		const pattern = typeof raw.pattern === "string" && raw.pattern
			? raw.pattern
			: typeof raw.query === "string" && raw.query
				? raw.query
				: typeof raw.search === "string" && raw.search
					? raw.search
					: "";

		const path = typeof raw.path === "string" ? raw.path : typeof raw.dir === "string" ? raw.dir : typeof raw.cwd === "string" ? raw.cwd : undefined;

		let root: string;
		try {
			root = path ? resolveWorkspacePath(ctx.cwd, path) : ctx.cwd;
		} catch (error) {
			return errorResult(error instanceof Error ? error.message : String(error));
		}
		if (!pattern) return errorResult("`pattern` is required.");

		const regex = globToRegExp(pattern);
		const limit = Math.min(args.limit ?? MAX_RESULTS, MAX_RESULTS);
		const matches: { path: string; mtime: number }[] = [];

		const walk = async (dir: string): Promise<void> => {
			if (matches.length >= limit * 4 || ctx.signal?.aborted) return;
			let entries: Dirent[];
			try {
				entries = await readdir(dir, { withFileTypes: true });
			} catch {
				return;
			}
			for (const entry of entries) {
				const full = join(dir, entry.name);
				if (entry.isDirectory()) {
					if (SKIP_DIRS.has(entry.name)) continue;
					// Hidden directories are only traversed when the pattern asks for them.
					if (entry.name.startsWith(".") && !pattern.includes("/.") && !pattern.startsWith(".")) continue;
					await walk(full);
					continue;
				}
				if (!entry.isFile()) continue;
				const rel = relative(root, full).split(sep).join("/");
				if (!regex.test(rel)) continue;
				const info = await stat(full).catch(() => null);
				matches.push({ path: rel, mtime: info?.mtimeMs ?? 0 });
			}
		};

		await walk(root);
		matches.sort((a, b) => b.mtime - a.mtime);
		const shown = matches.slice(0, limit);

		if (shown.length === 0) {
			return {
				content: [{ type: "text", text: `No files match ${pattern}.` }],
				details: { kind: "glob", count: 0 },
				uneventful: true,
			};
		}

		const footer = matches.length > shown.length ? `\n\n[${matches.length - shown.length} more matches not shown]` : "";
		return {
			content: [{ type: "text", text: shown.map((m) => m.path).join("\n") + footer }],
			details: { kind: "glob", pattern, count: matches.length, files: shown.map((m) => m.path) },
		};
	},
};

/**
 * Translate a glob to a regular expression.
 *
 * `**` crosses directory separators, `*` and `?` do not, and `{a,b}` expands to alternation.
 * Everything else is escaped so a pattern like `src/v1.2/*.ts` cannot smuggle regex syntax in.
 */
export function globToRegExp(pattern: string): RegExp {
	let out = "";
	let i = 0;
	while (i < pattern.length) {
		const char = pattern[i];
		if (char === "*") {
			if (pattern[i + 1] === "*") {
				// `**/` also has to match zero directories, so `**/*.ts` finds `a.ts` at the root.
				if (pattern[i + 2] === "/") {
					out += "(?:.*/)?";
					i += 3;
					continue;
				}
				out += ".*";
				i += 2;
				continue;
			}
			out += "[^/]*";
			i += 1;
			continue;
		}
		if (char === "?") {
			out += "[^/]";
			i += 1;
			continue;
		}
		if (char === "{") {
			const close = pattern.indexOf("}", i);
			if (close !== -1) {
				const options = pattern.slice(i + 1, close).split(",");
				out += `(?:${options.map(escapeRegex).join("|")})`;
				i = close + 1;
				continue;
			}
		}
		out += escapeRegex(char);
		i += 1;
	}
	return new RegExp(`^${out}$`);
}

function escapeRegex(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
