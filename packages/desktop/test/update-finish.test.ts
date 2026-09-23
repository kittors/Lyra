/**
 * What 「立即重启」 does on each kind of install, in the order it has to happen.
 *
 * The order is the point. An AppImage must be swapped before the relaunch is scheduled, or the new
 * process starts the old file. A relaunch must be scheduled before the exit, or there is nothing to
 * start. And on Windows the app must *quit* once the installer is running: the NSIS installer
 * finds Lyra still up and kills it with `Stop-Process`, which skips every `before-quit` handler —
 * sessions not flushed, shells not ended, the sync server not stopped.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { finishUpdate, type FinishEffects } from "../electron/update-finish.ts";

function effects(overrides: Partial<FinishEffects> = {}) {
	const calls: string[] = [];
	const base: FinishEffects = {
		execPath: "/opt/Lyra/Lyra",
		swapBundle: async (job) => void calls.push(`swapBundle ${job.target}`),
		swapAppImage: async (staged, target) => void calls.push(`swapAppImage ${staged} -> ${target}`),
		runPrivileged: async (command) => (calls.push(`run ${command.file} ${command.args.join(" ")}`), { code: 0, output: "" }),
		openInstaller: async (file) => (calls.push(`open ${file}`), ""),
		relaunch: (execPath) => void calls.push(`relaunch ${execPath ?? "(same)"}`),
		exit: () => void calls.push("exit"),
		quit: () => void calls.push("quit"),
	};
	return { calls, effects: { ...base, ...overrides } };
}

test("an AppImage is swapped, then relaunched from its own path, then the old process exits", async () => {
	const { calls, effects: fx } = effects();
	const result = await finishUpdate({ kind: "appimage", staged: "/a/.Lyra.AppImage.update", target: "/a/Lyra.AppImage" }, fx);
	assert.deepEqual(result, { ok: true });
	assert.deepEqual(calls, ["swapAppImage /a/.Lyra.AppImage.update -> /a/Lyra.AppImage", "relaunch /a/Lyra.AppImage", "exit"]);
});

test("a swap that fails leaves the app running on the old version", async () => {
	const { calls, effects: fx } = effects({
		swapAppImage: async () => {
			throw new Error("EACCES: permission denied, rename");
		},
	});
	const result = await finishUpdate({ kind: "appimage", staged: "/a/.x.update", target: "/a/x" }, fx);
	assert.equal(result.ok, false);
	assert.ok(!calls.includes("exit") && !calls.some((call) => call.startsWith("relaunch")));
});

test("a .deb is installed with the system's password prompt, then the installed binary is started", async () => {
	const { calls, effects: fx } = effects();
	const command = { file: "/usr/bin/pkexec", args: ["/usr/bin/apt-get", "install", "-y", "/c/Lyra.deb"] };
	assert.deepEqual(await finishUpdate({ kind: "deb", file: "/c/Lyra.deb", command }, fx), { ok: true });
	// By path: after dpkg replaced it, /proc/self/exe reads "…/Lyra (deleted)".
	assert.deepEqual(calls, ["run /usr/bin/pkexec /usr/bin/apt-get install -y /c/Lyra.deb", "relaunch /opt/Lyra/Lyra", "exit"]);
});

test("dismissing the password prompt is not a failure of the package, and nothing restarts", async () => {
	const { calls, effects: fx } = effects({ runPrivileged: async () => ({ code: 126, output: "Error executing command as another user: Request dismissed" }) });
	const result = await finishUpdate({ kind: "deb", file: "/c/Lyra.deb", command: { file: "pkexec", args: [] } }, fx);
	assert.deepEqual(result, { ok: false, reason: "dismissed", detail: "" });
	assert.ok(!calls.includes("exit"));
});

test("apt failing reports its own last words", async () => {
	const { effects: fx } = effects({
		runPrivileged: async () => ({ code: 100, output: "Reading package lists...\nE: Could not get lock /var/lib/dpkg/lock-frontend. It is held by process 812 (unattended-upgr)\n" }),
	});
	const result = await finishUpdate({ kind: "deb", file: "/c/Lyra.deb", command: { file: "pkexec", args: [] } }, fx);
	assert.equal(result.ok, false);
	assert.ok(!result.ok && result.reason === "failed" && result.detail.startsWith("E: Could not get lock"), JSON.stringify(result));
});

test("Windows quits — gracefully — once the installer is running, instead of being killed by it", async () => {
	const { calls, effects: fx } = effects();
	assert.deepEqual(await finishUpdate({ kind: "installer", file: "C:\\u\\Lyra-0.9.20-x64.exe" }, fx), { ok: true });
	assert.deepEqual(calls, ["open C:\\u\\Lyra-0.9.20-x64.exe", "quit"]);
	assert.ok(!calls.includes("exit"), "`exit` would skip before-quit, which is the whole point");
});

test("an installer that did not start leaves the app where it was", async () => {
	const { calls, effects: fx } = effects({ openInstaller: async () => "Failed to open path" });
	const result = await finishUpdate({ kind: "installer", file: "C:\\u\\x.exe" }, fx);
	assert.equal(result.ok, false);
	assert.ok(!calls.includes("quit"));
});

test("macOS keeps its swap script, which relaunches the app itself", async () => {
	const { calls, effects: fx } = effects();
	assert.deepEqual(await finishUpdate({ kind: "bundle", staged: "/u/Lyra.app", target: "/Applications/Lyra.app" }, fx), { ok: true });
	assert.deepEqual(calls, ["swapBundle /Applications/Lyra.app", "exit"]);
});
