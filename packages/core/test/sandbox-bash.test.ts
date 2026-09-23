/**
 * The sandbox, through the tool the model actually calls.
 *
 * Everything else about confinement is unit-testable and is tested that way. This file is the one
 * that answers the only question that matters at the end: when the agent runs a command, is the
 * write really refused? A profile that is generated correctly and never applied looks identical
 * from every other angle.
 *
 * Skipped where there is no backend, rather than failing: on a host without confinement these
 * assertions would be testing that an unconfined command can write, which is not a property worth
 * pinning down.
 */

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { bashTool } from "../src/tools/bash.ts";
import { selectRunner } from "../src/sandbox/backend.ts";
import { resetSystemShell } from "../src/platform.ts";
import { useSandbox } from "../src/sandbox/index.ts";
import type { SandboxProcess } from "../src/kernel/services.ts";
import type { SandboxMode, SandboxNetwork } from "../src/sandbox/policy.ts";
import type { ToolContext, ToolResult } from "../src/types.ts";
import { shellFor } from "./shell-for.ts";

const confined = selectRunner() !== "none";
const skip = confined ? false : "this host has no sandbox backend";
/** The Windows token governs files only, and the backend refuses a denied network there. */
const netSkip = confined && selectRunner({}, "deny") !== "windows-acl" ? false : "this host's sandbox cannot deny the network";

/*
 * Commands are spelled for the shell each mode runs in — see `shell-for.ts`. On Windows a confined
 * command runs in PowerShell, so writing a file there is `Set-Content`, not `echo >`; a test written
 * only in bash would be testing the grammar, not the sandbox.
 */

function context(cwd: string, mode: SandboxMode | undefined): ToolContext {
	return { cwd, sessionId: "test", state: new Map(), sandboxMode: mode };
}

const textOf = (result: ToolResult) => result.content.map((b) => (b.type === "text" ? b.text : "")).join("");

async function run(cwd: string, mode: SandboxMode | undefined, command: string): Promise<ToolResult> {
	return (await bashTool.execute({ command }, context(cwd, mode))) as ToolResult;
}

test("workspace-write lets a command write inside the project", { skip }, async (t) => {
	const ws = await mkdtemp(join(tmpdir(), "lyra-sb-ws-"));
	t.after(() => rm(ws, { recursive: true, force: true }));

	const s = shellFor("workspace-write");
	const result = await run(ws, "workspace-write", s.thenDone(s.write(join(ws, "inside.txt"))));
	assert.match(textOf(result), /DONE/);
	assert.ok(existsSync(join(ws, "inside.txt")));
});

test("workspace-write refuses a write outside the project, and nothing is created", { skip }, async (t) => {
	const ws = await mkdtemp(join(tmpdir(), "lyra-sb-ws-"));
	// Under the home directory: outside the workspace and outside the temp areas the mode grants.
	const outside = join(homedir(), ".lyra-sandbox-e2e-probe");
	t.after(async () => {
		await rm(ws, { recursive: true, force: true });
		await rm(outside, { force: true });
	});

	const result = await run(ws, "workspace-write", shellFor("workspace-write").write(outside));
	assert.equal(existsSync(outside), false, "the file must not exist — this is the whole point");
	// And the model is told it was a policy decision rather than a broken command.
	assert.match(textOf(result), /sandbox: 文件写入被拒/);
	assert.match(textOf(result), /可以申请/);
	assert.equal((result.details as { denied?: boolean }).denied, true);
});

test("read-only refuses even inside the project", { skip }, async (t) => {
	const ws = await mkdtemp(join(tmpdir(), "lyra-sb-ro-"));
	t.after(() => rm(ws, { recursive: true, force: true }));

	await run(ws, "read-only", shellFor("read-only").write(join(ws, "nope.txt")));
	assert.equal(existsSync(join(ws, "nope.txt")), false);
});

test("read-only still allows the sink a shell cannot run without", { skip }, async (t) => {
	const ws = await mkdtemp(join(tmpdir(), "lyra-sb-ro-"));
	t.after(() => rm(ws, { recursive: true, force: true }));

	// A read-only sandbox that cannot run `... 2>/dev/null` is not read-only, it is broken.
	const s = shellFor("read-only");
	const result = await run(ws, "read-only", s.thenDone(s.discard));
	assert.match(textOf(result), /DONE/);
});

