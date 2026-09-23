/**
 * How `tsserver` is started, which only matters inside the app.
 *
 * In Electron's main process `process.execPath` is Lyra itself. Started without
 * `ELECTRON_RUN_AS_NODE`, it is the app, not Node: every code-intelligence question launched a second
 * copy of Lyra with `tsserver.js` for an argument, the single-instance lock sent it away, and the tool
 * waited out its timeout. Tests run under Node, where the variable changes nothing — so the arguments
 * the process is started with are what is checked here, not whether a server answers.
 */

import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { EventEmitter } from "node:events";
import { syncBuiltinESMExports } from "node:module";
import { PassThrough } from "node:stream";
import { test } from "node:test";
import { TsServerBackend } from "../src/lsp/tsserver.ts";

test("tsserver starts as Node inside the app, with no console window on Windows", async (t) => {
	const calls: { file: string; args: readonly string[]; options: childProcess.SpawnOptions }[] = [];
	const spawn = t.mock.method(childProcess, "spawn", (file: string, args: readonly string[], options: childProcess.SpawnOptions) => {
		calls.push({ file, args, options });
		const child = Object.assign(new EventEmitter(), {
			stdout: new PassThrough(),
			stderr: new PassThrough(),
			stdin: new PassThrough(),
			pid: 1,
			killed: false,
			unref() {},
			kill() {
				return true;
			},
		});
		return child as unknown as childProcess.ChildProcess;
	});
	syncBuiltinESMExports();
	t.after(() => {
		spawn.mock.restore();
		syncBuiltinESMExports();
	});

	const backend = new TsServerBackend();
	if (!(await backend.available())) {
		t.skip("typescript is not installed here");
		return;
	}
	await backend.start(process.cwd());

	assert.equal(calls.length, 1);
	assert.equal(calls[0].file, process.execPath);
	assert.match(String(calls[0].args[0]), /tsserver\.js$/);
	assert.equal(calls[0].options.env?.ELECTRON_RUN_AS_NODE, "1", "in the app, process.execPath is Lyra — without this it is not Node");
	assert.equal(calls[0].options.windowsHide, true);
});
