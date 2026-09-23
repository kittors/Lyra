/**
 * Which confinement a host provides, and what happens when it provides none.
 *
 * The test that matters most is the one asserting a throw. Everything else here is bookkeeping;
 * that one is the difference between a sandbox and a label saying "sandbox" — if `confine` ever
 * quietly returned the original command when it could not wrap it, every mode above this line
 * would keep working, keep reporting success, and enforce nothing.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { confine, looksDenied, resetProbeCache, SandboxUnavailableError, selectRunner } from "../src/sandbox/backend.ts";

test("macOS selects Seatbelt when the probe accepts the profile", () => {
	resetProbeCache();
	assert.equal(selectRunner({ platform: "darwin", probe: () => true }), "seatbelt");
});

test("Linux selects bwrap when the probe accepts the profile", () => {
	resetProbeCache();
	assert.equal(selectRunner({ platform: "linux", probe: () => true }), "bwrap");
});

test("a runner that is present but refuses its profile is not selected", () => {
	// `sandbox-exec` ships on every macOS and can still reject a profile. Existence is not
	// capability, which is why the probe runs the thing instead of stat-ing it.
	resetProbeCache();
	assert.equal(selectRunner({ platform: "darwin", probe: () => false }), "none");
});

test("Windows has the restricted-token backend, when it probes clean", () => {
	resetProbeCache();
	assert.equal(selectRunner({ platform: "win32", probe: () => true }), "windows-acl");
});

test("Windows reports partial enforcement, and the reason is structural", () => {
	// `WRITE_RESTRICTED` needs Everyone in its restricting list or the process dies during loader
	// init, so anything granting Everyone write access stays writable; NTFS hard links can alias a
	// granted file outside the tree. Neither closes with a better implementation, and a caller
	// needing the absolute promise has to be able to tell this from `full`.
	resetProbeCache();
	const wrap = confine({ mode: "workspace-write", workspaceRoot: "C:\\work" }, { platform: "win32", probe: () => true });
	assert.ok(wrap);
	assert.equal(wrap.runner, "windows-acl");
	assert.equal(wrap.enforcement, "partial");
});

test("the Windows wrapper re-spawns this executable as a plain Node process", () => {
	// Under Electron there is no standalone `node` to reach for, and shipping one would be a second
	// runtime to keep in step.
	resetProbeCache();
	const wrap = confine({ mode: "workspace-write", workspaceRoot: "C:\\work" }, { platform: "win32", probe: () => true });
	assert.ok(wrap);
	assert.equal(wrap.command, process.execPath);
	assert.equal(wrap.env?.ELECTRON_RUN_AS_NODE, "1", "without this the runner would start a second copy of the app");
	assert.ok(wrap.args.includes("--lyra-sandbox-runner"));
	assert.equal(wrap.args.at(-1), "--", "the wrapped command follows the separator");
});

test("the runner's argv starts a script, not an option Node refuses", () => {
	/*
	 * The test above passed for the runner's whole broken life: the flag *was* in the arguments.
	 * What mattered was where. In Node mode the first argument that is not an option of Node's own
	 * must be the script, and `--lyra-sandbox-runner` in that position was `bad option`, exit 9.
	 * So this one starts the process for real. On this platform the runner declines to confine —
	 * which it can only say if it was started at all.
	 */
	resetProbeCache();
	const wrap = confine({ mode: "workspace-write", workspaceRoot: "C:\\work" }, { platform: "win32", probe: () => true });
	assert.ok(wrap);
	const script = wrap.args.findIndex((arg) => /runner-entry\.ts$|sandbox-runner\.js$/.test(arg));
	assert.ok(script >= 0, wrap.args.join(" "));
	assert.ok(script < wrap.args.indexOf("--lyra-sandbox-runner"), "the script has to come before the flag");

	if (process.platform !== "win32" && process.platform !== "linux") {
		const started = spawnSync(wrap.command, [...wrap.args, "true"], { encoding: "utf8", env: { ...process.env, ...wrap.env } });
		assert.doesNotMatch(started.stderr, /bad option/);
		assert.match(started.stderr, /不用这个 runner/);
	}
});

