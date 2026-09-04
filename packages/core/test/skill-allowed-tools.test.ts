/**
 * `allowed-tools`, which was parsed and then enforced nowhere.
 *
 * A skill declaring `allowed-tools: [read]` could run `bash`. That is worse than the field not
 * existing: it is the line an author writes to say what their skill will not do, skills are
 * installable from a registry, and a guarantee nothing checks is a guarantee that reads as one.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { ACTIVE_SKILL_KEY, clearActiveSkill, skillRefusal, skillTool, SKILLS_KEY } from "../src/skills/tool.ts";
import type { Skill } from "../src/skills/loader.ts";
import type { ToolContext } from "../src/types.ts";

function skill(name: string, allowedTools?: string[]): Skill {
	return {
		name,
		description: name,
		content: `# ${name}`,
		path: `/skills/${name}/SKILL.md`,
		dir: `/skills/${name}`,
		source: "workspace",
		allowedTools,
		disableModelInvocation: false,
	};
}

function ctx(skills: Skill[]): ToolContext {
	return { cwd: "/", sessionId: "s", state: new Map<string, unknown>([[SKILLS_KEY, skills]]) } as unknown as ToolContext;
}

function textOf(result: { content: { type: string; text?: string }[] }): string {
	return result.content.map((c) => c.text ?? "").join("");
}

test("loading a restricted skill records what it allows", async () => {
	const context = ctx([skill("pdf", ["read", "bash"])]);
	await skillTool.execute({ name: "pdf" }, context);

	assert.deepEqual(context.state.get(ACTIVE_SKILL_KEY), { name: "pdf", allowedTools: ["read", "bash"] });
});

test("the restriction is stated in the tool result, so the model is not surprised by a refusal", async () => {
	const context = ctx([skill("pdf", ["read"])]);
	const result = await skillTool.execute({ name: "pdf" }, context);
	assert.match(textOf(result), /只用这些工具：read/);
});

test("a skill with no restriction says nothing extra and restricts nothing", async () => {
	const context = ctx([skill("open", undefined)]);
	const result = await skillTool.execute({ name: "open" }, context);

	assert.ok(!/只用这些工具/.test(textOf(result)));
	assert.equal(skillRefusal(context.state, "bash"), undefined);
});

test("an allowed tool passes", async () => {
	const context = ctx([skill("pdf", ["read"])]);
	await skillTool.execute({ name: "pdf" }, context);
	assert.equal(skillRefusal(context.state, "read"), undefined);
});

test("a tool outside the list is refused, and the refusal names the skill and the list", async () => {
	const context = ctx([skill("pdf", ["read"])]);
	await skillTool.execute({ name: "pdf" }, context);

	const refusal = skillRefusal(context.state, "bash");
	assert.ok(refusal);
	assert.match(refusal, /pdf/, "which skill did this");
	assert.match(refusal, /read/, "and what it does allow");
	assert.match(refusal, /先说明为什么/, "and what to do if the step genuinely needs it");
});

test("`skill` itself is always allowed, so a restriction is not a trap", async () => {
	/*
	 * A skill that restricted tools must not also be able to lock the session inside itself.
	 * Loading a different skill is how you leave, so that route stays open whatever the list says.
	 */
	const context = ctx([skill("pdf", ["read"])]);
	await skillTool.execute({ name: "pdf" }, context);
	assert.equal(skillRefusal(context.state, "skill"), undefined);
});

test("loading another skill replaces the restriction rather than adding to it", async () => {
	const context = ctx([skill("pdf", ["read"]), skill("shell", ["bash"])]);
	await skillTool.execute({ name: "pdf" }, context);
	await skillTool.execute({ name: "shell" }, context);

	assert.equal(skillRefusal(context.state, "bash"), undefined, "the new skill's list applies");
	assert.ok(skillRefusal(context.state, "read"), "and the old one's does not");
});

test("something the person says clears it", () => {
	/*
	 * Their message is a new instruction. A restriction left standing across it refuses work they
	 * just asked for, citing a skill they may not remember loading.
	 */
	const state = new Map<string, unknown>([[ACTIVE_SKILL_KEY, { name: "pdf", allowedTools: ["read"] }]]);
	assert.ok(skillRefusal(state, "bash"));
	clearActiveSkill(state);
	assert.equal(skillRefusal(state, "bash"), undefined);
});

test("an empty list restricts nothing, rather than everything", async () => {
	/*
	 * `allowed-tools: []` in frontmatter is far more likely to be a stub somebody left behind than
	 * a deliberate "this skill uses no tools at all". Reading it as the latter would make a skill
	 * that does nothing and explains itself with a refusal per call.
	 */
	const context = ctx([skill("stub", [])]);
	await skillTool.execute({ name: "stub" }, context);
	assert.equal(skillRefusal(context.state, "bash"), undefined);
});
