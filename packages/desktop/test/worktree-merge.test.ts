/**
 * 把会话的工作树合回它出来的分支，以及把那个分支的新提交同步进来。
 *
 * 合回去有两条路：main 正检出在项目目录里，就在那儿 merge，文件跟着变；哪儿都没检出，就只算出合并
 * 结果、提交、挪分支，不动任何人的文件。两条路遇到冲突都立刻撤回，项目目录不留半截合并。同步遇到
 * 冲突则留在工作树里等人（或模型）解决。
 */

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { after, test } from "node:test";
import { reclaimWorktree, worktreeState } from "../electron/worktree-lifecycle.ts";
import { abortSync, mergeIntoBase, syncFromBase } from "../electron/worktree-merge.ts";
import { cleanUpFixtures, commitIn, fixture, sh } from "./helpers/worktree-fixture.ts";

after(cleanUpFixtures);

const merging = (dir: string) => sh(dir, "rev-parse", "-q", "--verify", "MERGE_HEAD").then(() => true, () => false);

test("main 检出在项目目录里：就地合并，文件跟着出现，是一个合并提交", async () => {
	const { repo, tree, meta } = await fixture();
	await commitIn(tree, "feature.txt", "feature\n");
	await commitIn(tree, "more.txt", "more\n");
	assert.deepEqual(await mergeIntoBase(meta), { kind: "merged", commits: 2, base: "main" });
	assert.ok(existsSync(join(repo, "feature.txt")), "the project's own folder has the work");
	assert.equal(await sh(repo, "log", "-1", "--format=%s"), "Merge branch 'lyra/session-12345678'");
	assert.equal((await sh(repo, "log", "-1", "--format=%P")).split(" ").length, 2);
	const after = await worktreeState(meta);
	assert.equal(after?.ahead, 0);
	assert.equal(after?.behind, 0, "the merge commit on main is not work the worktree is missing");
});

test("main 哪儿都没检出：只挪分支，不动项目目录里检出的东西", async () => {
	const { repo, tree, meta } = await fixture();
	await sh(repo, "checkout", "-b", "elsewhere");
	await commitIn(tree, "feature.txt", "feature\n");
	const before = await sh(repo, "rev-parse", "main");
	assert.deepEqual(await mergeIntoBase(meta), { kind: "merged", commits: 1, base: "main" });
	assert.notEqual(await sh(repo, "rev-parse", "main"), before);
	assert.equal(await sh(repo, "rev-parse", "--abbrev-ref", "HEAD"), "elsewhere", "the checkout stays on its branch");
	assert.equal(existsSync(join(repo, "feature.txt")), false, "and its files are untouched");
	assert.equal(await sh(repo, "show", "main:feature.txt"), "feature");
	assert.equal(await sh(repo, "log", "-1", "--format=%s", "main"), "Merge branch 'lyra/session-12345678'");
});

for (const checkedOut of [true, false]) {
	test(`合回去有冲突（main ${checkedOut ? "检出在项目里" : "没检出"}）：撤回，报出文件，main 不动`, async () => {
		const { repo, tree, meta } = await fixture(checkedOut ? "conflict-in" : "conflict-out");
		await commitIn(repo, "README.md", "# from main\n");
		await commitIn(tree, "README.md", "# from the worktree\n");
		if (!checkedOut) await sh(repo, "checkout", "-b", "elsewhere");
		const before = await sh(repo, "rev-parse", "main");
		assert.deepEqual(await mergeIntoBase(meta), { kind: "conflict", files: ["README.md"], base: "main" });
		assert.equal(await sh(repo, "rev-parse", "main"), before);
		assert.equal(await merging(repo), false, "no half-merged checkout left behind");
		assert.equal(await sh(repo, "status", "--porcelain"), "");
	});
}

