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
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { after, test } from "node:test";
import { assessRead, authorizeCommandReads, commandReadTargets, readGrantRoot, toAbsolute, windowsSpelling } from "../src/tools/read-access.ts";
import { bashTool, isReadOnlyCommand } from "../src/tools/bash.ts";
import { readTool } from "../src/tools/read.ts";
import { lsTool } from "../src/tools/ls.ts";
import { grepTool } from "../src/tools/grep.ts";
import { globTool } from "../src/tools/glob.ts";
import { home } from "../src/platform.ts";
import type { ApprovalRequest, ToolContext } from "../src/types.ts";

const CWD = "/tmp/ws" === tmpdir() ? "/workspace" : join(tmpdir(), "..", "not-a-temp-workspace");

/*
 * 这个文件里的家目录是借来的一间空屋，不是跑测试的那个人的家。
 *
 * 下面有一条测试要一把私钥摆在 `~/.ssh/id_ed25519`。它从前用的就是真家目录：机器上已经有钥匙，
 * 就直接拿开发者的真钥匙来测；没有，就现写一把假的，还可能顺手建出一个 `~/.ssh`，事后只删钥匙
 * 不删目录。前一种最糟——产品一回归，`cat` 真跑起来，那把真钥匙就进了断言信息和 CI 日志。
 *
 * `home()` 每次都现读 `os.homedir()`，换掉 `HOME`（Windows 上它认 `USERPROFILE`）代码就跟着换。
 * 可这间屋子不能开在临时目录里：临时区按设计就是可读的（`assessRead` 的 `tmpdir()` 和
 * `SYSTEM_ROOTS` 里的 `/tmp`、`/var/folders`），开在那里，每一条「项目之外要先问」的断言都会
 * 变成空话。所以它开在真家目录底下，是一个新建的空目录——这里建的一切都在它里面，跑完连它一起
 * 删掉；真家目录里原有的东西一样不读、不写。
 *
 * git 也要拦在这间屋子门口。「工作区里的日常操作一句都不问」那条会真的跑 `git commit`，而有人的
 * 家目录本身就是个仓库（放 dotfiles 的那种）——不设天花板，git 会一路往上找到它，把人家暂存着的
 * 改动提交掉。
 */
const HOME = await mkdtemp(join(homedir(), ".lyra-read-access-home-"));
const borrowed = ["HOME", "USERPROFILE", "GIT_CEILING_DIRECTORIES"] as const;
const saved = new Map(borrowed.map((key) => [key, process.env[key]]));
for (const key of borrowed) process.env[key] = HOME;
after(async () => {
	for (const [key, value] of saved) {
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
	await rm(HOME, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});
if (home() !== HOME) {
	await rm(HOME, { recursive: true, force: true });
	throw new Error(`the code under test sees ${home()} rather than the borrowed ${HOME}; refusing to run against a real home`);
}

/** A workspace that is not under a temp root, because temp roots are readable by design. */
const WS = join(HOME, ".lyra-test-ws");
const OUTSIDE = join(HOME, ".lyra-test-outside");

/**
 * A path as a model writes it for bash, which is the shell commands run in on Windows too (Git Bash).
 *
 * The scanner reads a command line the way bash does, and to bash an unquoted backslash escapes the
 * character after it: `cat C:\Users\me\.ssh\id_ed25519` names `C:Usersme.sshid_ed25519`, to the
 * shell and to the read boundary alike. Spliced in bare, every Windows path in these commands had
 * stopped being a path, and seven of these tests failed on windows-latest for it. Quoted, with
 * forward slashes — the same spelling as `sh()` in `sandbox-bash.test.ts`. What comes back from
 * `commandReadTargets` is resolved to the native form, so expectations stay `join(…)`.
 */
const sh = (path: string) => `'${path.replaceAll("\\", "/").replaceAll("'", "'\\''")}'`;

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
	const targets = commandReadTargets(`cat ${sh(join(HOME, ".ssh/id_ed25519"))}`, WS);
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
	assert.ok(!commandReadTargets(`echo hi > ${sh(join(HOME, "notes.txt"))}`, WS).includes(join(HOME, "notes.txt")));
	assert.ok(!commandReadTargets(`echo hi >> ${sh(join(HOME, "notes.txt"))}`, WS).includes(join(HOME, "notes.txt")));
	assert.ok(!commandReadTargets(`make 2> ${sh(join(HOME, "err.log"))}`, WS).includes(join(HOME, "err.log")));
	// But reading from one is a read.
	assert.ok(commandReadTargets(`sort < ${sh(join(HOME, "notes.txt"))}`, WS).includes(join(HOME, "notes.txt")));
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
	// Targets come back native: the delimiter word `EOF` resolves to `WS\EOF` on Windows, not `WS/EOF`.
	assert.deepEqual(commandReadTargets(command, WS).filter((p) => !p.startsWith(`${WS}${sep}`)), []);
	// And an unterminated one does not swallow the rest of the line it started on.
	assert.ok(commandReadTargets(`cat ${sh(join(HOME, "a.txt"))} && python3 - <<'EOF'\nbody\n`, WS).includes(join(HOME, "a.txt")));
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
	 * `worthAsking` skips paths that do not exist on disk to save noise, so the key has to be there.
	 * It is always one written here, into the borrowed home (see the top of the file): this used to
	 * test against whatever `~/.ssh/id_ed25519` the machine already had, which on a developer's
	 * laptop is their real key.
	 */
	const sshDir = join(HOME, ".ssh");
	const keyFile = join(sshDir, "id_ed25519");
	await mkdir(sshDir, { recursive: true });
	await writeFile(keyFile, "-----BEGIN OPENSSH PRIVATE KEY-----\nfake\n-----END OPENSSH PRIVATE KEY-----\n", "utf8");
	t.after(() => rm(sshDir, { recursive: true, force: true }));

	const approvals = { decisions: ["reject" as const], seen: [] as ApprovalRequest[] };
	const result = await bashTool.execute({ command: `cat ${sh(keyFile)}` } as never, ctxFor(WS, approvals));

	assert.equal(approvals.seen.length, 1, "it must be asked about");
	assert.equal(approvals.seen[0].kind, "read");
	assert.match(approvals.seen[0].title, /密钥/);
	assert.equal(approvals.seen[0].subject, `read:${keyFile}`, "granted as the key alone");
	assert.equal(result.isError, true);
	// Whether anything came back, not what: a failure message is no place for a key's contents.
	assert.ok(!/BEGIN .* PRIVATE KEY/.test(textOf(result)), "and nothing may come back");
});

