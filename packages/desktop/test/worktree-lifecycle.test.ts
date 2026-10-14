/**
 * 会话的工作树一辈子：看它现在什么样、收回来、再检出来。
 *
 * 规矩只有一条：分支比目录活得久。目录收掉，提交还在分支上，随时能再检出来；会丢的只有没提交的
 * 改动，所以没人点头之前，这里一个都不扔。每条都在真的仓库上跑。
 */

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { after, test } from "node:test";
import { bringBackWorktree, reclaimWorktree, restoreWorktree, worktreeRootOf, worktreeState } from "../electron/worktree-lifecycle.ts";
import { cleanUpFixtures, commitIn, fixture, sh } from "./helpers/worktree-fixture.ts";

after(cleanUpFixtures);

test("状态：领先、落后、没提交的，一眼看全", async () => {
	const { repo, tree, meta } = await fixture();
	await commitIn(tree, "a.txt", "a\n");
	await commitIn(tree, "b.txt", "b\n");
	await commitIn(repo, "main.txt", "main\n");
	await writeFile(join(tree, "loose.txt"), "not committed\n");
	const state = await worktreeState(meta);
	assert.deepEqual(state, { branch: "lyra/session-12345678", base: "main", present: true, ahead: 2, behind: 1, uncommitted: 1, merging: false, conflicted: [] });
});

test("没记 base 的旧工作树：按仓库的默认分支算", async () => {
	const { meta } = await fixture();
	const state = await worktreeState({ ...meta, worktree: { project: meta.worktree!.project, branch: meta.worktree!.branch } });
	assert.equal(state?.base, "main");
});

test("收回干净的工作树：目录没了，分支还在，再检出来提交一个不少", async () => {
	const { repo, tree, meta } = await fixture();
	await commitIn(tree, "work.txt", "done\n");
	const reclaimed = await reclaimWorktree(meta);
	assert.deepEqual(reclaimed, { removed: true, branchDropped: false });
	assert.equal(existsSync(tree), false);
	assert.ok((await sh(repo, "branch", "--list", "lyra/session-12345678")).includes("lyra/session-12345678"), "the branch outlives the folder");
	assert.equal((await worktreeState(meta))?.present, false);

	const restored = await restoreWorktree(meta);
	assert.deepEqual(restored, { ok: true, fresh: false });
	assert.ok(existsSync(join(tree, "work.txt")), "checked out again from its branch, commit and all");
});

test("有没提交的改动：不收，除非有人点了头", async () => {
	const { tree, meta } = await fixture();
	await writeFile(join(tree, "draft.txt"), "half done\n");
	assert.deepEqual(await reclaimWorktree(meta), { removed: false, kept: "uncommitted" });
	assert.ok(existsSync(join(tree, "draft.txt")));
	assert.equal((await reclaimWorktree(meta, { discardUncommitted: true })).removed, true);
	assert.equal(existsSync(tree), false);
});

test("顺手删分支：只删已经全在 base 里的，没合进去的留着", async () => {
	const merged = await fixture("merged");
	assert.equal((await reclaimWorktree(merged.meta, { dropMergedBranch: true })).branchDropped, true, "nothing on it that main lacks");
	assert.equal(await sh(merged.repo, "branch", "--list", "lyra/session-12345678"), "");

	const unmerged = await fixture("unmerged");
	await commitIn(unmerged.tree, "only-here.txt", "x\n");
	assert.equal((await reclaimWorktree(unmerged.meta, { dropMergedBranch: true })).branchDropped, false, "a commit main does not have keeps its branch");
	assert.ok((await sh(unmerged.repo, "branch", "--list", "lyra/session-12345678")).length > 0);
});

test("项目本身、不是工作树的目录：一律不收", async () => {
	const { repo, meta } = await fixture();
	assert.deepEqual(await reclaimWorktree({ cwd: repo, worktree: meta.worktree }), { removed: false });
	assert.ok(existsSync(join(repo, "README.md")));
});

test("分支已经不在了：从 base 重新切一个，标明是新的", async () => {
	const { repo, tree, meta } = await fixture();
	await reclaimWorktree(meta, { dropMergedBranch: true });
	assert.equal(existsSync(tree), false);
	assert.deepEqual(await restoreWorktree(meta), { ok: true, fresh: true });
	assert.equal(await sh(tree, "rev-parse", "--abbrev-ref", "HEAD"), "lyra/session-12345678");
	assert.equal(await sh(tree, "rev-parse", "HEAD"), await sh(repo, "rev-parse", "main"));
});

test("项目是仓库里的子目录：收回之后按同一套算法找回工作树的根", async () => {
	const { repo, tree, meta } = await fixture();
	await mkdir(join(repo, "packages", "app"), { recursive: true });
	await commitIn(repo, join("packages", "app", "index.ts"), "export {};\n");
	await sh(tree, "merge", "--ff-only", "main");
	const nested = { cwd: join(tree, "packages", "app"), worktree: { ...meta.worktree!, project: join(repo, "packages", "app") } };
	assert.equal(await worktreeRootOf(nested), await sh(tree, "rev-parse", "--show-toplevel"));
	await reclaimWorktree(nested);
	assert.equal(existsSync(tree), false);
	assert.equal(await worktreeRootOf(nested), tree, "the package's folder, backwards to the worktree's");
	assert.deepEqual(await restoreWorktree(nested), { ok: true, fresh: false });
	assert.ok(existsSync(join(nested.cwd, "index.ts")));
});

test("再用起来：收回的工作树在原来的路径检出回来；仓库都没了就退回项目、说出原因", async () => {
	const { repo, tree, meta } = await fixture();
	await commitIn(tree, "kept.txt", "kept\n");
	await reclaimWorktree(meta);
	assert.equal(existsSync(tree), false);
	assert.equal(await bringBackWorktree(meta), null, "checked out again, nothing for the meta to change");
	assert.ok(existsSync(join(tree, "kept.txt")), "at the same path the conversation's history names");
	assert.equal(await bringBackWorktree(meta), null, "and a folder that is there is left alone");

	await reclaimWorktree(meta);
	await rm(join(repo, ".git"), { recursive: true, force: true });
	const fallback = await bringBackWorktree(meta);
	assert.equal(fallback?.cwd, repo);
	assert.equal(fallback?.worktree, undefined);
	assert.ok(fallback?.worktreeError, "the reason is kept for the conversation to show");
});
