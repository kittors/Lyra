/**
 * Claude Code's directories.
 *
 * Separate from the other foreign tools because it supplies more than rules — commands and skills
 * live there in a layout close enough to ours that the same loaders read them — and because its
 * project-level directory is one people genuinely share. The reasoning is the one already written
 * in `commands/loader.ts`, and it applies unchanged:
 *
 *   一个命令文件就是 markdown 里的一个 prompt，里面没有任何东西属于某一个程序。
 *   拒绝读它们意味着要所有人把命令抄一遍才能被告知同样的事。
 *
 * Priority 80: below our own directories, above every other tool's, because it is the format ours
 * is closest to and a collision between the two is most likely to be the same file copied across.
 */

import { join } from "node:path";
import { loadCommands, type CommandSource } from "../../commands/loader.ts";
import { loadSkills, type Skill } from "../../skills/loader.ts";
import type { CapabilityId, CapabilityProvider, DiscoveryContext, ProviderResult, SourceMeta, Sourced } from "../types.ts";

const ID = "claude";
const LABEL = "Claude Code";

/** Where Claude Code keeps user-level configuration. */
function claudeHome(userHome: string): string {
	return process.env.CLAUDE_CONFIG_DIR || join(userHome, ".claude");
}

function meta(path: string, scope: SourceMeta["scope"]): SourceMeta {
	return { provider: ID, providerLabel: LABEL, path, scope, depth: scope === "project" ? 0 : undefined };
}

export const claudeProvider: CapabilityProvider = {
	id: ID,
	label: LABEL,
	describe: "读取 .claude/commands 与 .claude/skills（可选：~/.claude）",
	priority: 80,
	supplies: ["command", "skill"],
	foreign: true,

	async load(kind: CapabilityId, ctx: DiscoveryContext): Promise<ProviderResult> {
		if (kind === "command") {
			const sources: CommandSource[] = [];
			if (ctx.cwd) sources.push({ dir: join(ctx.cwd, ".claude", "commands"), scope: "workspace", origin: "claude" });
			if (ctx.userSourceEnabled) sources.push({ dir: join(claudeHome(ctx.userHome), "commands"), scope: "user", origin: "claude" });
			if (sources.length === 0) return { items: [] };

			const { commands, diagnostics } = await loadCommands(sources);
			return {
				items: commands.map((c) => ({ ...c, source: meta(c.path, c.scope === "workspace" ? "project" : "user") }) as Sourced<unknown>),
				diagnostics: diagnostics.map((d) => ({ path: d.path, message: d.message, severity: "error" as const })),
				watched: sources.map((s) => s.dir),
			};
		}

		if (kind === "skill") {
			const dirs: { dir: string; source: Skill["source"] }[] = [];
			if (ctx.cwd) dirs.push({ dir: join(ctx.cwd, ".claude", "skills"), source: "workspace" });
			if (ctx.userSourceEnabled) dirs.push({ dir: join(claudeHome(ctx.userHome), "skills"), source: "user" });
			if (dirs.length === 0) return { items: [] };

			const { skills, diagnostics } = await loadSkills(dirs);
			return {
				items: skills.map((s) => ({ ...s, source: meta(s.path, s.source === "workspace" ? "project" : "user") }) as Sourced<Skill>),
				diagnostics: diagnostics.map((d) => ({ path: d.path, message: d.message, severity: "error" as const })),
				watched: dirs.map((d) => d.dir),
			};
		}

		return { items: [] };
	},
};
