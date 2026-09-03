/**
 * `gitStatus` against real repositories, in every state a checkout can be in.
 *
 * The classification has its own unit tests next door, and they cover the rule. What they cannot
 * cover is the half that actually broke: what git *says* in each of these situations. Every wrong
 * answer this panel has given came from reading a real output slightly wrong — `## main` with no
 * ahead field read as "in sync", `rev-parse --abbrev-ref HEAD` answering with the string "HEAD" on
 * a detached checkout — and neither is reachable from a hand-built fixture.
 *
 * So these build the repositories. It costs a few hundred milliseconds and it is the only way to
 * know the parsing matches the git that is installed.
 */

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { after, test } from "node:test";

import { gitStatus } from "../electron/git-status.ts";
import { pushBranch } from "../electron/git-history.ts";
import { gitBranch } from "../electron/git.ts";

const execFileAsync = promisify(execFile);

const roots: string[] = [];
after(async () => {
	await Promise.all(roots.map((dir) => rm(dir, { recursive: true, force: true })));
});

async function git(cwd: string, ...args: string[]): Promise<string> {
	const { stdout } = await execFileAsync("git", args, { cwd });
	return stdout;
}

/** A scratch directory that cleans itself up when the file is done. */
async function scratch(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "lyra-git-"));
	roots.push(dir);
	return dir;
}

/** An empty repository on `main`, with an identity so commits are possible. */
async function repo(name = "work"): Promise<string> {
	const root = await scratch();
	const dir = join(root, name);
	await execFileAsync("git", ["init", "-q", "-b", "main", dir]);
	await git(dir, "config", "user.email", "t@example.com");
	await git(dir, "config", "user.name", "T");
	return dir;
}

async function commit(dir: string, file: string, body = file): Promise<void> {
	await writeFile(join(dir, file), `${body}\n`);
	await git(dir, "add", "-A");
	await git(dir, "commit", "-qm", file);
}

/** A repository with a bare remote beside it, already pushed and tracking. */
async function tracked(): Promise<{ dir: string; remote: string }> {
	const root = await scratch();
	const remote = join(root, "remote.git");
	await execFileAsync("git", ["init", "-q", "--bare", "-b", "main", remote]);
	const dir = join(root, "work");
	await execFileAsync("git", ["init", "-q", "-b", "main", dir]);
	await git(dir, "config", "user.email", "t@example.com");
	await git(dir, "config", "user.name", "T");
	await commit(dir, "a.txt");
	await git(dir, "remote", "add", "origin", remote);
	await git(dir, "push", "-q", "-u", "origin", "main");
	return { dir, remote };
}

// ---------------------------------------------------------------------------
// The states, in the order they are classified
// ---------------------------------------------------------------------------

test("a fresh repository has a branch and nothing to push", async () => {
	const dir = await repo();
	const status = await gitStatus(dir);
	assert.equal(status.remoteState, "no-commits");
	// The branch name is known before the first commit exists — `symbolic-ref` reads what HEAD is
	// waiting to become, which is what the first commit will land on.
	assert.equal(status.branch, "main");
	assert.equal(status.unpushed, null);
});

test("commits with no remote configured", async () => {
	const dir = await repo();
	await commit(dir, "a.txt");
	const status = await gitStatus(dir);
	assert.deepEqual(
		{ state: status.remoteState, remote: status.remote, unpushed: status.unpushed },
		{ state: "none", remote: null, unpushed: null },
	);
});

test("a remote, but this branch has never been pushed", async () => {
	/*
	 * The reported bug, at its source. `git status` says `## main` here — no upstream, and so no
	 * ahead field — which the old panel read as `ahead: 0` and reported as 「已同步」.
	 */
	const root = await scratch();
	const remote = join(root, "remote.git");
	await execFileAsync("git", ["init", "-q", "--bare", "-b", "main", remote]);
	const dir = await repo();
	await commit(dir, "a.txt");
	await git(dir, "remote", "add", "origin", remote);

	const status = await gitStatus(dir);
	assert.equal(status.ahead, 0, "git itself reports nothing here — this is the trap");
	assert.equal(status.remoteState, "no-upstream");
	assert.equal(status.remote, "origin");
	// Null rather than 1: there is no remote branch to count against, and 「整个分支」 is not a
	// number worth showing.
	assert.equal(status.unpushed, null);
});

test("a remote that already has this branch, but no tracking config", async () => {
	const { dir } = await tracked();
	await commit(dir, "b.txt");
	// Lose the tracking config, keeping the remote-tracking ref — a clone whose config was edited,
	// or a branch recreated by hand.
	await git(dir, "config", "--unset", "branch.main.merge");
	await git(dir, "config", "--unset", "branch.main.remote");

	const status = await gitStatus(dir);
	assert.equal(status.remoteState, "no-upstream");
	assert.equal(status.remote, "origin");
	// Here there *is* a base to count against, so the number is real.
	assert.equal(status.unpushed, 1);
});

test("a tracking branch, in the three ways it can differ", async () => {
	const { dir, remote } = await tracked();

	let status = await gitStatus(dir);
	assert.deepEqual(
		{ state: status.remoteState, remote: status.remote, unpushed: status.unpushed, behind: status.behind },
		{ state: "tracking", remote: "origin", unpushed: 0, behind: 0 },
		"in sync",
	);

	await commit(dir, "b.txt");
	status = await gitStatus(dir);
	assert.equal(status.unpushed, 1, "ahead");
	assert.equal(status.behind, 0);

	// Someone else pushes, and this checkout learns about it by fetching.
	const other = join(await scratch(), "other");
	await execFileAsync("git", ["clone", "-q", remote, other]);
	await git(other, "config", "user.email", "o@example.com");
	await git(other, "config", "user.name", "O");
	await commit(other, "c.txt");
	await git(other, "push", "-q", "origin", "main");
	await git(dir, "fetch", "-q", "origin");

	status = await gitStatus(dir);
	assert.equal(status.unpushed, 1, "diverged: ahead");
	assert.equal(status.behind, 1, "diverged: behind");
});

