/**
 * The read boundary, as one rule with several doors into it.
 *
 * There used to be two rules. The file tools refused anything outside the workspace; `bash` was
 * governed by a sandbox that denies writes and says nothing about reads, behind a read-only table
 * that skips the approval path entirely. So the same question — may this file be read — had
 * opposite answers depending on which tool asked it, and `cat` was the answer that always won.
 *
 * These tests are mostly about that asymmetry: every one of them that names both a file tool and a
 * shell command is checking that the two agree.
 */

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { assessRead, commandReadTargets, readGrantRoot, toAbsolute } from "../src/tools/read-access.ts";
import { bashTool, isReadOnlyCommand } from "../src/tools/bash.ts";
import { readTool } from "../src/tools/read.ts";
import { lsTool } from "../src/tools/ls.ts";
import { grepTool } from "../src/tools/grep.ts";
import { globTool } from "../src/tools/glob.ts";
import type { ApprovalRequest, ToolContext } from "../src/types.ts";

const CWD = "/tmp/ws" === tmpdir() ? "/workspace" : join(tmpdir(), "..", "not-a-temp-workspace");
const HOME = homedir();

/** A workspace that is not under a temp root, because temp roots are readable by design. */
const WS = join(HOME, ".lyra-test-ws");
const OUTSIDE = join(HOME, ".lyra-test-outside");

function ctxFor(cwd: string, approvals?: { decisions: ("once" | "always" | "reject")[]; seen: ApprovalRequest[] }): ToolContext {
	return {
		cwd,
		sessionId: "read-access",
		state: new Map(),
		requestApproval: approvals
			? async (request) => {
					approvals.seen.push(request);
					return approvals.decisions.shift() ?? "reject";
				}
			: undefined,
	} as ToolContext;
}

function textOf(result: { content: { type: string; text?: string }[] }): string {
	return result.content.map((part) => (part.type === "text" ? (part.text ?? "") : "")).join("\n");
}

/** Only the reads. `git commit` reaching the *command* approval is existing behaviour, not this. */
function readsAsked(seen: ApprovalRequest[]): ApprovalRequest[] {
	return seen.filter((request) => request.kind === "read");
}

/**
 * A real directory to be the workspace, because a command actually runs in it.
 *
 * Under home rather than a temp root: `assessRead` allows the temp areas, so a workspace there
 * would make every "outside" path in these tests readable and the assertions vacuous.
 */
async function workspace(t: { after(fn: () => unknown): void }): Promise<string> {
	const dir = await mkdtemp(join(HOME, ".lyra-test-ws-"));
	t.after(() => rm(dir, { recursive: true, force: true }));
	return dir;
}

// ---------------------------------------------------------------- the judgement

test("the workspace, scratch and the temp areas are readable without asking", () => {
	assert.equal(assessRead(join(WS, "src/index.ts"), WS).decision, "allow");
	assert.equal(assessRead(WS, WS).decision, "allow");
	assert.equal(assessRead(join(tmpdir(), "build.log"), WS).decision, "allow");
	assert.equal(assessRead("/tmp/build.log", WS).decision, "allow");
});

test("the directories a toolchain reads are not somebody's other project", () => {
	for (const path of ["/usr/bin/node", "/etc/hosts", "/bin/sh", "/opt/homebrew/bin/pnpm", "/Library/Fonts"]) {
		assert.equal(assessRead(path, WS).decision, "allow", path);
	}
});

test("anything else outside the workspace is a question, granted as a tree", () => {
	const verdict = assessRead(join(OUTSIDE, "src/app.ts"), WS);
	assert.equal(verdict.decision, "ask");
	assert.equal(verdict.decision === "ask" && verdict.scope, "tree");
	assert.match(verdict.decision === "ask" ? verdict.reason : "", /项目之外/);
});

