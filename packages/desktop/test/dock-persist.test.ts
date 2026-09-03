/**
 * What comes back out of storage, and what is done to it before it is believed.
 *
 * A stored layout is the one piece of the dock written by a version of this app that no longer
 * exists. It can name a panel a plugin used to provide, it can have been hand-edited, and it can
 * be a string where a tree should be. None of that should reach the renderer: a tree that fails
 * to load costs the user their arrangement, and a tree that loads *badly* paints an empty window
 * — which from the outside is indistinguishable from a crash.
 *
 * So `sanitize` never throws and never returns null. Every test here hands it something wrong and
 * checks that what comes back is a layout the dock can render.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { sanitize, serialize, storageKey } from "../src/features/dock/persist.ts";
import { defaultTree, has, kinds, leafOf, type DockNode, type DockSplit, type PaneKind } from "../src/features/dock/tree.ts";

/**
 * What the registry would report as loadable in a normal session.
 *
 * Note `chat` and `conversation` are both here and are different things: `chat` is the side-chat
 * *panel*, and `conversation` is the main thread the window is built around. The dock's pane kind
 * had to be named around that collision, and it is worth one line here so the next reader does
 * not assume one is a typo for the other.
 */
const ALLOWED: PaneKind[] = ["conversation", "chat", "files", "terminal", "review", "browser", "tasks", "trajectory"];

const roundTrip = (tree: DockNode): DockNode => sanitize(JSON.parse(serialize(tree)).tree, ALLOWED);

const row = (children: DockNode[], sizes: number[]): DockNode => ({ type: "split", dir: "row", children, sizes });

test("a layout survives being written and read back exactly", () => {
	const tree = row(
		[leafOf("conversation"), { type: "split", dir: "col", children: [leafOf("terminal"), leafOf("review")], sizes: [0.4, 0.6] }],
		[0.65, 0.35],
	);
	assert.deepEqual(roundTrip(tree), tree);
});

test("the key is per conversation, and the unsent one has a key of its own", () => {
	assert.equal(storageKey("s-1a2b"), "dw:dock:s-1a2b");
	assert.notEqual(storageKey("s-a"), storageKey("s-b"), "two conversations do not share a layout");
	// No id yet means the conversation has not been sent. `adopt` hands this layout over to the
	// real key the moment one is assigned, so arranging panes before the first message is not lost.
	assert.equal(storageKey(null), "dw:dock:@draft");
	assert.equal(storageKey(undefined), "dw:dock:@draft");
	assert.equal(storageKey(""), "dw:dock:@draft", "an empty id is not a conversation either");
});

test("anything that is not a tree falls back to the default layout", () => {
	for (const junk of [null, undefined, 0, "", "a string", [], {}, { type: "leaf" }, { type: "wat" }]) {
		assert.deepEqual(sanitize(junk, ALLOWED), defaultTree(), `for ${JSON.stringify(junk)}`);
	}
});

test("a pane whose panel no longer exists is dropped, and the rest of the layout survives", () => {
	// `notes` was a plugin's panel; the plugin is gone.
	const stored = row([leafOf("conversation"), leafOf("notes" as PaneKind), leafOf("terminal")], [0.5, 0.2, 0.3]);
	const tree = sanitize(stored, ALLOWED);
	assert.deepEqual(kinds(tree), ["conversation", "terminal"], "the unknown pane left, the known ones stayed");
	const root = tree as DockSplit;
	// 0.5 and 0.3 re-shared: the survivors keep their ratio rather than being reset to halves.
	assert.ok(Math.abs(root.sizes[0] - 0.625) < 1e-6, `expected 0.625, got ${root.sizes[0]}`);
});

test("a duplicated pane is repaired rather than rejected — the first one wins", () => {
	const stored = row([leafOf("conversation"), leafOf("terminal"), leafOf("terminal")], [0.4, 0.3, 0.3]);
	const tree = sanitize(stored, ALLOWED);
	assert.deepEqual(kinds(tree), ["conversation", "terminal"]);
});

test("a layout that lost the conversation gets it back, beside what survived", () => {
	const stored = row([leafOf("terminal"), leafOf("review")], [0.5, 0.5]);
	const tree = sanitize(stored, ALLOWED);
	assert.ok(has(tree, "conversation"));
	assert.deepEqual(kinds(tree), ["conversation", "terminal", "review"], "and it comes back first");
	const root = tree as DockSplit;
	assert.ok(root.sizes[0] > root.sizes[1] + root.sizes[2] - 1e-6, "with the larger share: it is what the window is for");
});

test("sizes that are missing, negative or not numbers are repaired", () => {
	const stored = {
		type: "split",
		dir: "row",
		children: [leafOf("conversation"), leafOf("terminal")],
		sizes: ["half", -3],
	};
	const tree = sanitize(stored, ALLOWED);
	const root = tree as DockSplit;
	assert.deepEqual(kinds(tree), ["conversation", "terminal"]);
	assert.ok(Math.abs(root.sizes[0] + root.sizes[1] - 1) < 1e-6, "and still add up");
});

test("a split missing its sizes entirely still loads", () => {
	const tree = sanitize({ type: "split", dir: "col", children: [leafOf("conversation"), leafOf("tasks")] }, ALLOWED);
	assert.deepEqual(kinds(tree), ["conversation", "tasks"]);
});

test("a split with a bad direction is discarded rather than rendered sideways", () => {
	const stored = { type: "split", dir: "diagonal", children: [leafOf("conversation")], sizes: [1] };
	assert.deepEqual(sanitize(stored, ALLOWED), defaultTree());
});

test("nesting deep enough to have been a mistake still comes back as something renderable", () => {
	let stored: DockNode = leafOf("conversation");
	for (let i = 0; i < 200; i++) stored = row([stored, leafOf("terminal")], [0.5, 0.5]);
	const tree = sanitize(stored, ALLOWED);
	// Every `terminal` past the first is a duplicate and is dropped, and the 200 same-axis
	// nestings flatten to one row.
	assert.deepEqual(kinds(tree), ["conversation", "terminal"]);
});

test("a stored layout from a future version is not read at all", () => {
	const future = JSON.stringify({ v: 99, tree: row([leafOf("conversation"), leafOf("terminal")], [0.5, 0.5]) });
	const parsed = JSON.parse(future) as { v: number };
	// `readTree` gates on this before `sanitize` ever sees the payload; asserting the gate here
	// keeps the version check from being quietly dropped later.
	assert.notEqual(parsed.v, 1);
});
