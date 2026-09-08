import { translate } from "../i18n/translate.ts";
import type { SessionMeta } from "@lyra/core";
import type { AppState } from "./index.ts";
import { howItStopped, prune, rebuildToolRuns, todosFrom, type Cache } from "./derive.ts";
import { useSubAgents } from "./subAgents.ts";
import { bridge } from "../services/index.ts";
import { beginSessionRead, endSessionRead } from "./read-events.ts";
import { cachedEvent } from "./cached-event.ts";
import { flushCoalesced } from "./coalesce.ts";

// Only one IPC payload is in flight. Intermediate selections collapse into the latest one.
let reading: string | null = null;
let queued: { meta: SessionMeta; resync: boolean } | null = null;

type Get = () => AppState;
type Set = (partial: Partial<AppState> | ((state: AppState) => Partial<AppState>)) => void;

export async function readSelectedSession(meta: SessionMeta, set: Set, get: Get, resync = false): Promise<void> {
	const cached = get().sessionCache[meta.id];
	if (reading !== null) {
		queued = { meta, resync: resync || (queued?.meta.id === meta.id && queued.resync) };
		return;
	}
	reading = meta.id;
	const before = get();
	const events = beginSessionRead(meta.id);

	let snapshot: Awaited<ReturnType<typeof bridge.sessions.transcript>>;
	try {
		snapshot = await bridge.sessions.transcript(meta.projectId, meta.id);
	} catch (cause) {
		if (get().activeSessionId === meta.id) {
			set({ loadingSession: false });
			get().notify(translate("sessionRead.failed", { reason: cause instanceof Error ? cause.message : String(cause) }), "error");
		}
		return;
	} finally {
		endSessionRead(meta.id);
		reading = null;
		// Whatever was clicked last while this was running is the one that still wants reading.
		const next = queued;
		queued = null;
		// Reconnect needs a post-disconnect snapshot even if the selected session did not change.
		if (next && (next.meta.id !== meta.id || next.resync) && get().activeSessionId === next.meta.id) {
			void readSelectedSession(next.meta, set, get, next.resync);
		}
	}

	// A second click while this was in flight wins; discard the stale arrival.
	if (get().activeSessionId !== meta.id) return;
	flushCoalesced();
	if (!snapshot) {
		set({ loadingSession: false });
		return;
	}

	// Cold visits need the disk prefix as well as events that arrived during the read.
	if ((before.loadingSession || resync) && events.length) {
		let merged: Cache[string] = {
			meta: snapshot.meta, messages: snapshot.messages, toolRuns: rebuildToolRuns(snapshot.messages),
			state: { running: snapshot.running, commandRuns: snapshot.commandRuns ?? [], todos: todosFrom(snapshot.messages), compactions: (snapshot.compactions ?? []).map((at) => ({ at, before: 0, after: 0 })),
				approvals: snapshot.pendingApprovals, stopped: howItStopped(snapshot.messages), retrying: null, capabilities: null, pendingUserMessage: null },
		};
		for (const event of events) {
			if (event.type === "message_start" && snapshot.messages.some((message) => message.role === event.message.role && message.timestamp === event.message.timestamp)) continue;
			if (event.type === "message_update" && snapshot.messages.some((message) => message.role === "assistant" && message.timestamp === event.message.timestamp && message.stopReason !== "pending")) continue;
			if (event.type === "approval_request" && snapshot.pendingApprovals.some((approval) => approval.id === event.requestId)) continue;
			merged = cachedEvent(merged, event);
		}
		set({ ...merged.state, meta: merged.meta, messages: merged.messages, toolRuns: merged.toolRuns,
			loadingSession: false, sessionCache: prune({ ...get().sessionCache, [meta.id]: merged }, meta.id) });
		await restoreLiveState(meta.id, set, get);
		return;
	}

	// An unchanged disk read must keep row props and disclosure geometry intact.
	const current = get();
	// A warm transcript already contains the history. Events received during the IPC read
	// are newer than that request, so refreshing must not roll them back.
	const advanced =
		!resync && !before.loadingSession &&
		(current.messages !== before.messages ||
			current.toolRuns !== before.toolRuns ||
			current.running !== before.running ||
			current.approvals !== before.approvals ||
			current.todos !== before.todos ||
			current.compactions !== before.compactions ||
			current.commandRuns !== before.commandRuns ||
			current.meta !== before.meta);
	const unchanged =
		cached &&
		!cached.dirty &&
		!snapshot.running &&
		cached.meta.seq === snapshot.meta.seq &&
		cached.messages.length === snapshot.messages.length;
	const messages = advanced ? current.messages : unchanged ? cached.messages : snapshot.messages;
	const toolRuns = advanced ? current.toolRuns : unchanged ? cached.toolRuns : rebuildToolRuns(messages);
	set({
		meta: advanced ? current.meta : snapshot.meta,
		messages,
		// Replayed from the log rather than the event stream: reopening a conversation does not
		// re-run its tools, so the plan has to be recovered from where the tool wrote it.
		todos: advanced ? current.todos : todosFrom(messages),
		// Replayed from the log: the summary itself is not in the transcript, only the fact.
		compactions: advanced
			? current.compactions
			: (snapshot.compactions ?? []).map((at) => ({ at, before: 0, after: 0 })),
		// No event to go on here, so the transcript answers on its own: a reply the log records as
		// `aborted` was stopped by hand, however long ago.
		stopped: advanced ? current.stopped : snapshot.running ? null : howItStopped(messages),
		running: advanced ? current.running : snapshot.running,
		commandRuns: advanced ? current.commandRuns : snapshot.commandRuns ?? [],
		approvals: advanced ? current.approvals : snapshot.pendingApprovals,
		toolRuns,
		loadingSession: false,
		sessionCache: prune(
			{
				...get().sessionCache,
				[meta.id]: {
					meta: advanced ? (current.meta ?? snapshot.meta) : snapshot.meta,
					messages,
					toolRuns,
					state: {
						running: advanced ? current.running : snapshot.running,
						commandRuns: advanced ? current.commandRuns : snapshot.commandRuns ?? [],
						todos: advanced ? current.todos : todosFrom(messages),
						compactions: advanced ? current.compactions : (snapshot.compactions ?? []).map((at) => ({ at, before: 0, after: 0 })),
						approvals: advanced ? current.approvals : snapshot.pendingApprovals,
						stopped: advanced ? current.stopped : snapshot.running ? null : howItStopped(messages),
						retrying: current.retrying, hiccups: current.hiccups, capabilities: current.capabilities, pendingUserMessage: current.pendingUserMessage,
					},
					scrollTop: get().sessionCache[meta.id]?.scrollTop,
					pinnedToBottom: get().sessionCache[meta.id]?.pinnedToBottom,
				},
			},
			meta.id,
		),
	});

	await restoreLiveState(meta.id, set, get);
}

async function restoreLiveState(id: string, set: Set, get: Get): Promise<void> {
	// A cold read that merges events needs the same runtime details as an unchanged transcript.
	void bridge.subAgents.list(id).then((subAgentsList) => {
		if (get().activeSessionId === id && Array.isArray(subAgentsList)) {
			useSubAgents.getState().sync(subAgentsList);
		}
	});

	// Capabilities describe a running agent; a transcript read from disk has none until the
	// session is activated, which the first message does.
	const capabilities = await bridge.sessions.capabilities(id);
	if (get().activeSessionId === id) set({ capabilities });
}