test("a credential is a question wherever it lives, and is granted as itself", () => {
	for (const path of [
		join(HOME, ".ssh/id_ed25519"),
		join(HOME, ".lyra/vault.key"),
		join(HOME, ".lyra/credentials.json"),
		join(HOME, ".aws/credentials"),
		join(HOME, ".netrc"),
	]) {
		const verdict = assessRead(path, WS);
		assert.equal(verdict.decision, "ask", path);
		assert.equal(verdict.decision === "ask" && verdict.scope, "file", path);
	}
});

test("a credential inside the workspace is still a credential", () => {
	/*
	 * Judged before the workspace, deliberately. A key is not damaged by being read, it is spent,
	 * and "it happened to be in the project" is not a reason to hand one over unasked.
	 */
	const verdict = assessRead(join(WS, ".ssh/id_rsa"), WS);
	assert.equal(verdict.decision, "ask");
	assert.equal(verdict.decision === "ask" && verdict.scope, "file");
});

test("a file the user attached is theirs to have attached", () => {
	const attached = join(OUTSIDE, "notes.md");
	assert.equal(assessRead(attached, WS, { allowedPaths: new Set([attached]) }).decision, "allow");
	// Including a key: dragging one in is an explicit act by the person the rule protects.
	const key = join(HOME, ".ssh/id_ed25519");
	assert.equal(assessRead(key, WS, { allowedPaths: new Set([key]) }).decision, "allow");
	// But only the file named, not its neighbours.
	assert.equal(assessRead(join(OUTSIDE, "other.md"), WS, { allowedPaths: new Set([attached]) }).decision, "ask");
});

test("installed skill files are readable only when the caller opted in", () => {
	const home = join(HOME, ".lyra");
	const loose = join(home, "skills/check/SKILL.md");
	const plugin = join(home, "plugins/waza/skills/check/references/modes.md");
	for (const path of [loose, plugin]) {
		assert.equal(assessRead(path, WS, { lyraHomeDir: home, allowSkillReads: true }).decision, "allow", path);
		assert.equal(assessRead(path, WS, { lyraHomeDir: home }).decision, "ask", path);
	}
	// Settings and transcripts stay shut either way.
	assert.equal(assessRead(join(home, "settings.json"), WS, { lyraHomeDir: home, allowSkillReads: true }).decision, "ask");
});

// ---------------------------------------------------------------- what a grant covers

test("a grant walks up to the repository, so approving once covers the project", async (t) => {
	const repo = await mkdtemp(join(HOME, ".lyra-test-repo-"));
	t.after(() => rm(repo, { recursive: true, force: true }));
	await mkdir(join(repo, ".git"), { recursive: true });
	await mkdir(join(repo, "src/deep/deeper"), { recursive: true });

	const exists = (path: string) => path === join(repo, ".git");
	assert.equal(readGrantRoot(join(repo, "src/deep/deeper/a.ts"), false, exists), repo);
	assert.equal(readGrantRoot(join(repo, "src"), true, exists), repo);
});

test("the home directory and the filesystem root are never granted", () => {
	/*
	 * Replaying real sessions produced `/Users/<me>` 271 times and `/` 148 times as the directory
	 * an approval would have covered — a file sitting directly in either has it as its parent.
	 * "Always allow" on one of those is the whole machine, from a click meant for one file.
	 */
	const never = () => false;
	assert.equal(readGrantRoot(join(HOME, ".zshrc"), false, never), join(HOME, ".zshrc"));
	assert.equal(readGrantRoot("/vmlinuz", false, never), "/vmlinuz");
	// A directory named directly under home is itself a reasonable grant.
	assert.equal(readGrantRoot(join(HOME, "Documents"), true, never), join(HOME, "Documents"));
});

// ---------------------------------------------------------------- reading a command line

test("a command's paths are found, and the program name is not one of them", () => {
	const targets = commandReadTargets(`cat ${HOME}/.ssh/id_ed25519`, WS);
	assert.deepEqual(targets, [join(HOME, ".ssh/id_ed25519")]);
	assert.equal(commandReadTargets("pwd", WS).length, 0);
});