test("workspace-write on Windows brings a private temp directory with an identity of its own", () => {
	// Seatbelt and bwrap grant the temp areas; without one here, every heredoc in Git Bash failed.
	resetProbeCache();
	const wrap = confine({ mode: "workspace-write", workspaceRoot: "C:\\work" }, { platform: "win32", probe: () => true });
	assert.ok(wrap);
	const temp = wrap.args[wrap.args.indexOf("--temp") + 1];
	const sid = wrap.args[wrap.args.indexOf("--temp-sid") + 1];
	assert.match(temp, /lyra-sandbox/);
	assert.match(sid, /^S-1-4-\d+-\d+-1$/, "a temp identity, never the workspace's");
	assert.notEqual(sid, wrap.args[wrap.args.indexOf("--write-sid") + 1]);

	const readOnly = confine({ mode: "read-only", workspaceRoot: "C:\\work" }, { platform: "win32", probe: () => true });
	assert.ok(readOnly && !readOnly.args.includes("--temp"), "a read-only command gets no temp to write either");
});

test("Linux falls back to Landlock where bwrap cannot run", () => {
	resetProbeCache();
	assert.equal(selectRunner({ platform: "linux", probe: (runner) => runner === "landlock" }), "landlock");
	// The verdicts are cached per host; a different host is a fresh cache.
	resetProbeCache();
	assert.equal(selectRunner({ platform: "linux", probe: () => true }), "bwrap", "bwrap stays first where it works");
	resetProbeCache();
	const wrap = confine({ mode: "workspace-write", workspaceRoot: "/work" }, { platform: "linux", probe: (runner) => runner === "landlock" });
	assert.ok(wrap);
	assert.equal(wrap.runner, "landlock");
	assert.equal(wrap.env?.ELECTRON_RUN_AS_NODE, "1");
	assert.ok(wrap.args.includes("--lyra-sandbox-runner"));
	const denied = confine({ mode: "workspace-write", workspaceRoot: "/work", network: "deny" }, { platform: "linux", probe: (runner) => runner === "landlock" });
	assert.ok(denied?.args.includes("--network"), "the network half reaches the runner");
});

test("read-only carries no capability SID on Windows either", () => {
	// A leftover grant from an earlier workspace-write session stays inert this way, with nothing
	// to find and revoke.
	resetProbeCache();
	const wrap = confine({ mode: "read-only", workspaceRoot: "C:\\work" }, { platform: "win32", probe: () => true });
	assert.ok(wrap);
	assert.ok(!wrap.args.includes("--write-sid"), wrap.args.join(" "));
});

test("workspace-write names the capability derived from the workspace", () => {
	resetProbeCache();
	const wrap = confine({ mode: "workspace-write", workspaceRoot: "C:\\work" }, { platform: "win32", probe: () => true });
	assert.ok(wrap);
	const sid = wrap.args[wrap.args.indexOf("--write-sid") + 1];
	assert.match(sid, /^S-1-4-\d+-\d+$/);
});

test("a Windows host whose probe fails still fails closed", () => {
	// The probe runs the whole chain — token, default-DACL merge, CreateProcessAsUserW. A host
	// where any of it does not work is one that cannot enforce, so it is not offered.
	resetProbeCache();
	assert.equal(selectRunner({ platform: "win32", probe: () => false }), "none");
	resetProbeCache();
	assert.throws(
		() => confine({ mode: "workspace-write", workspaceRoot: "C:\\w" }, { platform: "win32", probe: () => false }),
		SandboxUnavailableError,
	);
});

test("the probe runs once per host, not once per command", () => {
	resetProbeCache();
	let probes = 0;
	const hooks = {
		platform: "darwin" as const,
		probe: () => {
			probes += 1;
			return true;
		},
	};
	selectRunner(hooks);
	selectRunner(hooks);
	selectRunner(hooks);
	assert.equal(probes, 1);
});

test("confinement that cannot be provided throws rather than running unconfined", () => {
	resetProbeCache();
	assert.throws(
		() => confine({ mode: "workspace-write", workspaceRoot: "/p" }, { platform: "freebsd", probe: () => false }),
		SandboxUnavailableError,
	);
	resetProbeCache();
	assert.throws(
		() => confine({ mode: "read-only", workspaceRoot: "/p" }, { platform: "darwin", probe: () => false }),
		SandboxUnavailableError,
	);
});

test("danger-full-access asks for no confinement, so it needs no backend", () => {
	resetProbeCache();
	// Even on a platform with nothing available: the mode is the absence of a sandbox, and the
	// absence is available everywhere.
	assert.equal(confine({ mode: "danger-full-access", workspaceRoot: "/p" }, { platform: "freebsd" }), null);
});

test("a Seatbelt confinement ends in the separator sandbox-exec expects", () => {
	resetProbeCache();
	const wrap = confine(
		{ mode: "workspace-write", workspaceRoot: "/p" },
		{ platform: "darwin", probe: () => true, seatbeltExec: "/usr/bin/sandbox-exec" },
	);
	assert.ok(wrap);
	assert.equal(wrap.command, "/usr/bin/sandbox-exec");
	assert.equal(wrap.args.at(-1), "--", "the wrapped command follows the separator");
	assert.equal(wrap.args[0], "-p");
	assert.equal(wrap.runner, "seatbelt");
	assert.equal(wrap.enforcement, "full");
});

