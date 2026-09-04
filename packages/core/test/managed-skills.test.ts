/**
 * 从会话里长出来的技能，以及那条铁律：**人不点头就不生效**。
 *
 * 一个自动生成的技能会改变这个 agent 以后的行为，而看到它生效的人多半不记得自己批准过什么。
 * 所以这个文件里每一条，本质上都在测同一件事的不同侧面：候选待在待确认区、能力层看不到它、
 * 批准之后才出现、而且人写的同名技能永远赢。
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { createRegistry } from "../src/capability/index.ts";
import { approvedSkills, approveSkill, managedSkillsDir, pendingSkills, pendingSkillsDir, proposeSkill, rejectSkill } from "../src/runtime/managed-skills.ts";
import { parseSkillProposal } from "../src/runtime/memory-extract.ts";
import type { Skill } from "../src/skills/loader.ts";

let home: string;
let project: string;

before(async () => {
	home = await mkdtemp(join(tmpdir(), "ly-mskill-home-"));
	project = await mkdtemp(join(tmpdir(), "ly-mskill-proj-"));
	process.env.LYRA_HOME = home;
});
after(async () => {
	delete process.env.LYRA_HOME;
	await rm(home, { recursive: true, force: true, maxRetries: 8, retryDelay: 25 });
	await rm(project, { recursive: true, force: true, maxRetries: 8, retryDelay: 25 });
});

const CANDIDATE = {
	name: "core-change-checklist",
	description: "改完 packages/core 之后要做的检查",
	body: "1. 跑 `pnpm arch`\n2. 跑 `pnpm typecheck`",
};

async function skillNames(): Promise<string[]> {
	const result = await createRegistry({ home: join(home, ".lyra"), userHome: home }).load<Skill>("skill", { cwd: project });
	return result.items.map((s) => s.name);
}

// ---------------------------------------------------------------------------
// 待确认，而不是直接生效
// ---------------------------------------------------------------------------

test("候选进待确认区，能力层看不到它", async () => {
	/*
	 * 这一条是整个功能的前提。候选一旦对能力层可见，那个「等人点头」的设计就只是一句注释了。
	 */
	await proposeSkill(project, CANDIDATE);

	const waiting = await pendingSkills(project);
	assert.equal(waiting.length, 1);
	assert.equal(waiting[0].name, CANDIDATE.name);
	assert.equal(waiting[0].description, CANDIDATE.description);

	assert.ok(!(await skillNames()).includes(CANDIDATE.name), "没批准之前，模型不该拿到它");
});

test("批准之后才出现在技能列表里", async () => {
	await proposeSkill(project, CANDIDATE);
	const path = await approveSkill(project, CANDIDATE.name);

	assert.ok(path?.endsWith(join(CANDIDATE.name, "SKILL.md")), `落在 skills/<name>/SKILL.md：${path}`);
	assert.ok((await skillNames()).includes(CANDIDATE.name), "批准之后模型才拿得到");
	assert.deepEqual(await pendingSkills(project), [], "待确认区清空了");
});

test("「编辑后启用」跟「启用」是同一个动作", async () => {
	/*
	 * 两条代码路径意味着两种可能不一致的行为，而这里的差别只有「存哪份文本」。
	 */
	await proposeSkill(project, { ...CANDIDATE, name: "edited-one" });
	const path = await approveSkill(project, "edited-one", "---\nname: edited-one\ndescription: \"改过的说明\"\n---\n\n人改过的正文\n");

	assert.match(await readFile(path!, "utf8"), /人改过的正文/);
});

test("否决就是删掉，下次不再问", async () => {
	/*
	 * 留着它只会在下一次列表里再问一遍——而这个人已经回答过了。
	 */
	await proposeSkill(project, { ...CANDIDATE, name: "not-wanted" });
	await rejectSkill(project, "not-wanted");

	assert.ok(!(await pendingSkills(project)).some((c) => c.name === "not-wanted"));
	assert.ok(!(await skillNames()).includes("not-wanted"));
});

// ---------------------------------------------------------------------------
// 优先级：人写的永远赢
// ---------------------------------------------------------------------------

test("同名的人写技能盖掉自动生成的", async () => {
	/*
	 * 这不是一个折中，是这个 provider 敢存在的理由：一个自动生成的东西可以被安静地忽略掉，
	 * 办法是写一个同名的。反过来（自动生成的赢）意味着一个人写好的技能会在某天被一段自己
	 * 没写过的文字取代。
	 */
	await proposeSkill(project, { ...CANDIDATE, name: "contested", body: "自动生成的正文" });
	await approveSkill(project, "contested");

	const mine = join(project, ".lyra", "skills", "contested");
	await mkdir(mine, { recursive: true });
	await writeFile(join(mine, "SKILL.md"), '---\nname: contested\ndescription: "我自己写的"\n---\n\n我的正文\n');

	const result = await createRegistry({ home: join(home, ".lyra"), userHome: home }).load<Skill>("skill", { cwd: project });
	const won = result.items.find((s) => s.name === "contested");
	assert.match(won?.content ?? "", /我的正文/, "人写的那份赢");
});

// ---------------------------------------------------------------------------
// 名字与解析
// ---------------------------------------------------------------------------

test("名字不合规的候选直接不收", async () => {
	/*
	 * 名字同时是目录名和模型叫它的方式。一个带斜杠的名字是个路径穿越，一个带空格的名字模型
	 * 叫不出来——两种都该在写进磁盘之前挡掉。
	 */
	for (const bad of ["../escape", "Has Space", "", "A".repeat(60)]) {
		assert.equal(await proposeSkill(project, { ...CANDIDATE, name: bad }), null, bad);
	}
	assert.equal(await approveSkill(project, "../escape"), null);
});

test("缺任何一段的提案都不算数", async () => {
	/*
	 * 一个缺了步骤的技能会以一个人不知道的方式改变 agent 的行为，而「少一个候选」没有任何代价。
	 */
	assert.equal(parseSkillProposal("（没有）"), null);
	assert.equal(parseSkillProposal("NAME: x-y\nDESCRIPTION: 有说明"), null, "缺正文");
	assert.equal(parseSkillProposal("NAME: x-y\nBODY:\n步骤"), null, "缺说明");
	assert.equal(parseSkillProposal("DESCRIPTION: 有\nBODY:\n步骤"), null, "缺名字");
	assert.equal(parseSkillProposal("NAME: Bad Name\nDESCRIPTION: 有\nBODY:\n步骤"), null, "名字不合规");

	const good = parseSkillProposal("NAME: run-checks\nDESCRIPTION: 改完 core 之后\nBODY:\n1. pnpm arch\n");
	assert.deepEqual(good, { name: "run-checks", description: "改完 core 之后", body: "1. pnpm arch" });
});

test("待确认区不是一个技能目录", async () => {
	/*
	 * `.pending` 跟已批准的那些是兄弟目录。它被当成技能读进来的话，「等人点头」就绕过去了。
	 */
	await proposeSkill(project, { ...CANDIDATE, name: "still-waiting" });
	assert.ok(!(await approvedSkills(project)).includes(".pending"));
	assert.ok(pendingSkillsDir(project).startsWith(managedSkillsDir(project)), "确实是兄弟目录，所以这条才有意义");
});
