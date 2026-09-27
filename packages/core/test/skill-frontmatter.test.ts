/**
 * What `parseFrontmatter` reports, and what a skill loader does with the report.
 *
 * The interesting case is a block that opens and never closes. The parse cannot fail — with the
 * delimiters unusable, treating the whole file as body is the only reading left — so for a long
 * time it succeeded quietly and the author was left looking at a file that appears to carry
 * metadata and behaves as if it carries none. The skill loads with a name taken from its directory,
 * `description:` arrives in the model's context as prose, and nothing anywhere says so.
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { formatSkillInvocation, isUnparsable, loadSkills, parseFrontmatter, type Skill } from "../src/skills/loader.ts";

let root: string;

async function skill(name: string, body: string): Promise<void> {
	await mkdir(join(root, "skills", name), { recursive: true });
	await writeFile(join(root, "skills", name, "SKILL.md"), body);
}

before(async () => {
	root = await mkdtemp(join(tmpdir(), "ly-skill-fm-"));
});

after(async () => {
	await rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 25 });
});

test("a document with no frontmatter is not a problem", () => {
	const parsed = parseFrontmatter("just a body\n");
	assert.ok(parsed);
	assert.deepEqual(parsed.frontmatter, {});
	assert.equal(parsed.body, "just a body\n");
	assert.equal(parsed.problem, undefined, "not having frontmatter is ordinary");
});

test("a closed block parses and leaves no problem", () => {
	const parsed = parseFrontmatter("---\nname: x\n---\nbody\n");
	assert.ok(parsed);
	assert.equal(parsed.frontmatter.name, "x");
	assert.equal(parsed.body, "body\n");
	assert.equal(parsed.problem, undefined);
});

test("an unterminated block still parses, and says so", () => {
	const parsed = parseFrontmatter("---\nname: x\ndescription: y\n\nbody\n");
	assert.ok(parsed, "it is not a parse failure — the file is readable, just not as intended");
	assert.deepEqual(parsed.frontmatter, {}, "no metadata is claimed");
	assert.match(parsed.body, /name: x/, "the whole document is the body, which is the visible symptom");
	assert.ok(parsed.problem, "and the reading is flagged");
	assert.match(parsed.problem, /never closed/);
});

test("invalid YAML is a parse failure, which is a different thing", () => {
	const parsed = parseFrontmatter("---\n: : :\n---\nbody\n");
	assert.ok(isUnparsable(parsed), "不是「读出来是空的」，是根本读不了");
	/*
	 * 解析器的原话要在里面。
	 *
	 * 从前这里返回 null，于是用户能看到的只有「不是合法 YAML」——文件名有了，错在哪没有。
	 * 不比对完整句子（那是 `yaml` 库的措辞，升级会变），只要求它确实说了点什么，并且不是
	 * 我们自己编的一句空话。
	 */
	assert.ok(parsed.invalid.length > 0);
	assert.ok(!parsed.invalid.includes("\n"), "单行，因为它要被拼进一句诊断里");
});

test("a skill with unterminated frontmatter loads but is reported", async () => {
	await skill("broken", "---\nname: broken\ndescription: 忘了闭合\n\n这里是正文。");
	await skill("fine", "---\nname: fine\ndescription: 正常的技能\n---\n正文。");

	const { skills, diagnostics } = await loadSkills([{ dir: join(root, "skills"), source: "workspace" }]);

	assert.ok(
		skills.some((s) => s.name === "fine"),
		"the healthy one is unaffected",
	);
	assert.ok(
		!skills.some((s) => s.name === "broken"),
		"the broken one is skipped — with no frontmatter it has no description, which is already required",
	);

	const reported = diagnostics.filter((d) => d.path.includes("broken"));
	assert.equal(reported.length, 2, `both the cause and the consequence are reported (${reported.map((d) => d.message).join("; ")})`);
	assert.ok(
		reported.some((d) => /never closed/.test(d.message)),
		"the cause: the block was never closed",
	);
	assert.ok(
		reported.some((d) => /`description` is required/.test(d.message)),
		"the consequence: with no metadata there is no description",
	);
});

