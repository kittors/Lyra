/**
 * The live sessions, and how their events get out.
 *
 * A session is expensive: it owns MCP servers as real child processes and a visible browser tabs. So
 * this is also where they are kept to a bounded number and evicted by recency — an afternoon of
 * moving between conversations should not leave a dozen sets of processes running.
 *
 * Everything the rest of the main process needs from a session goes through here, which is what
 * keeps the map from being reachable — and therefore mutable — from six different files.
 */

import { AgentSession, backgroundJobs, type AgentEvent, type SessionStorage, type Settings, type SideChat } from "@lyra/core";
import type { BrowserWindow } from "electron";
import { browserState, closeSessionBrowser } from "./browser-workspace.ts";
import { createBrowserTools } from "./browser-tools.ts";
import { autoCreateSessionWorktree, cleanOldWorktrees } from "./git-worktrees.ts";
import type { SessionChange } from "./ipc-shapes.ts";
import type { SessionSnapshot, LyraApi } from "./ipc-types.ts";
import { createStoredSession, type InitialPrompt } from "./create-session.ts";
import { initialPrompt, promptContent, promptOptions } from "./prompt-input.ts";
import { ensureSessionWorkspace } from "./scratch.ts";
import { notifyAgentEvent } from "./notify.ts";

export interface HubDeps {
	store(): SessionStorage;
	settings(): Settings;
	window(): BrowserWindow | null;
	/** Events also go to connected phones, when the sync server is up. */
	sync?(): {
		broadcast(sessionId: string, event: AgentEvent): void;
		broadcastSideChat(sessionId: string, event: import("@lyra/core").SideChatUpdate): void;
		broadcastSessionChange(change: SessionChange): void;
	} | null;
}

let deps: HubDeps = {
	store: () => {
		throw new Error("session hub used before configure()");
	},
	settings: () => {
		throw new Error("session hub used before configure()");
	},
	window: () => null,
};

export function configureHub(next: HubDeps): void {
	deps = next;
}

export const sessions = new Map<string, AgentSession>();
const ready = new Set<string>();
const submitted = new Set<string>();
const initializing = new Map<string, Promise<AgentSession | null>>();
const retiring = new Set<string>();
const abortedWhileStarting = new Set<string>();

export async function createSession(cwd: string, modelId: string, initial?: InitialPrompt): Promise<SessionSnapshot> {
	const saved = await createStoredSession(deps.store(), deps.settings(), cwd, modelId, initialPrompt(initial));
	stageSession(saved);
	if (initial) submitted.add(saved.meta.id);
	return saved;
}

function stageSession(saved: SessionSnapshot): AgentSession {
	const browser = createBrowserTools();
	const session = new AgentSession({ cwd: saved.meta.cwd, settings: deps.settings(), store: deps.store(), meta: saved.meta,
		extraTools: browser.tools, emit: (event) => broadcast(saved.meta.id, event) });
	session.restore(saved.messages);
	sessions.set(saved.meta.id, session);
	browsers.set(saved.meta.id, browser.dispose);
	return session;
}

export const promptSession: LyraApi["agent"]["prompt"] = async (id, content, options) => {
	const input = promptContent(content);
	const requested = promptOptions(options);
	let session: AgentSession | null;
	try { session = await ensureLiveSession(id); }
	finally { submitted.delete(id); }
	if (!session) throw new Error(`Session ${id} is not open.`);
	// Both transports return after activation; a multi-minute turn is delivered by events.
	void (requested.resumePending ? session.resumePendingPrompt() : session.prompt(input, requested)).catch((error: unknown) => {
		const message = error instanceof Error ? error.message : String(error);
		broadcast(id, { type: "notice", level: "error", message });
		broadcast(id, { type: "agent_end", reason: "error", error: message });
	});
	return session.meta;
};
/** Disposers for each session's browser tools, keyed the same way. */
export const browsers = new Map<string, () => void>();
/** Side chats, one per session, built on first use and dropped with the session. */
export const sideChats = new Map<string, SideChat>();


export async function editSessionMessage(
	sessionId: string,
	index: number,
	content: Parameters<LyraApi["agent"]["editMessage"]>[2],
	options: Parameters<LyraApi["agent"]["editMessage"]>[3] = {},
): Promise<void> {
	const session = await ensureLiveSession(sessionId);
	if (!session) throw new Error("找不到这个会话。");
	if (session.running) throw new Error("请先停止当前回复，再编辑消息。");
	// Acknowledge submission immediately; the rerun and any failure arrive on the shared stream.
	void session.editAndResend(index, content, options).catch((error: unknown) => {
		const message = error instanceof Error ? error.message : String(error);
		broadcast(sessionId, { type: "notice", level: "error", message });
		broadcast(sessionId, { type: "agent_end", reason: "error", error: message });
	});
}