test("先提交才合：有没提交的改动就停下说有几个", async () => {
	const { tree, meta } = await fixture();
	await commitIn(tree, "a.txt", "a\n");
	await writeFile(join(tree, "draft.txt"), "draft\n");
	await writeFile(join(tree, "a.txt"), "changed\n");
	assert.deepEqual(await mergeIntoBase(meta), { kind: "uncommitted", files: 2 });
});

test("没有新提交：说没东西可合；main 检出在别的工作树里：不碰", async () => {
	const { repo, tree, meta, root } = await fixture();
	assert.deepEqual(await mergeIntoBase(meta), { kind: "nothing", base: "main" });
	await commitIn(tree, "a.txt", "a\n");
	await sh(repo, "checkout", "-b", "elsewhere");
	const other = join(root, "other-checkout");
	await sh(repo, "worktree", "add", other, "main");
	const outcome = await mergeIntoBase(meta);
	assert.equal(outcome.kind, "refused");
	assert.equal(outcome.kind === "refused" && outcome.reason, "elsewhere");
});

test("同步：main 的新提交并进工作树；已经是最新就说最新", async () => {
	const { repo, tree, meta } = await fixture();
	await commitIn(repo, "upstream.txt", "new on main\n");
	await commitIn(tree, "mine.txt", "mine\n");
	assert.deepEqual(await syncFromBase(meta), { kind: "synced", commits: 1, base: "main" });
	assert.ok(existsSync(join(tree, "upstream.txt")));
	const after = await worktreeState(meta);
	assert.equal(after?.behind, 0);
	assert.equal(after?.ahead, 1, "its own commit, not the merge that brought main in");
	assert.deepEqual(await syncFromBase(meta), { kind: "up-to-date", base: "main" });
});

test("同步有冲突：留在工作树里等解决；状态里看得到；能撤回", async () => {
	const { repo, tree, meta } = await fixture();
	await commitIn(repo, "README.md", "# main's version\n");
	await commitIn(tree, "README.md", "# the worktree's version\n");
	assert.deepEqual(await syncFromBase(meta), { kind: "conflict", files: ["README.md"], base: "main" });
	assert.equal(await merging(tree), true, "left in progress where it is meant to be settled");
	const state = await worktreeState(meta);
	assert.equal(state?.merging, true);
	assert.deepEqual(state?.conflicted, ["README.md"]);
	assert.deepEqual(await syncFromBase(meta), { kind: "conflict", files: ["README.md"], base: "main" }, "asking again reports what is waiting");
	assert.equal(await abortSync(meta), true);
	assert.equal(await merging(tree), false);
	assert.equal(await readFile(join(tree, "README.md"), "utf8"), "# the worktree's version\n");
});

test("同步前也要先提交", async () => {
	const { repo, tree, meta } = await fixture();
	await commitIn(repo, "upstream.txt", "x\n");
	await writeFile(join(tree, "draft.txt"), "draft\n");
	assert.deepEqual(await syncFromBase(meta), { kind: "uncommitted", files: 1 });
});

test("合回去以后再收回：分支已经全在 main 里，跟着一起删", async () => {
	const { repo, tree, meta } = await fixture();
	await commitIn(tree, "feature.txt", "feature\n");
	await mergeIntoBase(meta);
	assert.deepEqual(await reclaimWorktree(meta, { dropMergedBranch: true }), { removed: true, branchDropped: true });
	assert.equal(await sh(repo, "branch", "--list", "lyra/session-12345678"), "");
});

test("收起来的工作树照样能合：提交都在分支上；同步要先有目录", async () => {
	const { repo, tree, meta } = await fixture();
	await commitIn(tree, "feature.txt", "feature\n");
	await reclaimWorktree(meta);
	assert.equal(existsSync(tree), false);
	assert.deepEqual(await mergeIntoBase(meta), { kind: "merged", commits: 1, base: "main" });
	assert.ok(existsSync(join(repo, "feature.txt")));
	assert.deepEqual(await syncFromBase(meta), { kind: "refused", reason: "gone" });
});
