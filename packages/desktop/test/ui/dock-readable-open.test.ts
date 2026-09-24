import assert from "node:assert/strict";
import { test } from "node:test";
import { popOutPanel, provideScope, toggleScopedPanel, usePanelWindows, watchPanelWindows } from "../../src/features/dock/popout.ts";
import { usePaneDock } from "../../src/features/dock/pane-store.ts";
import { defaultTree, has, insert } from "../../src/features/dock/tree.ts";

function reset() {
	window.localStorage.clear();
	usePaneDock.setState({ trees: {}, sizes: {}, drag: null, maximized: {}, focused: {}, crossRatio: {}, host: null });
	usePanelWindows.setState({ panels: [], opening: [] });
	provideScope(() => "width");
}

/** Coming back may first bring its conversation on screen, so it finishes a tick later. */
const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

/*
 * An overfull tile keeps its panel — it does not hand it to a native window.
 *
 * This used to assert the opposite. `split-window-conflicts.md` §6 removed that route: it fired on an
 * ordinary resize, and the panel did not work once it arrived. The guards for the new rule are in
 * `dock-no-auto-popout.test.ts`; what is left here is the half that still matters — the tile's
 * own tree is the thing that changes.
 */
test("an overfull tile takes the panel into its own tree", async () => {
	reset();
	const opened: unknown[] = [];
	Reflect.set(window, "lyra", { windows: { openPanel: async (input: unknown) => { opened.push(input); return { ok: true }; } } });
	usePaneDock.getState().rememberSize("width", { width: 700, height: 400 });
	toggleScopedPanel("width", "browser");
	await Promise.resolve();
	assert.ok(has(usePaneDock.getState().tree("width"), "browser"));
	assert.deepEqual(opened, []);
});

test("failed native creation restores the original panel even after its tile became too small", async () => {
	reset();
	Reflect.set(window, "lyra", { windows: { openPanel: async () => { throw new Error("native window refused"); } } });
	usePaneDock.getState().open("width", "terminal");
	const before = usePaneDock.getState().tree("width");
	usePaneDock.getState().rememberSize("width", { width: 500, height: 350 });
	await assert.rejects(popOutPanel({ scope: "width", kind: "terminal", sessionId: "width" }), /native window refused/);
	assert.equal(usePaneDock.getState().tree("width"), before);
	assert.equal(usePanelWindows.getState().opening.length, 0);
	assert.deepEqual(JSON.parse(window.localStorage.getItem("dw:homes") ?? "{}"), {});
});

test("a rejected native creation does not undo a different panel opened during the handoff", async () => {
	reset();
	const result = Promise.withResolvers<{ok:boolean}>();
	Reflect.set(window, "lyra", { windows: { openPanel: () => result.promise } });
	usePaneDock.getState().open("width", "terminal");
	const transfer = popOutPanel({scope:"width",kind:"terminal",sessionId:"width"});
	usePaneDock.getState().open("width", "files");
	result.resolve({ok:false});
	assert.equal(await transfer, false);
	assert.ok(has(usePaneDock.getState().tree("width"),"terminal"));
	assert.ok(has(usePaneDock.getState().tree("width"),"files"));
	assert.equal(usePanelWindows.getState().opening.length,0);
});

test("a rejected native creation restores its panel after the old neighbour was closed", async () => {
	reset();
	const result = Promise.withResolvers<{ ok: boolean }>();
	Reflect.set(window, "lyra", { windows: { openPanel: () => result.promise } });
	usePaneDock.getState().open("width", "files");
	usePaneDock.getState().open("width", "terminal", { kind: "files", side: "bottom" });
	const transfer = popOutPanel({ scope: "width", kind: "terminal", sessionId: "width" });
	usePaneDock.getState().close("width", "files");
	result.resolve({ ok: false });
	assert.equal(await transfer, false);
	assert.equal(has(usePaneDock.getState().tree("width"), "terminal"), true);
	assert.equal(has(usePaneDock.getState().tree("width"), "files"), false);
});

/*
 * Coming back is a person pressing a button, so it lands even when the dock is full.
 *
 * It used to refuse, leaving the panel in its floating window until the dock was made wider —
 * which paired with the automatic hand-off that has since been removed. On its own that refusal
 * is a button that does nothing and says nothing (`split-window-conflicts.md` §7). The exact
 * departure snapshot is still preferred when it clears the floors; what changed is the fallback.
 */
