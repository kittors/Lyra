/**
 * What `rebuild-pty.mjs` decides before it compiles anything.
 *
 * On Windows it could never compile: it ran `execFileSync("npx", …)`, and `npx` there is `npx.cmd`,
 * which Node will not start without a shell — ENOENT, three attempts, and a closing warning that
 * the terminal would not work. It did work, from node-pty's own prebuilt binaries, but only by
 * luck: a `pnpm package` leaves `build/Release` compiled for the last architecture packaged, the
 * loader prefers it, and the "restore" that should have undone it was the step that always failed.
 */

import assert from "node:assert/strict";
import { basename, join } from "node:path";
import { test } from "node:test";

import { gypInvocation, nodeGypEntry, usablePrebuild } from "../scripts/rebuild-pty-plan.mjs";

const napi = { dependencies: { "node-addon-api": "^7.1.0" } };
// Built with the host's `join`, as the script builds them — so this holds on the Windows CI runner too.
const winFiles = (arch: string) =>
	new Set(["conpty.node", "conpty_console_list.node", "pty.node"].map((file) => join("/pty", "prebuilds", `win32-${arch}`, file)));

test("Windows uses node-pty's N-API prebuild instead of compiling, when it ships one for this arch", () => {
	const present = winFiles("x64");
	assert.equal(
		usablePrebuild({ platform: "win32", arch: "x64", ptyDir: "/pty", pkg: napi, exists: (path: string) => present.has(path) }),
		join("/pty", "prebuilds", "win32-x64"),
	);
});

test("no prebuild for this architecture, or one file missing, means compiling after all", () => {
	const x64Only = winFiles("x64");
	assert.equal(usablePrebuild({ platform: "win32", arch: "arm64", ptyDir: "/pty", pkg: napi, exists: (path: string) => x64Only.has(path) }), null);
	const partial = new Set([...winFiles("x64")].filter((path) => basename(path) !== "conpty.node"));
	assert.equal(usablePrebuild({ platform: "win32", arch: "x64", ptyDir: "/pty", pkg: napi, exists: (path: string) => partial.has(path) }), null);
});

test("a node-pty that is not N-API cannot use a prebuild across ABIs, so it is compiled", () => {
	const present = winFiles("x64");
	assert.equal(usablePrebuild({ platform: "win32", arch: "x64", ptyDir: "/pty", pkg: { dependencies: {} }, exists: (path: string) => present.has(path) }), null);
});

test("macOS and Linux keep compiling as they always have", () => {
	assert.equal(usablePrebuild({ platform: "darwin", arch: "arm64", ptyDir: "/pty", pkg: napi, exists: () => true }), null);
	assert.equal(usablePrebuild({ platform: "linux", arch: "x64", ptyDir: "/pty", pkg: napi, exists: () => true }), null);
});

test("node-gyp is run as a script by this Node, never through a .cmd shim", () => {
	const plan = gypInvocation({ entry: "C:\\gyp\\bin\\node-gyp.js", execPath: "C:\\node\\node.exe", platform: "win32", args: ["rebuild"] });
	assert.deepEqual(plan, { file: "C:\\node\\node.exe", args: ["C:\\gyp\\bin\\node-gyp.js", "rebuild"] });
	// With nothing to run, Windows gives up rather than reach for npx.cmd again.
	assert.equal(gypInvocation({ entry: null, execPath: "C:\\node\\node.exe", platform: "win32", args: ["rebuild"] }), null);
	// Elsewhere npx still works, so it stays the last resort there.
	assert.deepEqual(gypInvocation({ entry: null, execPath: "/usr/bin/node", platform: "linux", args: ["rebuild"] }), {
		file: "npx",
		args: ["--yes", "node-gyp", "rebuild"],
	});
});

test("node-gyp is looked for where npm said, then beside @electron/rebuild, then inside npm itself", () => {
	const exists = (path: string) => path !== "/missing/node-gyp.js";
	assert.equal(
		nodeGypEntry({ env: { npm_config_node_gyp: "/npm/node-gyp.js" }, execPath: "/usr/bin/node", platform: "linux", fromRebuild: () => "/eb/node-gyp.js", exists }),
		"/npm/node-gyp.js",
	);
	assert.equal(
		nodeGypEntry({ env: { npm_config_node_gyp: "/missing/node-gyp.js" }, execPath: "/usr/bin/node", platform: "linux", fromRebuild: () => "/eb/node-gyp.js", exists }),
		"/eb/node-gyp.js",
	);
	const bundled = new Set(["C:\\node\\node_modules\\npm\\node_modules\\node-gyp\\bin\\node-gyp.js"]);
	assert.equal(
		nodeGypEntry({ env: {}, execPath: "C:\\node\\node.exe", platform: "win32", fromRebuild: () => null, exists: (path: string) => bundled.has(path) }),
		"C:\\node\\node_modules\\npm\\node_modules\\node-gyp\\bin\\node-gyp.js",
	);
	const unixBundled = new Set(["/usr/local/lib/node_modules/npm/node_modules/node-gyp/bin/node-gyp.js"]);
	assert.equal(
		nodeGypEntry({ env: {}, execPath: "/usr/local/bin/node", platform: "darwin", fromRebuild: () => null, exists: (path: string) => unixBundled.has(path) }),
		"/usr/local/lib/node_modules/npm/node_modules/node-gyp/bin/node-gyp.js",
	);
	assert.equal(nodeGypEntry({ env: {}, execPath: "/x/node", platform: "linux", fromRebuild: () => null, exists: () => false }), null);
});
