import type { SessionMeta } from "@lyra/core";
import type { AppState } from "./index.ts";
import { howItStopped, prune, rebuildToolRuns, todosFrom } from "./derive.ts";
import { useSubAgents } from "./subAgents.ts";
import { bridge } from "../services/index.ts";
import { flushCoalesced } from "./coalesce.ts";

// Only one IPC payload is in flight. Intermediate selections collapse into the latest one.
let reading: string | null = null;
let queued: SessionMeta | null = null;

type Get = () => AppState;
type Set = (partial: Partial<AppState> | ((state: AppState) => Partial<AppState>)) => void;

export async function readSelectedSession(meta: SessionMeta, set: Set, get: Get): Promise<void> {
	const cached = get().sessionCache[meta.id];
	if (reading !== null) {
		queued = meta;
		return;
	}
	reading = meta.id;
	const before = get();

	let snapshot: Awaited<ReturnType<typeof bridge.sessions.transcript>>;
	try {
		snapshot = await bridge.sessions.transcript(meta.projectId, meta.id);
	} finally {
		reading = null;
		// Whatever was clicked last while this was running is the one that still wants reading.
		const next = queued;
		queued = null;
		if (next && next.id !== meta.id && get().activeSessionId === next.id) void readSelectedSession(next, set, get);
	}

	// A second click while this was in flight wins; discard the stale arrival.
	if (get().activeSessionId !== meta.id) return;
	flushCoalesced();
	if (!snapshot) {
		set({ loadingSession: false });
		return;
	}

	// An unchanged disk read must keep row props and disclosure geometry intact.
	const current = get();
	// A warm transcript already contains the history. Events received during the IPC read
	// are newer than that request, so refreshing must not roll them back.
	const advanced =
		!before.loadingSession &&
		(current.messages !== before.messages ||
			current.toolRuns !== before.toolRuns ||
			current.running !== before.running ||
			current.approvals !== before.approvals ||
			current.todos !== before.todos ||
			current.compactions !== before.compactions ||
			current.meta !== before.meta);
	const unchanged =
		cached &&
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
					scrollTop: get().sessionCache[meta.id]?.scrollTop,
					pinnedToBottom: get().sessionCache[meta.id]?.pinnedToBottom,
				},
			},
			meta.id,
		),
	});

	// Restore sub-agents for this session if available
	void bridge.subAgents.list(snapshot.meta.id).then((subAgentsList) => {
		if (get().activeSessionId === snapshot.meta.id && Array.isArray(subAgentsList)) {
			useSubAgents.getState().sync(subAgentsList);
		}
	});

	// Capabilities describe a running agent; a transcript read from disk has none until the
	// session is activated, which the first message does.
	const capabilities = await bridge.sessions.capabilities(snapshot.meta.id);
	if (get().activeSessionId === meta.id) set({ capabilities });
}
