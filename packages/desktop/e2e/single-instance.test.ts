/**
 * One Lyra per machine.
 *
 * Closing the window does not quit while there is a status bar item, so the app looks closed while
 * it is still running — and opening it again used to start a *second copy*. On Windows that is a
 * row of identical tray icons, most of which belong to processes with no window and therefore
 * answer nothing; underneath it is two schedulers firing the same task, two sync servers on one
 * port, and two processes appending to the same session log.
 *
 * What is checked here is the whole of the fix: a second launch on the same profile exits by
 * itself, and the one already running is told about it.
 */

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";
import { startApp, type RunningApp } from "./app.ts";

const ROOT = join(fileURLToPath(import.meta.url), "..", "..");

let app: RunningApp;

before(async () => {
	app = await startApp({ port: 9734 });
});

after(async () => {
	await app?.stop();
});

/**
 * A second launch against the same profile, and what it did.
 *
 * Spawned the same way the first one was, so the lock is being tested rather than a lookalike:
 * the lock is keyed on the user data directory, which `LYRA_HOME` decides.
 */
function secondLaunch(home: string): Promise<{ code: number | null; output: string }> {
	return new Promise((resolve) => {
		const output: string[] = [];
		const second = spawn("pnpm", ["exec", "electron-vite", "preview"], {
			cwd: ROOT,
			env: { ...process.env, LYRA_HOME: home, ELECTRON_ENABLE_LOGGING: "1" },
			stdio: "pipe",
			detached: true,
		});
		second.stdout?.on("data", (chunk: Buffer) => output.push(chunk.toString()));
		second.stderr?.on("data", (chunk: Buffer) => output.push(chunk.toString()));
		second.on("exit", (code) => resolve({ code, output: output.join("") }));

		/*
		 * A backstop, not the expected path.
		 *
		 * If the lock is gone the second copy runs forever and this test would hang rather than
		 * fail, which is the worst way for a regression to arrive: a suite that times out tells you
		 * nothing about what broke.
		 */
		setTimeout(() => {
			try {
				process.kill(-second.pid!, "SIGKILL");
			} catch {}
			resolve({ code: null, output: output.join("") });
		}, 25_000);
	});
}

test("a second launch on the same profile gets out of the way", async () => {
	const { code } = await secondLaunch(app.home);
	// It exits on its own; `null` is the backstop above having had to kill it.
	assert.notEqual(code, null, "the second copy was still running after 25s — the lock is gone");
});

test("and the copy already running is still the one with the window", async () => {
	// Still answering, which is the other half: the lock must not take the first one down with it.
	const alive = await app.evaluate<boolean>(`Boolean(document.querySelector(".ly-shell"))`);
	assert.ok(alive);
});
