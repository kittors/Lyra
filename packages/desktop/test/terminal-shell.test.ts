/**
 * Which shell a new terminal starts, on the platform where `SHELL` lies.
 *
 * Lyra launched from Git Bash inherits `SHELL=/usr/bin/bash` — a path in MSYS's world, which
 * ConPTY cannot open — and the registry handed it to node-pty as it was. The terminal never
 * started. The platform and environment are parameters so the Windows case is checked here, on
 * whatever machine runs the tests.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { createTerminalRegistry, pickShell, type LiveTerminal } from "../electron/terminal-registry.ts";

const PWSH = "C:\\Program Files\\PowerShell\\7\\pwsh.exe";
const POWERSHELL = "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";

function finder(present: string[]) {
	return (command: string) => present.find((path) => path.toLowerCase().endsWith(`\\${command.toLowerCase()}`) || path === command) ?? null;
}

test("a POSIX SHELL on Windows is ignored, and the terminal starts in PowerShell 7 when it is there", () => {
	const spawned: string[] = [];
	const registry = createTerminalRegistry({
		terminals: new Map<string, LiveTerminal>(),
		spawnPty: (file) => {
			spawned.push(file);
			return { pid: 1, onData() {}, onExit() {}, write() {}, resize() {}, kill() {} } as never;
		},
		insideAProject: () => false,
		eachWindow: () => {},
		platform: "win32",
		env: { SHELL: "/usr/bin/bash", ComSpec: "C:\\Windows\\system32\\cmd.exe" },
		findExecutable: finder([PWSH, POWERSHELL]),
	});
	registry.open("C:\\proj", 80, 24);
	assert.deepEqual(spawned, [PWSH]);
});

test("without PowerShell 7 it is Windows PowerShell, and without either it is ComSpec", () => {
	const env = { SHELL: "/usr/bin/bash", ComSpec: "C:\\Windows\\system32\\cmd.exe" };
	assert.equal(pickShell("win32", env, finder([POWERSHELL])), POWERSHELL);
	assert.equal(pickShell("win32", env, finder([])), "C:\\Windows\\system32\\cmd.exe");
	// ComSpec in whatever case the environment spelled it, then cmd.exe by name.
	assert.equal(pickShell("win32", { COMSPEC: "D:\\cmd.exe" }, finder([])), "D:\\cmd.exe");
	assert.equal(pickShell("win32", {}, finder([])), "cmd.exe");
});

test("Windows PowerShell is found in System32 even when PATH does not list it", () => {
	const env = { SystemRoot: "C:\\Windows" };
	const onlyByPath = (command: string) => (command === POWERSHELL ? POWERSHELL : null);
	assert.equal(pickShell("win32", env, onlyByPath), POWERSHELL);
});

test("a SHELL that is a real Windows path is still honoured", () => {
	const gitBash = "C:\\Program Files\\Git\\bin\\bash.exe";
	assert.equal(pickShell("win32", { SHELL: gitBash }, finder([gitBash, PWSH])), gitBash);
	// …but not when that file is not there.
	assert.equal(pickShell("win32", { SHELL: gitBash }, finder([PWSH])), PWSH);
});

test("everywhere else SHELL is the answer, as it always was", () => {
	assert.equal(pickShell("linux", { SHELL: "/usr/bin/fish" }, finder([])), "/usr/bin/fish");
	assert.equal(pickShell("darwin", {}, finder([])), "/bin/bash");
});