test("read-only can still read", { skip }, async (t) => {
	const ws = await mkdtemp(join(tmpdir(), "lyra-sb-ro-"));
	t.after(() => rm(ws, { recursive: true, force: true }));

	/*
	 * A file outside the workspace that exists on every platform and needs no approval to read:
	 * the temp areas are readable without asking (`read-access.ts`), `/etc/passwd` is not a file
	 * Git Bash promises, and anything under the home directory would be a question for a person.
	 */
	const other = join(tmpdir(), `lyra-sb-read-${process.pid}.txt`);
	await writeFile(other, "data");
	t.after(() => rm(other, { force: true }));
	const s = shellFor("read-only");
	const result = await run(ws, "read-only", s.thenDone(s.read(other)));
	assert.match(textOf(result), /DONE/);
});

test("danger-full-access is unconfined, and says nothing about denials", { skip }, async (t) => {
	const ws = await mkdtemp(join(tmpdir(), "lyra-sb-full-"));
	const outside = join(ws, "..", `lyra-full-${process.pid}.txt`);
	t.after(async () => {
		await rm(ws, { recursive: true, force: true });
		await rm(outside, { force: true });
	});

	const s = shellFor("danger-full-access");
	const result = await run(ws, "danger-full-access", s.thenDone(s.write(outside)));
	assert.match(textOf(result), /DONE/);
	assert.ok(!textOf(result).includes("sandbox:"));
});

test("no mode means no confinement, which is how the CLI and the tests run", { skip }, async (t) => {
	const ws = await mkdtemp(join(tmpdir(), "lyra-sb-none-"));
	t.after(() => rm(ws, { recursive: true, force: true }));

	const result = await run(ws, undefined, "echo DONE");
	assert.match(textOf(result), /DONE/);
});

test("a path with a quote in it does not break out of the profile", { skip: skip || (process.platform === "win32" ? "a Windows path cannot contain a quote" : false) }, async (t) => {
	// The escaping is unit-tested; this proves the escaped profile is one the kernel accepts.
	const ws = await mkdtemp(join(tmpdir(), "lyra-sb-q-"));
	t.after(() => rm(ws, { recursive: true, force: true }));

	const weird = join(ws, 'we"ird dir');
	const s = shellFor("workspace-write");
	const result = await run(ws, "workspace-write", s.thenDone(`${s.mkdir(weird)} && ${s.write(join(weird, "f.txt"))}`));
	assert.match(textOf(result), /DONE/, textOf(result));
});

test("an ordinary failure is not dressed up as a denial", { skip }, async (t) => {
	const ws = await mkdtemp(join(tmpdir(), "lyra-sb-fail-"));
	t.after(() => rm(ws, { recursive: true, force: true }));

	const result = await run(ws, "workspace-write", "definitely-not-a-command-here");
	assert.ok(!textOf(result).includes("sandbox:"), textOf(result));
	assert.equal((result.details as { denied?: boolean }).denied, undefined);
});

/*
 * The network axis, asked at the seam rather than at the socket.
 *
 * This is the file's opening paragraph applied to the other half: the profile that denies the
 * network was generated correctly, and was never handed to anything. `denyCommandNetwork` reached
 * `ToolContext`, and from there went only into the *judgement* of the output — so the setting read
 * as on, `curl` returned 200, and a genuine outage got labelled a policy decision. Nothing about
 * the wiring was visible from any test that ran a real command, because on a host with a working
 * network both the enforced and the unenforced arrangement print the same thing.
 *
 * A recording sandbox rather than a socket, because the question here is "was it asked for". The
 * two tests below that one answer "was it obeyed".
 */
function immediateExit(): SandboxProcess {
	let exited: ((code: number | null) => void) | undefined;
	setImmediate(() => exited?.(0));
	return { onOutput() {}, onExit(listener) { exited = listener; }, onError() {}, kill() {} };
}

test("what the turn decided about the network is what the sandbox is told", async (t) => {
	const asked: Array<{ mode?: SandboxMode; network?: SandboxNetwork }> = [];
	useSandbox({
		run(_command, options) {
			asked.push({ mode: options.mode, network: options.network });
			return immediateExit();
		},
	});
	t.after(() => useSandbox(null));

	const ctx = (network: SandboxNetwork | undefined): ToolContext => ({
		cwd: tmpdir(),
		sessionId: "test",
		state: new Map(),
		sandboxMode: "workspace-write",
		sandboxNetwork: network,
	});

	await bashTool.execute({ command: "echo hi" }, ctx("deny"));
	assert.equal(asked[0]?.network, "deny", "设置里禁了联网，沙箱却没被告知——那条设置就是假的");

	// The background path spawns separately and had the same omission.
	await bashTool.execute({ command: "echo hi", run_in_background: true }, ctx("deny"));
	assert.equal(asked[1]?.network, "deny", "后台命令是同一台机器上的同一条命令");

	await bashTool.execute({ command: "echo hi" }, ctx("allow"));
	assert.equal(asked[2]?.network, "allow");

	// Absent stays absent: a host that never heard of this axis keeps the behaviour it had.
	await bashTool.execute({ command: "echo hi" }, ctx(undefined));
	assert.equal(asked[3]?.network, undefined);
});

