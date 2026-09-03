/**
 * Pointing the dock at a conversation, which is the one place per-conversation layouts can be lost.
 *
 * Two things have to be true at once and they pull in opposite directions:
 *
 *   — A conversation you arranged panes in gets its id only when the first message is stored. The
 *     scope goes from `null` to that id, and reading the new key would find nothing and reset the
 *     dock, throwing away an arrangement made seconds earlier.
 *   — Clicking an existing conversation for the first time after launch *also* takes the scope
 *     from `null` to an id. There, the stored layout is the whole point, and carrying the draft's
 *     over it is exactly the loss per-conversation layouts exist to prevent.
 *
 * They were not distinguished: the first branch fired on both, so the first conversation opened in
 * every session had its layout overwritten by an untouched draft. Nothing caught it because
 * `adopt` had no test at all — the store needs a `window`, and everything else about the dock is
 * testable without one.
 */

import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

import { flushTree, serialize, storageKey } from "../src/features/dock/persist.ts";
import { defaultTree, has, kinds, leafOf, type DockNode, type PaneKind } from "../src/features/dock/tree.ts";

const ALLOWED: PaneKind[] = ["conversation", "chat", "files", "terminal", "review", "browser"];

/** Just enough `window` for the store and its persistence, which is all either of them touches. */
const saved = new Map<string, string>();
Object.defineProperty(globalThis, "window", {
	configurable: true,
	value: {
		localStorage: {
			getItem: (key: string) => saved.get(key) ?? null,
			setItem: (key: string, value: string) => void saved.set(key, value),
			removeItem: (key: string) => void saved.delete(key),
		},
		setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
		clearTimeout: (id: ReturnType<typeof setTimeout>) => clearTimeout(id),
		addEventListener: () => {},
	},
});

const { useDock } = await import("../src/features/dock/store.ts");

const withPanel = (kind: PaneKind): DockNode => ({
	type: "split",
	dir: "row",
	children: [leafOf("conversation"), leafOf(kind)],
	sizes: [0.6, 0.4],
});

/**
 * The state a freshly launched window is in: a draft, nothing adopted yet.
 *
 * `flushTree` first, because writes are debounced by a tenth of a second — without it the previous
 * test's pending write lands in the middle of this one and overwrites what it just seeded.
 */
function launch(): void {
	flushTree();
	saved.clear();
	useDock.setState({ tree: defaultTree(), scope: null, adopted: false, maximized: null, drag: null });
}

/** Write a layout to disk as if a previous session had left it there. */
function store(session: string | null, tree: DockNode): void {
	saved.set(storageKey(session), serialize(tree));
}

beforeEach(launch);

test("a conversation's own saved layout wins over the draft it was clicked from", () => {
	store("s-1", withPanel("review"));
	useDock.getState().adopt(null, ALLOWED);
	useDock.getState().adopt("s-1", ALLOWED);

	assert.ok(has(useDock.getState().tree, "review"), "the saved panel should be back");
	assert.equal(useDock.getState().scope, "s-1");
});

test("and is not overwritten on disk by the draft's", () => {
	store("s-1", withPanel("review"));
	useDock.getState().adopt(null, ALLOWED);
	useDock.getState().adopt("s-1", ALLOWED);

	// The bug was silent until the *next* launch, because the damage was to what was written.
	const back = saved.get(storageKey("s-1"));
	assert.ok(back?.includes("review"), `the stored layout was replaced: ${back}`);
});

test("a draft that was arranged keeps its panes when it is given an id", () => {
	useDock.getState().adopt(null, ALLOWED);
	// Arranged before the first message — which is when anyone sets up to work.
	useDock.getState().open("terminal");
	assert.ok(has(useDock.getState().tree, "terminal"));

	// `send` stores the conversation, and the id arrives.
	useDock.getState().adopt("s-new", ALLOWED);

	assert.ok(has(useDock.getState().tree, "terminal"), "the arrangement should have come with it");
	assert.equal(useDock.getState().scope, "s-new");
	// Writes are debounced, so ask for the one that is pending rather than racing it.
	flushTree();
	assert.ok(saved.get(storageKey("s-new"))?.includes("terminal"), "and been saved under the new key");
});

test("an untouched draft carries nothing into a conversation that has no layout of its own", () => {
	useDock.getState().adopt(null, ALLOWED);
	useDock.getState().adopt("s-blank", ALLOWED);

	assert.deepEqual(kinds(useDock.getState().tree), ["conversation"]);
});

test("moving between two conversations gives each its own", () => {
	store("s-1", withPanel("review"));
	store("s-2", withPanel("terminal"));
	useDock.getState().adopt(null, ALLOWED);

	useDock.getState().adopt("s-1", ALLOWED);
	assert.ok(has(useDock.getState().tree, "review"));

	useDock.getState().adopt("s-2", ALLOWED);
	assert.ok(has(useDock.getState().tree, "terminal"));
	assert.ok(!has(useDock.getState().tree, "review"), "the last one's panel must not follow");

	useDock.getState().adopt("s-1", ALLOWED);
	assert.ok(has(useDock.getState().tree, "review"), "and going back returns to what was there");
});

test("adopting the same conversation twice does nothing", () => {
	store("s-1", withPanel("review"));
	useDock.getState().adopt(null, ALLOWED);
	useDock.getState().adopt("s-1", ALLOWED);
	useDock.getState().open("terminal");

	// A re-render must not reset the dock to what is on disk under the user's hands.
	useDock.getState().adopt("s-1", ALLOWED);
	assert.ok(has(useDock.getState().tree, "terminal"));
});

test("a stored layout naming a panel that no longer exists still loads, minus that panel", () => {
	store("s-1", {
		type: "split",
		dir: "row",
		children: [leafOf("conversation"), leafOf("notes" as PaneKind), leafOf("review")],
		sizes: [0.5, 0.2, 0.3],
	});
	useDock.getState().adopt(null, ALLOWED);
	useDock.getState().adopt("s-1", ALLOWED);

	assert.deepEqual(kinds(useDock.getState().tree).sort(), ["conversation", "review"]);
});