test("a detached HEAD is not a branch called HEAD", async () => {
	const { dir } = await tracked();
	await commit(dir, "b.txt");
	await git(dir, "checkout", "-q", "--detach", "HEAD");

	const status = await gitStatus(dir);
	assert.equal(status.remoteState, "detached");
	/*
	 * The old `gitBranch` answered `"HEAD"` here, because `rev-parse --abbrev-ref` does. Every
	 * `if (!branch)` guard in the codebase was reading that as "on a branch".
	 */
	assert.equal(status.branch, null);
	assert.equal(await gitBranch(dir), null);
});

test("push refuses a detached HEAD rather than inventing a branch", async () => {
	const { dir } = await tracked();
	await git(dir, "checkout", "-q", "--detach", "HEAD");

	const result = await pushBranch(dir);
	assert.equal(result.ok, false);
	assert.equal(result.error, "当前不在任何分支上");
	// And nothing called HEAD was created on the remote by trying.
	const refs = await git(dir, "ls-remote", "origin");
	assert.ok(!refs.includes("refs/heads/HEAD"), `a branch called HEAD was pushed:\n${refs}`);
});

test("a rebase in progress reads as a rebase, not as a detached HEAD", async () => {
	const { dir } = await tracked();
	await git(dir, "checkout", "-q", "-b", "side");
	await commit(dir, "shared.txt", "from side");
	await git(dir, "checkout", "-q", "main");
	await commit(dir, "shared.txt", "from main");
	await git(dir, "checkout", "-q", "side");
	// Conflicts, so the rebase stops and stays stopped.
	await git(dir, "rebase", "main").catch(() => undefined);

	const status = await gitStatus(dir);
	assert.equal(status.remoteState, "in-progress");
	assert.equal(status.operation, "rebase");
});

test("a conflicted merge is caught even though the branch is intact", async () => {
	const { dir } = await tracked();
	await git(dir, "checkout", "-q", "-b", "side");
	await commit(dir, "shared.txt", "from side");
	await git(dir, "checkout", "-q", "main");
	await commit(dir, "shared.txt", "from main");
	await git(dir, "merge", "side").catch(() => undefined);

	const status = await gitStatus(dir);
	assert.equal(status.remoteState, "in-progress");
	assert.equal(status.operation, "merge");
	// Unlike a rebase, this one still knows its branch — nothing else in the status would say.
	assert.equal(status.branch, "main");
});

test("the operation probe reads the worktree's own git dir, not the shared one", async () => {
	/*
	 * Marker files are per-worktree. Read from `--git-common-dir` a rebase stopped in the main
	 * checkout would be reported in every linked worktree as well, disabling their buttons for a
	 * conflict that has nothing to do with them.
	 */
	const { dir } = await tracked();
	const linked = join(await scratch(), "wt");
	await git(dir, "worktree", "add", "-q", linked, "-b", "wt-branch");

	await git(dir, "checkout", "-q", "-b", "side");
	await commit(dir, "shared.txt", "from side");
	await git(dir, "checkout", "-q", "main");
	await commit(dir, "shared.txt", "from main");
	await git(dir, "merge", "side").catch(() => undefined);

	assert.equal((await gitStatus(dir)).operation, "merge", "the checkout that is merging");
	assert.equal((await gitStatus(linked)).operation, null, "the one that is not");
});

test("a remote that is not called origin", async () => {
	const root = await scratch();
	const remote = join(root, "remote.git");
	await execFileAsync("git", ["init", "-q", "--bare", "-b", "main", remote]);
	const dir = await repo();
	await commit(dir, "a.txt");
	await git(dir, "remote", "add", "fork", remote);
	await git(dir, "push", "-q", "-u", "fork", "main");
	await commit(dir, "b.txt");

	const status = await gitStatus(dir);
	assert.equal(status.remoteState, "tracking");
	assert.equal(status.remote, "fork", "the remote comes from the upstream, not from a guess");
	assert.equal(status.unpushed, 1);
});

test("publishing an untracked branch goes to the remote the repository has", async () => {
	// The old code ran `push -u origin <branch>` regardless, which fails outright here.
	const root = await scratch();
	const remote = join(root, "remote.git");
	await execFileAsync("git", ["init", "-q", "--bare", "-b", "main", remote]);
	const dir = await repo();
	await commit(dir, "a.txt");
	await git(dir, "remote", "add", "fork", remote);

	const result = await pushBranch(dir);
	assert.equal(result.ok, true, result.error);

	const status = await gitStatus(dir);
	assert.equal(status.remoteState, "tracking", "an upstream now exists");
	assert.equal(status.upstream, "fork/main");
	assert.equal(status.unpushed, 0);
});

test("with several remotes and no origin, push declines instead of guessing", async () => {
	const root = await scratch();
	for (const name of ["one.git", "two.git"]) {
		await execFileAsync("git", ["init", "-q", "--bare", "-b", "main", join(root, name)]);
	}
	const dir = await repo();
	await commit(dir, "a.txt");
	await git(dir, "remote", "add", "upstream", join(root, "one.git"));
	await git(dir, "remote", "add", "fork", join(root, "two.git"));

	const status = await gitStatus(dir);
	assert.equal(status.remoteState, "no-upstream");
	assert.equal(status.remote, null, "no remote could be chosen");

	const result = await pushBranch(dir);
	assert.equal(result.ok, false);
	assert.equal(result.error, "有多个远端，请先设置上游分支");
});
