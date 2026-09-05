/**
 * Lyra's own directories, and the loaders that already read them.
 *
 * This provider wraps rather than replaces. The skill, command, rule and agent loaders are tested,
 * in use, and each carries a season of corrections that are not visible in their shape — the way
 * `.clinerules` is a file about as often as a directory, or the way a Cursor `alwaysApply` counts
 * only when it is literally `true`. Rewriting them to fit a new interface would put all of that at
 * risk to gain nothing a caller can see.
 *
 * What the registry adds on top is uniform: one precedence rule instead of five, a shadowed item
 * that can name its winner, and diagnostics with a severity. The loaders keep doing the reading.
 */

import { join } from "node:path";
import { loadCommands, commandSources } from "../../commands/loader.ts";
import { loadRules, ruleSources } from "../../rules/loader.ts";
import type { Rule } from "../../rules/types.ts";
import { loadSkills, parseFrontmatter, type Skill } from "../../skills/loader.ts";
import type { AgentDefinition } from "../../tools/task.ts";
import type { JsonSchema } from "../../types.ts";
import { normalizeKeys, walkFiles } from "../fs.ts";
import type { CapabilityId, CapabilityProvider, ContextFile, Diagnostic, DiscoveryContext, ProviderResult, SourceMeta, Sourced } from "../types.ts";

const ID = "native";
const LABEL = "Lyra";

/** The scope a loader's own `source` field maps to. */
function scopeOf(source: string): SourceMeta["scope"] {
	if (source === "workspace") return "project";
	if (source === "builtin") return "builtin";
	return "user";
}

function meta(path: string, scope: SourceMeta["scope"]): SourceMeta {
	return { provider: ID, providerLabel: LABEL, path, scope, depth: scope === "project" ? 0 : undefined };
}

function attach<T>(items: T[], path: (item: T) => string, scope: (item: T) => SourceMeta["scope"]): Sourced<T>[] {
	return items.map((item) => ({ ...item, provenance: meta(path(item), scope(item)) }) as Sourced<T>);
}

function upgrade(diagnostics: { path: string; message: string; severity?: string }[]): Diagnostic[] {
	return diagnostics.map((d) => ({
		path: d.path,
		message: d.message,
		severity: d.severity === "warning" || d.severity === "info" ? d.severity : "error",
	}));
}

export const nativeProvider: CapabilityProvider = {
	id: ID,
	label: LABEL,
	describe: "读取项目里的 .lyra/ 与 ~/.lyra/",
	priority: 100,
	supplies: ["skill", "command", "rule", "agent", "context-file"],

	async load(kind: CapabilityId, ctx: DiscoveryContext): Promise<ProviderResult> {
		if (kind === "skill") return loadNativeSkills(ctx);
		if (kind === "command") return loadNativeCommands(ctx);
		if (kind === "rule") return loadNativeRules(ctx);
		if (kind === "agent") return loadNativeAgents(ctx);
		if (kind === "context-file") return loadNativeContextFiles(ctx);
		return { items: [] };
	},
};

async function loadNativeSkills(ctx: DiscoveryContext): Promise<ProviderResult<Skill>> {
	const dirs = [
		ctx.cwd ? { dir: join(ctx.cwd, ".lyra", "skills"), source: "workspace" as const } : null,
		{ dir: join(ctx.home, "skills"), source: "user" as const },
	].filter((d): d is { dir: string; source: "workspace" | "user" } => d !== null);

	/*
	 * One call per directory, not one call with both.
	 *
	 * `loadSkills` deduplicates internally, so handing it both directories returns one `pdf` and
	 * silently drops the other — and the registry, which is the thing that knows how to report
	 * shadowing, never learns the second one existed. The settings page then shows a user-level
	 * skill as simply missing, which is indistinguishable from one that failed to parse.
	 *
	 * Loading them separately hands every candidate up and lets the merge happen in one place. It
	 * costs a second directory read of a directory that is almost always small.
	 */
	const items: Sourced<Skill>[] = [];
	const diagnostics: Diagnostic[] = [];
	for (const spec of dirs) {
		const loaded = await loadSkills([spec]);
		items.push(...attach(loaded.skills, (s) => s.path, (s) => scopeOf(s.source)));
		diagnostics.push(...upgrade(loaded.diagnostics));
	}
	return { items, diagnostics, watched: dirs.map((d) => d.dir) };
}

