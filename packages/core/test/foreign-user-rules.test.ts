/**
 * 外部工具的**个人**规则：默认不读，勾了才读。
 *
 * 这个开关在能力层里写好很久了，而从来没有产品代码传过它——所有外部工具的用户级目录一直
 * 都是读不到的。所以这里测的是两件事，而第二件才是新的：opt-in 的语义对不对，以及
 * **`loadRules` 到底有没有把设置传下去**。
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { DEFAULT_SETTINGS, type Settings } from "../src/config/settings.ts";
import { loadRules } from "../src/runtime/session-setup.ts";

let home: string;
let project: string;

before(async () => {
	home = await mkdtemp(join(tmpdir(), "ly-foreign-home-"));
	project = await mkdtemp(join(tmpdir(), "ly-foreign-proj-"));
	process.env.LYRA_HOME = join(home, ".lyra");

	// 项目里的一份（永远读）和个人的一份（要勾）
	await mkdir(join(project, ".cursor", "rules"), { recursive: true });
	await writeFile(join(project, ".cursor", "rules", "team.mdc"), "---\nalwaysApply: true\n---\n团队的约定。\n");
	await mkdir(join(home, ".cursor", "rules"), { recursive: true });
	await writeFile(join(home, ".cursor", "rules", "mine.mdc"), "---\nalwaysApply: true\n---\n我自己的偏好。\n");

	// Gemini：项目一份、个人一份，都是纯 markdown
	await writeFile(join(project, "GEMINI.md"), "这个项目的 Gemini 指令。\n");
	await mkdir(join(home, ".gemini"), { recursive: true });
	await writeFile(join(home, ".gemini", "GEMINI.md"), "我的全局 Gemini 记忆。\n");

	// Codex：只有个人那一份
	await mkdir(join(home, ".codex"), { recursive: true });
	await writeFile(join(home, ".codex", "AGENTS.md"), "我的 Codex 全局约定。\n");
});

after(async () => {
	delete process.env.LYRA_HOME;
	await rm(home, { recursive: true, force: true, maxRetries: 8, retryDelay: 25 });
	await rm(project, { recursive: true, force: true, maxRetries: 8, retryDelay: 25 });
});

/** `loadRules` 读的是 `userHome`，测试里用 HOME 指过去。 */
function withHome<T>(run: () => Promise<T>): Promise<T> {
	const before = process.env.HOME;
	process.env.HOME = home;
	return run().finally(() => {
		process.env.HOME = before;
	});
}

const settingsWith = (enabled: string[]): Settings => ({ ...DEFAULT_SETTINGS, enabledForeignUserRules: enabled });

const names = (set: { always: { name: string }[]; book: { name: string }[]; stream: { name: string }[] }) =>
	[...set.always, ...set.book, ...set.stream].map((r) => r.name);

test("项目里的外部规则永远读，个人的默认不读", async () => {
	/*
	 * 项目里的 `.cursor/rules` 是团队对这份代码做出的声明，提交在仓库里。而 `~/.cursor/rules`
	 * 是你自己的——让它跟着你进别人的仓库，会做出一个跟同事在同一份代码上行为不同的 agent，
	 * 而屏幕上没有任何东西解释为什么。
	 */
	const set = await withHome(() => loadRules(project, DEFAULT_SETTINGS, []));
	const found = names(set);

	assert.ok(found.includes("team"), `项目里那份该读到：${found.join("、")}`);
	assert.ok(!found.includes("mine"), "个人那份默认不该读");
});

test("勾上之后个人的那份才进来", async () => {
	const set = await withHome(() => loadRules(project, settingsWith(["cursor"]), []));
	const found = names(set);

	assert.ok(found.includes("team"));
	assert.ok(found.includes("mine"), `勾了 cursor 就该读到个人那份：${found.join("、")}`);
});

test("勾一个不影响另一个", async () => {
	/*
	 * 按 provider 逐个勾，而不是一个「读所有外部工具的个人规则」的总开关：一个人可能想让
	 * Cursor 的个人规则跟着走，同时不想让三年前配的 Windsurf 也跟着。
	 */
	const set = await withHome(() => loadRules(project, settingsWith(["gemini"]), []));
	const found = names(set);

	assert.ok(!found.includes("mine"), "没勾 cursor，它的个人规则就不该在");
	assert.ok(found.includes("GEMINI"), `勾了 gemini：${found.join("、")}`);
});

test("Gemini 的项目文件不用勾就能读", async () => {
	const set = await withHome(() => loadRules(project, DEFAULT_SETTINGS, []));
	assert.ok(names(set).includes("GEMINI"), "项目根的 GEMINI.md 是这个仓库里的文件");
});

test("Codex 只有个人那一份，因为项目里的 AGENTS.md 已经被当项目指令读了", async () => {
	/*
	 * 同一段文字在提示词里出现两次，而两次里只有一次能被关掉——那是比不读更糟的状态。
	 */
	const off = await withHome(() => loadRules(project, DEFAULT_SETTINGS, []));
	assert.ok(!names(off).includes("AGENTS"), "没勾 codex 时什么都不该有");

	const on = await withHome(() => loadRules(project, settingsWith(["codex"]), []));
	assert.ok(names(on).includes("AGENTS"), `勾了 codex 该读到 ~/.codex/AGENTS.md：${names(on).join("、")}`);
});

test("纯 markdown 的外部文件当常驻规则", async () => {
	/*
	 * `GEMINI.md` 和 `AGENTS.md` 整份就是一段指令，作者写它的时候没有「什么时候生效」这个
	 * 概念。读成规则库条目的话，它就只在模型自己想起来去读的时候才生效。
	 */
	const set = await withHome(() => loadRules(project, DEFAULT_SETTINGS, []));
	assert.ok(
		set.always.some((r) => r.name === "GEMINI"),
		"该进常驻桶",
	);
});