test("~ and .. are resolved, because that is how a boundary is left", () => {
	assert.ok(commandReadTargets("cat ~/.netrc", WS).includes(join(HOME, ".netrc")));
	assert.ok(commandReadTargets("cat ../sibling/key.pem", join(HOME, "a/b")).includes(join(HOME, "a/sibling/key.pem")));
});

test("a redirection target is written, not read", () => {
	/*
	 * `echo hi > ~/notes.txt` reads nothing. Judging it here asked "may this be read?" about a file
	 * being created — and answered before the sandbox got its chance to refuse the write, so the
	 * layer that actually enforces the boundary stopped being the layer under test.
	 */
	/*
	 * Asserted as "the target is absent" rather than "nothing was found": a word like `hi` also
	 * resolves to a path, harmlessly inside the workspace. That is by design — see the note on
	 * `commandReadTargets` — and only the words that can leave the workspace matter here.
	 */
	assert.ok(!commandReadTargets(`echo hi > ${HOME}/notes.txt`, WS).includes(join(HOME, "notes.txt")));
	assert.ok(!commandReadTargets(`echo hi >> ${HOME}/notes.txt`, WS).includes(join(HOME, "notes.txt")));
	assert.ok(!commandReadTargets(`make 2> ${HOME}/err.log`, WS).includes(join(HOME, "err.log")));
	// But reading from one is a read.
	assert.ok(commandReadTargets(`sort < ${HOME}/notes.txt`, WS).includes(join(HOME, "notes.txt")));
});

test("words a shell would rewrite are not guessed at", () => {
	// Guessing produces both false grants and false prompts; neither is worth it.
	const outside = (command: string) => commandReadTargets(command, WS).filter((p) => !p.replace(/\\/g, "/").startsWith(`${WS.replace(/\\/g, "/")}/`));
	assert.deepEqual(outside("cat $SECRETS/key"), []);
	assert.deepEqual(outside("cat ~/.ssh/*"), []);
	assert.deepEqual(outside("cat `which node`"), []);
});

test("a here-document's body is data, not a list of paths", () => {
	const command = `python3 - <<'EOF'\nimport os\nopen('${HOME}/.ssh/id_ed25519').read()\nprint("/dist and /out")\nEOF`;
	assert.deepEqual(commandReadTargets(command, WS).filter((p) => !p.startsWith(`${WS}/`)), []);
	// And an unterminated one does not swallow the rest of the line it started on.
	assert.ok(commandReadTargets(`cat ${HOME}/a.txt && python3 - <<'EOF'\nbody\n`, WS).includes(join(HOME, "a.txt")));
});

test("a script passed inline is not a path however long it is", () => {
	const script = `line one\n${"x".repeat(500)}`;
	assert.equal(commandReadTargets(`python3 -c "${script}"`, WS).length, 0);
});

test("options are not paths", () => {
	assert.equal(commandReadTargets("ls -la --color=auto", WS).length, 0);
});

// ------------------------------------------------- the repair: the read-only table no longer wins

test("the read-only table still says cat is read-only — that was never the bug", () => {
	assert.equal(isReadOnlyCommand(`cat ${HOME}/.ssh/id_ed25519`), true);
});

