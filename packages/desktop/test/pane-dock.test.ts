import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { emptyDockTree, usePaneDock } from "../src/features/dock/pane-store.ts";
import { has } from "../src/features/dock/tree.ts";
import { fitTree, layoutPanes } from "../src/features/dock/layout.ts";
import { tilePaneFloor } from "../src/features/dock/geometry.ts";

function resetPaneDock(): void {
	usePaneDock.setState({ trees: {}, sizes: {}, drag: null, maximized: {} });
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
	assert.equal("a" in usePaneDock.getState().trees, true, "an empty loaded dock must not be confused with an unread one");
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

test("a roomy tile opens its first tool on the right and stacks the next below it", () => {
	resetPaneDock();
	usePaneDock.getState().rememberSize("a", { width: 900, height: 600 });
	assert.equal(usePaneDock.getState().open("a", "browser"), true);
	assert.deepEqual(layoutPanes(usePaneDock.getState().tree("a")).map(({ kind, left, width }) => ({ kind, left, width })), [
		{ kind: "conversation", left: 0, width: 0.5 }, { kind: "browser", left: 0.5, width: 0.5 },
	]);
	assert.equal(usePaneDock.getState().open("a", "terminal"), true);
	const boxes = layoutPanes(usePaneDock.getState().tree("a"));
	assert.deepEqual(boxes.map(({ kind, left, top, height }) => ({ kind, left, top, height })), [
		{ kind: "conversation", left: 0, top: 0, height: 1 },
		{ kind: "browser", left: 0.5, top: 0, height: 0.5 },
		{ kind: "terminal", left: 0.5, top: 0.5, height: 0.5 },
	]);
});

test("five panes fit when the tile has room for every readable minimum", () => {
	resetPaneDock();
	const span = { width: 1200, height: 700 };
	usePaneDock.getState().rememberSize("a", span);
	for (const kind of ["browser", "terminal", "files", "review"] as const) assert.equal(usePaneDock.getState().open("a", kind), true);
	const boxes = layoutPanes(fitTree(usePaneDock.getState().tree("a"), span, tilePaneFloor, true));
	assert.equal(boxes.length, 5);
	for (const box of boxes) {
		assert.ok(box.width * span.width >= tilePaneFloor(box.kind).width - 0.01);
		assert.ok(box.height * span.height >= tilePaneFloor(box.kind).height - 0.01);
		assert.ok(box.left + box.width <= 1.00001 && box.top + box.height <= 1.00001);
		for (const other of boxes) {
			if (other === box) continue;
			assert.ok(box.left + box.width <= other.left + 0.00001 || other.left + other.width <= box.left + 0.00001 || box.top + box.height <= other.top + 0.00001 || other.top + other.height <= box.top + 0.00001);
		}
	}
});

test("an impossible drop is refused without mutating the layout", () => {
	resetPaneDock();
	usePaneDock.getState().rememberSize("a", { width: 504, height: 424 });
	assert.equal(usePaneDock.getState().open("a", "browser", { side: "bottom", kind: "conversation" }), true);
	const before = usePaneDock.getState().tree("a");
	usePaneDock.getState().moveTo("a", "browser", { side: "right", kind: "conversation" });
	assert.equal(usePaneDock.getState().tree("a"), before);
});

test("the tile title bar is handed to the pane dock, not painted over the whole tile", async () => {
	const pane = fileURLToPath(new URL("../src/features/split/SplitPane.tsx", import.meta.url));
	const dock = fileURLToPath(new URL("../src/features/split/PaneDock.tsx", import.meta.url));
	const paneSrc = await readFile(pane, "utf8");
	const dockSrc = await readFile(dock, "utf8");
	const surfaceSrc = await readFile(new URL("../src/features/dock/DockPane.tsx", import.meta.url), "utf8");
	assert.match(paneSrc, /chrome=\{screen \? <SplitChrome/);
	assert.doesNotMatch(paneSrc, /\{screen && <SplitChrome/);
	assert.match(surfaceSrc, /data-ly-pane-slot=\{customHeader \? "conversation"/);
	assert.match(dockSrc, /\{chrome\}/);
});