async function loadNativeCommands(ctx: DiscoveryContext): Promise<ProviderResult> {
	/*
	 * Only our own directories here. `.claude/commands` is the `claude` provider's business, and
	 * reading it from two places would make the same file collide with itself — which the registry
	 * would faithfully report as a conflict between Lyra and Lyra.
	 */
	const sources = commandSources(ctx.cwd, ctx.home).filter((s) => s.origin === "lyra");
	const { commands, diagnostics } = await loadCommands(sources);
	return {
		items: attach(commands, (c) => c.path, (c) => scopeOf(c.scope)),
		diagnostics: upgrade(diagnostics),
		watched: sources.map((s) => s.dir),
	};
}

async function loadNativeRules(ctx: DiscoveryContext): Promise<ProviderResult<Rule>> {
	const sources = ruleSources(ctx.cwd, ctx.home).filter((s) => s.dialect === "lyra");
	/*
	 * Built-ins are the `builtin` provider's contribution, not ours — merging them here would give
	 * them our priority of 100 and make a project rule of the same name unable to replace one.
	 */
	const set = await loadRules(sources, { builtin: false });
	const rules = [...set.always, ...set.book, ...set.stream];
	return {
		items: attach(rules, (r) => r.path, (r) => scopeOf(r.source)),
		diagnostics: upgrade(set.diagnostics),
		watched: sources.map((s) => s.dir),
	};
}

/**
 * Sub-agent definitions from `.lyra/agents/*.md`.
 *
 * Read here rather than in `session-setup.ts` because that is where the precedence bug lived: the
 * list was built as `[...BUILTIN_AGENTS, ...custom]` and consumed with `.find()`, so a definition
 * written to replace a built-in of the same name could never be reached. Through the registry the
 * built-ins arrive from a provider with a priority of 1 and lose to this one, which is the
 * behaviour every other capability already had.
 */
async function loadNativeAgents(ctx: DiscoveryContext): Promise<ProviderResult<AgentDefinition>> {
	const dirs = [
		ctx.cwd ? { dir: join(ctx.cwd, ".lyra", "agents"), scope: "project" as const } : null,
		{ dir: join(ctx.home, "agents"), scope: "user" as const },
	].filter((d): d is { dir: string; scope: "project" | "user" } => d !== null);

	const items: Sourced<AgentDefinition>[] = [];
	const diagnostics: Diagnostic[] = [];

	for (const { dir, scope } of dirs) {
		const files = await walkFiles(dir, [".md"], 1);
		if (!files) continue;
		for (const file of files) {
			const raw = await readFileSafe(file, diagnostics);
			if (raw === null) continue;
			const parsed = parseFrontmatter(raw);
			if (!parsed) {
				diagnostics.push({ path: file, message: "开头的 YAML 无法解析，这个 agent 被跳过了。", severity: "error" });
				continue;
			}
			if (parsed.problem) {
				diagnostics.push({
					path: file,
					message: "开头的 `---` 没有闭合，整个文件都被当成了 agent 的提示词。",
					severity: "warning",
					hint: "在元数据后面补一行 `---`。",
				});
			}
			// `schema-mode` and `schemaMode` are the same key, as they are for skills and commands.
			const frontmatter = normalizeKeys(parsed.frontmatter);
			const { body } = parsed;
			const name =
				typeof frontmatter.name === "string" && frontmatter.name.trim()
					? frontmatter.name.trim()
					: file.split(/[/\\]/).pop()!.replace(/\.md$/i, "");

			items.push({
				name,
				description: typeof frontmatter.description === "string" ? frontmatter.description : name,
				systemPrompt: body,
				tools: Array.isArray(frontmatter.tools)
					? (frontmatter.tools as unknown[]).filter((t): t is string => typeof t === "string")
					: "*",
				model: typeof frontmatter.model === "string" ? frontmatter.model : undefined,
				/*
				 * Who it may dispatch — `"*"` or a list of names. Declared on the type, enforced in
				 * `runSubAgent`, tested with definitions built in memory, and never read from a file:
				 * no definition anyone wrote could delegate, so the tree the pane draws could not occur.
				 */
				spawns:
					frontmatter.spawns === "*"
						? "*"
						: Array.isArray(frontmatter.spawns)
							? (frontmatter.spawns as unknown[]).filter((t): t is string => typeof t === "string")
							: undefined,
				// Same story as `spawns`: the two fields that make a reply an object were never read.
				output:
					frontmatter.output && typeof frontmatter.output === "object" && !Array.isArray(frontmatter.output)
						? (frontmatter.output as JsonSchema)
						: undefined,
				schemaMode: frontmatter.schemaMode === "strict" || frontmatter.schemaMode === "permissive" ? frontmatter.schemaMode : undefined,
				provenance: meta(file, scope),
			} as Sourced<AgentDefinition>);
		}
	}

	return { items, diagnostics, watched: dirs.map((d) => d.dir) };
}

