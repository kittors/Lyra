/**
 * `.agent/` 与 `.agents/`——验收清单第 5 条（计划 15 §3.6）。
 *
 * 四种能力、两个目录名、项目侧向上遍历、个人侧要勾。每一条都对应一种「静默失效」：只认一个
 * 目录名，另一半的人失效；不往上走，monorepo 子包看不见根；个人目录默认读，同事之间行为不一。
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { createRegistry } from "../src/capability/index.ts";
import type { ContextFile } from "../src/capability/types.ts";
import type { SlashCommand } from "../src/commands/loader.ts";
import type { Rule } from "../src/rules/types.ts";
import type { Skill } from "../src/skills/loader.ts";

let root: string;
let home: string;

before(async () => {
	root = await mkdtemp(join(tmpdir(), "ly-agentsdir-"));
	home = await mkdtemp(join(tmpdir(), "ly-agentsdir-home-"));
	const repo = join(root, "repo");
	await mkdir(join(repo, ".git"), { recursive: true });

	// 根用 .agents（复数），四样都放
	await mkdir(join(repo, ".agents", "rules"), { recursive: true });
	await mkdir(join(repo, ".agents", "skills", "deploy"), { recursive: true });
	await mkdir(join(repo, ".agents", "commands"), { recursive: true });
	await writeFile(join(repo, ".agents", "rules", "team.md"), "团队约定：先跑测试。\n");
	await writeFile(join(repo, ".agents", "skills", "deploy", "SKILL.md"), '---\nname: deploy\ndescription: "部署流程"\n---\n\n步骤。\n');
	await writeFile(join(repo, ".agents", "commands", "ship.md"), "---\ndescription: 发布\n---\n发布 $ARGUMENTS\n");
	await writeFile(join(repo, ".agents", "AGENTS.md"), "根的 .agents/AGENTS.md。\n");

	// 子包用 .agent（单数）
	await mkdir(join(repo, "packages", "api", ".agent", "rules"), { recursive: true });
	await writeFile(join(repo, "packages", "api", ".agent", "rules", "api.md"), "api：不加依赖。\n");

	// 个人的
	await mkdir(join(home, ".agents", "rules"), { recursive: true });
	await writeFile(join(home, ".agents", "rules", "mine.md"), "我的偏好。\n");
});
after(async () => {
	await rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 25 });
	await rm(home, { recursive: true, force: true, maxRetries: 8, retryDelay: 25 });
});

const registry = () => createRegistry({ home: join(home, ".lyra"), userHome: home });
const cwd = () => join(root, "repo", "packages", "api");

test("四种能力都从 .agents/ 里读出来", async () => {
	const r = registry();
	const rules = await r.load<Rule>("rule", { cwd: cwd() });
	const skills = await r.load<Skill>("skill", { cwd: cwd() });
	const commands = await r.load<SlashCommand>("command", { cwd: cwd() });
	const files = await r.load<ContextFile>("context-file", { cwd: cwd() });

	assert.ok(rules.items.some((x) => x.name === "team"), `规则：${rules.items.map((x) => x.name).join("、")}`);
	assert.ok(skills.items.some((x) => x.name === "deploy"), `技能：${skills.items.map((x) => x.name).join("、")}`);
	assert.ok(commands.items.some((x) => x.name === "ship"), `命令：${commands.items.map((x) => x.name).join("、")}`);
	assert.ok(files.items.some((x) => x.path.endsWith(join(".agents", "AGENTS.md"))), `指令文件：${files.items.map((x) => x.name).join("、")}`);
});

test("两个目录名都认：子包的 .agent（单数）和根的 .agents（复数）一起来", async () => {
	/*
	 * 写这份约定的人自己没定下来用哪个，于是两个都在野外流通。只认一个，另一半的人静默失效。
	 */
	const rules = await registry().load<Rule>("rule", { cwd: cwd() });
	const names = new Set(rules.items.map((x) => x.name));
	assert.ok(names.has("team"), "根的 .agents/ 读到了");
	assert.ok(names.has("api"), "子包的 .agent/ 也读到了");
});

test("项目侧带着 depth，子包 0 根 2", async () => {
	const rules = await registry().load<Rule>("rule", { cwd: cwd() });
	const api = rules.items.find((x) => x.name === "api");
	const team = rules.items.find((x) => x.name === "team");
	assert.equal(api?.provenance.depth, 0);
	assert.equal(team?.provenance.depth, 2);
});

test("裸 markdown 规则当常驻，而不是被拒", async () => {
	/*
	 * `.agents/rules/*.md` 多半没有 frontmatter。走 `lyra` 方言会因为「没 condition、没
	 * alwaysApply、没 description」被拒——而写它的人只是写了一段话。
	 */
	const rules = await registry().load<Rule>("rule", { cwd: cwd() });
	assert.equal(rules.items.find((x) => x.name === "team")?.bucket, "always");
	assert.ok(!rules.diagnostics.some((d) => d.path.includes("team.md")), "没有诊断说它格式不对");
});

test("个人的 ~/.agents/ 默认不读，勾了才读", async () => {
	const off = await registry().load<Rule>("rule", { cwd: cwd() });
	assert.ok(!off.items.some((x) => x.name === "mine"), "默认不该读到个人的");

	const on = await registry().load<Rule>("rule", { cwd: cwd(), enabledUserSources: new Set(["agents-dir"]) });
	assert.ok(on.items.some((x) => x.name === "mine"), "勾了 agents-dir 就该读到");
});

test("命令的来源标成 agents，设置页能区分", async () => {
	const commands = await registry().load<SlashCommand>("command", { cwd: cwd() });
	assert.equal(commands.items.find((x) => x.name === "ship")?.origin, "agents");
});

test(".agents/AGENTS.md 跟同层裸 AGENTS.md 撞上时，裸的赢、这份被遮蔽", async () => {
	/*
	 * 同一层两份指令文件是一次冲突，注册表按 `scope:depth` 只留一份。根目录那份是更标准的
	 * 位置，`native` 优先级 100 赢；这份带着「被谁盖的」回来，而不是静默消失。
	 */
	await writeFile(join(root, "repo", "AGENTS.md"), "根的裸 AGENTS.md。\n");
	const files = await registry().load<ContextFile>("context-file", { cwd: join(root, "repo") });
	const live = files.items.filter((f) => f.depth === 0);
	assert.equal(live.length, 1, `同层只留一份：${files.items.map((f) => f.name).join("、")}`);
	assert.match(live[0].content, /裸 AGENTS/);
	const lost = files.all.find((f) => f.path.endsWith(join(".agents", "AGENTS.md")));
	assert.ok(lost?.shadowedBy, "被遮蔽的那份要能查到");
});
