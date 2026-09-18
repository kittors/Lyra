/**
 * Conversation tiling belongs to the window, not the project under the focused chat.
 */

import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

import { flushSplit, loadSplit, saveSplit, storageKey } from "../src/features/split/persist.ts";
import { defaultTree, firstSession, leafCount, leafOf, splitLeaf } from "../src/features/split/tree.ts";

const memory = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
	configurable: true,
	value: {
		getItem: (key: string) => memory.get(key) ?? null,
		setItem: (key: string, value: string) => {
			memory.set(key, value);
		},
		removeItem: (key: string) => {
			memory.delete(key);
		},
		key: (index: number) => [...memory.keys()][index] ?? null,
		get length() {
			return memory.size;
		},
	},
});
Object.defineProperty(globalThis, "window", {
	configurable: true,
	value: {
		localStorage: globalThis.localStorage,
		addEventListener: () => {},
	},
});

const { useSplit } = await import("../src/features/split/store.ts");

function mixed() {
	let tree = splitLeaf(leafOf("proj-a"), "proj-a", "proj-b", "right")!;
	tree = splitLeaf(tree, "proj-a", "proj-c", "bottom")!;
	return tree;
}

beforeEach(() => {
	flushSplit();
	memory.clear();
	useSplit.setState({ tree: defaultTree(), focused: null, windowId: "" });
});

test("a saved tiling is keyed by the window, not the project", () => {
	const tree = mixed();
	saveSplit("primary", tree, "proj-b");
	flushSplit();
	assert.ok(memory.get(storageKey("primary")));
	assert.equal([...memory.keys()].some((key) => key.includes("/repo")), false);
	const loaded = loadSplit("primary", "/other/repo");
	assert.equal(leafCount(loaded.tree), 3);
	assert.equal(loaded.focused, "proj-b");
});

test("hydrate keeps a live mix when the focused project changes", () => {
	const tree = mixed();
	useSplit.setState({ tree, focused: "proj-b", windowId: "primary" });
	useSplit.getState().hydrate("primary", new Set(["proj-a", "proj-b", "proj-c", "other"]), "/other/repo");
	assert.equal(useSplit.getState().tree, tree);
	assert.equal(useSplit.getState().focused, "proj-b");
	assert.equal(firstSession(useSplit.getState().tree), "proj-a");
});

test("forgetMissing does not wipe a live tree when the list has not arrived", () => {
	const tree = mixed();
	useSplit.setState({ tree, focused: "proj-b", windowId: "primary" });
	useSplit.getState().forgetMissing(new Set());
	assert.equal(useSplit.getState().tree, tree);
});

test("forgetMissing drops a conversation that is genuinely gone", () => {
	const tree = mixed();
	useSplit.setState({ tree, focused: "proj-b", windowId: "primary" });
	useSplit.getState().forgetMissing(new Set(["proj-a", "proj-c"]));
	assert.equal(leafCount(useSplit.getState().tree), 2);
	assert.equal(useSplit.getState().focused, null);
});
