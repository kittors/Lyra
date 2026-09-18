import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { emptyDockTree, usePaneDock } from "../src/features/dock/pane-store.ts";
import { has } from "../src/features/dock/tree.ts";

function resetPaneDock(): void {
	usePaneDock.setState({ trees: {}, sizes: {}, drag: null });
}

test("opening a panel is local to that conversation screen", () => {
	resetPaneDock();
	usePaneDock.getState().open("a", "browser");
	assert.equal(has(usePaneDock.getState().tree("a"), "browser"), true);
	assert.equal(has(usePaneDock.getState().tree("b"), "browser"), false);
	assert.equal(has(emptyDockTree, "browser"), false);
});

test("closing the last panel returns the screen to a lone conversation", () => {
	resetPaneDock();
	usePaneDock.getState().open("a", "terminal");
	usePaneDock.getState().close("a", "terminal");
	assert.deepEqual(usePaneDock.getState().tree("a"), emptyDockTree);
	assert.equal("a" in usePaneDock.getState().trees, false);
});

test("a share that did not move keeps the stored tree", () => {
	resetPaneDock();
	usePaneDock.getState().open("a", "terminal");
	const first = usePaneDock.getState().trees;
	const share = usePaneDock.getState().tree("a").type === "split" ? usePaneDock.getState().tree("a").sizes[0] : 0.5;
	usePaneDock.getState().setShare("a", [], 0, share ?? 0.5);
	assert.equal(usePaneDock.getState().trees, first);
	usePaneDock.getState().setShare("a", [], 0, 0.55);
	const moved = usePaneDock.getState().trees;
	assert.notEqual(moved, first);
	usePaneDock.getState().setShare("a", [], 0, 0.55);
	assert.equal(usePaneDock.getState().trees, moved);
});

test("toggle puts a panel away when it is already on that screen", () => {
	resetPaneDock();
	usePaneDock.getState().toggle("a", "review");
	assert.equal(has(usePaneDock.getState().tree("a"), "review"), true);
	usePaneDock.getState().toggle("a", "review");
	assert.equal(has(usePaneDock.getState().tree("a"), "review"), false);
});

test("moving a panel stays inside that screen's tree", () => {
	resetPaneDock();
	usePaneDock.getState().open("a", "browser");
	usePaneDock.getState().moveTo("a", "browser", { side: "bottom", kind: "conversation" });
	assert.equal(has(usePaneDock.getState().tree("a"), "browser"), true);
	assert.equal(has(usePaneDock.getState().tree("b"), "browser"), false);
	const tree = usePaneDock.getState().tree("a");
	assert.equal(tree.type, "split");
	if (tree.type === "split") assert.equal(tree.dir, "col");
});

test("a 2×2 tile stacks the first panel and refuses a second that would crush the chat", () => {
	resetPaneDock();
	usePaneDock.getState().rememberSize("a", { width: 504, height: 424 });
	assert.equal(usePaneDock.getState().open("a", "browser"), true);
	const stacked = usePaneDock.getState().tree("a");
	assert.equal(stacked.type, "split");
	if (stacked.type === "split") assert.equal(stacked.dir, "col");
	assert.equal(usePaneDock.getState().open("a", "terminal"), false);
	assert.equal(has(usePaneDock.getState().tree("a"), "browser"), true);
	assert.equal(has(usePaneDock.getState().tree("a"), "terminal"), false);
});

test("a drag onto an edge that would crush the conversation is ignored", () => {
	resetPaneDock();
	usePaneDock.getState().rememberSize("a", { width: 504, height: 424 });
	usePaneDock.getState().open("a", "browser");
	usePaneDock.getState().moveTo("a", "browser", { side: "right", kind: "conversation" });
	const tree = usePaneDock.getState().tree("a");
	assert.equal(tree.type, "split");
	if (tree.type === "split") assert.equal(tree.dir, "col");
});

test("the tile title bar is handed to the pane dock, not painted over the whole tile", async () => {
	const pane = fileURLToPath(new URL("../src/features/split/SplitPane.tsx", import.meta.url));
	const dock = fileURLToPath(new URL("../src/features/split/PaneDock.tsx", import.meta.url));
	const paneSrc = await readFile(pane, "utf8");
	const dockSrc = await readFile(dock, "utf8");
	assert.match(paneSrc, /chrome=\{<SplitChrome/);
	assert.doesNotMatch(paneSrc, /\{screen && <SplitChrome/);
	assert.match(dockSrc, /data-ly-pane-slot="conversation"/);
	assert.match(dockSrc, /\{chrome\}/);
});
