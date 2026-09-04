/**
 * 从过去的会话里长出来、并且被人点头批准过的技能。
 *
 * **优先级 5，最低的一档。** 任何一个人写的同名技能都赢它，而这不是一个折中——它是这个
 * provider 敢存在的理由：一个自动生成的东西可以被安静地忽略掉，办法是写一个同名的。
 * 反过来（自动生成的赢）意味着一个人写好的技能会在某天被一段自己没写过的文字取代。
 *
 * 供应的东西本身也是被点过头的：候选先进 `.pending`，人批准之后才搬进这里。见
 * `runtime/managed-skills.ts`。
 */

import { loadSkills, type Skill } from "../../skills/loader.ts";
import { managedSkillsDir } from "../../runtime/managed-skills.ts";
import type { CapabilityId, CapabilityProvider, DiscoveryContext, ProviderResult, SourceMeta, Sourced } from "../types.ts";

const ID = "managed";
const LABEL = "从会话中总结";

export const managedProvider: CapabilityProvider<Skill> = {
	id: ID,
	label: LABEL,
	describe: "读 ~/.lyra/projects/<项目>/memory/skills/——从过去的会话里总结、并经你批准的技能",
	priority: 5,
	supplies: ["skill"],

	async load(kind: CapabilityId, ctx: DiscoveryContext): Promise<ProviderResult<Skill>> {
		if (kind !== "skill" || !ctx.cwd) return { items: [] };

		const dir = managedSkillsDir(ctx.cwd);
		const loaded = await loadSkills([{ dir, source: "user" }]).catch(() => ({ skills: [], diagnostics: [] }));

		return {
			items: loaded.skills.map(
				(skill) =>
					({
						...skill,
						provenance: {
							provider: ID,
							providerLabel: LABEL,
							path: skill.path,
							scope: "project",
						} satisfies SourceMeta,
					}) as Sourced<Skill>,
			),
			diagnostics: loaded.diagnostics.map((d) => ({ path: d.path, message: d.message, severity: "warning" as const })),
			watched: [dir],
		};
	},
};