test("a screen takes a panel back even with no room, using its remembered layout when it fits", async () => {
	reset();
	let restore = (_input: { kind: string; scope: string }) => {};
	const closed: unknown[] = [];
	Reflect.set(window, "lyra", { windows: {
		list: async () => ({ panels: [{ kind: "terminal", scope: "width" }] }),
		onChanged: () => () => {},
		onRestorePanel: (listener: typeof restore) => { restore = listener; return () => {}; },
		closePanel: async (input: unknown) => { closed.push(input); return { ok: true }; },
	} });
	const rest = insert(defaultTree(), "files", { kind: "conversation", side: "bottom" });
	const before = insert(rest, "terminal", { kind: "files", side: "bottom" });
	usePaneDock.setState({ trees: { width: rest }, sizes: { width: { width: 590, height: 450 } } });
	window.localStorage.setItem("dw:homes", JSON.stringify({ "width:terminal": { scope: "width", before, rest } }));
	const stop = watchPanelWindows();
	await settled();
	restore({ kind: "terminal", scope: "width" });
	await settled();
	// No room at 590×450, and it comes back regardless — squeezed, in its screen, reachable.
	assert.ok(has(usePaneDock.getState().tree("width"), "terminal"), "the button did something");
	assert.equal(closed.length, 1, "the floating window closes once its pane is home");
	assert.equal(window.localStorage.getItem("dw:homes")?.includes("width:terminal"), false);

	// With room, the layout it left is restored exactly rather than approximated.
	reset();
	usePaneDock.setState({ trees: { width: rest }, sizes: { width: { width: 900, height: 800 } } });
	window.localStorage.setItem("dw:homes", JSON.stringify({ "width:terminal": { scope: "width", before, rest } }));
	restore({ kind: "terminal", scope: "width" });
	await settled();
	assert.deepEqual(usePaneDock.getState().tree("width"), before);
	stop();
});

/*
 * The anchor a panel remembers may have left while it was away.
 *
 * `insert` against a neighbour that is not in the tree hands back a tree *without* the pane, and
 * the home record is deleted on the way out — so adopting that tree loses the panel for good.
 * That is the failure these two exist for, and it survives the change of policy: what used to be
 * "refuse, keep the record" is now "land it on the root edge", but the pane must be in the tree
 * either way before anything is deleted.
 */
// `window` is a record from before panels had one home: it returns to the screen the person is in.
for (const dock of ["window", "pane"] as const) {
	test(`${dock} return never deletes a home without actually placing the pane`, async () => {
		reset();
		const scope = dock === "window" ? "window" : "width";
		let restore = (_input: { kind: string; scope: string }) => {};
		const closed: unknown[] = [];
		Reflect.set(window, "lyra", { windows: {
			list: async () => ({ panels: [{ kind: "file", scope }, { kind: "files", scope }] }),
			onChanged: () => () => {},
			onRestorePanel: (listener: typeof restore) => { restore = listener; return () => {}; },
			closePanel: async (input: unknown) => { closed.push(input); return { ok: true }; },
		} });
		const rest = insert(defaultTree(), "files", { kind: "conversation", side: "right" });
		const at = { kind: "files", side: "bottom" } as const;
		const home = { dock, scope, at, before: insert(rest, "file", at), rest };
		window.localStorage.setItem("dw:homes", JSON.stringify({ [`${scope}:file`]: home }));
		// Either way the pane lands in the screen `width`: its own, or the one the person is in.
		const resize = (width: number, height: number) => usePaneDock.getState().rememberSize("width", { width, height });
		const current = () => usePaneDock.getState().tree("width");
		usePaneDock.setState({ trees: { width: rest } });
		resize(528, 330);
		const stop = watchPanelWindows();
		try {
			await settled();
			restore({ kind: "file", scope });
			await settled();
			// The anchor is gone, so the remembered edge cannot be used — it lands anyway.
			assert.equal(has(current(), "file"), true, "a vanished anchor falls back to an edge that exists");
			assert.equal(closed.length, 1, "the window closes only because the pane really is home");
			assert.equal(JSON.parse(window.localStorage.getItem("dw:homes") ?? "{}")[`${scope}:file`], undefined);
			resize(900, 800);
			assert.equal(has(current(), "file"), true, "and it stays there once there is room");
		} finally { stop(); }
	});
}

/*
 * Left detached at quit, adopted back on launch — into the dock, not into a new window.
 *
 * This used to assert that a home with no room re-opened the native window. With the floors being
 * what they are that meant a narrow window spat its panels back out on every single launch, which
 * is the cold-start half of `split-window-conflicts.md` §6.
 */
test("a tool left detached at quit comes back to its tile, however small the tile is", async () => {
	reset();
	const opened: unknown[] = [];
	Reflect.set(window, "lyra", { windows: {
		list: async () => ({ panels: [] }),
		onChanged: () => () => {}, onRestorePanel: () => () => {},
		openPanel: async (input: unknown) => { opened.push(input); return { ok: true }; },
	} });
	const rest = defaultTree();
	const before = insert(rest, "terminal", { kind: "conversation", side: "right" });
	const home = { dock: "pane", scope: "width", before, rest, at: { kind: "conversation", side: "right" } };
	usePaneDock.getState().rememberSize("width", { width: 500, height: 350 });
	window.localStorage.setItem("dw:homes", JSON.stringify({ "width:terminal": home }));
	const stop = watchPanelWindows();
	await Promise.resolve();
	await Promise.resolve();
	assert.deepEqual(opened, [], "a cold start does not create windows nobody asked for");
	assert.equal(has(usePaneDock.getState().tree("width"), "terminal"), true);
	assert.equal(JSON.parse(window.localStorage.getItem("dw:homes") ?? "{}")["width:terminal"], undefined);
	stop();
});