// A fresh directory per call, because `root/skills` still holds the skills written above.
async function loadSpelled(fields: Record<string, string>) {
	const dir = await mkdtemp(join(tmpdir(), "ly-skill-spelling-"));
	try {
		for (const [name, yaml] of Object.entries(fields)) {
			await mkdir(join(dir, name), { recursive: true });
			await writeFile(
				join(dir, name, "SKILL.md"),
				`---\nname: ${name}\ndescription: A skill whose frontmatter spelling is under test.\n${yaml}\n---\nBody.\n`,
				"utf8",
			);
		}
		const { skills, diagnostics } = await loadSkills([{ dir, source: "workspace" }]);
		return { skills: new Map(skills.map((s) => [s.name, s])), diagnostics };
	} finally {
		await rm(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 25 });
	}
}

test("allowed-tools takes effect under either spelling", async () => {
	/*
	 * The guide told authors to write `allowedTools` while the loader read only `allowed-tools`.
	 * A skill written by the book loaded with no restriction at all, and nothing said the field
	 * had been ignored.
	 */
	const { skills } = await loadSpelled({
		hyphen: "allowed-tools: [read, grep]",
		camel: "allowedTools: [read, grep]",
	});
	assert.deepEqual(skills.get("hyphen")?.allowedTools, ["read", "grep"]);
	assert.deepEqual(skills.get("camel")?.allowedTools, ["read", "grep"]);
});

test("with both spellings present, the hyphenated one decides", async () => {
	/*
	 * `normalizeKeys` leaves an explicit camelCase key holding its own value, so reading only the
	 * camelCase key would let it win. The hyphenated spelling is the documented one, shared with
	 * Claude Code's SKILL.md. Both key orders, because YAML order is the author's accident.
	 */
	const { skills } = await loadSpelled({
		"tools-hyphen-first": "allowed-tools: [read]\nallowedTools: [bash]",
		"tools-camel-first": "allowedTools: [bash]\nallowed-tools: [read]",
		"hidden-hyphen-first": "disable-model-invocation: false\ndisableModelInvocation: true",
		"hidden-camel-first": "disableModelInvocation: true\ndisable-model-invocation: false",
	});
	assert.deepEqual(skills.get("tools-hyphen-first")?.allowedTools, ["read"]);
	assert.deepEqual(skills.get("tools-camel-first")?.allowedTools, ["read"]);
	assert.equal(skills.get("hidden-hyphen-first")?.disableModelInvocation, false);
	assert.equal(skills.get("hidden-camel-first")?.disableModelInvocation, false);
});

test("non-string entries in allowed-tools are dropped under either spelling", async () => {
	// Dropping a stray entry keeps the rest of the list in force; rejecting the whole field
	// would quietly lift the restriction instead.
	const { skills } = await loadSpelled({
		hyphen: "allowed-tools: [read, 42, true, null, {name: bash}, grep]",
		camel: "allowedTools: [read, 42, true, null, {name: bash}, grep]",
	});
	assert.deepEqual(skills.get("hyphen")?.allowedTools, ["read", "grep"]);
	assert.deepEqual(skills.get("camel")?.allowedTools, ["read", "grep"]);
});

/** What the loader said about one skill. Nothing `allowed-tools` says may stop a skill loading. */
function warningsFor(result: Awaited<ReturnType<typeof loadSpelled>>, name: string): string[] {
	assert.ok(result.skills.has(name), `${name} should have loaded: ${JSON.stringify(result.diagnostics)}`);
	const own = result.diagnostics.filter((d) => d.path.split(/[\\/]/).at(-2) === name);
	assert.ok(
		own.every((d) => d.severity === "warning"),
		`${name} should have only warnings: ${JSON.stringify(own)}`,
	);
	return own.map((d) => d.message);
}

test("a Claude Code string is a list, split on commas or on spaces", async () => {
	/*
	 * Claude Code documents `allowed-tools: Read, Grep` and `allowed-tools: Bash Read Grep` beside
	 * the YAML list. Only the list was read here: a string was dropped without a word, and the skill
	 * it belonged to ran with every tool.
	 */
	const result = await loadSpelled({
		comma: "allowed-tools: Read, Grep",
		space: "allowed-tools: Read Grep",
		camel: "allowedTools: read,grep",
	});
	for (const name of ["comma", "space", "camel"]) {
		assert.deepEqual(result.skills.get(name)?.allowedTools, ["read", "grep"], name);
		assert.deepEqual(warningsFor(result, name), [], name);
	}
});