test("a bwrap confinement ends in the same separator", () => {
	resetProbeCache();
	const wrap = confine({ mode: "read-only", workspaceRoot: "/p" }, { platform: "linux", probe: () => true });
	assert.ok(wrap);
	assert.equal(wrap.command, "bwrap");
	assert.equal(wrap.args.at(-1), "--");
	assert.equal(wrap.enforcement, "full");
});

// ---------------------------------------------------------------------------
// Reading a denial out of stderr
// ---------------------------------------------------------------------------

test("what the runners actually print counts as a denial", () => {
	assert.ok(looksDenied("touch: /etc/hosts: Operation not permitted"));
	// zsh is the default shell on macOS and writes the same refusal in lower case, in a
	// differently shaped line. Matching only bash's wording passed every unit test and missed
	// every real denial on the machine this runs on.
	assert.ok(looksDenied("zsh:1: operation not permitted: /Users/x/.ssh/config"));
	assert.ok(looksDenied("sandbox-exec: sandbox_apply: Operation not permitted"));
	assert.ok(looksDenied("bwrap: Can't create file at /etc/x: Read-only file system"));
	assert.ok(looksDenied("mkdir: cannot create directory '/x': Read-only file system"));
});

test("our own runners' refusals are recognised under those runners only", () => {
	// Landlock and the Windows token refuse in common words, with no prefix of their own.
	assert.ok(looksDenied("/bin/bash: line 1: /home/u/x: Permission denied", "landlock"));
	assert.ok(looksDenied("Access is denied.", "windows-acl"));
	// The same words under Seatbelt are an ordinary failure, as they always were.
	assert.ok(!looksDenied("/bin/bash: line 1: /home/u/x: Permission denied", "seatbelt"));
	assert.ok(!looksDenied("/bin/bash: line 1: /home/u/x: Permission denied"));
	// And ssh's two sentences are never the sandbox, whatever runs them.
	assert.ok(!looksDenied("git@github.com: Permission denied (publickey).", "landlock"));
	assert.ok(!looksDenied("Permission denied, please try again.", "windows-acl"));
});

test("Windows: PowerShell's refusal and an MSYS program dying under the token are denials", () => {
	// What a confined PowerShell prints for a write outside the grant, verbatim from a Windows runner.
	const powershell =
		"Set-Content : Access to the path 'C:\\Users\\runneradmin\\AppData\\Local\\Temp\\lyra-win-KHRkQe\\ps.txt' is denied.\n" +
		"    + CategoryInfo          : PermissionDenied: (C:\\Users\\runner...n-KHRkQe\\ps.txt:String) [Set-Content], UnauthorizedAccessException";
	assert.ok(looksDenied(powershell, "windows-acl"));
	assert.ok(!looksDenied(powershell, "seatbelt"), "the same words are only ours under our runner");

	// `git commit` in a confined PowerShell runs the hooks with Git's `sh`, which dies as it starts.
	const hook = "      0 [main] sh (1396) C:\\Program Files\\Git\\usr\\bin\\sh.exe: *** fatal error - couldn't create signal pipe, Win32 error 5";
	assert.ok(looksDenied(hook, "windows-acl"));
	assert.ok(looksDenied("0 [main] bash (2104) bash.exe: *** fatal error - CreateFileMapping S-1-5-21-1-2-3-500.1, Win32 error 5.  Terminating.", "windows-acl"));
	assert.ok(!looksDenied(hook, "landlock"), "Cygwin's wording means the Windows token and nothing else");
	// Another Win32 error from the same runtime is not the sandbox.
	assert.ok(!looksDenied("0 [main] bash (1) bash.exe: *** fatal error - couldn't allocate heap, Win32 error 487", "windows-acl"));
});

test("an ordinary failure is not read as a denial", () => {
	// Being wrong in this direction is the expensive one: it would offer an escalation prompt for
	// something the sandbox never blocked, and teach the user that the prompt means nothing.
	assert.ok(!looksDenied("bash: line 1: nosuchcommand: command not found"));
	assert.ok(!looksDenied("error: pathspec 'x' did not match any file(s) known to git"));
	assert.ok(!looksDenied("npm ERR! code EACCES\nnpm ERR! syscall mkdir"));
	assert.ok(!looksDenied(""));
});
