/**
 * The working-tree diff, after it stopped reading one file at a time.
 *
 * The claim being defended is that nothing about the *answer* changed when the reads were batched
 * — only how long they take. So this asserts on the things a reader of the panel would notice: a
 * modification is counted, an untracked file is entirely new, a deletion is entirely gone, an
 * image is listed as binary rather than diffed as text, and the totals add up to the files.
 *
 * The binary cases are the ones with history. Both sides of that used to be wrong in opposite
 * directions — a changed image vanished from the review, and a deleted one was diffed as five
 * lines of PNG header — so they are asserted rather than assumed.
 */

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { after, before, test } from "node:test";
import { collectWorkspaceDiff } from "../electron/git-diff.ts";
import { diffRefs } from "../electron/git-history.ts";

const exec = promisify(execFile);

let repo: string;

before(async () => {
	repo = await mkdtemp(join(tmpdir(), "lyra-diff-"));
	await exec("git", ["init", "-q"], { cwd: repo });
	await exec("git", ["config", "user.email", "t@example.com"], { cwd: repo });
	await exec("git", ["config", "user.name", "t"], { cwd: repo });

	await writeFile(join(repo, "kept.txt"), "a\nb\nc\n");
	await writeFile(join(repo, "edited.txt"), "one\ntwo\n");
	await writeFile(join(repo, "gone.txt"), "bye\n");
	await writeFile(join(repo, "picture.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x0d]));
	await exec("git", ["add", "-A"], { cwd: repo });
	await exec("git", ["commit", "-qm", "seed"], { cwd: repo });

	// One of each kind of change, so the walk has to get every branch right.
	await writeFile(join(repo, "edited.txt"), "one\ntwo\nthree\nfour\n");
	await writeFile(join(repo, "fresh.txt"), "new\nlines\nhere\n");
	await unlink(join(repo, "gone.txt"));
	await writeFile(join(repo, "picture.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x01, 0x02, 0x03]));
});

after(async () => {
	await rm(repo, { recursive: true, force: true });
});

test("a CRLF checkout with one line changed shows one line changed", async (t) => {
	/*
	 * Git for Windows checks out with CRLF by default. The committed side was read as stored — LF —
	 * so against the CRLF file on disk every line differed, and a one-line edit was shown as the
	 * whole file rewritten. `.gitattributes` gives the same checkout on any platform.
	 */
	const crlf = await mkdtemp(join(tmpdir(), "lyra-diff-crlf-"));
	t.after(() => rm(crlf, { recursive: true, force: true }));
	await exec("git", ["init", "-q"], { cwd: crlf });
	await exec("git", ["config", "user.email", "t@example.com"], { cwd: crlf });
	await exec("git", ["config", "user.name", "t"], { cwd: crlf });
	await writeFile(join(crlf, ".gitattributes"), "*.txt text eol=crlf\n");
	await writeFile(join(crlf, "notes.txt"), "one\r\ntwo\r\nthree\r\nfour\r\n");
	await exec("git", ["add", "-A"], { cwd: crlf });
	await exec("git", ["commit", "-qm", "seed"], { cwd: crlf });
	await writeFile(join(crlf, "notes.txt"), "one\r\nTWO\r\nthree\r\nfour\r\n");

	const diff = await collectWorkspaceDiff(crlf);
	const notes = diff.files.find((file) => file.path === "notes.txt");
	assert.ok(notes, JSON.stringify(diff.files.map((file) => file.path)));
	assert.equal(notes.added, 1, JSON.stringify(notes));
	assert.equal(notes.removed, 1, JSON.stringify(notes));
});

test("every changed file is listed, once, sorted by path", async () => {
	const diff = await collectWorkspaceDiff(repo);
	assert.deepEqual(
		diff.files.map((f) => f.path),
		["edited.txt", "fresh.txt", "gone.txt", "picture.png"],
	);
});

test("a modification is counted from its own diff", async () => {
	const diff = await collectWorkspaceDiff(repo);
	const edited = diff.files.find((f) => f.path === "edited.txt");
	assert.equal(edited?.status, "modified");
	assert.equal(edited?.added, 2);
	assert.equal(edited?.removed, 0);
	assert.ok((edited?.hunks.length ?? 0) > 0, "and has something to show");
});

test("an untracked file is entirely new", async () => {
	const diff = await collectWorkspaceDiff(repo);
	const fresh = diff.files.find((f) => f.path === "fresh.txt");
	assert.equal(fresh?.status, "untracked");
	assert.equal(fresh?.added, 3);
	assert.equal(fresh?.removed, 0);
});

test("a deleted file is entirely gone", async () => {
	const diff = await collectWorkspaceDiff(repo);
	const gone = diff.files.find((f) => f.path === "gone.txt");
	assert.equal(gone?.status, "deleted");
	assert.equal(gone?.added, 0);
	assert.equal(gone?.removed, 1);
});

test("an image is listed as binary rather than diffed as text", async () => {
	const diff = await collectWorkspaceDiff(repo);
	const picture = diff.files.find((f) => f.path === "picture.png");
	assert.equal(picture?.binary, true);
	assert.equal(picture?.added, 0);
	assert.equal(picture?.removed, 0);
	assert.deepEqual(picture?.hunks, []);
	assert.equal(picture?.bytes, 7, "its size is the working copy's");
});

test("the totals are the sum of the files", async () => {
	const diff = await collectWorkspaceDiff(repo);
	const added = diff.files.reduce((sum, f) => sum + f.added, 0);
	const removed = diff.files.reduce((sum, f) => sum + f.removed, 0);
	assert.equal(diff.added, added);
	assert.equal(diff.removed, removed);
	assert.equal(diff.branch, await currentBranch());
});

test("a directory that is not a repository answers empty rather than throwing", async () => {
	const plain = await mkdtemp(join(tmpdir(), "lyra-plain-"));
	try {
		assert.deepEqual(await collectWorkspaceDiff(plain), { files: [], added: 0, removed: 0, branch: null });
	} finally {
		await rm(plain, { recursive: true, force: true });
	}
});

test("what is staged is what diffRefs reports against the index", async () => {
	await exec("git", ["add", "edited.txt"], { cwd: repo });
	try {
		const staged = await diffRefs(repo, "HEAD", null);
		assert.deepEqual(
			staged.files.map((f) => f.path),
			["edited.txt"],
		);
		assert.equal(staged.files[0].added, 2);
		assert.equal(staged.added, 2);
	} finally {
		await exec("git", ["restore", "--staged", "edited.txt"], { cwd: repo });
	}
});

test("a commit's own diff is the change it made", async () => {
	const before = await exec("git", ["rev-parse", "HEAD"], { cwd: repo }).then((r) => r.stdout.trim());
	await writeFile(join(repo, "kept.txt"), "a\nb\nc\nd\n");
	await exec("git", ["add", "kept.txt"], { cwd: repo });
	await exec("git", ["commit", "-qm", "one more line"], { cwd: repo });
	try {
		const diff = await diffRefs(repo, before, "HEAD");
		assert.deepEqual(
			diff.files.map((f) => f.path),
			["kept.txt"],
		);
		assert.equal(diff.added, 1);
		assert.equal(diff.removed, 0);
	} finally {
		await exec("git", ["reset", "-q", "--hard", before], { cwd: repo });
		// The reset takes the working-tree changes with it; put them back for anything after this.
		await writeFile(join(repo, "edited.txt"), "one\ntwo\nthree\nfour\n");
		await unlink(join(repo, "gone.txt"));
		await writeFile(join(repo, "picture.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x01, 0x02, 0x03]));
	}
});

async function currentBranch(): Promise<string> {
	const { stdout } = await exec("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: repo });
	return stdout.trim();
}

test("unstaged additions compare with the index after a new file was staged", async () => {
	const path = "staged-new.txt";
	await writeFile(join(repo, path), "one\ntwo\nthree\n");
	await exec("git", ["add", "--", path], { cwd: repo });
	await writeFile(join(repo, path), "one\nchanged\nthree\n");
	try {
		const all = await collectWorkspaceDiff(repo);
		assert.equal(all.files.find((file) => file.path === path)?.added, 3);
		const unstaged = await collectWorkspaceDiff(repo, "index");
		const file = unstaged.files.find((entry) => entry.path === path);
		assert.equal(file?.status, "modified");
		assert.equal(file?.added, 1);
		assert.equal(file?.removed, 1);
		assert.deepEqual(file?.hunks.flatMap((hunk) => hunk.lines.filter((line) => line.type === "remove").map((line) => line.text)), ["two"]);
		await exec("git", ["add", "--", path], { cwd: repo });
		assert.ok(!(await collectWorkspaceDiff(repo, "index")).files.some((entry) => entry.path === path));
	} finally {
		await exec("git", ["restore", "--staged", "--", path], { cwd: repo });
		await unlink(join(repo, path));
	}
});