export function broadcastSessionChange(change: SessionChange): void {
	const win = deps.window();
	if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) {
		win.webContents.send("sessions:changed", change);
	}
	deps.sync?.()?.broadcastSessionChange(change);
}

export function broadcast(sessionId: string, event: AgentEvent): void {
	const win = deps.window();
	if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) {
		win.webContents.send("agent:event", { sessionId, event });
	}
	deps.sync?.()?.broadcast(sessionId, event);
	notifyAgentEvent(sessionId, event, sessions.get(sessionId)?.meta.title);
}

/**
 * Side-chat events have their own channel on both transports so they cannot enter the main thread.
 */
export function broadcastSideChat(sessionId: string, event: import("@lyra/core").SideChatUpdate): void {
	const win = deps.window();
	if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) {
		win.webContents.send("sidechat:event", { sessionId, event });
	}
	deps.sync?.()?.broadcastSideChat(sessionId, event);
}

export async function getOrCreateSession(cwd: string, _modelId: string): Promise<AgentSession> {
	// A project-less conversation runs in a directory under the app's home, and that directory can
	// be gone — swept by a version of this app that used to, or removed by hand. Put it back before
	// a session is built around a working directory that is not there.
	await ensureSessionWorkspace(cwd).catch(() => false);

	const appSettings = deps.settings();
	// Generate a temporary session id prefix for potential worktree naming
	const tempId = Math.random().toString(36).slice(2, 10);
	const worktreeResult = await autoCreateSessionWorktree(cwd, appSettings, tempId).catch(() => ({
		cwd,
		worktreeCreated: false,
	}));
	const sessionCwd = worktreeResult.cwd;

	const browser = createBrowserTools();
	// `emit` closes over `session`, which is only ever invoked after `initialize()` has
	// assigned `meta`, so the self-reference is safe — but it needs an explicit type.
	const session: AgentSession = new AgentSession({
		cwd: sessionCwd,
		settings: appSettings,
		store: deps.store(),
		extraTools: browser.tools,
		emit: (event: AgentEvent) => broadcast(session.meta.id, event),
	});
	await session.initialize();
	sessions.set(session.meta.id, session);
	ready.add(session.meta.id);
	browsers.set(session.meta.id, browser.dispose);

	// Trigger async cleanup if enabled in settings
	if (appSettings.worktrees?.autoCleanOld) {
		const liveCwds = new Set(Array.from(sessions.values()).map((s) => s.cwd));
		void cleanOldWorktrees(cwd, appSettings, liveCwds).catch(() => {});
	}

	return session;
}

/**
 * How many sessions stay warm.
 *
 * Each one owns its MCP servers — real child processes — plus a visible browser tabs, so an
 * unbounded map meant an afternoon of browsing left a dozen sets of them running. Three keeps
 * the conversations you are actually moving between instant without hoarding processes.
 */
const MAX_LIVE_SESSIONS = 3;

/** Move a session to the end of the map, which is the recency order eviction walks. */
export function touchSession(sessionId: string): void {
	const session = sessions.get(sessionId);
	if (!session) return;
	sessions.delete(sessionId);
	sessions.set(sessionId, session);
}

export async function snapshot(session: AgentSession): Promise<SessionSnapshot> {
	return {
		meta: session.meta,
		messages: session.messages,
		/*
		 * The same field the stored read returns, so a session being read live is not missing
		 * something a session read from disk has.
		 *
		 * Leaving it out did not break anything — the window defaults it to an empty list — it just
		 * quietly dropped every compaction mark for as long as the session was running, and put them
		 * all back the moment it stopped. A turn long enough to summarise its own history is exactly
		 * the one where those marks are worth drawing.
		 */
		compactions: session.log.compactions,
		commandRuns: session.log.commandRuns,
		running: session.running || submitted.has(session.meta.id),
		pendingApprovals: session.listPendingApprovals().map(({ id, request }) => ({
			id,
			kind: request.kind,
			title: request.title,
			detail: request.detail,
			options: request.options,
			allowCustomInput: request.allowCustomInput,
		})),
	};
}

/** Tear down a live session's agent, MCP servers and browser. Safe to call for unknown ids. */
export async function disposeSession(sessionId: string): Promise<void> {
	retiring.add(sessionId);
	submitted.delete(sessionId);
	try { await initializing.get(sessionId); } catch { /* Failed initialization still owns resources to release. */ }
	await sessions.get(sessionId)?.dispose();
	closeSessionBrowser(sessionId);
	browsers.get(sessionId)?.();
	browsers.delete(sessionId);
	// A side chat reads its session's live message list; without the session it has nothing
	// to read, so it goes at the same time.
	sideChats.get(sessionId)?.reset();
	sideChats.delete(sessionId);
	sessions.delete(sessionId);
	ready.delete(sessionId);
	retiring.delete(sessionId);
}

