/**
 * The shipped providers against real directories.
 *
 * Every assertion here is about a layout on disk producing a particular list, so the layouts are
 * real. A fixture that hands back a prepared array would be testing the array.
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { createRegistry } from "../src/capability/index.ts";
import type { Rule } from "../src/rules/types.ts";
import type { Skill } from "../src/skills/loader.ts";
import type { AgentDefinition } from "../src/tools/task.ts";

let root: string;
let project: string;
let home: string;
let userHome: string;

async function put(path: string, body: string): Promise<void> {
	const full = join(root, path);
	await mkdir(join(full, ".."), { recursive: true });
	await writeFile(full, body);
}

function registry() {
	return createRegistry({ home, userHome, repoRoot: () => project });
}

before(async () => {
	root = await mkdtemp(join(tmpdir(), "ly-cap-"));
	project = join(root, "project");
	home = join(root, "lyra-home");
	userHome = join(root, "user-home");

	// Our own directories.
	await put("project/.lyra/skills/deploy/SKILL.md", "---\nname: deploy\ndescription: 我们的部署技能\n---\n正文");
	await put("project/.lyra/commands/review.md", "---\ndescription: 我们的审查\n---\n审查改动");
	await put("project/.lyra/rules/style.md", "---\ndescription: 我们的风格\nglobs: ['**/*.ts']\n---\n用 tab 缩进。");
	await put("project/.lyra/agents/general.md", "---\nname: general\ndescription: 覆盖内置的 general\n---\n我是自定义的。");
	await put("project/.lyra/agents/boss.md", "---\nname: boss\ndescription: 编排者\nspawns: \"*\"\n---\n派活。");
	await put(
		"project/.lyra/agents/lead.md",
		"---\nname: lead\ndescription: 组长\nspawns: [scout, reviewer]\nschema-mode: strict\noutput:\n  type: object\n  properties:\n    where:\n      type: string\n---\n带队。",
	);

	// Claude Code's, one of which collides with ours.
	await put("project/.claude/commands/review.md", "---\ndescription: Claude 的审查\n---\n别的内容");
	await put("project/.claude/commands/security.md", "---\ndescription: 安全审查\n---\n查注入");
	await put("project/.claude/skills/pdf/SKILL.md", "---\nname: pdf\ndescription: 读 PDF\n---\n正文");

	// Four other tools, three of which are only rules.
	await put("project/.cursor/rules/imports.mdc", "---\ndescription: 导入顺序\nalwaysApply: false\n---\n先内置后第三方。");
	await put("project/.windsurf/rules/naming.md", "命名用 camelCase。");
	await put("project/.clinerules", "提交信息写中文。");
	await put("project/.github/instructions/tests.instructions.md", "---\napplyTo: 'test/**'\n---\n测试要断言原因。");

	// A rule of the same name from two tools, to prove which wins.
	await put("project/.lyra/rules/shared.md", "---\ndescription: 我们的\n---\n我们的版本。");
	await put("project/.cursor/rules/shared.mdc", "---\ndescription: Cursor 的\n---\nCursor 的版本。");

	// User-level foreign directories, which must not be read unless asked for.
	await put("user-home/.cursor/rules/private.mdc", "---\ndescription: 我的私人规则\n---\n私人内容。");

	// A file that is broken, next to one that is not.
	await put("project/.lyra/rules/broken.md", "---\ncondition: '('\n---\n这条正则编译不了。");
});

after(async () => {
	await rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 25 });
});

test("a custom agent replaces the built-in of the same name", async () => {
	/*
	 * The bug this closes: agents were assembled `[...BUILTIN_AGENTS, ...custom]` and read with
	 * `.find()`, so a `general` written into `.lyra/agents/` was found second and never used. The
	 * file loaded, appeared in listings, and did nothing.
	 */
	const result = await registry().load<AgentDefinition>("agent", { cwd: project });

	const general = result.items.filter((a) => a.name === "general");
	assert.equal(general.length, 1, "there is exactly one `general`");
	assert.equal(general[0].provenance.provider, "native", "and it is the one on disk");
	assert.equal(general[0].description, "覆盖内置的 general");

	const shadowed = result.all.find((a) => a.name === "general" && a.provenance.provider === "builtin");
	assert.ok(shadowed, "the built-in is still listed");
	assert.equal(shadowed.shadowedBy?.provider, "native", "and says who replaced it");
});

test("an agent file can say whom it dispatches and what it must return", async () => {
	/*
	 * `spawns`, `output` and `schemaMode` were declared on the type, enforced in `runSubAgent`
	 * and tested with definitions built in memory — and never read from a file. No definition
	 * anyone could write was able to delegate or to promise an object, so the lineage the pane
	 * draws and the schema-rendered reply could not occur outside a test.
	 */
	const result = await registry().load<AgentDefinition>("agent", { cwd: project });
	const boss = result.items.find((a) => a.name === "boss");
	const lead = result.items.find((a) => a.name === "lead");
	const general = result.items.find((a) => a.name === "general");
	assert.ok(boss && lead && general);
	assert.equal(boss.spawns, "*");
	assert.deepEqual(lead.spawns, ["scout", "reviewer"], "a list is a list, not a switch");
	assert.equal(lead.schemaMode, "strict", "`schema-mode` reaches the camelCase field");
	assert.equal(lead.output?.type, "object");
	assert.deepEqual(Object.keys((lead.output as { properties: Record<string, unknown> }).properties), ["where"]);
	assert.equal(general.spawns, undefined, "the default stays: nobody dispatches unless the file says so");
	assert.equal(general.output, undefined);
});