test("Claude Code's tool names become ours, whatever the case", async () => {
	/*
	 * Enforcement compares names exactly, and ours are lowercase. `[Read, Grep]` reached it as
	 * written and matched nothing, so the skill was refused every tool but `skill` — the two it
	 * named included.
	 */
	const result = await loadSpelled({
		same: "allowed-tools: [Read, Write, Edit, Glob, Grep, LS, Bash, WebFetch, WebSearch, TodoWrite, LSP, Skill]",
		renamed: "allowed-tools: [Agent, Task, AskUserQuestion, MultiEdit, BashOutput, KillShell, TaskCreate]",
		shouted: "allowed-tools: [READ, Web_Fetch]",
	});
	assert.deepEqual(result.skills.get("same")?.allowedTools, [
		"read",
		"write",
		"edit",
		"glob",
		"grep",
		"ls",
		"bash",
		"web_fetch",
		"web_search",
		"todo_write",
		"lsp",
		"skill",
	]);
	assert.deepEqual(result.skills.get("renamed")?.allowedTools, ["task", "ask_user", "edit", "bash_output", "todo_write"]);
	assert.deepEqual(result.skills.get("shouted")?.allowedTools, ["read", "web_fetch"]);
	for (const name of ["same", "renamed", "shouted"]) assert.deepEqual(warningsFor(result, name), [], name);
});

test("a permission pattern keeps its tool, and the author is told the pattern does nothing here", async () => {
	/*
	 * Claude Code narrows a tool with a pattern, `Bash(git add *)`. There is no per-command scope
	 * here, so the entry grants all of `bash` — not something an author would guess, so it is said.
	 * Parentheses keep their own commas and spaces: `Agent(a, b)` is one entry, the way Claude
	 * Code's own skills write it.
	 */
	const result = await loadSpelled({
		commit: "allowed-tools: Bash(git add *) Bash(git commit *) Bash(git status *)",
		scan: "allowed-tools: Agent(scan-inventory, scan-verifier), Read",
	});
	assert.deepEqual(result.skills.get("commit")?.allowedTools, ["bash"]);
	assert.deepEqual(result.skills.get("scan")?.allowedTools, ["task", "read"]);
	const commit = warningsFor(result, "commit");
	assert.equal(commit.length, 1, "one warning for the field, not one per entry");
	assert.match(commit[0], /`Bash\(git add \*\)`/, "it names what was written");
	assert.match(commit[0], /`bash` 按整个工具放行/, "and what that amounts to");
	assert.match(warningsFor(result, "scan").join("\n"), /`Agent\(scan-inventory, scan-verifier\)`/);
});

test("a name with nothing here to match is kept, so the restriction holds, and it is reported", async () => {
	/*
	 * Dropping it would be quieter and wrong. An empty list restricts nothing, so a skill naming only
	 * `NotebookEdit` would go from one tool to every tool. Kept as written it matches none, which is
	 * as close as this runtime gets to what the author asked for.
	 */
	const result = await loadSpelled({
		notebook: "allowed-tools: [NotebookEdit]",
		mixed: "allowed-tools: Read Workflow",
	});
	assert.deepEqual(result.skills.get("notebook")?.allowedTools, ["NotebookEdit"]);
	assert.deepEqual(result.skills.get("mixed")?.allowedTools, ["read", "Workflow"]);
	assert.match(warningsFor(result, "notebook").join("\n"), /对应不到 Lyra 工具的项.*`NotebookEdit`/);
	const mixed = warningsFor(result, "mixed").join("\n");
	assert.match(mixed, /对应不到 Lyra 工具的项.*`Workflow`/);
	assert.doesNotMatch(mixed, /`Read`/, "only the name that failed is named");
});

test("tools the loader cannot see are taken on trust", async () => {
	/*
	 * The desktop adds `browser_*` tools and MCP servers add `mcp__<server>__<tool>`, and none of
	 * them exist yet when skills load. A warning for each would teach people to skip the warnings.
	 */
	const result = await loadSpelled({
		host: "allowed-tools: [browser_open, mcp__github__create_issue, mcp__My-Server__getIssue]",
	});
	assert.deepEqual(result.skills.get("host")?.allowedTools, ["browser_open", "mcp__github__create_issue", "mcp__My-Server__getIssue"]);
	assert.deepEqual(warningsFor(result, "host"), []);
});

test("a whole MCP server cannot be named here, and that is said", async () => {
	// Claude Code reads `mcp__github` as every tool the server has; enforcement here compares exact names.
	const result = await loadSpelled({ server: "allowed-tools: [mcp__github, mcp__linear__*]" });
	assert.deepEqual(result.skills.get("server")?.allowedTools, ["mcp__github", "mcp__linear__*"]);
	assert.match(warningsFor(result, "server").join("\n"), /指整个 MCP 服务的项.*`mcp__github`、`mcp__linear__\*`/);
});