test("a credential read through bash asks, despite the read-only table", async (t) => {
	/*
	 * The heart of it. `bash.ts` documents `isReadOnlyCommand` as the one path around the whole
	 * risk classifier: a command on that table never reaches `requestApproval`, in any permission
	 * mode. `cat` is on it. So `SECRET_PATH` — the credential rule the 2026-09-12 audit raised as
	 * H2 and the fix log marked done — was judging commands that could never arrive.
	 *
	 * `worthAsking` skips paths that do not exist on disk to save noise. In CI (especially a clean
	 * runner or Linux arm64) `~/.ssh/id_ed25519` may not exist unless created for the test.
	 */
	const sshDir = join(HOME, ".ssh");
	const keyFile = join(sshDir, "id_ed25519");
	let created = false;
	if (!existsSync(keyFile)) {
		await mkdir(sshDir, { recursive: true });
		await writeFile(keyFile, "-----BEGIN OPENSSH PRIVATE KEY-----\nfake\n-----END OPENSSH PRIVATE KEY-----\n", "utf8");
		created = true;
	}
	t.after(async () => {
		if (created) await rm(keyFile, { force: true });
	});

	const approvals = { decisions: ["reject" as const], seen: [] as ApprovalRequest[] };
	const result = await bashTool.execute({ command: `cat ${keyFile}` } as never, ctxFor(WS, approvals));

	assert.equal(approvals.seen.length, 1, "it must be asked about");
	assert.equal(approvals.seen[0].kind, "read");
	assert.match(approvals.seen[0].title, /密钥/);
	assert.equal(approvals.seen[0].subject, `read:${keyFile}`, "granted as the key alone");
	assert.equal(result.isError, true);
	assert.doesNotMatch(textOf(result), /BEGIN .* PRIVATE KEY/, "and nothing may come back");
});

test("the file tool and the shell now give the same answer for the same path", async (t) => {
	const ws = await workspace(t);
	const outside = await mkdtemp(join(HOME, ".lyra-test-outside-"));
	t.after(() => rm(outside, { recursive: true, force: true }));
	const file = join(outside, "secret.txt");
	await writeFile(file, "SECRET_FROM_OTHER_PROJECT\n", "utf8");

	// Refused by both, when refused.
	const viaRead = await readTool.execute({ path: file } as never, ctxFor(ws, { decisions: ["reject"], seen: [] }));
	const viaBash = await bashTool.execute({ command: `cat ${file}` } as never, ctxFor(ws, { decisions: ["reject"], seen: [] }));
	assert.equal(viaRead.isError, true);
	assert.equal(viaBash.isError, true);
	assert.doesNotMatch(textOf(viaBash), /SECRET_FROM_OTHER_PROJECT/, "the command must not have run");

	// Allowed by both, when approved.
	const okRead = await readTool.execute({ path: file } as never, ctxFor(ws, { decisions: ["once"], seen: [] }));
	const okBash = await bashTool.execute({ command: `cat ${file}` } as never, ctxFor(ws, { decisions: ["once"], seen: [] }));
	assert.equal(okRead.isError, undefined);
	assert.match(textOf(okRead), /SECRET_FROM_OTHER_PROJECT/);
	assert.match(textOf(okBash), /SECRET_FROM_OTHER_PROJECT/);
});

test("one question per grant, not per path", async (t) => {
	const ws = await workspace(t);
	const outside = await mkdtemp(join(HOME, ".lyra-test-multi-"));
	t.after(() => rm(outside, { recursive: true, force: true }));
	await writeFile(join(outside, "a.txt"), "a", "utf8");
	await writeFile(join(outside, "b.txt"), "b", "utf8");

	const approvals = { decisions: ["once" as const, "once" as const], seen: [] as ApprovalRequest[] };
	await bashTool.execute({ command: `cat ${join(outside, "a.txt")} ${join(outside, "b.txt")}` } as never, ctxFor(ws, approvals));
	assert.equal(readsAsked(approvals.seen).length, 1, "两个文件同属一个授权范围，只该问一次");
});

// ---------------------------------------------------------------- every reading tool, same door

test("ls, grep and glob are judged the same way read is", async (t) => {
	const outside = await mkdtemp(join(HOME, ".lyra-test-tools-"));
	t.after(() => rm(outside, { recursive: true, force: true }));
	await writeFile(join(outside, "app.ts"), "const needle = 1;\n", "utf8");

	for (const [name, run] of [
		["ls", () => lsTool.execute({ path: outside } as never, ctxFor(WS, { decisions: ["reject"], seen: [] }))],
		["grep", () => grepTool.execute({ pattern: "needle", path: outside } as never, ctxFor(WS, { decisions: ["reject"], seen: [] }))],
		["glob", () => globTool.execute({ pattern: "**/*.ts", path: outside } as never, ctxFor(WS, { decisions: ["reject"], seen: [] }))],
	] as const) {
		const refused = await run();
		assert.equal(refused.isError, true, name);
		assert.doesNotMatch(textOf(refused), /needle|app\.ts/, `${name} must not leak what it refused to read`);
	}

	const listed = await lsTool.execute({ path: outside } as never, ctxFor(WS, { decisions: ["once"], seen: [] }));
	assert.equal(listed.isError, undefined);
	assert.match(textOf(listed), /app\.ts/);
});