async function readFileSafe(file: string, diagnostics: Diagnostic[]): Promise<string | null> {
	const { readFile } = await import("node:fs/promises");
	return readFile(file, "utf8").catch((error: unknown) => {
		diagnostics.push({
			path: file,
			message: `读不出这个文件：${error instanceof Error ? error.message : String(error)}`,
			severity: "warning",
		});
		return null;
	});
}

/** 同一个目录里的优先级。两份都在时，前者赢——后者多半是从别的工具迁过来没删的旧版本。 */
const CONTEXT_FILE_NAMES = ["LYRA.md", "AGENTS.md", "CLAUDE.md"];

/**
 * 项目指令，从 cwd 一路往上收到仓库根。
 *
 * 这条优先级规则此前住在 `prompt/system.ts` 里——「按目录找、每层留一个」的第六份副本，
 * 而注册表存在的理由就是这种规则只写一次。`context-file` 这个 kind 在 `kinds.ts` 里连去重
 * 规则都定义好了，只是一直没有 provider 供应它。
 *
 * **同一层的候选全部返回，让注册表去重。** provider 自己挑一份会让第二份静默消失；经注册表
 * 走，第二份是「被遮蔽」——带着是谁盖的它、在哪儿——设置页能说出「CLAUDE.md 被 AGENTS.md
 * 盖掉了」，而不是让人对着一份不生效的文件发呆。
 *
 * 不在 git 仓库里时只读 cwd 自己：没有边界时收窄，不是放开。
 */
async function loadNativeContextFiles(ctx: DiscoveryContext): Promise<ProviderResult<ContextFile>> {
	if (!ctx.cwd) return { items: [] };
	const { readFile } = await import("node:fs/promises");
	const { dirname, relative } = await import("node:path");

	const items: Sourced<ContextFile>[] = [];
	const watched: string[] = [];
	const stop = ctx.repoRoot;
	let dir = ctx.cwd;
	for (let depth = 0; depth < 10; depth += 1) {
		watched.push(dir);
		for (const name of CONTEXT_FILE_NAMES) {
			const path = join(dir, name);
			const content = await readFile(path, "utf8").catch(() => null);
			if (!content?.trim()) continue;
			const file: ContextFile = {
				name: stop ? relative(stop, path) || name : name,
				path,
				content: content.trim(),
				scope: "project",
				depth,
			};
			items.push({ ...file, provenance: { provider: ID, providerLabel: LABEL, path, scope: "project", depth } } as Sourced<ContextFile>);
		}
		if (stop === null || dir === stop) break;
		const parent = dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	return { items, watched };
}
