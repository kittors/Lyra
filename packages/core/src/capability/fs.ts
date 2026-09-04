/**
 * What every provider needs and none of them should write twice.
 *
 * The rule this file exists to enforce: **one malformed file never costs you the others**. A
 * provider that maps over `readdir` and parses inline gets this wrong the first time somebody
 * commits a rule with a tab in its YAML — the throw escapes the map, the load fails, and every
 * rule in the directory disappears at once. That failure is also invisible, because a capability
 * that vanishes looks exactly like a capability nobody configured.
 */

import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { basename, join, relative, resolve, sep } from "node:path";
import { parseFrontmatter } from "../skills/loader.ts";
import type { Diagnostic, ProviderResult, SourceMeta, Sourced } from "./types.ts";

export interface DirSpec {
	dir: string;
	scope: SourceMeta["scope"];
	depth?: number;
}

export interface ReadDirOptions {
	extensions: string[];
	/** Walk into subdirectories to this depth. 1 is the directory itself. */
	maxDepth?: number;
}

/**
 * Build an item from one markdown file. Returning `undefined` skips it without complaint;
 * returning a diagnostic reports it. Throwing is caught and reported too, so a build function
 * does not have to be defensive to be safe.
 */
export type BuildItem<T> = (
	file: string,
	frontmatter: Record<string, unknown>,
	body: string,
	source: SourceMeta,
) => T | undefined | { diagnostic: Diagnostic };

/**
 * Read every markdown file in a set of directories and turn each into an item.
 *
 * Directories that do not exist are not an error — most projects have most of these directories
 * missing, and a diagnostic per absent directory would bury the ones that mean something.
 */
export async function readMarkdownDir<T>(
	dirs: (DirSpec | false | null | undefined)[],
	options: ReadDirOptions,
	provider: { id: string; label: string },
	build: BuildItem<T>,
): Promise<ProviderResult<T>> {
	const items: Sourced<T>[] = [];
	const diagnostics: Diagnostic[] = [];
	const watched: string[] = [];
	/*
	 * Two paths that resolve to the same file are one file. A team that symlinks a shared skills
	 * repository into `.lyra/skills` while also having it on a user-level path would otherwise get
	 * every skill twice, with the second copy shadowed by the first — visible in the settings page
	 * as a conflict between a directory and itself.
	 */
	const seenReal = new Set<string>();

	for (const spec of dirs) {
		if (!spec) continue;
		const files = await walkFiles(spec.dir, options.extensions, options.maxDepth ?? 1);
		if (files === null) continue;
		watched.push(spec.dir);

		for (const file of files) {
			const real = await realpath(file).catch(() => file);
			if (seenReal.has(real)) continue;
			seenReal.add(real);

			const raw = await readFile(file, "utf8").catch((error: unknown) => {
				diagnostics.push({
					path: file,
					message: `读不出这个文件：${error instanceof Error ? error.message : String(error)}`,
					severity: "warning",
				});
				return null;
			});
			if (raw === null) continue;

			const parsed = parseFrontmatter(raw);
			if (!parsed) {
				diagnostics.push({ path: file, message: "开头的 YAML 无法解析，这个文件被跳过了。", severity: "error" });
				continue;
			}
			if (parsed.problem) {
				diagnostics.push({
					path: file,
					message: "开头的 `---` 没有闭合，整个文件都被当成了正文。",
					severity: "warning",
					hint: "在元数据后面补一行 `---`。",
				});
			}

			const source: SourceMeta = {
				provider: provider.id,
				providerLabel: provider.label,
				path: file,
				scope: spec.scope,
				depth: spec.depth,
			};

			try {
				const built = build(file, normalizeKeys(parsed.frontmatter), parsed.body, source);
				if (!built) continue;
				if (typeof built === "object" && built !== null && "diagnostic" in built) {
					diagnostics.push((built as { diagnostic: Diagnostic }).diagnostic);
					continue;
				}
				items.push({ ...(built as T), source } as Sourced<T>);
			} catch (error) {
				diagnostics.push({
					path: file,
					message: `解析这个文件时出错：${error instanceof Error ? error.message : String(error)}`,
					severity: "error",
				});
			}
		}
	}

	return { items, diagnostics, watched };
}

