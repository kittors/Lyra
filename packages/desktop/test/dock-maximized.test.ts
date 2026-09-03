/**
 * What full screen survives, and what ends it.
 *
 * Full screen used to be dropped by *any* change to the tree — a rule written when it was a path
 * into that tree, kept after it became a set of pane kinds, by which point the reason for it was
 * gone. What that cost was the two most ordinary things anyone does while a pane fills the dock:
 * clicking a file in a maximised tree collapsed the layout instead of opening the file beside it,
 * and closing one of a maximised pair took the other one out of full screen with it.
 *
 * So the question each of these asks is the same: after this, is the user still looking at what
 * they chose to look at? Driven through the real store, because the bug was in how its actions
 * compose — `open` calling `commit` — rather than in either one alone.
 */

import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

// The store persists through `localStorage` on every commit. Nothing here is about persistence;
// this is the smallest thing that lets the actions run outside a browser.
const store: Record<string, string> = {};
(globalThis as { window?: unknown }).window = {
	localStorage: {
		getItem: (key: string) => store[key] ?? null,
		setItem: (key: string, value: string) => {
			store[key] = value;
		},
		removeItem: (key: string) => {
			delete store[key];
		},
	},
	// Writes are debounced through `window.setTimeout` and flushed on `pagehide`. Neither matters
	// here — the timer runs the same write these tests are not looking at.
	setTimeout: (fn: () => void, ms?: number) => setTimeout(fn, ms),
	clearTimeout: (id: number) => clearTimeout(id),
	addEventListener: () => {},
	removeEventListener: () => {},
};

const { useDock } = await import("../src/features/dock/store.ts");
const { defaultTree, kinds } = await import("../src/features/dock/tree.ts");

/** How the file panel names the tree it belongs beside — see `BUILTIN_PANELS`. */
const BESIDE_TREE = { kind: "files", side: "bottom" } as const;
const BESIDE_FILE = { kind: "file", side: "left", share: 0.3 } as const;

beforeEach(() => {
	useDock.setState({ tree: defaultTree(), maximized: null, focused: "conversation", drag: null });
});

/** Which panes are filling the dock, or null when the layout is showing all of them. */
function full(): string[] | null {
	return useDock.getState().maximized?.panes ?? null;
}

test("clicking a file in a maximised tree opens it beside the tree, still full screen", () => {
	/*
	 * The reported bug. The tree fills the window, you click a file, and what you want is the file
	 * next to it — the arrangement full screen exists to give you. What happened instead was the
	 * whole dock collapsing back to its ordinary layout, showing the file in a pane a third the
	 * size, because opening a pane reshaped the tree and any reshaping ended full screen.
	 */
	const dock = useDock.getState();
	dock.open("files");
	dock.toggleMaximized("files", "file");
	assert.deepEqual(full(), ["files"], "the tree alone, since the file pane is not open yet");

	dock.open("file", BESIDE_TREE);

	assert.deepEqual(full(), ["files", "file"], "the file joined it rather than ending it");
	assert.equal(useDock.getState().focused, "file");
});

test("closing one of a maximised pair leaves the other one full screen", () => {
	const dock = useDock.getState();
	dock.open("files");
	dock.open("file", BESIDE_TREE);
	dock.toggleMaximized("file", "files");
	assert.deepEqual(full(), ["files", "file"]);

	dock.close("files");

	assert.deepEqual(full(), ["file"], "the file kept the dock it was already filling");
	assert.ok(!kinds(useDock.getState().tree).includes("files"));
});

test("closing the only maximised pane ends full screen rather than leaving an empty one", () => {
	const dock = useDock.getState();
	dock.open("terminal");
	dock.toggleMaximized("terminal");
	dock.close("terminal");

	assert.equal(full(), null);
});

test("opening an unrelated panel ends full screen, so the panel can be seen at all", () => {
	/*
	 * The other half of the rule. A pane opened beside the maximised one belongs with it; a pane
	 * opened from the menu does not, and keeping full screen would put it behind what is already
	 * filling the dock — indistinguishable from the menu having done nothing.
	 */
	const dock = useDock.getState();
	dock.open("files");
	dock.toggleMaximized("files", "file");

	dock.open("terminal");

	assert.equal(full(), null);
	assert.equal(useDock.getState().focused, "terminal");
});

test("opening beside a pane that is not full screen does not put anything full screen", () => {
	const dock = useDock.getState();
	dock.open("files");
	dock.open("file", BESIDE_TREE);

	assert.equal(full(), null, "nothing was maximised, and opening a pane is not a reason to start");
});

test("the pair goes full screen together, whichever half is asked", () => {
	const dock = useDock.getState();
	dock.open("files");
	dock.open("file", BESIDE_TREE);

	dock.toggleMaximized("files", "file");
	assert.deepEqual(full(), ["files", "file"], "asked of the tree");

	dock.toggleMaximized("files", "file");
	assert.equal(full(), null, "and off again");

	dock.toggleMaximized("file", "files");
	assert.deepEqual(full(), ["files", "file"], "asked of the file");
});

test("reopening the tree from the file's dropdown joins the file's full screen", () => {
	/*
	 * The dropdown's 「在面板中打开」 in the state it is most useful from: the tree was closed, the
	 * file is filling the window, and the pane it asks for should arrive beside it rather than
	 * dropping the window out of full screen to make room.
	 */
	const dock = useDock.getState();
	dock.open("files");
	dock.open("file", BESIDE_TREE);
	dock.close("files");
	dock.toggleMaximized("file", "files");
	assert.deepEqual(full(), ["file"]);

	dock.open("files", BESIDE_FILE);

	/*
	 * Order matters here: the set is laid out left to right, so this is also the assertion that the
	 * tree arrives on the left of the file rather than the right.
	 */
	assert.deepEqual(full(), ["files", "file"], "both, still full screen, names on the left");
});

