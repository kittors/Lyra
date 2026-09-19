/**
 * Opening another real window of this app.
 *
 * Not `shell.openExternal("lyra://…")`. That scheme is refused by the navigation guard, so the
 * old "open in a new window" item toasted and then did nothing.
 *
 * A session window is a conversation, not a second workspace. `openInMain` puts that conversation
 * back on the primary window and closes the document that was holding it.
 *
 * A panel window is the same idea for a browser, a terminal, files, git: the pane leaves the
 * dock, and restore asks the primary window to put it back in the slot it left.
 */

import { BrowserWindow, ipcMain } from "electron";
import {
	broadcastSessionWindows,
	closePanelWindow,
	listPanelWindows,
	listSessionWindowIds,
	openPanelWindow,
	openSessionWindow,
	requestRestorePanel,
	revealSessionInMain,
} from "../window.ts";

const PANEL_KINDS = new Set([
	"files",
	"file",
	"chat",
	"subagents",
	"terminal",
	"review",
	"delivery",
	"browser",
	"tasks",
	"trajectory",
]);

function readPanel(input: { kind?: string; scope?: string; sessionId?: string | null }): {
	kind: string;
	scope: string;
	sessionId: string | null;
} | null {
	if (!input?.kind || !input.scope || !PANEL_KINDS.has(input.kind)) return null;
	return { kind: input.kind, scope: input.scope, sessionId: input.sessionId ?? null };
}

export function registerWindowsIpc(): void {
	ipcMain.handle("windows:keepOnTop", (event, input: unknown) => {
		const win = BrowserWindow.fromWebContents(event.sender);
		if (!win || win.isDestroyed()) return { ok: false, enabled: false };
		if (input !== undefined) {
			if (typeof input !== "object" || input === null || !("enabled" in input) || typeof input.enabled !== "boolean") {
				return { ok: false, enabled: win.isAlwaysOnTop() };
			}
			win.setAlwaysOnTop(input.enabled);
		}
		return { ok: true, enabled: win.isAlwaysOnTop() };
	});
	ipcMain.handle("windows:open", async (_event, input: { sessionId: string }) => {
		if (!input?.sessionId) return { ok: false };
		openSessionWindow(input.sessionId);
		return { ok: true };
	});
	ipcMain.handle("windows:list", async () => ({
		sessions: listSessionWindowIds(),
		panels: listPanelWindows(),
	}));
	ipcMain.handle("windows:openInMain", async (event, input: { sessionId: string }) => {
		if (!input?.sessionId) return { ok: false };
		revealSessionInMain(input.sessionId, BrowserWindow.fromWebContents(event.sender));
		broadcastSessionWindows();
		return { ok: true };
	});
	ipcMain.handle("windows:openPanel", async (_event, input: { kind: string; scope: string; sessionId: string | null }) => {
		const panel = readPanel(input);
		if (!panel) return { ok: false };
		openPanelWindow(panel);
		return { ok: true };
	});
	ipcMain.handle("windows:restorePanel", async (_event, input: { kind: string; scope: string }) => {
		const panel = readPanel(input);
		if (!panel) return { ok: false };
		return { ok: requestRestorePanel(panel) };
	});
	ipcMain.handle("windows:closePanel", async (_event, input: { kind: string; scope: string }) => {
		const panel = readPanel(input);
		if (!panel) return { ok: false };
		return { ok: closePanelWindow(panel) };
	});
}
