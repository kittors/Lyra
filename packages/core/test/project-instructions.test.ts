/**
 * 项目指令：从 cwd 一路往上收，停在仓库根。
 *
 * 只读 cwd 一层在 monorepo 里就是错的——在 `packages/core` 里开的会话读不到仓库根的
 * AGENTS.md，而那份文件里通常写着整个仓库的约定：提交格式、包管理器、跑测试的方式。
 * 这个仓库自己就是 monorepo，所以这条一直在影响我们自己。
 */

import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtemp } from "node:fs/promises";
import { after, before, test } from "node:test";
import { loadProjectInstructions } from "../src/prompt/system.ts";

let root: string;

/** 一个有 `.git` 的仓库，里面一个子包。 */
before(async () => {
	root = await mkdtemp(join(tmpdir(), "ly-instr-"));
	await mkdir(join(root, "repo", "packages", "core"), { recursive: true });
	await mkdir(join(root, "repo", ".git"), { recursive: true });
	await writeFile(join(root, "repo", "AGENTS.md"), "整个仓库：提交信息用中文。\n");
	await writeFile(join(root, "repo", "packages", "core", "AGENTS.md"), "这个包：不要引入新依赖。\n");
	// 仓库外面的一份，用来确认往上走会停下来
	await writeFile(join(root, "AGENTS.md"), "别人的项目：这条不该被读到。\n");
});

after(async () => {
	await rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 25 });
});

test("monorepo 子包同时拿到自己的和仓库根的", async () => {
	const found = await loadProjectInstructions(join(root, "repo", "packages", "core"));
	const paths = found.map((f) => f.path);

	assert.equal(found.length, 2, `应当收到两份，实际：${paths.join("、")}`);
	assert.match(found[0].content, /整个仓库/, "根的在前");
	assert.match(found[1].content, /这个包/, "子包的在后");
});

test("从远到近，因为后面的更具体", async () => {
	/*
	 * 顺序就是语义。模型读到冲突时按后者办，而「子包可以覆盖仓库约定」正该是这个方向——
	 * 反过来的话，越具体的指令越容易被一句笼统的话盖掉。
	 */
	const found = await loadProjectInstructions(join(root, "repo", "packages", "core"));
	assert.ok(found[0].path.endsWith(join("repo", "AGENTS.md")), "根的排第一");
	assert.ok(found[1].path.includes(join("packages", "core")), "子包的排最后");
});

test("停在仓库根，不会读到别人项目的那份", async () => {
	/*
	 * 再往上就是 `~` 和 `/`。那里的 AGENTS.md 属于另一个项目，或者是这个人给别的工具写的——
	 * 把它注进来，等于让隔壁仓库的约定管着这个仓库。
	 */
	const found = await loadProjectInstructions(join(root, "repo", "packages", "core"));
	assert.equal(
		found.some((f) => f.content.includes("别人的项目")),
		false,
	);
});

test("仓库根自己开的会话只拿到一份", async () => {
	const found = await loadProjectInstructions(join(root, "repo"));
	assert.equal(found.length, 1);
	assert.match(found[0].content, /整个仓库/);
});

test("每层最多一份，同层按优先级", async () => {
	/*
	 * 同一个目录里两份指令，第二份多半是从别的工具迁过来忘了删的旧版本。两份一起注入，
	 * 模型读到的是一份自相矛盾的约定。
	 */
	const dir = join(root, "repo", "packages", "both");
	await mkdir(dir, { recursive: true });
	await writeFile(join(dir, "LYRA.md"), "优先这份。\n");
	await writeFile(join(dir, "AGENTS.md"), "不该同时出现。\n");

	const found = await loadProjectInstructions(dir);
	const here = found.filter((f) => f.path.includes(join("packages", "both")));
	assert.equal(here.length, 1);
	assert.match(here[0].content, /优先这份/);
});

test("不在 git 仓库里时只读自己那一层", async () => {
	/*
	 * 没有仓库根就没有「往上到哪儿为止」的答案，而一路走到 `/` 会读到跟这次会话毫无关系的
	 * 文件。没有边界时收窄，不是放开。
	 */
	const loose = join(root, "loose", "deep");
	await mkdir(loose, { recursive: true });
	await writeFile(join(root, "loose", "AGENTS.md"), "上一层，不该被读到。\n");
	await writeFile(join(loose, "AGENTS.md"), "自己这层。\n");

	const found = await loadProjectInstructions(loose);
	assert.equal(found.length, 1);
	assert.match(found[0].content, /自己这层/);
});

test("一份都没有时返回空，而不是抛错", async () => {
	const empty = join(root, "repo", "packages", "empty");
	await mkdir(empty, { recursive: true });
	const found = await loadProjectInstructions(empty);
	// 这一层没有，但仓库根有——空的是「这一层」，不是整个结果。
	assert.equal(found.length, 1);
	assert.match(found[0].content, /整个仓库/);
});
