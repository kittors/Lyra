import type { SessionChange } from "../../electron/ipc-types.ts";
import type { AppState } from "./index.ts";

type Set = (partial: Partial<AppState> | ((state: AppState) => Partial<AppState>)) => void;

/** A committed directory change must reach both the sidebar and the selected conversation. */
export function applySessionChange(change: SessionChange, set: Set, get: () => AppState): void {
	const { id, meta } = change;
	const previous = get().sessions.find((session) => session.id === id);
	if (meta && previous && meta.seq < previous.seq) return;
	if ((!meta || meta.archived) && get().activeSessionId === id) void get().newSession();
	set((state) => {
		const sessions = state.sessions.filter((session) => session.id !== id);
		if (meta) sessions.push(meta);
		sessions.sort((a, b) => b.updatedAt - a.updatedAt);
		const sessionCache = { ...state.sessionCache };
		const drafts = { ...state.drafts };
		// 排着的那几条跟草稿一起走：它们本来就是没发出去的草稿，而要说给它听的那个对话已经没了。
		const queued = { ...state.queued };
		if (!meta) {
			delete sessionCache[id];
			delete drafts[id];
			delete queued[id];
		} else if (sessionCache[id]) {
			sessionCache[id] = { ...sessionCache[id], meta, dirty: true };
		}
		return { sessions, sessionCache, drafts, queued, ...(state.activeSessionId === id && meta ? { meta } : {}) };
	});
}
