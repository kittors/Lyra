import assert from "node:assert/strict";
import { test } from "node:test";
import { tilePaneFloor } from "../src/features/dock/geometry.ts";
import { fitTree, layoutPanes } from "../src/features/dock/layout.ts";
import { usePaneDock } from "../src/features/dock/pane-store.ts";
import { SCREEN_MIN_WIDTH_PX } from "../src/features/split/geometry.ts";
import { overflowPanels } from "../src/features/dock/place.ts";
import { leafOf, type DockNode } from "../src/features/dock/tree.ts";

test("tiled conversations and tools use readable pixel minima, not sliver-sized substitutes", () => {
	assert.equal(tilePaneFloor("conversation").width, 420);
	assert.equal(tilePaneFloor("terminal").width, 300);
	assert.equal(SCREEN_MIN_WIDTH_PX, 420);
});

test("restored dense rows shed only the tools that exceed the available space", () => {
	const tree: DockNode = { type: "split", dir: "row", children: [leafOf("conversation"), { type: "split", dir: "col", children: [leafOf("browser"), leafOf("terminal")], sizes: [0.5, 0.5] }, leafOf("tasks")], sizes: [0.1, 0.45, 0.45] };
	assert.deepEqual(overflowPanels(tree, { width: 1020, height: 700 }, tilePaneFloor), []);
	assert.deepEqual(overflowPanels(tree, { width: 720, height: 700 }, tilePaneFloor), ["tasks"]);
	assert.deepEqual(overflowPanels(tree, { width: 700, height: 400 }, tilePaneFloor), ["tasks", "terminal", "browser"]);
	assert.deepEqual(overflowPanels(leafOf("conversation"), { width: 375, height: 700 }, tilePaneFloor), []);
});

test("a 700 by 400 tile refuses a tool when neither a row nor a column can preserve the minima", () => {
	usePaneDock.setState({ trees: {}, sizes: {}, drag: null, maximized: {} });
	usePaneDock.getState().rememberSize("readable", { width: 700, height: 400 });
	const before = usePaneDock.getState().tree("readable");
	assert.equal(usePaneDock.getState().open("readable", "browser"), false);
	assert.equal(usePaneDock.getState().tree("readable"), before);
});

test("a narrow but tall tile stacks one tool without shrinking the conversation", () => {
	usePaneDock.setState({ trees: {}, sizes: {}, drag: null, maximized: {} });
	const span = { width: 504, height: 424 };
	usePaneDock.getState().rememberSize("readable", span);
	assert.equal(usePaneDock.getState().open("readable", "browser"), true);
	assert.equal(usePaneDock.getState().open("readable", "terminal"), false);
	const boxes = layoutPanes(fitTree(usePaneDock.getState().tree("readable"), span, tilePaneFloor, true));
	for (const box of boxes) {
		assert.ok(box.width * span.width >= (box.kind === "conversation" ? 420 : 300));
		assert.ok(box.height * span.height >= (box.kind === "conversation" ? 260 : 150));
	}
});
