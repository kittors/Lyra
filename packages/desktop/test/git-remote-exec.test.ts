/**
 * The three ways a call to a remote can end, and why they must not look alike.
 *
 * The panel disables its other sync buttons while one of these is in flight, so an operation with
 * no bound is a panel someone is stuck inside. Bounding it is only half of it: a timeout has to be
 * *recognisable* afterwards, because `execFile` kills the process and git therefore leaves nothing
 * on stderr — the generic path would put `Command failed: git fetch --prune` in the red bar, which
 * names the command and not the problem.
 *
 * The hang is produced by a server that accepts the connection and then says nothing, which is what
 * a host behind a dead proxy does. A refused connection fails in milliseconds and would prove
 * nothing about the timeout.
 */

import assert from "node:assert/strict";
import { createServer, type Server, type Socket } from "node:net";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { after, before, test } from "node:test";

import { runRemote } from "../electron/git-exec.ts";
import { explainGitFailure } from "../electron/git-errors.ts";

const execFileAsync = promisify(execFile);

let silent: Server;
let silentPort = 0;
/** Held open so the sockets can be destroyed at the end; git leaves them connected otherwise. */
const held: Socket[] = [];
let dir = "";

before(async () => {
	silent = createServer((socket) => {
		held.push(socket);
		// Deliberately no reply, and no close. This is the shape of the failure that hangs.
	});
	await new Promise<void>((resolve) => silent.listen(0, "127.0.0.1", resolve));
	const address = silent.address();
	silentPort = typeof address === "object" && address ? address.port : 0;

	dir = await mkdtemp(join(tmpdir(), "lyra-remote-"));
	await execFileAsync("git", ["init", "-q", "-b", "main", dir]);
});

after(async () => {
	for (const socket of held) socket.destroy();
	await new Promise<void>((resolve) => silent.close(() => resolve()));
	await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

const silentUrl = () => `http://127.0.0.1:${silentPort}/x.git`;

test("a hang is cut off, and says so", async () => {
	const started = Date.now();
	const result = await runRemote(dir, ["ls-remote", silentUrl()], { timeoutMs: 700 });
	const elapsed = Date.now() - started;

	assert.equal(result.ok, false);
	assert.equal(result.timedOut, true, "a killed process leaves no stderr; it has to be recognised by `killed`");
	assert.equal(result.error, "连接远端超时");
	assert.ok(!result.cancelled, "a timeout is not a cancellation — one is silent and this one is not");
	// Generously bounded: the point is that it ended near the deadline rather than at TCP's.
	assert.ok(elapsed < 6000, `took ${elapsed}ms, so the timeout did not apply`);
});

test("a cancellation is silent", async () => {
	const controller = new AbortController();
	setTimeout(() => controller.abort(), 200);
	const result = await runRemote(dir, ["ls-remote", silentUrl()], { timeoutMs: 30_000, signal: controller.signal });

	assert.equal(result.ok, false);
	assert.equal(result.cancelled, true);
	/*
	 * An aborted child is also a killed child, so asking `killed` first would report every
	 * cancellation as a timeout — and put a red bar on screen for something the user just did.
	 */
	assert.ok(!result.timedOut, "a cancellation must not be reported as a timeout");
	assert.equal(result.error, undefined, "nothing to say about a stop someone asked for");
});

test("a refusal comes back as a reason, not as the command that failed", async () => {
	// Port 9 discards; nothing listens, so the connection is refused immediately.
	const result = await runRemote(dir, ["ls-remote", "http://127.0.0.1:9/x.git"], { timeoutMs: 10_000 });
	assert.equal(result.ok, false);
	assert.ok(!result.timedOut);
	assert.equal(result.error, "连不上远端。");
});

test("a remote that needs a login fails immediately rather than waiting for one", async () => {
	/*
	 * Git and its credential helper have separate prompt controls. Worth pinning that this is *fast*:
	 * on Windows, GCM otherwise opens a dialog that can outlive the git process killed by the timeout.
	 */
	const { createServer: createHttpServer } = await import("node:http");
	const server = createHttpServer((_req, res) => {
		res.writeHead(401, { "www-authenticate": 'Basic realm="git"' });
		res.end("no");
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	const port = typeof address === "object" && address ? address.port : 0;

	const started = Date.now();
	const result = await runRemote(dir, ["ls-remote", `http://127.0.0.1:${port}/x.git`], { timeoutMs: 10_000 });
	const elapsed = Date.now() - started;
	await new Promise<void>((resolve) => server.close(() => resolve()));

	assert.equal(result.ok, false);
	assert.ok(!result.timedOut, `it hung instead of failing (${elapsed}ms)`);
	assert.equal(result.error, "远端需要登录，这里无法输入。请先在终端里配置一次凭据。");
});

test("a call that works reports plainly", async () => {
	const result = await runRemote(dir, ["--version"], { timeoutMs: 5_000 });
	assert.deepEqual(result, { ok: true });
});

// ---------------------------------------------------------------------------
// The wording
// ---------------------------------------------------------------------------

test("git's advice block becomes one sentence someone can act on", () => {
	// What `pull --ff-only` actually prints when the branch has moved on both sides.
	const stderr = [
		"hint: Diverging branches can't be fast-forwarded, you need to either:",
		"hint:",
		"hint: \tgit merge --no-ff",
	].join("\n");
	assert.equal(explainGitFailure(stderr), "远端已分叉，无法快进。先手动合并或变基。");
});

test("a rejected push says what to do about it", () => {
	const stderr = [
		" ! [rejected]        main -> main (non-fast-forward)",
		"error: failed to push some refs to '../remote.git'",
		"hint: Updates were rejected because the tip of your current branch is behind",
	].join("\n");
	assert.equal(explainGitFailure(stderr), "远端有新的提交，先拉取再推送。");
});

test("no credentials and rejected credentials are different sentences", () => {
	/*
	 * They send you to different places: one means "set this up once", the other means "what you
	 * set up is wrong". Collapsing them is why `GIT_ASKPASS` is deliberately not set — pointing it
	 * at a helper that answers with nothing turns the first into the second.
	 */
	assert.equal(
		explainGitFailure("fatal: could not read Username for 'https://github.com': terminal prompts disabled"),
		"远端需要登录，这里无法输入。请先在终端里配置一次凭据。",
	);
	assert.equal(
		explainGitFailure("remote: Support for password authentication was removed.\nfatal: Authentication failed for 'x'"),
		"远端拒绝了凭据。",
	);
	assert.equal(explainGitFailure("git@github.com: Permission denied (publickey)."), "远端拒绝了凭据。");
});

test("no tracking information, which is what pull says with no upstream", () => {
	assert.equal(
		explainGitFailure("There is no tracking information for the current branch.\nPlease specify which branch"),
		"当前分支没有上游。",
	);
});

test("anything unrecognised is passed through rather than guessed at", () => {
	/*
	 * The fallback matters as much as the table. A confident Chinese sentence about the wrong cause
	 * sends someone looking in the wrong place; an untranslated English one can at least be searched
	 * for.
	 */
	const odd = "error: cannot lock ref 'refs/heads/main': is at 1234 but expected 5678";
	assert.equal(explainGitFailure(odd), odd);
});

test("a wall of output is cut to three lines, and silence still says something", () => {
	const long = Array.from({ length: 12 }, (_, i) => `line ${i}`).join("\n");
	assert.equal(explainGitFailure(long), "line 0\nline 1\nline 2");
	assert.equal(explainGitFailure("   \n  "), "操作失败");
});