/*
 * Rearranging the dock, and what that does to full screen.
 *
 * These are the combinations that go wrong quietly. A pane in flight is *out* of the tree — that is
 * how the drag preview works — so anything remembering a set of panes across a drag has to survive
 * one of them being briefly absent. And a pair that was maximised because it was adjacent can stop
 * being adjacent without either pane going anywhere.
 */

test("moving a pane leaves full screen, rather than moving it somewhere unwatchable", () => {
	const dock = useDock.getState();
	dock.open("files");
	dock.open("file", BESIDE_TREE);
	dock.toggleMaximized("files", "file");

	dock.moveTo("file", { side: "left", kind: null });

	assert.equal(full(), null, "the dock is showing every pane again, which is where a move lands");
});

test("a drag ends full screen on the first frame, not on the pane that was picked up", () => {
	/*
	 * The failure this prevents: the carried pane is missing from the tree for the whole drag, so a
	 * set that merely filtered by what is present would drop it — and put the pane back afterwards
	 * with the full screen it was dragged out of no longer including it.
	 */
	const dock = useDock.getState();
	dock.open("files");
	dock.open("file", BESIDE_TREE);
	dock.toggleMaximized("files", "file");
	const before = useDock.getState().tree;

	dock.preview(before, "file", { side: "left", kind: null });

	assert.equal(full(), null);
});

test("a pair dragged apart is enlarged one pane at a time", () => {
	// `areAdjacent` is what decides a pair, and two panes at opposite ends of the dock are not one.
	const dock = useDock.getState();
	dock.open("files");
	dock.open("file", BESIDE_TREE);
	dock.moveTo("file", { side: "left", kind: null });

	dock.toggleMaximized("files", "file");

	assert.deepEqual(full(), ["files"], "only the one asked for");
});

test("the pane a maximised one is dropped next to becomes its neighbour, not its full screen", () => {
	const dock = useDock.getState();
	dock.open("terminal");
	dock.toggleMaximized("terminal");
	assert.deepEqual(full(), ["terminal"]);

	dock.moveTo("terminal", { side: "bottom", kind: "conversation" });

	assert.equal(full(), null);
	assert.ok(kinds(useDock.getState().tree).includes("terminal"), "and it is still open");
});

/*
 * How a pair divides the room it shares.
 *
 * A panel declares its own share of the pair — the tree asks for a third — and which side it lands
 * on must not change the answer. It used to: the share was applied against whichever pane happened
 * to be to the *left*, which is the partner only when the new pane was inserted after it. Opening
 * the tree on the file's left therefore divided the tree against the conversation and left the pair
 * itself split evenly, so the "narrower" tree came out wider than the file it was narrowing for.
 */

/** A pane's share of the two it is beside, read back off the tree. */
function shareOf(kind: string, partner: string): number {
	const tree = useDock.getState().tree;
	const find = (node: never, want: string): number[] | null => {
		const n = node as { type: string; kind?: string; children?: never[] };
		if (n.type === "leaf") return n.kind === want ? [] : null;
		for (let i = 0; i < (n.children?.length ?? 0); i++) {
			const under = find(n.children![i], want);
			if (under) return [i, ...under];
		}
		return null;
	};
	const a = find(tree as never, kind);
	const b = find(tree as never, partner);
	if (!a || !b) return Number.NaN;
	let node = tree as { children?: never[]; sizes?: number[] };
	for (const step of a.slice(0, -1)) node = (node.children as never[])[step];
	const mine = node.sizes?.[a[a.length - 1]] ?? 0;
	const theirs = node.sizes?.[b[b.length - 1]] ?? 0;
	return mine / (mine + theirs);
}

test("a panel gets the share it asked for when it opens after its partner", () => {
	const dock = useDock.getState();
	dock.open("file");
	dock.open("files", { kind: "file", side: "right", share: 0.3 } as never);

	assert.ok(Math.abs(shareOf("files", "file") - 0.3) < 0.001, `got ${shareOf("files", "file")}`);
});

test("and the same share when it opens before its partner", () => {
	// The direction 「在面板中打开」 uses. Identical claim, opposite side — and the one that was wrong.
	const dock = useDock.getState();
	dock.open("file");
	dock.open("files", { kind: "file", side: "left", share: 0.3 } as never);

	assert.ok(Math.abs(shareOf("files", "file") - 0.3) < 0.001, `got ${shareOf("files", "file")}`);
});

test("dividing a pair never touches the pane on the other side of it", () => {
	/*
	 * The failure that made the tree wider than the file: the share was applied to the boundary
	 * between the tree and the *conversation*, which is not the pair at all.
	 */
	const dock = useDock.getState();
	dock.open("file");
	const conversationBefore = (useDock.getState().tree as { sizes?: number[] }).sizes?.[0] ?? 0;

	dock.open("files", { kind: "file", side: "left", share: 0.3 } as never);

	// Only the pair's own boundary moved; the conversation is not part of that pair.
	const after = (useDock.getState().tree as { sizes?: number[] }).sizes?.[0] ?? 0;
	assert.ok(
		Math.abs(after - conversationBefore) < 0.001,
		`the conversation went from ${conversationBefore} to ${after}`,
	);
});