test("the shell a command runs in is the one its session announced, escalated or not", async (t) => {
	/*
	 * On Windows a confined command runs in PowerShell and an unconfined one in Git Bash. The model
	 * writes for the shell the system prompt names, which follows the session's mode — so a command
	 * escalated to full access is still a PowerShell command, and handing it to Git Bash because the
	 * escalated mode is unconfined would run PowerShell text through bash.
	 *
	 * Pretends to be Windows with a Git Bash on hand; a recording sandbox, so nothing is started.
	 */
	const realPlatform = process.platform;
	const realShell = process.env.LYRA_SHELL;
	const bashDir = await mkdtemp(join(tmpdir(), "lyra-sb-shell-"));
	await writeFile(join(bashDir, "bash.exe"), "");
	Object.defineProperty(process, "platform", { value: "win32", configurable: true });
	process.env.LYRA_SHELL = join(bashDir, "bash.exe");
	resetSystemShell();
	t.after(async () => {
		Object.defineProperty(process, "platform", { value: realPlatform, configurable: true });
		if (realShell === undefined) delete process.env.LYRA_SHELL;
		else process.env.LYRA_SHELL = realShell;
		resetSystemShell();
		await rm(bashDir, { recursive: true, force: true });
	});

	const shells: Array<{ mode?: SandboxMode; kind?: string }> = [];
	useSandbox({
		run(_command, options) {
			shells.push({ mode: options.mode, kind: options.shell?.kind });
			return immediateExit();
		},
	});
	t.after(() => useSandbox(null));
	const ctx = (mode: SandboxMode): ToolContext => ({
		cwd: bashDir,
		sessionId: "test",
		state: new Map(),
		sandboxMode: mode,
		requestApproval: async () => "once",
	});

	await bashTool.execute({ command: "echo hi" }, ctx("workspace-write"));
	await bashTool.execute({ command: "echo hi", escalate: "danger-full-access", justification: "要写工作区外面" }, ctx("workspace-write"));
	await bashTool.execute({ command: "echo hi", run_in_background: true }, ctx("read-only"));
	await bashTool.execute({ command: "echo hi" }, ctx("danger-full-access"));

	assert.deepEqual(shells, [
		{ mode: "workspace-write", kind: "powershell" },
		{ mode: "danger-full-access", kind: "powershell" },
		{ mode: "read-only", kind: "powershell" },
		{ mode: "danger-full-access", kind: "posix" },
	]);
});

test("a denied network is denied, and an allowed one is not", { skip: netSkip }, async (t) => {
	const ws = await mkdtemp(join(tmpdir(), "lyra-sb-net-"));
	t.after(() => rm(ws, { recursive: true, force: true }));

	// `-sS` rather than `-s`: the denial marker is matched against what the command printed, so a
	// command whose errors are silenced cannot demonstrate that the matching works.
	const reach = async (network: SandboxNetwork) =>
		(await bashTool.execute(
			{ command: "curl -sS -m 5 -o /dev/null -w '%{http_code}' https://example.com" },
			{ cwd: ws, sessionId: "test", state: new Map(), sandboxMode: "workspace-write", sandboxNetwork: network },
		)) as ToolResult;

	/*
	 * The control runs first and decides whether the assertion below means anything: on a host
	 * with no route out, a denial and an outage are the same observation, and asserting on the
	 * denied case alone would pass for the wrong reason on exactly the machines that need it most.
	 */
	const allowed = textOf(await reach("allow"));
	if (!allowed.includes("200")) {
		t.skip(`这台机器出不去网（对照组拿到 ${JSON.stringify(allowed.slice(0, 60))}），拒绝与断网无法区分`);
		return;
	}

	const denied = await reach("deny");
	assert.ok(!textOf(denied).includes("200"), `联网本该被拒: ${textOf(denied)}`);
	// And it is reported as a decision rather than as the flaky wifi it looks like.
	assert.match(textOf(denied), /sandbox: 联网被拒/);
	assert.equal((denied.details as { networkDenied?: boolean }).networkDenied, true);
});
