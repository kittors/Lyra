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
import { walkFiles } from "../fs.ts";
import type { CapabilityId, CapabilityProvider, Diagnostic, DiscoveryContext, ProviderResult, SourceMeta, Sourced } from "../types.ts";

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
	supplies: ["skill", "command", "rule", "agent"],

	async load(kind: CapabilityId, ctx: DiscoveryContext): Promise<ProviderResult> {
		if (kind === "skill") return loadNativeSkills(ctx);
		if (kind === "command") return loadNativeCommands(ctx);
		if (kind === "rule") return loadNativeRules(ctx);
		if (kind === "agent") return loadNativeAgents(ctx);
		return { items: [] };
	},
};

async function loadNativeSkills(ctx: DiscoveryContext): Promise<ProviderResult<Skill>> {
	const dirs = [
		ctx.cwd ? { dir: join(ctx.cwd, ".lyra", "skills"), source: "workspace" as const } : null,
		{ dir: join(ctx.home, "skills"), source: "user" as const },
	].filter((d): d is { dir: string; source: "workspace" | "user" } => d !== null);

	const { skills, diagnostics } = await loadSkills(dirs);
	return {
		items: attach(skills, (s) => s.path, (s) => scopeOf(s.source)),
		diagnostics: upgrade(diagnostics),
		watched: dirs.map((d) => d.dir),
	};
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
			const { frontmatter, body } = parsed;
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