test("the file tool and the shell now give the same answer for the same path", async (t) => {
	const ws = await workspace(t);
	const outside = await mkdtemp(join(HOME, ".lyra-test-outside-"));
	t.after(() => rm(outside, { recursive: true, force: true }));
	const file = join(outside, "secret.txt");
	await writeFile(file, "SECRET_FROM_OTHER_PROJECT\n", "utf8");

	// Refused by both, when refused.
	const viaRead = await readTool.execute({ path: file } as never, ctxFor(ws, { decisions: ["reject"], seen: [] }));
	const viaBash = await bashTool.execute({ command: `cat ${sh(file)}` } as never, ctxFor(ws, { decisions: ["reject"], seen: [] }));
	assert.equal(viaRead.isError, true);
	assert.equal(viaBash.isError, true);
	assert.doesNotMatch(textOf(viaBash), /SECRET_FROM_OTHER_PROJECT/, "the command must not have run");

	// Allowed by both, when approved.
	const okRead = await readTool.execute({ path: file } as never, ctxFor(ws, { decisions: ["once"], seen: [] }));
	const okBash = await bashTool.execute({ command: `cat ${sh(file)}` } as never, ctxFor(ws, { decisions: ["once"], seen: [] }));
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
	await bashTool.execute({ command: `cat ${sh(join(outside, "a.txt"))} ${sh(join(outside, "b.txt"))}` } as never, ctxFor(ws, approvals));
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
		`ls ${sh(tmpdir())}`,
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

test("a Windows shell's spellings are the Windows paths they name", () => {
	const home = "C:\\Users\\me";
	const temp = "C:\\Users\\me\\AppData\\Local\\Temp";
	// Git Bash: `/c/...` is drive C. Read by Node it was `C:\c\...`, which does not exist.
	assert.equal(windowsSpelling("/c/Users/me/.ssh/id_ed25519", home, temp), "C:\\Users\\me\\.ssh\\id_ed25519");
	assert.equal(windowsSpelling("/cygdrive/d/work/x", home, temp), "D:\\work\\x");
	assert.equal(windowsSpelling("/c", home, temp), "C:\\");
	assert.equal(windowsSpelling("/tmp/a/b", home, temp), `${temp}\\a\\b`);
	// PowerShell's home.
	assert.equal(windowsSpelling("~\\Documents\\x", home, temp), "C:\\Users\\me\\Documents\\x");
	// A one-letter directory is a drive only at the root, and anything else is left alone.
	assert.equal(windowsSpelling("/cc/x", home, temp), "/cc/x");
	assert.equal(windowsSpelling("/usr/bin/git", home, temp), "/usr/bin/git");
	assert.equal(windowsSpelling("src/c/x", home, temp), "src/c/x");
});

test("a credential is asked about even where the path does not seem to exist", async () => {
	/*
	 * "Not there" is only as good as the path resolved: a spelling this code could not read made a
	 * real key look absent, and absent was a reason not to ask. For a key, it no longer is.
	 */
	const ctx: ToolContext = { cwd: WS, sessionId: "t", state: new Map() };
	const refusal = await authorizeCommandReads(`cat ${sh(join(HOME, ".ssh", `id_lyra_absent_${process.pid}`))}`, ctx);
	assert.ok(refusal, "a credential path must be put to a person, and there is none here");
	// An ordinary path that does not exist is still not a question.
	assert.equal(await authorizeCommandReads(`cat ${sh(join(HOME, `lyra-absent-${process.pid}.txt`))}`, ctx), null);
});

test("a path spelled with backslashes is the path bash opens", () => {
	// `\h` is `h` to bash, and the credential rule only knows the plain spelling.
	assert.ok(commandReadTargets("cat ~/.ss\\h/id_ed25519", WS).includes(join(HOME, ".ssh/id_ed25519")));
});

test("a substitution in an unquoted heredoc is a read like any other", () => {
	// bash runs the `$(…)` in the body; only a quoted delimiter makes the body inert.
	const key = join(HOME, ".ssh/id_ed25519");
	const unquoted = `cat <<EOF\n$(cat ${sh(key)})\nEOF`;
	assert.ok(commandReadTargets(unquoted, WS, ["posix"]).includes(key));
	const quoted = `cat <<'EOF'\n$(cat ${sh(key)})\nEOF`;
	assert.ok(!commandReadTargets(quoted, WS, ["posix"]).includes(key));
	/*
	 * PowerShell has no heredoc, so to its reading the same body is a live `$(…)`. Where PowerShell
	 * may be the shell that runs it, that reading is kept — which is why the grammar is the shell's,
	 * passed in by whoever knows it, and not every grammar there is.
	 */
	assert.ok(commandReadTargets(quoted, WS, ["posix", "powershell"]).includes(key));
});