test("the other built-in agents are untouched", async () => {
	const result = await registry().load<AgentDefinition>("agent", { cwd: project });
	assert.ok(result.items.length > 1, "replacing one does not drop the rest");
	assert.ok(result.items.some((a) => a.provenance.provider === "builtin"), "the ones nobody overrode are still ours");
});

test("our command wins a name collision with Claude Code's, and the loser names the winner", async () => {
	const result = await registry().load<{ name: string; description: string }>("command", { cwd: project });

	const review = result.items.filter((c) => c.name === "review");
	assert.equal(review.length, 1);
	assert.equal(review[0].description, "我们的审查");

	const loser = result.all.find((c) => c.name === "review" && c.provenance.provider === "claude");
	assert.ok(loser, "Claude Code's copy is listed");
	assert.equal(loser.shadowedBy?.provider, "native");

	assert.ok(
		result.items.some((c) => c.name === "security"),
		"and the one with no collision is simply available",
	);
});

test("skills come from both directories", async () => {
	const result = await registry().load<Skill>("skill", { cwd: project });
	const names = result.items.map((s) => s.name).sort();
	assert.deepEqual(names, ["deploy", "pdf"]);
	assert.equal(result.items.find((s) => s.name === "pdf")?.provenance.provider, "claude");
});

test("four ecosystems' rules are all read, and ours wins the shared name", async () => {
	const result = await registry().load<Rule>("rule", { cwd: project });
	const byProvider = new Map(result.items.map((r) => [r.name, r.provenance.provider]));

	assert.equal(byProvider.get("style"), "native");
	assert.equal(byProvider.get("imports"), "cursor");
	assert.equal(byProvider.get("naming"), "windsurf");
	assert.equal(byProvider.get("clinerules"), "cline");
	assert.equal(byProvider.get("tests"), "copilot");
	assert.equal(byProvider.get("shared"), "native", "a name we also define is ours");

	const loser = result.all.find((r) => r.name === "shared" && r.provenance.provider === "cursor");
	assert.equal(loser?.shadowedBy?.provider, "native");
});

test("a foreign user-level directory is not read until it is asked for", async () => {
	const off = await registry().load<Rule>("rule", { cwd: project });
	assert.ok(!off.items.some((r) => r.name === "private"), "your personal Cursor rules stay out of someone else's repo");

	const on = await registry().load<Rule>("rule", { cwd: project, enabledUserSources: new Set(["cursor"]) });
	assert.ok(
		on.items.some((r) => r.name === "private"),
		"and are read once you say so",
	);
});

test("a project-level foreign directory is always read", async () => {
	const result = await registry().load<Rule>("rule", { cwd: project });
	assert.ok(
		result.items.some((r) => r.provenance.provider === "cursor" && r.provenance.scope === "project"),
		"what the team committed for this repository applies without a setting",
	);
});

test("a broken rule file does not cost the healthy ones", async () => {
	const result = await registry().load<Rule>("rule", { cwd: project });
	assert.ok(
		result.items.some((r) => r.name === "style"),
		"the file next to the broken one loaded",
	);
	assert.ok(
		result.diagnostics.some((d) => d.path.includes("broken")),
		`and the broken one is reported (${result.diagnostics.map((d) => d.path).join("; ")})`,
	);
});

test("built-in rules are present and can be replaced by name", async () => {
	const result = await registry().load<Rule>("rule", { cwd: project });
	assert.ok(
		result.items.some((r) => r.name === "no-secret-in-code" && r.provenance.provider === "builtin"),
		"the shipped rules arrive through the registry like anything else",
	);
});

test("only: native reduces the result to our own directories", async () => {
	const result = await registry().load<Rule>("rule", { cwd: project, only: new Set(["native"]) });
	assert.ok(result.items.length > 0);
	assert.ok(
		result.items.every((r) => r.provenance.provider === "native"),
		"nothing else contributed",
	);
});

test("disabling a provider removes its contribution and promotes what it was hiding", async () => {
	const result = await registry().load<Rule>("rule", { cwd: project, disabledProviders: new Set(["native"]) });
	const shared = result.items.find((r) => r.name === "shared");
	assert.equal(shared?.provenance.provider, "cursor", "with ours switched off, Cursor's version of that name serves");
});

test("no working directory still yields the user-level and built-in layers", async () => {
	const result = await registry().load<Rule>("rule", { cwd: null });
	assert.ok(
		result.items.every((r) => r.provenance.scope !== "project"),
		"nothing project-scoped, because there is no project",
	);
	assert.ok(result.items.some((r) => r.provenance.provider === "builtin"));
});

test("contributors and watched directories describe what actually happened", async () => {
	const result = await registry().load<Rule>("rule", { cwd: project });
	assert.ok(result.contributors.includes("native"));
	assert.ok(result.contributors.includes("cursor"));
	assert.ok(
		result.watched.some((dir) => dir.includes(join(".lyra", "rules"))),
		"the directories that produced items are the ones worth watching",
	);
});

test("a cold load of the mixed fixture stays under 150ms", async () => {
	const result = await registry().load<Rule>("rule", { cwd: project });
	assert.ok(result.elapsedMs < 150, `cold load took ${result.elapsedMs}ms; the slowest were ${JSON.stringify(result.timings)}`);
});
