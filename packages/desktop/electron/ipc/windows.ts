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
import { readFilePanelState, requestFilePanel, type FilePanelVersion } from "../../shared/file-panel-state.ts";
import {
	broadcastSessionWindows,
	closePanelWindow,
	listPanelWindows,
	isAppQuitting,
	isAppWindowContents,
	listSessionWindowIds,
	openPanelWindow,
	openSessionWindow,
	requestRestorePanel,
	revealSessionInMain,
} from "../window.ts";

interface FileHandoff extends FilePanelVersion {
	owner: BrowserWindow;
	kind: string;
	scope: string;
	closeRequested: boolean;
	allowClose: boolean;
}

const fileHandoffs = new Map<number, FileHandoff>();

function trustedWindow(event: Electron.IpcMainInvokeEvent): BrowserWindow | null {
	return event.senderFrame === event.sender.mainFrame && isAppWindowContents(event.sender)
		? BrowserWindow.fromWebContents(event.sender)
		: null;
}

function fileVersion(record: FilePanelVersion): FilePanelVersion {
	return { version: record.version, state: record.state };
}

function sendFileState(record: FileHandoff, previous: FilePanelVersion["state"]): void {
	if (!record.owner.isDestroyed() && !record.owner.webContents.isDestroyed()) {
		record.owner.webContents.send("windows:file-panel-state", { ...fileVersion(record), previous });
	}
}

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

function readPanel(input: unknown): {
	kind: string;
	scope: string;
	sessionId: string | null;
} | null {
	if (!input || typeof input !== "object" || !("kind" in input) || !("scope" in input)) return null;
	if (typeof input.kind !== "string" || typeof input.scope !== "string" || !input.scope || !PANEL_KINDS.has(input.kind)) return null;
	const sessionId = "sessionId" in input ? input.sessionId : null;
	if (sessionId !== null && sessionId !== undefined && typeof sessionId !== "string") return null;
	return { kind: input.kind, scope: input.scope, sessionId: sessionId ?? null };
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
	ipcMain.handle("windows:openPanel", async (event, input: { kind: string; scope: string; sessionId: string | null; fileState?: unknown }) => {
		const owner = trustedWindow(event);
		if (!owner) return { ok: false };
		const panel = readPanel(input);
		if (!panel) return { ok: false };
		const fileState = input.fileState === undefined ? null : readFilePanelState(input.fileState);
		if (input.fileState !== undefined && (panel.kind !== "file" || !fileState)) return { ok: false };
		const win = openPanelWindow(panel);
		if (fileState) {
			const previous = fileHandoffs.get(win.webContents.id);
			if (previous) {
				const before = previous.state;
				previous.state = requestFilePanel(before, fileState);
				previous.version++;
				sendFileState(previous, before);
				win.webContents.send("windows:file-panel-state", fileVersion(previous));
			} else {
				const id = win.webContents.id;
				const handoff: FileHandoff = { ...panel, owner, state: fileState, version: 1, closeRequested: false, allowClose: false };
				fileHandoffs.set(id, handoff);
				win.on("close", (event) => {
					if (handoff.allowClose || isAppQuitting()) return;
					// Cancel natively before asking for the last edit; beforeunload re-entry loses close requests.
					event.preventDefault();
					handoff.closeRequested = true;
					win.webContents.send("windows:close-panel");
				});
				win.once("closed", () => fileHandoffs.delete(id));
			}
		}
		return { ok: true };
	});
	ipcMain.handle("windows:filePanelState", (event, input?: unknown) => {
		if (!trustedWindow(event)) return null;
		// The sender's registered window is the key; a renderer cannot name another editor.
		const handoff = fileHandoffs.get(event.sender.id);
		if (!handoff) return null;
		if (input === undefined) return fileVersion(handoff);
		if (!input || typeof input !== "object" || !("version" in input) || !("state" in input)) return null;
		const state = readFilePanelState(input.state);
		if (!state || !Number.isSafeInteger(input.version)) return null;
		if (input.version !== handoff.version) return fileVersion(handoff);
		const previous = handoff.state;
		handoff.state = state;
		handoff.version++;
		sendFileState(handoff, previous);
		return fileVersion(handoff);
	});
	ipcMain.handle("windows:restorePanel", async (event, input: { kind: string; scope: string }) => {
		if (!trustedWindow(event)) return { ok: false };
		const panel = readPanel(input);
		if (!panel) return { ok: false };
		const handoff = fileHandoffs.get(event.sender.id);
		if (handoff && handoff.kind === panel.kind && handoff.scope === panel.scope) {
			if (handoff.owner.isDestroyed() || handoff.owner.webContents.isDestroyed()) return { ok: false };
			handoff.owner.show();
			handoff.owner.webContents.send("windows:restore-panel", { ...panel, fileState: handoff.state });
			return { ok: true };
		}
		return { ok: requestRestorePanel(panel) };
	});
	ipcMain.handle("windows:closePanel", async (event, input: { kind: string; scope: string }) => {
		if (!trustedWindow(event)) return { ok: false };
		const panel = readPanel(input);
		if (!panel) return { ok: false };
		const handoff = fileHandoffs.get(event.sender.id);
		if (handoff) {
			if (handoff.kind !== panel.kind || handoff.scope !== panel.scope) return { ok: false };
			if (handoff.closeRequested) handoff.allowClose = true;
		}
		return { ok: closePanelWindow(panel) };
	});
}
