/**
 * Reading a conversation's panel layout back, which is the one place per-conversation layouts can
 * be lost.
 *
 * Two things have to be true at once and they pull in opposite directions:
 *
 *   — A blank conversation you arranged panes in gets its id only when the first message is stored.
 *     Its screen goes from `@draft` to that id, and reading the new key would find nothing and throw
 *     away an arrangement made seconds earlier.
 *   — Clicking an existing conversation from a blank one *also* takes the screen from `@draft` to an
 *     id. There, carrying the draft's panes across is exactly the loss per-conversation layouts exist
 *     to prevent. The caller says which it is (`draftFrom`), so nothing here has to guess.
 *
 * And one thing that only happens once per installation: panels used to have two homes — a window
 * layer across every screen (`dw:dock:<id>`) and each screen's own (`dw:panedock:<id>`). They are
 * one now, and whatever either held for a conversation comes back.
 */

import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

import { flushTree, legacyStorageKey, paneStorageKey, serialize } from "../src/features/dock/persist.ts";
import { has, kinds, leafOf, type DockNode, type PaneKind } from "../src/features/dock/tree.ts";

const ALLOWED: PaneKind[] = ["conversation", "chat", "files", "terminal", "review", "browser", "tasks"];

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

const { usePaneDock } = await import("../src/features/dock/pane-store.ts");

const withPanel = (kind: PaneKind): DockNode => ({
	type: "split",
	dir: "row",
	children: [leafOf("conversation"), leafOf(kind)],
	sizes: [0.7, 0.3],
});

/**
 * A freshly launched window: nothing read yet.
 *
 * `flushTree` first, because writes are debounced by a tenth of a second — without it the previous
 * test's pending write lands in the middle of this one and overwrites what it just seeded.
 */
function launch(): void {
	flushTree();
	saved.clear();
	usePaneDock.setState({ trees: {}, sizes: {}, maximized: {}, focused: {}, crossRatio: {}, drag: null, host: null });
}

/** Write a layout to disk as if a previous session had left it there. */
function store(key: string, tree: DockNode): void {
	saved.set(key, serialize(tree));
}

const tree = (scope: string) => usePaneDock.getState().tree(scope);

beforeEach(launch);

test("a conversation's own saved layout comes back", () => {
	store(paneStorageKey("s-1"), withPanel("review"));
	usePaneDock.getState().hydrate("s-1", ALLOWED);

	assert.ok(has(tree("s-1"), "review"), "the saved panel should be back");
});

test("a blank conversation that is sent keeps the panes it was arranged with", () => {
	usePaneDock.getState().hydrate("@draft", ALLOWED);
	// Arranged before the first message — which is when anyone sets up to work.
	usePaneDock.getState().open("@draft", "terminal");

	// `send` stores the conversation, the id arrives, and the screen says where it came from.
	usePaneDock.getState().hydrate("s-new", ALLOWED, { draftFrom: "@draft" });

	assert.ok(has(tree("s-new"), "terminal"), "the arrangement should have come with it");
	flushTree();
	assert.ok(saved.get(paneStorageKey("s-new"))?.includes("terminal"), "and been saved under the new key");
	assert.ok(has(tree("@draft"), "terminal"), "the next blank conversation starts from the same arrangement");
});

test("clicking an existing conversation from a blank one does not hand it the blank one's panes", () => {
	usePaneDock.getState().hydrate("@draft", ALLOWED);
	usePaneDock.getState().open("@draft", "terminal");

	usePaneDock.getState().hydrate("s-old", ALLOWED);

	assert.deepEqual(kinds(tree("s-old")), ["conversation"]);
});

test("a conversation's own layout wins even when it was just sent from a blank one", () => {
	store(paneStorageKey("s-1"), withPanel("review"));
	usePaneDock.getState().hydrate("@draft", ALLOWED);
	usePaneDock.getState().open("@draft", "terminal");

	usePaneDock.getState().hydrate("s-1", ALLOWED, { draftFrom: "@draft" });

	assert.deepEqual(kinds(tree("s-1")).sort(), ["conversation", "review"]);
});

test("an untouched blank conversation carries nothing", () => {
	usePaneDock.getState().hydrate("@draft", ALLOWED);
	usePaneDock.getState().hydrate("s-blank", ALLOWED, { draftFrom: "@draft" });

	assert.deepEqual(kinds(tree("s-blank")), ["conversation"]);
});

test("each conversation has its own", () => {
	store(paneStorageKey("s-1"), withPanel("review"));
	store(paneStorageKey("s-2"), withPanel("terminal"));
	usePaneDock.getState().hydrate("s-1", ALLOWED);
	usePaneDock.getState().hydrate("s-2", ALLOWED);

	assert.ok(has(tree("s-1"), "review") && !has(tree("s-1"), "terminal"));
	assert.ok(has(tree("s-2"), "terminal") && !has(tree("s-2"), "review"), "one conversation's panel must not follow another");
});

test("reading the same conversation twice does not reset it to what is on disk", () => {
	store(paneStorageKey("s-1"), withPanel("review"));
	usePaneDock.getState().hydrate("s-1", ALLOWED);
	usePaneDock.getState().open("s-1", "terminal");

	// A screen remounting must not reset the layout under the user's hands.
	usePaneDock.getState().hydrate("s-1", ALLOWED);
	assert.ok(has(tree("s-1"), "terminal"));
});

test("a stored layout naming a panel that no longer exists still loads, minus that panel", () => {
	store(paneStorageKey("s-1"), {
		type: "split",
		dir: "row",
		children: [leafOf("conversation"), leafOf("notes" as PaneKind), leafOf("review")],
		sizes: [0.5, 0.2, 0.3],
	});
	usePaneDock.getState().hydrate("s-1", ALLOWED);

	assert.deepEqual(kinds(tree("s-1")).sort(), ["conversation", "review"]);
});

test("a layout from the old window layer comes back inside the conversation's own screen", () => {
	// A single screen with a task panel beside it, from before panels had one home.
	store(legacyStorageKey("s-1"), withPanel("tasks"));
	saved.set("dw:dock:at", "s-1");

	usePaneDock.getState().hydrate("s-1", ALLOWED);

	assert.ok(has(tree("s-1"), "tasks"), "the task panel belongs to this conversation and comes back with it");
	flushTree();
	assert.ok(saved.get(paneStorageKey("s-1"))?.includes("tasks"), "written to the one key there is now");
	assert.equal(saved.has(legacyStorageKey("s-1")), false, "and the old key is gone, so it is not merged twice");
	assert.equal(saved.has("dw:dock:at"), false, "the old layer's bookmark means nothing any more");
});

test("both old homes of one conversation are merged, nothing dropped", () => {
	// Task panel opened on a single screen; browser opened in that conversation's screen during a split.
	store(legacyStorageKey("s-1"), withPanel("tasks"));
	store(paneStorageKey("s-1"), withPanel("browser"));

	usePaneDock.getState().hydrate("s-1", ALLOWED);

	assert.deepEqual(kinds(tree("s-1")).sort(), ["browser", "conversation", "tasks"]);
	const top = tree("s-1");
	assert.ok(top.type === "split" && top.dir === "row", "the full-size arrangement is the base");
});
