/**
 * The Windows runner, really started — not through a probe hook.
 *
 * Every other Windows sandbox test injects `probe: () => true`, which is how the runner went its
 * whole life without once starting: Electron in Node mode read `--lyra-sandbox-runner` as one of
 * Node's own options and exited 9, the real probe failed, and on Windows the default permission
 * mode ran no command at all. Nothing here is injected. It starts the runner the way the app does,
 * through Git Bash — the shell the agent's commands run in there — and checks what a person would
 * check: the project writes, the rest of the disk does not, and the things a shell needs still work.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { confine, resetProbeCache, selectRunner } from "../src/sandbox/backend.ts";
import { LocalSandbox } from "../src/sandbox/local.ts";
import { resetSystemShell, systemShell } from "../src/platform.ts";
import type { SandboxMode } from "../src/sandbox/policy.ts";

const skip = process.platform === "win32" ? false : "Windows only";

/** A path as Git Bash reads it: single-quoted, forward slashes. */
const sh = (path: string) => `'${path.replaceAll("\\", "/").replaceAll("'", "'\\''")}'`;

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

test("the agent's commands run in Git Bash on a Windows that has Git", { skip }, () => {
	resetSystemShell();
	const shell = systemShell();
	assert.equal(shell.kind, "posix", JSON.stringify(shell));
	assert.equal(shell.label, "Git Bash");
	assert.ok(!/\\(system32|windowsapps)\\/i.test(shell.file), `that is WSL, not Git Bash: ${shell.file}`);
});

test("workspace-write: the project and its temp are writable, the rest of the disk is not", { skip, timeout: 120_000 }, async (t) => {
	const ws = await mkdtemp(join(tmpdir(), "lyra-win-ws-"));
	const outside = join(homedir(), `lyra-win-outside-${process.pid}.txt`);
	t.after(async () => {
		await rm(ws, { recursive: true, force: true });
		await rm(outside, { force: true });
	});

	let r = await run("echo hi > inside.txt && cat inside.txt", ws, "workspace-write");
	assert.equal(r.out.trim(), "hi", r.out);

	r = await run(`echo x > ${sh(outside)}`, ws, "workspace-write");
	assert.notEqual(r.code, 0, r.out);
	assert.equal(existsSync(outside), false, "the file must not exist — this is the whole point");

	// A heredoc is a temp file in bash; before the private temp directory, every one of these failed.
	r = await run("cat > note.txt <<'EOF'\nheredoc line\nEOF\ncat note.txt", ws, "workspace-write");
	assert.match(r.out, /heredoc line/);

	r = await run('f=$(mktemp) && echo t > "$f" && cat "$f"', ws, "workspace-write");
	assert.equal(r.out.trim(), "t", r.out);

	// Native programs under the same token: cmd's built-ins and PowerShell.
	r = await run('cmd //c "echo native"', ws, "workspace-write");
	assert.match(r.out, /native/, r.out);
	r = await run('powershell -NoProfile -NonInteractive -Command "Write-Output ps-ok"', ws, "workspace-write");
	assert.match(r.out, /ps-ok/, r.out);

	// Output that is not ASCII arrives as itself.
	r = await run("echo 中文输出", ws, "workspace-write");
	assert.match(r.out, /中文输出/, r.out);

	// How the runner was started is not something the command inherits.
	r = await run('printf %s "$ELECTRON_RUN_AS_NODE"', ws, "workspace-write");
	assert.equal(r.out, "");

	assert.equal((await run("exit 3", ws, "workspace-write")).code, 3);
});

test("read-only: nothing in the project is writable, and reading still works", { skip, timeout: 60_000 }, async (t) => {
	const ws = await mkdtemp(join(tmpdir(), "lyra-win-ro-"));
	t.after(() => rm(ws, { recursive: true, force: true }));

	let r = await run("echo x > ro.txt", ws, "read-only");
	assert.notEqual(r.code, 0, r.out);
	assert.equal(existsSync(join(ws, "ro.txt")), false);

	r = await run(`head -c 2 ${sh(process.execPath)} > /dev/null && echo read-ok`, ws, "read-only");
	assert.match(r.out, /read-ok/, r.out);
});
