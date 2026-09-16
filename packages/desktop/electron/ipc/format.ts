/**
 * Formatting that needs a binary, and the project settings that override ours.
 *
 * Two things the renderer cannot do for itself. Prettier's standalone build runs happily in there
 * and handles most languages; `gofmt` is a process, and `.prettierrc` is a file — both live on
 * this side of the wire.
 */

import { ipcMain } from "electron";
import { readFile } from "node:fs/promises";
import { dirname, join, parse } from "node:path";
import { formatExternally, hasExternalFormatter, type ExternalResult } from "../format-external.ts";
import type { BuiltinFormatOptions } from "../format-builtin-engines.ts";

export interface FormatIpcDeps {
	/** The path, normalised, if it lies in an open project — otherwise null. */
	projectPath(target: string): string | null;
	/** The open project the path lies in, which is where the config search stops. */
	projectRoot(target: string): string | null;
}

/** Config files that decide formatting, nearest one wins. */
const CONFIGS = [
	".prettierrc",
	".prettierrc.json",
	".prettierrc.yaml",
	".prettierrc.yml",
	".prettierrc.json5",
	".editorconfig",
];

/**
 * What the project says about formatting, if it says anything.
 *
 * Searched upward from the file, because that is where these live: a monorepo puts one
 * `.prettierrc` at the root and expects every package to follow it. Stops at the project boundary
 * rather than walking to `/` — reading a config out of somebody's home directory because a file
 * happened to be opened from there would be a surprise, and a slow one.
 *
 * The point is precedence. A repository that has committed a style has decided it, and a personal
 * setting in this app must not quietly reformat everyone else's files to something different on
 * every save. Ours applies where the project is silent.
 */
async function projectConfig(file: string, root: string): Promise<Record<string, unknown> | null> {
	let directory = dirname(file);
	const stop = parse(root).root;
	while (directory.startsWith(root) && directory !== stop) {
		for (const name of CONFIGS) {
			const found = await readFile(join(directory, name), "utf8").catch(() => null);
			if (found === null) continue;
			const parsed = name === ".editorconfig" ? fromEditorConfig(found) : fromJson(found);
			// A config that exists but parses to nothing still counts as "the project has spoken" for
			// the file it was found in — keep looking upward only when there was no file at all.
			if (parsed) return { ...parsed, __source: name };
		}
		const parent = dirname(directory);
		if (parent === directory) break;
		directory = parent;
	}
	// `package.json`'s `prettier` key, which is where a lot of projects keep it instead.
	const packageJson = await readFile(join(root, "package.json"), "utf8").catch(() => null);
	if (packageJson) {
		const parsed = fromJson(packageJson) as { prettier?: Record<string, unknown> } | null;
		if (parsed?.prettier) return { ...parsed.prettier, __source: "package.json" };
	}
	return null;
}

function fromJson(text: string): Record<string, unknown> | null {
	try {
		const value = JSON.parse(text);
		return value && typeof value === "object" ? value : null;
	} catch {
		return null;
	}
}

/**
 * The three `.editorconfig` keys that mean anything to a formatter.
 *
 * Only the `[*]` section and only these keys, deliberately. `.editorconfig` is a glob language
 * with its own inheritance rules, and implementing it properly to extract an indent width would
 * be a library; the universal section is what nearly every file has and covers the case this is
 * for — a project that has said "tabs, width 4" and means it.
 */
function fromEditorConfig(text: string): Record<string, unknown> | null {
	const universal = text.split(/^\s*\[/m).find((section) => section.startsWith("*]"));
	if (!universal) return null;
	const out: Record<string, unknown> = {};
	const style = universal.match(/^\s*indent_style\s*=\s*(\w+)/m);
	if (style) out.useTabs = style[1].toLowerCase() === "tab";
	const size = universal.match(/^\s*indent_size\s*=\s*(\d+)/m);
	if (size) out.tabWidth = Number(size[1]);
	const width = universal.match(/^\s*max_line_length\s*=\s*(\d+)/m);
	if (width) out.printWidth = Number(width[1]);
	return Object.keys(out).length > 0 ? out : null;
}

export function registerFormatIpc(deps: FormatIpcDeps): void {
	ipcMain.handle(
		"format:external",
		async (_event, extension: string, source: string, options?: BuiltinFormatOptions): Promise<ExternalResult> => {
			return await formatExternally(extension, source, options);
		},
	);

	ipcMain.handle("format:available", async (_event, extension: string) => hasExternalFormatter(extension));

	ipcMain.handle("format:config", async (_event, file: string) => {
		const resolved = deps.projectPath(file);
		const root = deps.projectRoot(file);
		// No project means no boundary to stop the upward walk at, and walking to `/` would read a
		// stranger's config. Ours applies in that case, which is the right default anyway.
		if (!resolved || !root) return null;
		return await projectConfig(resolved, root);
	});
}
