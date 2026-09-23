/**
 * The Windows runner, really started — not through a probe hook.
 *
 * Every other Windows sandbox test injects `probe: () => true`, which is how the runner went its
 * whole life without once starting: Electron in Node mode read `--lyra-sandbox-runner` as one of
 * Node's own options and exited 9, the real probe failed, and on Windows the default permission
 * mode ran no command at all. Nothing here is injected. It starts the runner the way the app does,
 * through PowerShell — the shell a confined command runs in there (`commandShell`) — and checks what
 * a person would check: the project writes, the rest of the disk does not, and the things a shell
 * needs still work.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { confine, looksDenied, resetProbeCache, selectRunner } from "../src/sandbox/backend.ts";
import { LocalSandbox } from "../src/sandbox/local.ts";
import { commandShell, resetSystemShell, systemShell } from "../src/platform.ts";
import type { SandboxMode } from "../src/sandbox/policy.ts";

const skip = process.platform === "win32" ? false : "Windows only";

/** A path as PowerShell reads it: single-quoted, a quote doubled. */
const ps = (path: string) => `'${path.replaceAll("'", "''")}'`;

function run(command: string, cwd: string, mode: SandboxMode): Promise<{ code: number | null; out: string }> {
	return new Promise((resolve) => {
		const child = new LocalSandbox().run(command, { cwd, mode });
		let out = "";
		child.onOutput((chunk) => { out += chunk; });
		child.onExit((code) => resolve({ code, out }));
		child.onError((error) => resolve({ code: -1, out: `spawn failed: ${error.message}` }));
	});
}

test("the runner, started directly, confines a trivial command — and says why when it cannot", { skip, timeout: 60_000 }, () => {
	// The probe's verdict is a boolean; this is the same call with everything it printed kept.
	const wrap = confine({ mode: "read-only", workspaceRoot: process.cwd() }, { platform: "win32", probe: () => true });
	assert.ok(wrap);
	const started = spawnSync(wrap.command, [...wrap.args, "cmd.exe", "/c", "echo confined"], {
		encoding: "utf8",
		env: { ...process.env, ...wrap.env },
		windowsHide: true,
		timeout: 30_000,
	});
	assert.equal(
		started.status,
		0,
		`runner exit ${started.status} signal ${started.signal}\nargv: ${JSON.stringify([wrap.command, ...wrap.args])}\nstderr: ${started.stderr}\nstdout: ${started.stdout}\nerror: ${started.error?.message}`,
	);
	assert.match(started.stdout, /confined/);
});

test("the runner really starts: the probe passes and the restricted token is selected", { skip }, () => {
	resetProbeCache();
	let reason = "";
	try {
		confine({ mode: "read-only", workspaceRoot: process.cwd() });
	} catch (error) {
		reason = error instanceof Error ? error.message : String(error);
	}
	assert.equal(selectRunner(), "windows-acl", reason);
});

test("unconfined commands run in Git Bash on a Windows that has Git, confined ones in PowerShell", { skip }, () => {
	resetSystemShell();
	const shell = systemShell();
	assert.equal(shell.kind, "posix", JSON.stringify(shell));
	assert.equal(shell.label, "Git Bash");
	assert.ok(!/\\(system32|windowsapps)\\/i.test(shell.file), `that is WSL, not Git Bash: ${shell.file}`);
	assert.equal(commandShell("danger-full-access").label, "Git Bash");
	// Git Bash cannot start under the restricted token (its own signal pipe refuses it); see `commandShell`.
	for (const mode of ["read-only", "workspace-write"] as const) {
		assert.equal(commandShell(mode).kind, "powershell", `${mode}: ${JSON.stringify(commandShell(mode))}`);
	}
});

test("workspace-write: the project and its temp are writable, the rest of the disk is not", { skip, timeout: 120_000 }, async (t) => {
	const ws = await mkdtemp(join(tmpdir(), "lyra-win-ws-"));
	const outside = join(homedir(), `lyra-win-outside-${process.pid}.txt`);
	t.after(async () => {
		await rm(ws, { recursive: true, force: true });
		await rm(outside, { force: true });
	});

	let r = await run("Set-Content -Path inside.txt -Value hi; Get-Content -Path inside.txt", ws, "workspace-write");
	assert.equal(r.out.trim(), "hi", r.out);

	r = await run(`Set-Content -LiteralPath ${ps(outside)} -Value x`, ws, "workspace-write");
	assert.notEqual(r.code, 0, r.out);
	assert.equal(existsSync(outside), false, "the file must not exist — this is the whole point");
	assert.ok(looksDenied(r.out, "windows-acl"), `PowerShell's refusal has to read as the sandbox's: ${r.out}`);

	// The private temp directory is `TEMP` here; without it no temp file could be made at all.
	r = await run("$f = New-TemporaryFile; Set-Content -LiteralPath $f -Value t; Get-Content -LiteralPath $f; Remove-Item -LiteralPath $f", ws, "workspace-write");
	assert.equal(r.out.trim(), "t", r.out);

	// Native programs under the same token.
	r = await run("cmd /d /c echo native", ws, "workspace-write");
	assert.match(r.out, /native/, r.out);

	// Output that is not ASCII arrives as itself.
	r = await run("Write-Output 中文输出", ws, "workspace-write");
	assert.match(r.out, /中文输出/, r.out);

	// How the runner was started is not something the command inherits.
	r = await run("[string]$env:ELECTRON_RUN_AS_NODE", ws, "workspace-write");
	assert.equal(r.out.trim(), "");

	assert.equal((await run("exit 3", ws, "workspace-write")).code, 3);

	// Longer than a command line could ever have carried it: from a script file, confined all the same.
	r = await run(`$s = '${"x".repeat(12_000)}'; Write-Output "long-$($s.Length)"`, ws, "workspace-write");
	assert.match(r.out, /long-12000/, r.out.slice(0, 300));
	r = await run(`$s = '${"x".repeat(12_000)}'; Set-Content -LiteralPath ${ps(outside)} -Value $s`, ws, "workspace-write");
	assert.equal(existsSync(outside), false, "a script file is no way around the token");
	assert.notEqual(r.code, 0, "and its failure is still reported as one");
});

