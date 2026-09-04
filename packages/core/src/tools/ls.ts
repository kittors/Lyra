import type { Dirent } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { errorResult } from "../agent/tool-run.ts";
import type { Tool, ToolResult } from "../types.ts";
import { displayPath, resolveWorkspacePath } from "./paths.ts";

const MAX_ENTRIES = 400;

interface LsArgs {
	path?: string;
	all?: boolean;
}

export const lsTool: Tool<LsArgs> = {
	name: "ls",
	snippet: "List directory contents",
	description: "List the contents of a directory, with directories first and file sizes shown.",
	parameters: {
		type: "object",
		properties: {
			path: { type: "string", description: "Directory to list. Defaults to the workspace root." },
			all: { type: "boolean", description: "Include dotfiles." },
		},
		additionalProperties: false,
	},
	summarize: (args) => `List ${args.path ?? "."}`,

	async execute(args, ctx): Promise<ToolResult> {
		let absolute: string;
		try {
			absolute = args.path ? resolveWorkspacePath(ctx.cwd, args.path) : ctx.cwd;
		} catch (error) {
			return errorResult(error instanceof Error ? error.message : String(error));
		}

		let entries: Dirent[];
		try {
			entries = await readdir(absolute, { withFileTypes: true });
		} catch {
			return errorResult(`Not a directory or not found: ${args.path ?? "."}`);
		}

		const rows: { name: string; dir: boolean; size: number }[] = [];
		for (const entry of entries) {
			if (!args.all && entry.name.startsWith(".")) continue;
			const dir = entry.isDirectory();
			const size = dir ? 0 : ((await stat(join(absolute, entry.name)).catch(() => null))?.size ?? 0);
			rows.push({ name: entry.name, dir, size });
		}

		rows.sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1));
		const shown = rows.slice(0, MAX_ENTRIES);

		const body = shown.map((r) => (r.dir ? `${r.name}/` : `${r.name}  (${formatSize(r.size)})`)).join("\n");
		const footer = rows.length > shown.length ? `\n\n[${rows.length - shown.length} more entries]` : "";

		return {
			content: [{ type: "text", text: (body || "(empty directory)") + footer }],
			uneventful: body === "",
			details: {
				kind: "ls",
				path: displayPath(ctx.cwd, absolute),
				entries: shown,
				truncated: rows.length > shown.length,
			},
		};
	},
};

function formatSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