export async function activateSession(projectId: string, sessionId: string): Promise<AgentSession | null> {
	if (retiring.has(sessionId)) return null;
	const pending = initializing.get(sessionId);
	if (pending) return pending;
	const existing = sessions.get(sessionId);
	if (existing && ready.has(sessionId)) {
		touchSession(sessionId);
		return existing;
	}
	const starting = startStoredSession(projectId, sessionId);
	initializing.set(sessionId, starting);
	try { return await starting; }
	finally { initializing.delete(sessionId); abortedWhileStarting.delete(sessionId); }
}

async function startStoredSession(projectId: string, sessionId: string): Promise<AgentSession | null> {
	const store = deps.store();
	let session = sessions.get(sessionId);
	if (!session) {
		const loaded = await store.load(projectId, sessionId);
		if (!loaded || retiring.has(sessionId)) return null;
		session = stageSession({ meta: loaded.meta, messages: loaded.messages, running: false, pendingApprovals: [] });
		session.restore(loaded.messages, loaded.compaction, loaded.compactions);
		session.log.commandRuns = loaded.commandRuns ?? [];
	}
	try {
		await ensureSessionWorkspace(session.cwd);
		if (session.meta.workspaceSetup === "worktree") {
			const prepared = await autoCreateSessionWorktree(session.cwd, deps.settings(), sessionId);
			session.cwd = prepared.cwd;
			// Execution may move; project identity and all metadata edits remain on the same log.
			await session.log.append({ type: "meta", meta: { ...session.meta, cwd: prepared.cwd, workspaceSetup: undefined } });
		}
		if (retiring.has(sessionId)) return null;
		await session.initialize();
		ready.add(sessionId);
		if (abortedWhileStarting.has(sessionId)) await session.cancelPendingPrompt();
		if (retiring.has(sessionId)) return null;
		await evictStaleSessions(sessionId);
		return session;
	} catch (cause) {
		await session.dispose();
		closeSessionBrowser(sessionId);
	browsers.get(sessionId)?.();
		ready.delete(sessionId);
		sessions.delete(sessionId); browsers.delete(sessionId);
		throw cause;
	}
}

export async function abortSession(sessionId: string): Promise<void> {
	submitted.delete(sessionId);
	if (initializing.has(sessionId)) abortedWhileStarting.add(sessionId);
	const session = sessions.get(sessionId);
	if (session) {
		session.abort();
		if (!session.meta.pendingPrompt) return;
		await session.cancelPendingPrompt();
	} else {
		const store = deps.store();
		const meta = (await store.listSessions()).find((meta) => meta.id === sessionId);
		if (!meta?.pendingPrompt) return;
		await store.append(meta, { type: "meta", meta: { ...meta, pendingPrompt: undefined } });
	}
	broadcast(sessionId, { type: "agent_end", reason: "aborted" });
}

/** Retire the least recently used sessions, never one mid-turn and never the current one. */
async function evictStaleSessions(keep: string): Promise<void> {
	// Snapshotted with `entries()`, not spread: this loop deletes from the map as it goes.
	for (const [id, session] of Array.from(sessions.entries())) {
		if (sessions.size <= MAX_LIVE_SESSIONS) break;
		// An open side chat is a conversation in progress, same as a running turn — evicting
		// its session would silently throw that conversation away.
		if (id === keep || session.running || session.meta.pendingPrompt || initializing.has(id) || sideChats.has(id)) continue;
		if (browserState().tabs.some((tab) => tab.sessionId === id)) continue;
		if (backgroundJobs(session.can.state).list().some((job) => job.status === "running" || job.status === "stopping")) continue;
		await disposeSession(id);
	}
}

/**
 * The live session for an id, activating it from disk if it is not warm yet.
 *
 * The one entry point for "I need to actually run something on this conversation" — as opposed to
 * reading it, which must never come through here.
 */
export async function ensureLiveSession(sessionId: string): Promise<AgentSession | null> {
	if (retiring.has(sessionId)) return null;
	const pending = initializing.get(sessionId);
	if (pending) return pending;
	const existing = sessions.get(sessionId);
	if (existing && ready.has(sessionId)) {
		touchSession(sessionId);
		return existing;
	}
	const meta = (await deps.store().listSessions()).find((s) => s.id === sessionId);
	return meta ? activateSession(meta.projectId, sessionId) : null;
}
