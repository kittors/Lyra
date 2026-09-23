/**
 * Which shell a command runs in, by how it is confined.
 *
 * On Windows the answer depends on the mode: Git Bash cannot start under the restricted token that
 * confines a command (its signal pipe is created with a DACL no restricting SID can pass), so a
 * confined command runs in PowerShell and only an unconfined one in Git Bash. Everywhere else the
 * mode changes nothing.
 *
 * `process.platform` is swapped for the Windows cases, and `LYRA_SHELL` points at files named for
 * the shells — the selection reads names and existence, which is all a test here can provide.
 */

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { commandDialects, commandShell, resetSystemShell, systemShell } from "../src/platform.ts";

// Captured once: a test that pretends twice must still put back the real ones, not its own first pretence.
const REAL_PLATFORM = process.platform;
const REAL_LYRA_SHELL = process.env.LYRA_SHELL;

async function pretend(t: TestContext, platform: NodeJS.Platform, lyraShell?: string): Promise<void> {
	Object.defineProperty(process, "platform", { value: platform, configurable: true });
	if (lyraShell === undefined) delete process.env.LYRA_SHELL;
	else process.env.LYRA_SHELL = lyraShell;
	resetSystemShell();
	t.after(() => {
		Object.defineProperty(process, "platform", { value: REAL_PLATFORM, configurable: true });
		if (REAL_LYRA_SHELL === undefined) delete process.env.LYRA_SHELL;
		else process.env.LYRA_SHELL = REAL_LYRA_SHELL;
		resetSystemShell();
	});
}

async function fakeShell(t: TestContext, name: string): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "lyra-shell-"));
	t.after(() => rm(dir, { recursive: true, force: true }));
	const file = join(dir, name);
	await writeFile(file, "");
	return file;
}

test("Windows: a confined command runs in PowerShell, an unconfined one in Git Bash", async (t) => {
	await pretend(t, "win32", await fakeShell(t, "bash.exe"));

	assert.equal(systemShell().label, "Git Bash");
	assert.equal(commandShell("danger-full-access").label, "Git Bash");
	assert.equal(commandShell(undefined).label, "Git Bash", "no mode means nobody asked for confinement");

	for (const mode of ["read-only", "workspace-write"] as const) {
		const shell = commandShell(mode);
		assert.equal(shell.kind, "powershell", `${mode}: Git Bash cannot start under the restricted token`);
		assert.match(shell.label, /PowerShell/);
		// From a script file, so quotes survive CreateProcess and errors come back as text.
		assert.ok(shell.args("echo hi").includes("-File"));
	}
});

test("Windows: LYRA_SHELL naming a PowerShell is used confined too", async (t) => {
	const pwsh = await fakeShell(t, "pwsh.exe");
	await pretend(t, "win32", pwsh);
	assert.equal(commandShell("workspace-write").file, pwsh);
	assert.equal(commandShell("workspace-write").label, "PowerShell 7");
});

test("PowerShell: every command runs from a UTF-8 script file, whatever its length", async (t) => {
	/*
	 * `-EncodedCommand` made Windows PowerShell 5.1 write every error as CLIXML, and a command past
	 * about twelve thousand characters never started (`spawn ENAMETOOLONG`). A file has neither.
	 */
	await pretend(t, "win32", await fakeShell(t, "pwsh.exe"));
	const shell = commandShell("workspace-write");

	for (const command of ["Write-Output 中文", `Write-Output '${"x".repeat(12_000)}'`]) {
		const args = shell.args(command);
		assert.ok(!args.includes("-EncodedCommand"), JSON.stringify(args.slice(0, 8)));
		const file = args[args.indexOf("-File") + 1];
		assert.ok(file && existsSync(file), JSON.stringify(args));
		t.after(() => rm(file, { force: true }));
		assert.ok(args.join(" ").length < 1_000, "the line itself stays short");

		const text = await readFile(file, "utf8");
		assert.equal(text.charCodeAt(0), 0xfeff, "a BOM, or Windows PowerShell 5.1 reads it in the console's code page");
		const lines = text.slice(1).split("\n");
		assert.match(lines[0], /OutputEncoding/, "the prelude is the first line");
		assert.equal(lines[1], command.split("\n")[0], "and the command starts on the second");
		// `-File` reports 0 after a failed last command; the last line reports the failure instead.
		assert.match(text.trimEnd(), /if \(-not \$\?\) \{ exit .+ \}$/);
		// Named by what is in it: the same command again is the same file.
		assert.equal(shell.args(command).at(-1), file);
	}
});

test("macOS and Linux: the mode does not change the shell", async (t) => {
	const bash = await fakeShell(t, "bash");
	for (const platform of ["darwin", "linux"] as const) {
		await pretend(t, platform, bash);
		for (const mode of ["read-only", "workspace-write", "danger-full-access", undefined] as const) {
			assert.equal(commandShell(mode).file, bash, `${platform} ${mode}`);
			assert.equal(commandShell(mode).kind, "posix");
		}
	}
});

test("every Windows command is judged in both grammars, whichever shell ends up running it", async (t) => {
	await pretend(t, "win32", await fakeShell(t, "bash.exe"));
	// Git Bash is the system shell here, and it is still both: confined, the same line runs in PowerShell.
	assert.deepEqual(commandDialects(), ["posix", "powershell"]);

	await pretend(t, "darwin", await fakeShell(t, "zsh"));
	assert.deepEqual(commandDialects(), ["posix"]);
});
