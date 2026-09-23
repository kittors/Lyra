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
		// Encoded, so quotes survive CreateProcess; the output forced to UTF-8.
		assert.ok(shell.args("echo hi").includes("-EncodedCommand"));
	}
});

test("Windows: LYRA_SHELL naming a PowerShell is used confined too", async (t) => {
	const pwsh = await fakeShell(t, "pwsh.exe");
	await pretend(t, "win32", pwsh);
	assert.equal(commandShell("workspace-write").file, pwsh);
	assert.equal(commandShell("workspace-write").label, "PowerShell 7");
});

test("PowerShell: a command too long for the Windows command line goes in a script file", async (t) => {
	await pretend(t, "win32", await fakeShell(t, "pwsh.exe"));
	const shell = commandShell("workspace-write");

	// Short: encoded on the line, the command intact inside it.
	const short = shell.args("Write-Output 中文");
	const encoded = short[short.indexOf("-EncodedCommand") + 1];
	assert.ok(encoded, JSON.stringify(short));
	assert.match(Buffer.from(encoded, "base64").toString("utf16le"), /Write-Output 中文$/);

	/*
	 * Long: 12,000 characters would be 32,000 on the line once encoded — past what `CreateProcess`
	 * accepts, so it never started (`spawn ENAMETOOLONG`). It runs from a file instead.
	 */
	const command = `Write-Output '${"x".repeat(12_000)}'`;
	const long = shell.args(command);
	assert.ok(!long.includes("-EncodedCommand"));
	const file = long[long.indexOf("-File") + 1];
	assert.ok(file && existsSync(file), JSON.stringify(long.slice(0, 7)));
	t.after(() => rm(file, { force: true }));
	assert.ok(long.join(" ").length < 1_000, "the line itself stays short");
	const text = await readFile(file, "utf8");
	assert.equal(text.charCodeAt(0), 0xfeff, "a BOM, or Windows PowerShell 5.1 reads it in the console's code page");
	assert.ok(text.includes(command));
	// `-File` reports 0 after a failed last command, where `-Command` reports failure; the last line keeps that.
	assert.match(text.trimEnd(), /if \(-not \$\?\) \{ exit .+ \}$/);
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
