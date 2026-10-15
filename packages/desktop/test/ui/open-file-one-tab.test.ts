/**
 * One file, one tab, however its path was spelled.
 *
 * On Windows 11, three links in a reply — `C:/…/README.md`, `C:\…\README.md`, `c:/…/README.md` — opened
 * three tabs on one file, each able to hold its own unsaved draft of it.
 */

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { useOpenFile } from "../../src/store/openFile.ts";

afterEach(() => {
	useOpenFile.getState().clear();
	Reflect.deleteProperty(window, "lyra");
});

test("three spellings of one Windows path open one tab, in the system's spelling", async () => {
	const read: string[] = [];
	Object.defineProperty(window, "lyra", { configurable: true, value: { files: { read: async (path: string) => (read.push(path), { kind: "text", text: "# QA" }) } } });
	const { open } = useOpenFile.getState();
	await open({ path: "C:/lyra/app/README.md", name: "README.md" } as never);
	await open({ path: "C:\\lyra\\app\\README.md", name: "README.md" } as never);
	await open({ path: "c:/lyra/app/README.md", name: "README.md" } as never);
	const { tabs, path } = useOpenFile.getState();
	assert.deepEqual(tabs.map((tab) => tab.path), ["C:\\lyra\\app\\README.md"]);
	assert.equal(path, "C:\\lyra\\app\\README.md");
	assert.deepEqual([...new Set(read)], ["C:\\lyra\\app\\README.md"]);
});

test("on macOS and Linux two spellings are two files", async () => {
	Object.defineProperty(window, "lyra", { configurable: true, value: { files: { read: async () => ({ kind: "text", text: "" }) } } });
	const { open } = useOpenFile.getState();
	await open({ path: "/work/App/a.md", name: "a.md" } as never);
	await open({ path: "/work/app/a.md", name: "a.md" } as never);
	assert.equal(useOpenFile.getState().tabs.length, 2);
});
