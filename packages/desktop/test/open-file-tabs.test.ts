/**
 * Closing tabs in bulk: 关闭其他, 关闭右侧, 全部关闭.
 *
 * The rules worth pinning down are the two that are invisible in a screenshot — which tab the pane
 * lands on afterwards, and what happens to a tab holding unsaved edits. Both are the kind of thing
 * that looks right in the strip and is wrong in the store.
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

/*
 * `open` reads the file it moves to, so the store needs a window before it is imported. Minimal on
 * purpose: nothing here asserts on contents, only on which file was asked for.
 */
const reads: string[] = [];
(globalThis as unknown as { window: unknown }).window = {
	lyra: {
		files: {
			read: async (path: string) => {
				reads.push(path);
				return { text: "", truncated: false };
			},
		},
	},
};

const { useOpenFile } = await import("../src/store/openFile.ts");

const TABS = [
	{ path: "/repo/a.ts", name: "a.ts" },
	{ path: "/repo/b.ts", name: "b.ts" },
	{ path: "/repo/c.ts", name: "c.ts" },
	{ path: "/repo/d.ts", name: "d.ts" },
];

function strip(): string[] {
	return useOpenFile.getState().tabs.map((tab) => tab.path);
}

describe("closing tabs in bulk", () => {
	beforeEach(() => {
		reads.length = 0;
		useOpenFile.setState({
			tabs: TABS.map((tab) => ({ ...tab })),
			path: "/repo/b.ts",
			name: "b.ts",
			contents: null,
			opening: null,
			loading: false,
			drafts: {},
		});
	});

	it("关闭其他 leaves the one that was right-clicked", () => {
		const kept = useOpenFile.getState().closeTabs(["/repo/a.ts", "/repo/c.ts", "/repo/d.ts"]);
		assert.equal(kept, 0);
		assert.deepEqual(strip(), ["/repo/b.ts"]);
		// The open file survived, so nothing was re-read.
		assert.deepEqual(reads, []);
	});

	it("关闭右侧 leaves everything up to and including the target", () => {
		useOpenFile.getState().closeTabs(["/repo/c.ts", "/repo/d.ts"]);
		assert.deepEqual(strip(), ["/repo/a.ts", "/repo/b.ts"]);
	});

	it("全部关闭 empties the strip and the pane", () => {
		useOpenFile.getState().closeTabs(TABS.map((tab) => tab.path));
		assert.deepEqual(strip(), []);
		assert.equal(useOpenFile.getState().path, null);
		assert.equal(useOpenFile.getState().contents, null);
	});

	it("closing the open file lands on the nearest survivor to its right", () => {
		// b is open; a and c go, so the pane should move to d rather than to a.
		useOpenFile.getState().closeTabs(["/repo/a.ts", "/repo/b.ts", "/repo/c.ts"]);
		assert.deepEqual(strip(), ["/repo/d.ts"]);
		assert.equal(useOpenFile.getState().opening, "/repo/d.ts");
		assert.deepEqual(reads, ["/repo/d.ts"]);
	});

	it("with nothing left to the right it lands on the last tab", () => {
		useOpenFile.setState({ path: "/repo/d.ts", name: "d.ts" });
		useOpenFile.getState().closeTabs(["/repo/c.ts", "/repo/d.ts"]);
		assert.deepEqual(strip(), ["/repo/a.ts", "/repo/b.ts"]);
		assert.equal(useOpenFile.getState().opening, "/repo/b.ts");
	});

	it("a tab with unsaved edits is kept, and counted", () => {
		useOpenFile.setState({ drafts: { "/repo/c.ts": "half-written" } });
		const kept = useOpenFile.getState().closeTabs(["/repo/a.ts", "/repo/c.ts", "/repo/d.ts"]);
		assert.equal(kept, 1);
		assert.deepEqual(strip(), ["/repo/b.ts", "/repo/c.ts"]);
		// And the edit itself is still there — keeping the tab and dropping its text is worse than
		// either doing the whole thing or nothing.
		assert.equal(useOpenFile.getState().drafts["/repo/c.ts"], "half-written");
	});

	it("全部关闭 with an unsaved edit keeps that one tab open", () => {
		useOpenFile.setState({ drafts: { "/repo/c.ts": "half-written" } });
		const kept = useOpenFile.getState().closeTabs(TABS.map((tab) => tab.path));
		assert.equal(kept, 1);
		assert.deepEqual(strip(), ["/repo/c.ts"]);
		// The open file (b) was closed, so the pane moves to what is left.
		assert.equal(useOpenFile.getState().opening, "/repo/c.ts");
	});

	it("a set that is entirely unsaved changes nothing", () => {
		useOpenFile.setState({ drafts: { "/repo/a.ts": "x", "/repo/c.ts": "y" } });
		const kept = useOpenFile.getState().closeTabs(["/repo/a.ts", "/repo/c.ts"]);
		assert.equal(kept, 2);
		assert.deepEqual(strip(), TABS.map((tab) => tab.path));
		assert.deepEqual(reads, []);
	});

	it("paths that are not open are ignored rather than counted", () => {
		const kept = useOpenFile.getState().closeTabs(["/repo/gone.ts", "/repo/a.ts"]);
		assert.equal(kept, 0);
		assert.deepEqual(strip(), ["/repo/b.ts", "/repo/c.ts", "/repo/d.ts"]);
	});

	it("single close still drops the draft with the tab", () => {
		useOpenFile.setState({ drafts: { "/repo/c.ts": "half-written" } });
		useOpenFile.getState().closeTab("/repo/c.ts");
		assert.deepEqual(strip(), ["/repo/a.ts", "/repo/b.ts", "/repo/d.ts"]);
		assert.equal(useOpenFile.getState().drafts["/repo/c.ts"], undefined);
	});
});

describe("renaming on Windows", () => {
	it("a renamed tab is titled with the file's name, not the whole backslashed path", () => {
		useOpenFile.setState({
			tabs: [{ path: "C:\\repo\\a.ts", name: "a.ts" }],
			path: null,
			name: null,
			contents: null,
			opening: null,
			loading: false,
			drafts: {},
		});
		useOpenFile.getState().moved("C:\\repo\\a.ts", "C:\\repo\\b.ts");
		assert.deepEqual(useOpenFile.getState().tabs, [{ path: "C:\\repo\\b.ts", name: "b.ts" }]);
	});
});
