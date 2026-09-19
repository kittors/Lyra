import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";
import type { FilePanelState, FilePanelVersion } from "../shared/file-panel-state.ts";

interface Contents {
	id: number;
	mainFrame: object;
	messages: { channel: string; payload: unknown }[];
}
interface FakeWindow {
	webContents: Contents;
	close(): void;
	isDestroyed(): boolean;
}
type Handler = (event: { sender: Contents; senderFrame: object }, input?: unknown) => unknown;
const fixtureUrl = `data:text/javascript,${encodeURIComponent(`
export const handlers = new Map();
export const windows = new Map();
export const panels = new Map();
export const openedInMain = [];
let quitting = false;
export const setQuitting = value => { quitting = value; };
export const isAppQuitting = () => quitting;
let id = 0;
export function makeWindow() {
  const listeners = new Map();
  let destroyed = false;
  const webContents = { id: ++id, mainFrame: {}, messages: [], isDestroyed: () => false,
    send(channel, payload) { this.messages.push({ channel, payload }); } };
  const on = (event, listener) => { if(!listeners.has(event)) listeners.set(event, []); listeners.get(event).push(listener); };
  const win = { webContents, isDestroyed: () => destroyed, show() {}, on, once: on, close() {
    const event = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
    for(const listener of listeners.get('close') ?? []) listener(event);
    if(event.defaultPrevented) return;
    destroyed = true;
    for(const listener of listeners.get('closed') ?? []) listener();
    windows.delete(webContents);
  } };
  windows.set(webContents, win);
  return win;
}
export const BrowserWindow = { fromWebContents: contents => windows.get(contents) ?? null };
export const ipcMain = { handle: (name, fn) => handlers.set(name, fn) };
export const isAppWindowContents = contents => windows.has(contents);
export const openPanelWindow = input => { const key = input.scope + ':' + input.kind; if(!panels.has(key)) panels.set(key, makeWindow()); return panels.get(key); };
export const closePanelWindow = input => { const panel = panels.get(input.scope + ':' + input.kind); if(!panel || panel.isDestroyed()) return false; panel.close(); return true; };
export const listPanelWindows = () => [];
export const listSessionWindowIds = () => [];
export const broadcastSessionWindows = () => {};
export const openSessionWindow = () => {};
export const requestRestorePanel = () => false;
export const requestOpenPanel = input => { openedInMain.push(input); return true; };
export const revealSessionInMain = () => {};
`)}`;
const source = new URL("../electron/ipc/windows.ts", import.meta.url).href;
const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
	if (context.parentURL === source && (specifier === "electron" || specifier === "../window.ts")) return { url: fixtureUrl, shortCircuit: true };
	return nextResolve(specifier, context);
} });
const fixture: { handlers: Map<string, Handler>; makeWindow(): FakeWindow; panels: Map<string, FakeWindow>; setQuitting(value: boolean): void; openedInMain: unknown[] } = await import(fixtureUrl);
const { registerWindowsIpc } = await import("../electron/ipc/windows.ts");
hooks.deregister();
registerWindowsIpc();
const a = { path: "/project/a.ts", name: "a.ts" };
const b = { path: "/project/b.ts", name: "b.ts" };
const snapshot: FilePanelState = { path: a.path, tabs: [a], drafts: { [a.path]: "original draft" }, wrap: true, showSource: false };
function call(name: string, win: FakeWindow, input?: unknown, frame = win.webContents.mainFrame) {
	const handler = fixture.handlers.get(name);
	assert.ok(handler);
	return handler({ sender: win.webContents, senderFrame: frame }, input);
}

test("real file-panel handlers validate snapshots, isolate senders and keep the latest draft through restore", async () => {
	const owner = fixture.makeWindow();
	const unrelated = fixture.makeWindow();
	assert.deepEqual(await call("windows:openPanel", owner, { kind: "file", scope: "test", sessionId: "session", fileState: { ...snapshot, drafts: { [a.path]: 1 } } }), { ok: false });
	assert.equal(fixture.panels.size, 0);
	assert.deepEqual(await call("windows:openPanel", owner, { kind: "file", scope: "test", sessionId: "session", fileState: snapshot }), { ok: true });
	const panel = fixture.panels.get("test:file");
	assert.ok(panel);
	assert.deepEqual(call("windows:filePanelState", panel), { version: 1, state: snapshot });
	assert.equal(call("windows:filePanelState", owner), null);
	assert.equal(call("windows:filePanelState", unrelated), null);
	assert.equal(call("windows:filePanelState", panel, undefined, {}), null);
	const foreign = { webContents: { id: panel.webContents.id, mainFrame: {}, messages: [] }, close() {}, isDestroyed: () => false };
	assert.equal(call("windows:filePanelState", foreign), null);
	const edited = { ...snapshot, drafts: { [a.path]: "native editor draft" } };
	assert.deepEqual(call("windows:filePanelState", panel, { version: 1, state: edited }), { version: 2, state: edited });
	assert.equal(unrelated.webContents.messages.length, 0);
	assert.equal(owner.webContents.messages.length, 1);
	assert.equal(call("windows:filePanelState", panel, { version: 2, state: { ...edited, tabs: [] } }), null);
	assert.deepEqual(call("windows:filePanelState", panel), { version: 2, state: edited });
	assert.deepEqual(call("windows:filePanelState", panel, { version: 1, state: snapshot }), { version: 2, state: edited });
	await call("windows:openPanel", owner, { kind: "file", scope: "test", sessionId: "session", fileState: { ...snapshot, path: b.path, tabs: [a, b] } });
	const latest: FilePanelVersion = { version: 3, state: { ...edited, path: b.path, tabs: [a, b] } };
	assert.deepEqual(call("windows:filePanelState", panel), latest);
	assert.deepEqual(await call("windows:restorePanel", panel, { kind: "file", scope: "test" }), { ok: true });
	assert.deepEqual(owner.webContents.messages.at(-1), { channel: "windows:restore-panel", payload: { kind: "file", scope: "test", sessionId: null, fileState: latest.state } });
	panel.close();
	await call("windows:closePanel", panel, { kind: "file", scope: "test" });
	assert.equal(call("windows:filePanelState", panel), null);
});

