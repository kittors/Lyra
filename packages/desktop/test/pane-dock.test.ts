import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { emptyDockTree, usePaneDock } from "../src/features/dock/pane-store.ts";
import { has } from "../src/features/dock/tree.ts";
import { fitTree, layoutPanes } from "../src/features/dock/layout.ts";
import { paneFloor } from "../src/features/dock/geometry.ts";
import { toggleScopedPanel } from "../src/features/dock/popout.ts";

function resetPaneDock(): void {
	usePaneDock.setState({ trees: {}, sizes: {}, drag: null, maximized: {}, focused: {}, crossRatio: {}, host: null });
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
	toggleScopedPanel("a", "review");
	assert.equal(has(usePaneDock.getState().tree("a"), "review"), true);
	toggleScopedPanel("a", "review");
	assert.equal(has(usePaneDock.getState().tree("a"), "review"), false);
});

test("in the narrow layout a panel hidden behind the conversation is brought forward, not closed", () => {
	resetPaneDock();
	usePaneDock.getState().open("a", "review");
	usePaneDock.getState().focus("a", "conversation");
	toggleScopedPanel("a", "review", { compact: true });
	assert.equal(has(usePaneDock.getState().tree("a"), "review"), true, "pressing its button asked to see it");
	assert.equal(usePaneDock.getState().focused.a, "review");
	toggleScopedPanel("a", "review", { compact: true });
	assert.equal(has(usePaneDock.getState().tree("a"), "review"), false, "and pressed again while in front, it goes");
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

test("the first panel is a column at the screen's edge and the next stacks below it — measured or not", () => {
	/*
	 * One rule whatever the screen: a single screen always opened its first panel as a column taking
	 * about a third, and a split screen used to halve the conversation instead. A panel belongs to the
	 * conversation, so it opens the same way wherever the conversation is on screen.
	 */
	for (const measured of [true, false]) {
		resetPaneDock();
		if (measured) usePaneDock.getState().rememberSize("a", { width: 1200, height: 700 });
		assert.equal(usePaneDock.getState().open("a", "browser"), true);
		assert.deepEqual(layoutPanes(usePaneDock.getState().tree("a")).map(({ kind, left, width }) => ({ kind, left, width })), [
			{ kind: "conversation", left: 0, width: 0.7 }, { kind: "browser", left: 0.7, width: 0.3 },
		], measured ? "measured" : "not yet measured");
		assert.equal(usePaneDock.getState().open("a", "terminal"), true);
		const boxes = layoutPanes(usePaneDock.getState().tree("a"));
		assert.deepEqual(boxes.map(({ kind, top, height }) => ({ kind, top, height })), [
			{ kind: "conversation", top: 0, height: 1 },
			{ kind: "browser", top: 0, height: 0.5 },
			{ kind: "terminal", top: 0.5, height: 0.5 },
		]);
	}
});

test("five panes fit when the tile has room for every readable minimum", () => {
	resetPaneDock();
	const span = { width: 1200, height: 700 };
	usePaneDock.getState().rememberSize("a", span);
	for (const kind of ["browser", "terminal", "files", "review"] as const) assert.equal(usePaneDock.getState().open("a", kind), true);
	const boxes = layoutPanes(fitTree(usePaneDock.getState().tree("a"), span, paneFloor));
	assert.equal(boxes.length, 5);
	for (const box of boxes) {
		assert.ok(box.width * span.width >= paneFloor(box.kind).width - 0.01);
		assert.ok(box.height * span.height >= paneFloor(box.kind).height - 0.01);
		assert.ok(box.left + box.width <= 1.00001 && box.top + box.height <= 1.00001);
		for (const other of boxes) {
			if (other === box) continue;
			assert.ok(box.left + box.width <= other.left + 0.00001 || other.left + other.width <= box.left + 0.00001 || box.top + box.height <= other.top + 0.00001 || other.top + other.height <= box.top + 0.00001);
		}
	}
});

test("a move the screen cannot hold is kept as asked and drawn squeezed, never refused", () => {
	/*
	 * The floors choose how a layout is drawn, never whether a person's arrangement stands. A
	 * 504px screen cannot put a panel beside a 420px conversation, so it is drawn stacked — and the
	 * arrangement asked for is what a wider screen shows again.
	 */
	resetPaneDock();
	const span = { width: 504, height: 424 };
	usePaneDock.getState().rememberSize("a", span);
	assert.equal(usePaneDock.getState().open("a", "browser", { side: "bottom", kind: "conversation" }), true);
	usePaneDock.getState().moveTo("a", "browser", { side: "right", kind: "conversation" });
	const stored = usePaneDock.getState().tree("a");
	assert.ok(stored.type === "split" && stored.dir === "row", "the stored tree is what was asked for");
	const drawn = fitTree(stored, span, paneFloor);
	assert.ok(drawn.type === "split" && drawn.dir === "col", "and it is drawn the way it fits");
});

test("every screen's title bar is handed to its dock, so it covers the transcript and never a panel", async () => {
	const pane = fileURLToPath(new URL("../src/features/split/SplitPane.tsx", import.meta.url));
	const dock = fileURLToPath(new URL("../src/features/dock/DockView.tsx", import.meta.url));
	const paneSrc = await readFile(pane, "utf8");
	const dockSrc = await readFile(dock, "utf8");
	const surfaceSrc = await readFile(new URL("../src/features/dock/DockPane.tsx", import.meta.url), "utf8");
	// Single screen too: there is no window-level title bar that panels could fall under.
	assert.match(paneSrc, /header=\{\(room: ScreenInsets\) => <SplitChrome/);
	assert.doesNotMatch(paneSrc, /screen \? <SplitChrome/);
	assert.match(surfaceSrc, /data-ly-pane-slot=\{customHeader \? "conversation"/);
	assert.match(dockSrc, /\{header\(\{ start: inset, end: insetEnd \}\)\}/);
});
