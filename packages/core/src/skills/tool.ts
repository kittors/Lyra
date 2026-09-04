import { errorResult } from "../agent/tool-run.ts";
import type { Tool, ToolResult } from "../types.ts";
import { formatSkillInvocation, type Skill } from "./loader.ts";

export const SKILLS_KEY = "skills";
/** The skill currently in force, and what it allows. See `ACTIVE_SKILL` below. */
export const ACTIVE_SKILL_KEY = "activeSkill";

export interface ActiveSkill {
	name: string;
	/** Tool names this skill permits. Undefined means it did not restrict anything. */
	allowedTools?: string[];
}

interface SkillArgs {
	name: string;
	args?: string;
}

/**
 * Loading a skill returns its instructions as the tool result, which places them in context
 * as data the model then follows. This is why the body is not in the system prompt: only the
 * skills actually used cost tokens.
 */
export const skillTool: Tool<SkillArgs> = {
	name: "skill",
	snippet: "Load a skill's instructions",
	guidelines: ["When a task matches a listed skill, load it before starting your own approach."],
	description:
		"Load a skill's instructions into the conversation. Call this when the task matches a skill listed in the " +
		"system prompt. The instructions come back as the tool result and take precedence over your default approach.",
	parameters: {
		type: "object",
		properties: {
			name: { type: "string", description: "Exact skill name from the skill list." },
			args: { type: "string", description: "Optional arguments or context to pass to the skill." },
		},
		required: ["name"],
		additionalProperties: false,
	},
	summarize: (args) => `Skill: ${args.name}`,

	async execute(args, ctx): Promise<ToolResult> {
		const skills = (ctx.state.get(SKILLS_KEY) as Skill[] | undefined) ?? [];
		const skill = skills.find((s) => s.name === args.name);
		if (!skill) {
			const available = skills.filter((s) => !s.disableModelInvocation).map((s) => s.name);
			return errorResult(
				available.length > 0
					? `No skill named "${args.name}". Available: ${available.join(", ")}.`
					: `No skill named "${args.name}", and no skills are installed.`,
			);
		}

		/*
		 * `allowed-tools` starts applying here, and until now it applied nowhere.
		 *
		 * The field was parsed from frontmatter and then read by nothing — so a skill saying
		 * `allowed-tools: [read]` could run `bash`, and its author had a written guarantee that was
		 * not enforced anywhere. That is worse than not having the field: skills are installable
		 * from a registry, and this is the line an author uses to say what theirs will not do.
		 *
		 * In force until another skill is loaded or the person says something new — see
		 * `clearActiveSkill`. A restriction that expired at the end of the tool call would cover
		 * none of the work the skill exists to direct.
		 */
		ctx.state.set(ACTIVE_SKILL_KEY, { name: skill.name, allowedTools: skill.allowedTools } satisfies ActiveSkill);

		const limit = skill.allowedTools?.length
			? `\n\n<skill-tools>这个技能声明了它只用这些工具：${skill.allowedTools.join("、")}。其他工具在它生效期间会被拒绝。</skill-tools>`
			: "";

		return {
			content: [{ type: "text", text: formatSkillInvocation(skill, args.args) + limit }],
			details: { kind: "skill", name: skill.name, source: skill.source, path: skill.path, allowedTools: skill.allowedTools },
		};
	},
};

/**
 * Drop the active skill's restriction.
 *
 * Called when the person says something new: their message is a new instruction, and leaving a
 * previous skill's tool restriction across it would silently refuse work they just asked for.
 */
export function clearActiveSkill(state: Map<string, unknown>): void {
	state.delete(ACTIVE_SKILL_KEY);
}

/**
 * Why this tool call is not allowed right now, or undefined when it is.
 *
 * `skill` itself is always allowed: a skill that restricted tools must not also trap the session
 * into itself, and loading a different skill is how you leave.
 */
export function skillRefusal(state: Map<string, unknown>, toolName: string): string | undefined {
	const active = state.get(ACTIVE_SKILL_KEY) as ActiveSkill | undefined;
	if (!active?.allowedTools?.length) return undefined;
	if (toolName === "skill" || active.allowedTools.includes(toolName)) return undefined;
	return (
		`技能“${active.name}”声明了它只用 ${active.allowedTools.join("、")}，所以 \`${toolName}\` 在它生效期间不可用。` +
		`如果这一步确实需要它，先说明为什么，让用户决定。`
	);
}