test("native file close waits for its own renderer acknowledgement and never mistakes its owner for an acknowledgement", async () => {
	const owner = fixture.makeWindow();
	const scope = "close-handshake";
	await call("windows:openPanel", owner, { kind: "file", scope, fileState: snapshot });
	const panel = fixture.panels.get(`${scope}:file`);
	assert.ok(panel);
	panel.close();
	assert.equal(panel.isDestroyed(), false, "native close must pause before destroying unsent edits");
	assert.deepEqual(panel.webContents.messages.at(-1), { channel: "windows:close-panel", payload: undefined });
	await call("windows:closePanel", owner, { kind: "file", scope });
	assert.equal(panel.isDestroyed(), false, "a source window's return request is not the editor's flush acknowledgement");
	assert.deepEqual(await call("windows:closePanel", panel, { kind: "file", scope }, {}), { ok: false });
	assert.equal(panel.isDestroyed(), false, "a child frame cannot acknowledge the editor's close");
	const edited = { ...snapshot, drafts: { [a.path]: "last keystroke before native close" } };
	call("windows:filePanelState", panel, { version: 1, state: edited });
	assert.equal(panel.isDestroyed(), false);
	await call("windows:closePanel", panel, { kind: "file", scope });
	assert.equal(panel.isDestroyed(), true);
	assert.deepEqual(owner.webContents.messages.at(-1), { channel: "windows:file-panel-state", payload: { version: 2, state: edited, previous: snapshot } });
});

test("application quit does not enter a window-return handshake", async () => {
	const owner = fixture.makeWindow();
	const scope = "quit-handshake";
	await call("windows:openPanel", owner, { kind: "file", scope, fileState: snapshot });
	const panel = fixture.panels.get(`${scope}:file`);
	assert.ok(panel);
	fixture.setQuitting(true);
	try {
		panel.close();
		assert.equal(panel.isDestroyed(), true);
		assert.deepEqual(panel.webContents.messages, []);
	} finally { fixture.setQuitting(false); }
});

/*
 * 面板窗口请主窗口开一个面板——它自己没有 dock。
 *
 * `beside` 是个布局提示（挨着谁、哪一边），转发前要逐字段验：它最终会被当成落点塞进主窗口的
 * dock 状态，而发起方是另一个渲染进程。见 `2026-09-19-2304-02` 缺陷 1。
 */
test("openPanelInMain validates the kind and the layout hint before forwarding", async () => {
	const panel = fixture.makeWindow();
	fixture.openedInMain.length = 0;
	assert.deepEqual(await call("windows:openPanelInMain", panel, { kind: "file" }), { ok: true });
	assert.deepEqual(fixture.openedInMain, [{ kind: "file" }]);

	fixture.openedInMain.length = 0;
	assert.deepEqual(await call("windows:openPanelInMain", panel, { kind: "file", beside: { kind: "files", side: "bottom", share: 0.3 } }), { ok: true });
	assert.deepEqual(fixture.openedInMain, [{ kind: "file", beside: { kind: "files", side: "bottom", share: 0.3 } }]);

	for (const bad of [
		undefined,
		{ kind: "settings" },
		{ kind: "file", beside: { kind: "file", side: "sideways" } },
		{ kind: "file", beside: { kind: "not-a-panel", side: "left" } },
		{ kind: "file", beside: { kind: "files", side: "left", share: 4 } },
		{ kind: "file", beside: "files" },
	]) {
		fixture.openedInMain.length = 0;
		assert.deepEqual(await call("windows:openPanelInMain", panel, bad), { ok: false }, JSON.stringify(bad));
		assert.deepEqual(fixture.openedInMain, [], JSON.stringify(bad));
	}
});
