import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { listReadableFiles, readReadableFile, resolveReadablePath } from "../electron/file-read-service.ts";

test("phone file reads stay read-only and share the desktop text rules", async () => {
	const root = await mkdtemp(join(tmpdir(), "lyra-file-read-"));
	try {
		await mkdir(join(root, "src"));
		await writeFile(join(root, "b.txt"), "second\n");
		await writeFile(join(root, "a.txt"), "first\n");

		const entries = await listReadableFiles(root);
		assert.deepEqual(entries.map((entry) => entry.name), ["src", "a.txt", "b.txt"]);
		assert.equal(entries[1]?.size, 6);

		const contents = await readReadableFile(join(root, "a.txt"), true);
		assert.equal(contents?.text, "first\n");
		assert.equal(contents?.readOnly, true);
		assert.equal(contents?.truncated, false);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("a refused path never reaches the filesystem reader", async () => {
	assert.deepEqual(await listReadableFiles(null), []);
	assert.equal(await readReadableFile(null, true), null);
});

test("phone file reads cannot follow a project link into a private directory", async () => {
	const root = await mkdtemp(join(tmpdir(), "lyra-phone-boundary-"));
	try {
		const project = join(root, "project");
		const privateDir = join(root, "private");
		await Promise.all([mkdir(project), mkdir(privateDir)]);
		await writeFile(join(privateDir, "secret.txt"), "private-token-fixture");
		await symlink(privateDir, join(project, "outside"), "junction");
		const target = await resolveReadablePath(join(project, "outside", "secret.txt"), [project]);
		assert.equal(await readReadableFile(target, true), null);
		assert.deepEqual(await listReadableFiles(await resolveReadablePath(join(project, "outside"), [project])), []);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("phone file boundaries permit contained links and projects opened through a link", async () => {
	const root = await mkdtemp(join(tmpdir(), "lyra-phone-links-"));
	try {
		const project = join(root, "project");
		const source = join(project, "src");
		const opened = join(root, "opened");
		await mkdir(source, { recursive: true });
		await writeFile(join(source, "visible.txt"), "visible");
		await symlink(source, join(project, "linked-src"), "junction");
		await symlink(project, opened, "junction");
		for (const target of [join(opened, "src", "visible.txt"), join(opened, "linked-src", "visible.txt")]) {
			const allowed = await resolveReadablePath(target, [opened]);
			assert.equal((await readReadableFile(allowed, true))?.text, "visible");
		}
		assert.equal(await resolveReadablePath(join(project, "missing"), [project]), null);
		assert.equal(await resolveReadablePath(join(root, "outside.txt"), [project]), null);
		assert.equal(await resolveReadablePath("src/visible.txt", [project]), null);
		assert.equal(await resolveReadablePath(join(project, "src", "visible.txt"), ["."]), null);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("a phone can list a linked project and read the exact path returned by each listing", async () => {
	const root = await mkdtemp(join(tmpdir(), "lyra-phone-browse-link-"));
	try {
		const physical = join(root, "physical");
		const opened = join(root, "opened");
		await mkdir(join(physical, "src"), { recursive: true });
		await writeFile(join(physical, "root.txt"), "root contents");
		await writeFile(join(physical, "src", "source.ts"), "export const value = 1;");
		await symlink(physical, opened, "junction");

		const entries = await listReadableFiles(await resolveReadablePath(opened, [opened]));
		const rootFile = entries.find((entry) => entry.name === "root.txt");
		assert.ok(rootFile);
		assert.equal((await readReadableFile(await resolveReadablePath(rootFile.path, [opened]), true))?.text, "root contents");

		const directory = entries.find((entry) => entry.name === "src");
		assert.ok(directory?.isDirectory);
		const children = await listReadableFiles(await resolveReadablePath(directory.path, [opened]));
		assert.equal(children.length, 1);
		const child = children[0];
		assert.equal(child.name, "source.ts");
		assert.equal((await readReadableFile(await resolveReadablePath(child.path, [opened]), true))?.text, "export const value = 1;");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("scratch roots and worktree roots permit reading files within them while forbidding traversal", async () => {
	const root = await mkdtemp(join(tmpdir(), "lyra-scratch-roots-"));
	try {
		const project = join(root, "project");
		const scratch = join(root, "scratch");
		const worktrees = join(root, "worktrees");
		const outside = join(root, "outside");

		await Promise.all([
			mkdir(join(project, "src"), { recursive: true }),
			mkdir(join(scratch, "session-1"), { recursive: true }),
			mkdir(join(worktrees, "repo-feat"), { recursive: true }),
			mkdir(outside, { recursive: true }),
		]);

		await writeFile(join(project, "src", "index.ts"), "project file");
		await writeFile(join(scratch, "session-1", "intro.md"), "# Scratch Note");
		await writeFile(join(worktrees, "repo-feat", "feature.ts"), "worktree code");
		await writeFile(join(outside, "secret.txt"), "secret");

		const allowedRoots = [project, scratch, worktrees];

		// Legitimate scratch and worktree files resolve and read correctly
		const resolvedScratch = await resolveReadablePath(join(scratch, "session-1", "intro.md"), allowedRoots);
		assert.ok(resolvedScratch);
		const scratchContent = await readReadableFile(resolvedScratch, false);
		assert.equal(scratchContent?.text, "# Scratch Note");

		const resolvedWorktree = await resolveReadablePath(join(worktrees, "repo-feat", "feature.ts"), allowedRoots);
		assert.ok(resolvedWorktree);
		const worktreeContent = await readReadableFile(resolvedWorktree, false);
		assert.equal(worktreeContent?.text, "worktree code");

		// Traversal outside allowed roots is forbidden
		const resolvedOutside = await resolveReadablePath(join(outside, "secret.txt"), allowedRoots);
		assert.equal(resolvedOutside, null);

		const resolvedTraverse = await resolveReadablePath(join(scratch, "..", "outside", "secret.txt"), allowedRoots);
		assert.equal(resolvedTraverse, null);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
