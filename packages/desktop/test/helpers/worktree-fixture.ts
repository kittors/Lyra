/**
 * A throwaway repository on `main` and a conversation's worktree cut from it, for the worktree tests.
 *
 * A helper rather than exports from one test file: importing a test file runs its tests a second time.
 */

import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { SessionMeta } from "@lyra/core";

const exec = promisify(execFile);
const made: string[] = [];

export async function cleanUpFixtures(): Promise<void> {
	for (const root of made.splice(0)) await rm(root, { recursive: true, force: true }).catch(() => {});
}

export async function sh(cwd: string, ...args: string[]): Promise<string> {
	return (await exec("git", args, { cwd })).stdout.trim();
}

export async function fixture(name = "wt"): Promise<{ root: string; repo: string; tree: string; meta: Pick<SessionMeta, "cwd" | "worktree"> }> {
	const root = await mkdtemp(join(tmpdir(), `lyra-${name}-`));
	made.push(root);
	const repo = join(root, "repo");
	await mkdir(repo, { recursive: true });
	await sh(repo, "init", "--initial-branch=main");
	// Windows runners check files out with CRLF (`core.autocrlf`), and the tests read files back byte for byte.
	await sh(repo, "config", "core.autocrlf", "false");
	await sh(repo, "config", "user.email", "test@example.com");
	await sh(repo, "config", "user.name", "Test");
	await writeFile(join(repo, "README.md"), "# repo\n");
	await sh(repo, "add", ".");
	await sh(repo, "commit", "-m", "init");
	const tree = join(root, "worktrees", "repo-12345678");
	await sh(repo, "worktree", "add", "-b", "lyra/session-12345678", tree, "main");
	return { root, repo, tree, meta: { cwd: tree, worktree: { project: repo, branch: "lyra/session-12345678", base: "main" } } };
}

export async function commitIn(dir: string, file: string, text: string, message = `edit ${file}`): Promise<void> {
	await writeFile(join(dir, file), text);
	await sh(dir, "add", file);
	await sh(dir, "commit", "-m", message);
}
