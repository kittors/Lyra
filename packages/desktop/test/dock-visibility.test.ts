/**
 * Which panes are actually on screen, across every arrangement the dock can be in.
 *
 * This is the question the open file's header asks before offering the project tree under its
 * name: with the tree pane visible the dropdown is a second copy of a list already on screen, and
 * with it hidden the dropdown is the only way to reach another file. So every combination below is
 * one of those two answers being wrong in a way somebody would notice.
 *
 * The cases that matter are the ones where "open" and "visible" come apart — a pane maximised over
 * its neighbours, a window narrow enough that the dock shows one pane at a time — because those are
 * exactly the ones a check for "is it open" gets wrong.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { canToggleMaximized, paneVisible, type DockVisibility } from "../src/features/dock/visibility.ts";

/** The ordinary arrangement: conversation, tree and file all open, nothing maximised. */
function dock(over: Partial<DockVisibility> = {}): DockVisibility {
	return {
		present: ["conversation", "files", "file"],
		maximized: null,
		compact: false,
		focused: "conversation",
		...over,
	};
}

test("a pane that is open, with nothing covering it, is on screen", () => {
	assert.equal(paneVisible("files", dock()), true);
	assert.equal(paneVisible("file", dock()), true);
});

test("a pane that was never opened is not on screen", () => {
	assert.equal(paneVisible("files", dock({ present: ["conversation", "file"] })), false);
});

test("maximising the file on its own hides the tree, though the tree is still open", () => {
	/*
	 * The case the header exists for. Closing the tree and maximising this pane look identical from
	 * the pane's point of view — there is no tree to be seen — and a check for "is the tree open"
	 * answers yes in one of them and leaves the name inert with no way to reach another file.
	 */
	const full = dock({ maximized: ["file"] });
	assert.equal(paneVisible("files", full), false, "covered by the maximised pane");
	assert.equal(paneVisible("file", full), true, "and it is the one doing the covering");
});

test("maximising the file takes the tree with it, and then the tree is on screen", () => {
	// `toggleMaximized` passes the companion, so the pair fills the dock together — which is why
	// this cannot assume a maximised set is a single pane.
	const pair = dock({ maximized: ["files", "file"] });
	assert.equal(paneVisible("files", pair), true);
	assert.equal(paneVisible("file", pair), true);
	assert.equal(paneVisible("conversation", pair), false, "everything else is behind them");
});

test("maximising the tree hides the file, which is the same rule the other way round", () => {
	const full = dock({ maximized: ["files"] });
	assert.equal(paneVisible("files", full), true);
	assert.equal(paneVisible("file", full), false);
});

test("a narrow window shows one pane, whatever the tree says is open", () => {
	const narrow = dock({ compact: true, focused: "file" });
	assert.equal(paneVisible("file", narrow), true);
	assert.equal(paneVisible("files", narrow), false, "open, and behind the one being shown");
	assert.equal(paneVisible("conversation", narrow), false);
});

test("a narrow window showing the tree is the tree being on screen", () => {
	assert.equal(paneVisible("files", dock({ compact: true, focused: "files" })), true);
});

test("being focused in a narrow window does not resurrect a pane that was closed", () => {
	// `focused` is remembered across layouts and the tree can be closed while it is set; the dock
	// falls back to the conversation, but nothing here should depend on that having happened yet.
	const gone = dock({ present: ["conversation", "file"], compact: true, focused: "files" });
	assert.equal(paneVisible("files", gone), false);
});

test("a narrow window is decided by focus, not by what is maximised", () => {
	/*
	 * Both can be set at once: maximise a pane, then drag the window narrow. The collapsed form
	 * shows one pane regardless, so reading `maximized` there would claim two panes are visible in
	 * a layout that has room for one.
	 */
	const both = dock({ maximized: ["files", "file"], compact: true, focused: "file" });
	assert.equal(paneVisible("file", both), true);
	assert.equal(paneVisible("files", both), false);
});

/*
 * Whether full screen is on offer — which is the same question as whether it can be left.
 *
 * One control does both, so anything that hides it strands whoever pressed it. The bug these are
 * written for: the header worked this out from `draggable`, which is false whenever the dock shows
 * a single pane — and a pane maximised without a companion *is* a single pane. So every panel
 * without a companion could be made full screen and then only closed, with Esc the sole way back
 * and nothing on screen saying so.
 */

test("every panel can be maximised in the ordinary layout", () => {
	for (const kind of ["files", "file", "terminal", "review", "tasks", "browser"] as const) {
		assert.equal(canToggleMaximized(kind, { compact: false, maximized: null }), true, kind);
	}
});

test("a maximised panel can always be un-maximised — including alone, which is the whole bug", () => {
	for (const kind of ["files", "file", "terminal", "review", "tasks", "browser"] as const) {
		assert.equal(canToggleMaximized(kind, { compact: false, maximized: { panes: [kind] } }), true, kind);
	}
});

test("the conversation is never offered full screen: it is what the dock is already showing", () => {
	assert.equal(canToggleMaximized("conversation", { compact: false, maximized: null }), false);
});

test("the collapsed layout offers no full screen, because one pane is all there is room for", () => {
	assert.equal(canToggleMaximized("terminal", { compact: true, maximized: null }), false);
});

test("a window dragged narrow while full screen is on still offers the way out", () => {
	assert.equal(canToggleMaximized("terminal", { compact: true, maximized: { panes: ["terminal"] } }), true);
});
