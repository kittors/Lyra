import assert from "node:assert/strict";
import { test } from "node:test";
import { popOutPanel, toggleScopedPanel, usePanelWindows, watchPanelWindows } from "../../src/features/dock/popout.ts";
import { usePaneDock } from "../../src/features/dock/pane-store.ts";
import { useDock } from "../../src/features/dock/store.ts";
import { defaultTree, has, insert } from "../../src/features/dock/tree.ts";

function reset() {
	window.localStorage.clear();
	usePaneDock.setState({ trees: {}, sizes: {}, drag: null, maximized: {} });
	useDock.setState({ tree: defaultTree() });
	usePanelWindows.setState({ panels: [], opening: [] });
}

test("an overfull tile opens a native panel once and leaves the chat tree intact", async () => {
	reset();
	const opened: unknown[] = [];
	Reflect.set(window, "lyra", { windows: { openPanel: async (input: unknown) => { opened.push(input); return { ok: true }; } } });
	usePaneDock.getState().rememberSize("width", { width: 700, height: 400 });
	const tree = usePaneDock.getState().tree("width");
	toggleScopedPanel("width", "browser");
	await Promise.resolve();
	assert.equal(usePaneDock.getState().tree("width"), tree);
	assert.deepEqual(opened, [{ kind: "browser", scope: "width", sessionId: "width" }]);
	assert.equal(has(tree, "browser"), false);
});

test("failed native creation restores the original panel even after its tile became too small", async () => {
	reset();
	Reflect.set(window, "lyra", { windows: { openPanel: async () => { throw new Error("native window refused"); } } });
	usePaneDock.getState().open("width", "terminal");
	const before = usePaneDock.getState().tree("width");
	usePaneDock.getState().rememberSize("width", { width: 500, height: 350 });
	await assert.rejects(popOutPanel({ dock: "pane", scope: "width", kind: "terminal", sessionId: "width" }), /native window refused/);
	assert.equal(usePaneDock.getState().tree("width"), before);
	assert.equal(usePanelWindows.getState().opening.length, 0);
	assert.deepEqual(JSON.parse(window.localStorage.getItem("dw:homes") ?? "{}"), {});
});

test("a rejected native creation does not undo a different panel opened during the handoff", async () => {
	reset();
	const result = Promise.withResolvers<{ok:boolean}>();
	Reflect.set(window, "lyra", { windows: { openPanel: () => result.promise } });
	usePaneDock.getState().open("width", "terminal");
	const transfer = popOutPanel({dock:"pane",scope:"width",kind:"terminal",sessionId:"width"});
	usePaneDock.getState().open("width", "files");
	result.resolve({ok:false});
	assert.equal(await transfer, false);
	assert.ok(has(usePaneDock.getState().tree("width"),"terminal"));
	assert.ok(has(usePaneDock.getState().tree("width"),"files"));
	assert.equal(usePanelWindows.getState().opening.length,0);
});

test("a window dock refuses a return without room and restores it after resize", async () => {
	reset();
	let restore = (_input: { kind: string; scope: string }) => {};
	const closed: unknown[] = [];
	Reflect.set(window, "lyra", { windows: {
		list: async () => ({ panels: [{ kind: "browser", scope: "window" }] }),
		onChanged: () => () => {},
		onRestorePanel: (listener: typeof restore) => { restore = listener; return () => {}; },
		closePanel: async (input: unknown) => { closed.push(input); return { ok: true }; },
	} });
	const rest = insert(defaultTree(), "terminal", { kind: "conversation", side: "bottom" });
	const before = insert(rest, "browser", { kind: "terminal", side: "bottom" });
	useDock.setState({ tree: rest, viewport: { width: 590, height: 450, conversation: { width: 420, height: 260 }, compact: false } });
	window.localStorage.setItem("dw:homes", JSON.stringify({ "window:browser": { dock: "window", scope: "window", before, rest } }));
	const stop = watchPanelWindows();
	await Promise.resolve();
	restore({ kind: "browser", scope: "window" });
	assert.equal(useDock.getState().tree, rest);
	assert.equal(closed.length, 0);
	assert.ok(window.localStorage.getItem("dw:homes")?.includes("window:browser"));
	useDock.setState({ viewport: { width: 900, height: 800, conversation: { width: 420, height: 260 }, compact: false } });
	restore({ kind: "browser", scope: "window" });
	assert.deepEqual(useDock.getState().tree, before);
	assert.equal(closed.length, 1);
	stop();
});

test("a restored tool whose live conversation is too small reopens its native window", async () => {
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
	assert.deepEqual(opened, [{ kind: "terminal", scope: "width", sessionId: "width" }]);
	assert.deepEqual(JSON.parse(window.localStorage.getItem("dw:homes") ?? "{}")["width:terminal"], home);
	assert.equal(has(usePaneDock.getState().tree("width"), "terminal"), false);
	stop();
});
