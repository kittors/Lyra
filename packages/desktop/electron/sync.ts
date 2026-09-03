/**
 * The sync server, started on demand and owned here.
 *
 * A phone talks to this rather than to the model: it replays the session log by sequence number and
 * sends prompts back. The server is built lazily because most sessions never turn it on, and
 * exposing a port is not something to do just in case.
 */

import { AgentSession, type SessionStorage } from "@lyra/core";
import { workspaceInfo } from "./workspace-info.ts";
import { applySettings, onSettingsChanged, settings } from "./app-settings.ts";
import type { SyncStatus } from "./ipc-types.ts";
import { activateSession, broadcast, getOrCreateSession, sessions, snapshot, touchSession } from "./session-hub.ts";
import { SyncServer } from "./sync-server.ts";

let syncServer: SyncServer | null = null;
/** Whether the settings listener is already attached; see `startSync`. */
let watchingSettings = false;

/** The running server, or null. Read by the handlers that report status. */
export function syncStatusSource(): SyncServer | null {
	return syncServer;
}

export async function stopSync(): Promise<void> {
	await syncServer?.stop();
}

export function configureSync(read: () => SessionStorage): void {
	readStore = read;
}

let readStore: () => SessionStorage = () => {
	throw new Error("sync used before configure()");
};

export async function startSync(): Promise<SyncStatus> {
	if (!syncServer) {
		syncServer = new SyncServer({
			getSettings: settings,
			saveSettings: async (next) => void (await applySettings(next)),
			store: readStore(),
			workspaceInfo: (path) => workspaceInfo(path),
			live: (id) => sessions.get(id),
			activate: (projectId, id) => activateSession(projectId, id),
			getOrCreate: (cwd, modelId) => getOrCreateSession(cwd, modelId),
			snapshot: (session) => snapshot(session),
			touch: (id) => touchSession(id),
			resolveSession: async (projectId, sessionId) => {
				const existing = sessions.get(sessionId);
				if (existing) return existing;
				const loaded = await readStore().load(projectId, sessionId);
				if (!loaded) return null;
				const session = new AgentSession({
					cwd: loaded.meta.cwd,
					settings: settings(),
					store: readStore(),
					meta: loaded.meta,
					emit: (event) => broadcast(sessionId, event),
				});
				session.restore(loaded.messages, loaded.compaction);
				await session.initialize();
				sessions.set(sessionId, session);
				return session;
			},
			createSession: (cwd, modelId) => getOrCreateSession(cwd, modelId),
		});
	}
	/*
	 * Forward every settings change to whatever phones are connected.
	 *
	 * Registered once, on the first start, and left in place: the listener is cheap, it does nothing
	 * while no server is running, and unsubscribing on stop would mean a phone that reconnects to a
	 * restarted server silently stops hearing about changes.
	 */
	if (!watchingSettings) {
		watchingSettings = true;
		onSettingsChanged((next) => syncServer?.broadcastSettings(next));
	}

	return syncServer.start(settings().sync.port, settings().sync.token);
}