/**
 * Files with the given extensions under `dir`. `null` means the directory is not there, which is
 * different from it being empty and is why this does not just return `[]`.
 */
export async function walkFiles(dir: string, extensions: string[], maxDepth: number): Promise<string[] | null> {
	const entries = await readdir(dir, { withFileTypes: true }).catch(() => null);
	if (!entries) return null;

	const out: string[] = [];
	for (const entry of entries) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) {
			if (maxDepth <= 1) continue;
			const nested = await walkFiles(full, extensions, maxDepth - 1);
			if (nested) out.push(...nested);
			continue;
		}
		if (entry.isSymbolicLink()) {
			const target = await stat(full).catch(() => null);
			if (target?.isDirectory()) {
				if (maxDepth <= 1) continue;
				const nested = await walkFiles(full, extensions, maxDepth - 1);
				if (nested) out.push(...nested);
				continue;
			}
		}
		if (extensions.some((ext) => entry.name.toLowerCase().endsWith(ext))) out.push(full);
	}
	return out.sort();
}

/**
 * `disable-model-invocation` and `disableModelInvocation` are the same key.
 *
 * Both spellings exist in the wild — the tools that inspired these formats disagree with each
 * other — and a user who writes the other one gets a field that is silently ignored. Normalising
 * here means a provider reads one spelling and every author gets the behaviour they meant.
 */
export function normalizeKeys(frontmatter: Record<string, unknown>): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(frontmatter)) {
		out[key] = value;
		const camel = key.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
		if (camel !== key && !(camel in out)) out[camel] = value;
	}
	return out;
}

/**
 * Directories from `cwd` up to a stopping point, nearest first.
 *
 * The boundary rules matter more than the walk. Without a repository root, a walk from a directory
 * under the user's home stops below home rather than at it: reading `~/AGENTS.md` for every project
 * on the machine is not a shared convention, it is a file one person forgot about affecting
 * everything they own.
 */
export function ancestorDirs(cwd: string, repoRoot: string | null, userHome: string): { dir: string; depth: number }[] {
	const out: { dir: string; depth: number }[] = [];
	let current = resolve(cwd);
	let depth = 0;

	for (;;) {
		out.push({ dir: current, depth });
		if (repoRoot && current === resolve(repoRoot)) break;
		const parent = resolve(current, "..");
		if (parent === current) break;
		if (!repoRoot && resolve(parent) === resolve(userHome)) break;
		current = parent;
		depth += 1;
		if (depth > 64) break;
	}
	return out;
}

/**
 * Whether a file sits inside a dot-directory, and therefore belongs to some other provider.
 *
 * `<repo>/.claude/CLAUDE.md` is the `claude` provider's file. Without this check the `claude-md`
 * provider, which looks for loose `CLAUDE.md` files, finds it too — and the same instructions get
 * injected twice, at two priorities, with the settings page showing a conflict between a provider
 * and itself.
 */
export function insideDotDirectory(file: string, root: string): boolean {
	const rel = relative(root, file);
	if (rel.startsWith("..")) return false;
	return rel
		.split(sep)
		.slice(0, -1)
		.some((segment) => segment.startsWith("."));
}

/** `<dir>/git/commit.md` under `<dir>` becomes `git:commit`. */
export function namespacedName(dir: string, file: string): string {
	return relative(dir, file)
		.replace(/\.[^.]+$/, "")
		.split(sep)
		.join(":");
}

/** The file's own name without extensions, for formats that use a double extension. */
export function bareName(file: string, extensions: string[]): string {
	const name = basename(file);
	for (const ext of extensions) {
		if (name.toLowerCase().endsWith(ext)) return name.slice(0, -ext.length);
	}
	return name.replace(/\.[^.]+$/, "");
}