test("with nobody to ask, the boundary holds rather than opens", async (t) => {
	/*
	 * A host with no approval channel — the CLI, a test, a sub-agent given no way to ask — has not
	 * been given permission by anyone. ADR-0004 already settled which way that fails.
	 */
	const outside = await mkdtemp(join(HOME, ".lyra-test-noask-"));
	t.after(() => rm(outside, { recursive: true, force: true }));
	const file = join(outside, "x.txt");
	await writeFile(file, "nope", "utf8");

	const result = await readTool.execute({ path: file } as never, ctxFor(WS));
	assert.equal(result.isError, true);
	assert.match(textOf(result), /没有可以询问的人/);
	assert.doesNotMatch(textOf(result), /nope/);
});

// ---------------------------------------------------------------- the noise budget

test("ordinary work inside the workspace asks nothing", async (t) => {
	/*
	 * The half of this that a safeguard fails by. A prompt that fires on `ls src` is one people
	 * learn to click through, and then it is not a safeguard. Measured against 303 real sessions
	 * and 30,173 tool calls, the median session asks zero times; these are the shapes that has to
	 * keep holding for.
	 */
	const ws = await workspace(t);
	await mkdir(join(ws, "src"), { recursive: true });
	await writeFile(join(ws, "package.json"), "{}\n", "utf8");
	await writeFile(join(ws, "src/index.ts"), "export const a = 1;\n", "utf8");

	const approvals = { decisions: [] as never[], seen: [] as ApprovalRequest[] };
	const ctx = ctxFor(ws, approvals);
	for (const command of [
		"ls src",
		"cat package.json",
		"git status",
		"git commit -m 'fix: something with / in it'",
		"pnpm install",
		"node --version",
		"grep -r needle src",
		"echo done > build.log",
		"ls /usr/bin",
		"cat /etc/hosts",
		`ls ${tmpdir()}`,
		"ssh user@host echo hi",
		"curl https://example.com/api/auth",
	]) {
		await bashTool.execute({ command, timeout: 5000 } as never, ctx);
		assert.equal(readsAsked(approvals.seen).length, 0, `不该问：${command}`);
	}

	await readTool.execute({ path: "src/index.ts" } as never, ctx);
	await lsTool.execute({ path: "src" } as never, ctx);
	await grepTool.execute({ pattern: "a", path: "src" } as never, ctx);
	assert.equal(readsAsked(approvals.seen).length, 0, "工作区内的读一次都不该问");
});

test("a path that is not there is not worth a question", async () => {
	/*
	 * Most of what looks like a path on a command line is not one — `/api/auth` out of a URL, a
	 * word from a commit message. Asking about a file that cannot be opened buys no safety and
	 * costs a prompt, and the tool's own "not found" is the honest answer.
	 */
	const approvals = { decisions: [] as never[], seen: [] as ApprovalRequest[] };
	const result = await readTool.execute({ path: join(HOME, ".lyra-test-absent-xyz/nope.txt") } as never, ctxFor(WS, approvals));
	assert.equal(approvals.seen.length, 0);
	assert.equal(result.isError, true);
	assert.match(textOf(result), /File not found/);
});

test("toAbsolute leaves a workspace-relative path where it belongs", () => {
	assert.equal(toAbsolute(WS, "src/a.ts"), join(WS, "src/a.ts"));
	assert.equal(toAbsolute(WS, "~/x"), join(HOME, "x"));
	assert.equal(toAbsolute(WS, "/etc/hosts"), resolve("/etc/hosts"));
	assert.ok(CWD.length > 0);
});