test("an MSYS program started by a confined command is reported as the sandbox refusing it", { skip, timeout: 60_000 }, async (t) => {
	/*
	 * `git commit` in a confined PowerShell runs its hooks with Git's `sh`, which cannot start under
	 * the token. That has to reach the model as a denial it can escalate, not as a broken hook.
	 */
	const ws = await mkdtemp(join(tmpdir(), "lyra-win-msys-"));
	t.after(() => rm(ws, { recursive: true, force: true }));
	const gitSh = join(systemShell().file, "..", "..", "usr", "bin", "sh.exe");
	assert.ok(existsSync(gitSh), gitSh);

	const r = await run(`& ${ps(gitSh)} -c 'echo from-sh'`, ws, "workspace-write");
	assert.ok(!r.out.includes("from-sh"), `sh ran confined after all — then Git Bash could be the confined shell: ${r.out}`);
	assert.ok(looksDenied(r.out, "windows-acl"), r.out);
});

test("read-only: nothing in the project is writable, and reading still works", { skip, timeout: 60_000 }, async (t) => {
	const ws = await mkdtemp(join(tmpdir(), "lyra-win-ro-"));
	t.after(() => rm(ws, { recursive: true, force: true }));

	let r = await run("Set-Content -Path ro.txt -Value x", ws, "read-only");
	assert.notEqual(r.code, 0, r.out);
	assert.equal(existsSync(join(ws, "ro.txt")), false);

	r = await run(`Get-Content -LiteralPath ${ps(process.execPath)} -TotalCount 1 > $null; if ($?) { 'read-ok' }`, ws, "read-only");
	assert.match(r.out, /read-ok/, r.out);
});

test("confined PowerShell is the whole language, speaks UTF-8, and reports errors as text", { skip, timeout: 120_000 }, async (t) => {
	/*
	 * Three things that each broke confined commands without failing a single write test:
	 * ConstrainedLanguage when `%TEMP%` was not writable (read-only), which also took the UTF-8 setup
	 * down with it; and errors serialized as CLIXML, which Windows PowerShell 5.1 does for every
	 * `-EncodedCommand`. Both PowerShells, because 5.1 is the one every Windows has and the one that
	 * did the CLIXML, while CI's `commandShell` finds 7.
	 */
	const ws = await mkdtemp(join(tmpdir(), "lyra-win-lang-"));
	t.after(() => rm(ws, { recursive: true, force: true }));
	const seven = commandShell("workspace-write");
	const legacy = { ...seven, file: join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe") };
	for (const shell of [seven, legacy]) {
		for (const mode of ["read-only", "workspace-write"] as const) {
			const r = await new Promise<{ code: number | null; out: string }>((resolve) => {
				const child = new LocalSandbox().run("Write-Output $ExecutionContext.SessionState.LanguageMode; Write-Output 中文输出; Write-Error boom; Write-Output after", { cwd: ws, mode, shell });
				let out = "";
				child.onOutput((chunk) => { out += chunk; });
				child.onExit((code) => resolve({ code, out }));
			});
			const where = `${shell.file} ${mode}: ${r.out}`;
			assert.match(r.out, /FullLanguage/, where);
			assert.match(r.out, /中文输出/, where);
			assert.match(r.out, /boom/, where);
			assert.ok(!r.out.includes("CLIXML"), `an error as XML, not as text — ${where}`);
			assert.ok(!r.out.includes("OutputEncoding"), `the prelude is not the model's to read — ${where}`);
			assert.match(r.out, /after/, where);
		}
	}
});

test("full access runs Git Bash, unconfined", { skip, timeout: 60_000 }, async (t) => {
	const ws = await mkdtemp(join(tmpdir(), "lyra-win-full-"));
	t.after(() => rm(ws, { recursive: true, force: true }));

	const r = await run("echo hi > full.txt && cat full.txt && uname -o", ws, "danger-full-access");
	assert.match(r.out, /hi/, r.out);
	assert.match(r.out, /Msys/i, r.out);
});
