/**
 * Other tools' configuration, read where it lies.
 *
 * A team's repository usually already has `.cursor/rules` or `.github/instructions` in it, written
 * months ago. Requiring those to be rewritten in our format before they do anything asks for work
 * with no payoff attached, which is exactly where most people stop. The dialect layer already
 * knows how to read all four; this file is only about *where* and *when*.
 *
 * The when is the part that needed a mechanism. Project-level directories are always read — a
 * `.cursor/rules` committed to a repository is a statement the team made about this code. User-level
 * ones are opt-in, because your personal rules following you into a stranger's repository produces
 * an agent that behaves differently from your colleague's on the same code, with nothing on screen
 * explaining why. Until now that distinction was enforced by simply never reading the user-level
 * directories at all; the registry lets it be a setting instead of an omission.
 */

import { join } from "node:path";
import { loadRules, type RuleSource } from "../../rules/loader.ts";
import type { Rule } from "../../rules/types.ts";
import type { Dialect } from "../../rules/dialects.ts";
import type { CapabilityId, CapabilityProvider, DiscoveryContext, ProviderResult, SourceMeta, Sourced } from "../types.ts";

interface ForeignSpec {
	id: string;
	label: string;
	describe: string;
	priority: number;
	dialect: Dialect;
	/**
	 * Relative to the project root. 缺省表示这个工具在项目一级没有独立的规则位置。
	 *
	 * Codex 就是这种：它项目里读的是 `AGENTS.md`，而那份文件我们已经在 `loadProjectInstructions`
	 * 里读了。再作为规则读一遍，同一段文字会在提示词里出现两次。
	 */
	projectDir?: string[];
	/** Relative to the operating system's home. Absent when the tool has no user-level rules. */
	userDir?: string[];
	extensions?: RegExp;
}

const SPECS: ForeignSpec[] = [
	{
		id: "cursor",
		label: "Cursor",
		describe: "读取 .cursor/rules（可选：~/.cursor/rules）",
		priority: 50,
		dialect: "cursor",
		projectDir: [".cursor", "rules"],
		userDir: [".cursor", "rules"],
		extensions: /\.mdc?$/i,
	},
	{
		id: "windsurf",
		label: "Windsurf",
		describe: "读取 .windsurf/rules（可选：~/.windsurf/rules）",
		priority: 50,
		dialect: "windsurf",
		projectDir: [".windsurf", "rules"],
		userDir: [".windsurf", "rules"],
	},
	{
		id: "cline",
		label: "Cline",
		describe: "读取 .clinerules，文件或目录都认",
		priority: 40,
		dialect: "cline",
		projectDir: [".clinerules"],
	},
	{
		id: "copilot",
		label: "GitHub Copilot",
		describe: "读取 .github/instructions/*.instructions.md",
		priority: 30,
		dialect: "copilot",
		projectDir: [".github", "instructions"],
		extensions: /\.instructions\.md$/i,
	},
	{
		id: "gemini",
		label: "Gemini CLI",
		describe: "读取 GEMINI.md（可选：~/.gemini/GEMINI.md）",
		priority: 40,
		dialect: "plain",
		projectDir: ["GEMINI.md"],
		userDir: [".gemini", "GEMINI.md"],
	},
	{
		/*
		 * Codex 只读用户级那一份。
		 *
		 * 它在项目里读的是 `AGENTS.md`，而那份文件 `loadProjectInstructions` 已经在读了——
		 * 再作为规则读一遍，同一段文字会在提示词里出现两次，而两次里只有一次能被关掉。
		 * `~/.codex/AGENTS.md` 是真正只有它才有的那份。
		 */
		id: "codex",
		label: "Codex",
		describe: "读取 ~/.codex/AGENTS.md（项目里的 AGENTS.md 已经作为项目指令读了）",
		priority: 40,
		dialect: "plain",
		userDir: [".codex", "AGENTS.md"],
	},
];

function foreignProvider(spec: ForeignSpec): CapabilityProvider<Rule> {
	return {
		id: spec.id,
		label: spec.label,
		describe: spec.describe,
		priority: spec.priority,
		supplies: ["rule"],
		foreign: true,

		async load(kind: CapabilityId, ctx: DiscoveryContext): Promise<ProviderResult<Rule>> {
			if (kind !== "rule") return { items: [] };

			const sources: RuleSource[] = [];
			if (ctx.cwd && spec.projectDir) {
				sources.push({ dir: join(ctx.cwd, ...spec.projectDir), source: "workspace", dialect: spec.dialect, extensions: spec.extensions });
			}
			if (spec.userDir && ctx.userSourceEnabled) {
				sources.push({ dir: join(ctx.userHome, ...spec.userDir), source: "user", dialect: spec.dialect, extensions: spec.extensions });
			}
			if (sources.length === 0) return { items: [] };

			const set = await loadRules(sources, { builtin: false });
			const rules = [...set.always, ...set.book, ...set.stream];
			return {
				items: rules.map(
					(rule) =>
						({
							...rule,
							provenance: {
								provider: spec.id,
								providerLabel: spec.label,
								path: rule.path,
								scope: rule.source === "workspace" ? "project" : "user",
								depth: rule.source === "workspace" ? 0 : undefined,
							} satisfies SourceMeta,
						}) as Sourced<Rule>,
				),
				diagnostics: set.diagnostics.map((d) => ({ path: d.path, message: d.message, severity: d.severity })),
				watched: sources.map((s) => s.dir),
			};
		},
	};
}

export const FOREIGN_PROVIDERS: CapabilityProvider<Rule>[] = SPECS.map(foreignProvider);

/**
 * 有个人级规则可以勾的外部工具，给设置页。
 *
 * 从 `SPECS` 派生而不是在界面里再列一遍：一个只在这里加了、界面上没有的工具，等于一个
 * 永远勾不上的开关——而那正是这份名单上一次存在时的结局。
 */
export const FOREIGN_USER_SOURCES: { id: string; label: string; describe: string }[] = SPECS.filter((s) => s.userDir).map((s) => ({
	id: s.id,
	label: s.label,
	describe: s.describe,
}));
