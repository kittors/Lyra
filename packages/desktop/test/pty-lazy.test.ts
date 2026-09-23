/**
 * node-pty is loaded when a terminal is opened, and failing to load it costs the terminal only.
 *
 * It was a static import at the top of `main.ts`. The Linux packages compile it on Ubuntu 24.04,
 * so `pty.node` needs glibc 2.34 — and on Ubuntu 20.04, Debian 11 or RHEL 8 the dynamic loader
 * refused it before a single line of the app ran. No window, no error, nothing: one native module
 * for one panel took the whole main process down.
 */

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { lazyPty } from "../electron/pty-loader.ts";
import { createTerminalRegistry, type LiveTerminal } from "../electron/terminal-registry.ts";

const GLIBC = "/lib/x86_64-linux-gnu/libc.so.6: version `GLIBC_2.34' not found (required by /opt/Lyra/resources/app.asar.unpacked/node_modules/node-pty/build/Release/pty.node)";

test("nothing is loaded until a terminal is actually opened", () => {
	let loads = 0;
	const spawn = lazyPty(
		() => {
			loads++;
			return { spawn: () => ({ pid: 7 }) as never };
		},
		String,
	);
	assert.equal(loads, 0, "creating the spawner must not load node-pty — that is what took startup down");
	spawn("/bin/bash", [], {});
	spawn("/bin/bash", [], {});
	assert.equal(loads, 1, "loaded once, then reused");
});

test("a module that will not load becomes an error that says what happened", () => {
	const spawn = lazyPty(
		() => {
			throw new Error(GLIBC);
		},
		(error) => `终端无法启动\n${error instanceof Error ? error.message : String(error)}`,
	);
	assert.throws(() => spawn("/bin/bash", [], {}), (error: Error) => error.message.startsWith("终端无法启动\n") && error.message.includes("GLIBC_2.34"));
});

test("a failed load is tried again next time, rather than remembered forever", () => {
	let fail = true;
	const spawn = lazyPty(
		() => {
			if (fail) throw new Error("not yet");
			return { spawn: () => ({ pid: 1 }) as never };
		},
		String,
	);
	assert.throws(() => spawn("/bin/bash", [], {}));
	fail = false;
	assert.equal((spawn("/bin/bash", [], {}) as unknown as { pid: number }).pid, 1);
});

test("a shell that cannot start leaves a tab that says why, and no exit that would remove it", () => {
	const terminals = new Map<string, LiveTerminal>();
	const sent: string[] = [];
	const registry = createTerminalRegistry({
		terminals,
		spawnPty: () => {
			throw new Error(`终端无法启动\n${GLIBC}`);
		},
		insideAProject: () => false,
		eachWindow: (visit) =>
			visit({ isDestroyed: () => false, webContents: { isDestroyed: () => false, send: (channel: string) => sent.push(channel) } } as never),
	});

	const opened = registry.open("/somewhere", 80, 24);
	const attached = registry.attach(opened.id, 80, 24);
	assert.ok(attached, "the tab exists, so the pane has something to show");
	assert.ok(attached.replay.includes("终端无法启动"), attached.replay);
	assert.ok(attached.replay.includes("GLIBC_2.34"));
	// `terminal:exit` makes the renderer drop the tab, message and all.
	assert.ok(!sent.includes("terminal:exit"));
	// Typing into it and resizing it are harmless; closing it removes it.
	registry.write(opened.id, "ls\r");
	registry.resize(opened.id, 100, 30);
	registry.kill(opened.id);
	assert.equal(terminals.size, 0);
});

test("prewarming does not retry a load that failed, once per launch is enough", () => {
	let attempts = 0;
	const terminals = new Map<string, LiveTerminal>();
	const registry = createTerminalRegistry({
		terminals,
		spawnPty: () => {
			attempts++;
			throw new Error("no pty");
		},
		insideAProject: () => false,
		eachWindow: () => {},
	});
	registry.prewarm("/somewhere", 80, 24);
	registry.prewarm("/somewhere", 80, 24);
	assert.equal(attempts, 1);
	assert.equal(terminals.size, 1);
});

test("no file in the main process imports node-pty as a value", () => {
	const electron = join(dirname(dirname(fileURLToPath(import.meta.url))), "electron");
	const offenders: string[] = [];
	const walk = (dir: string): void => {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			const path = join(dir, entry.name);
			if (entry.isDirectory()) walk(path);
			else if (entry.name.endsWith(".ts")) {
				const source = readFileSync(path, "utf8");
				// `import type` is erased at build time; anything else loads the addon when the bundle does.
				if (/^\s*import\s+(?!type\b)[^;]*from\s+["']node-pty["']/m.test(source)) offenders.push(path);
			}
		}
	};
	walk(electron);
	assert.deepEqual(offenders, []);
});
