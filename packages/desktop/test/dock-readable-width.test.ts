import assert from "node:assert/strict";
import { test } from "node:test";
import { tilePaneFloor } from "../src/features/dock/geometry.ts";
import { fitTree, layoutPanes } from "../src/features/dock/layout.ts";
import { usePaneDock } from "../src/features/dock/pane-store.ts";
import { SCREEN_MIN_WIDTH_PX } from "../src/features/split/geometry.ts";
import { has } from "../src/features/dock/tree.ts";

test("tiled conversations and tools use readable pixel minima, not sliver-sized substitutes", () => {
	assert.equal(tilePaneFloor("conversation").width, 420);
	assert.equal(tilePaneFloor("terminal").width, 300);
	assert.equal(SCREEN_MIN_WIDTH_PX, 420);
});

/*
 * The floors choose where a pane lands, never whether it lands.
 *
 * These two used to assert the opposite — `open` returning false for a tile with no clearing
 * edge — because the caller answered that by moving the pane into a window of its own. That
 * route is gone (`2026-09-19-2304-01`): an ordinary window resize was enough to trigger it, and
 * the pane did not work once it got there. A tile too small for its tools now keeps them and
 * draws them squeezed, which is a state the user can see and undo by widening the window.
 */
test("a 700 by 400 tile still takes a tool it cannot lay out at full size", () => {
	usePaneDock.setState({ trees: {}, sizes: {}, drag: null, maximized: {} });
	usePaneDock.getState().rememberSize("readable", { width: 700, height: 400 });
	assert.equal(usePaneDock.getState().open("readable", "browser"), true);
	assert.ok(has(usePaneDock.getState().tree("readable"), "browser"), "the pane belongs to the tile, not to a new window");
});

test("a narrow but tall tile keeps every floor for the first tool, and keeps the second anyway", () => {
	usePaneDock.setState({ trees: {}, sizes: {}, drag: null, maximized: {} });
	const span = { width: 504, height: 424 };
	usePaneDock.getState().rememberSize("readable", span);
	assert.equal(usePaneDock.getState().open("readable", "browser"), true);

	// One tool fits here, and fitting means every floor is honoured.
	for (const box of layoutPanes(fitTree(usePaneDock.getState().tree("readable"), span, tilePaneFloor, true))) {
		assert.ok(box.width * span.width >= (box.kind === "conversation" ? 420 : 300));
		assert.ok(box.height * span.height >= (box.kind === "conversation" ? 260 : 150));
	}

	// The second does not fit, and is taken anyway rather than being handed to a native window.
	assert.equal(usePaneDock.getState().open("readable", "terminal"), true);
	const tree = usePaneDock.getState().tree("readable");
	assert.ok(has(tree, "browser") && has(tree, "terminal"), "both tools stay in the tile");
});