test("what is skipped or ignored is said, too", async () => {
	/*
	 * A stray entry is still dropped, so the rest of the list stays in force, and a value that is
	 * neither a list nor a string still restricts nothing. Both used to happen in silence. The list
	 * that contains itself is the stray that cannot be printed; saying so must not take the loader
	 * down, and every skill in the directory with it.
	 */
	const result = await loadSpelled({
		strays: "allowed-tools: [read, 42]",
		cyclic: "allowed-tools: &x [read, *x]",
		flag: "allowed-tools: true",
	});
	assert.deepEqual(result.skills.get("strays")?.allowedTools, ["read"]);
	assert.match(warningsFor(result, "strays").join("\n"), /不是工具名的项已跳过：`42`/);
	assert.deepEqual(result.skills.get("cyclic")?.allowedTools, ["read"]);
	assert.match(warningsFor(result, "cyclic").join("\n"), /不是工具名的项已跳过/);
	assert.equal(result.skills.get("flag")?.allowedTools, undefined);
	assert.match(warningsFor(result, "flag").join("\n"), /要写成列表或字符串.*不限制工具/);
});

test("the hyphenated key still decides when it holds a Claude Code string", async () => {
	const { skills } = await loadSpelled({
		"string-first": "allowed-tools: Read\nallowedTools: [bash]",
		"string-last": "allowedTools: [bash]\nallowed-tools: Read, Grep",
	});
	assert.deepEqual(skills.get("string-first")?.allowedTools, ["read"]);
	assert.deepEqual(skills.get("string-last")?.allowedTools, ["read", "grep"]);
});

test("两种拼写的 disable-model-invocation 都算数", async () => {
	/*
	 * 连字符和驼峰在外面都有人写——启发这些格式的那几个工具彼此就不一致。原本只认连字符那一种，
	 * 写了驼峰的人得到的是一个被静默忽略的字段：技能照常加载、照常出现在列表里，只是那个开关
	 * 不起作用。这类失败没有任何迹象。
	 */
	const dir = await mkdtemp(join(tmpdir(), "ly-skill-keys-"));
	try {
		for (const [name, key] of [
			["hyphen", "disable-model-invocation"],
			["camel", "disableModelInvocation"],
		]) {
			await mkdir(join(dir, name), { recursive: true });
			await writeFile(
				join(dir, name, "SKILL.md"),
				`---\nname: ${name}\ndescription: 一个技能\n${key}: true\n---\n正文\n`,
				"utf8",
			);
		}

		const { skills } = await loadSkills([{ dir, source: "workspace" }]);
		assert.equal(skills.length, 2);
		for (const skill of skills) assert.equal(skill.disableModelInvocation, true, `${skill.name} 的开关该生效`);
	} finally {
		await rm(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 25 });
	}
});

test("给 Claude Code 写的技能：正文里的 ${CLAUDE_SKILL_DIR} 和 ${CLAUDE_PLUGIN_ROOT} 交给模型前换成真路径", () => {
	const skill: Skill = {
		name: "ui-ux",
		description: "测试用的技能。",
		content: "先跑 python ${CLAUDE_SKILL_DIR}/scripts/search.py，规则在 ${CLAUDE_PLUGIN_ROOT}/shared/rules.md。",
		path: "/home/.lyra/plugins/pro/skills/ui-ux/SKILL.md",
		dir: "/home/.lyra/plugins/pro/skills/ui-ux",
		source: "user",
		disableModelInvocation: false,
		pluginId: "pro",
		pluginRoot: "/home/.lyra/plugins/pro",
	};
	const text = formatSkillInvocation(skill);
	assert.match(text, /python \/home\/\.lyra\/plugins\/pro\/skills\/ui-ux\/scripts\/search\.py/);
	assert.match(text, /\/home\/\.lyra\/plugins\/pro\/shared\/rules\.md/);
	assert.doesNotMatch(text, /\$\{CLAUDE_/);
	// 零散技能没有包：插件根就当它自己的目录。
	const loose = formatSkillInvocation({ ...skill, pluginId: undefined, pluginRoot: undefined });
	assert.match(loose, /\/skills\/ui-ux\/shared\/rules\.md/);
});
