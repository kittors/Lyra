import { translate } from "../i18n/translate.ts";
import type { SessionMeta } from "@lyra/core";
import type { AppState } from "./index.ts";
import { howItStopped, prune, rebuildToolRuns, todosFrom, type Cache } from "./derive.ts";
import { intact } from "../lib/transcript.ts";
import { useSubAgents } from "./subAgents.ts";
import { bridge } from "../services/index.ts";
import { beginSessionRead, endSessionRead } from "./read-events.ts";
import { cachedEvent } from "./cached-event.ts";
import { flushCoalesced } from "./coalesce.ts";

// Only one IPC payload is in flight. Intermediate selections collapse into the latest one.
let reading: string | null = null;
let queued: { meta: SessionMeta; resync: boolean; cacheOnly: boolean } | null = null;

type Get = () => AppState;
type Set = (partial: Partial<AppState> | ((state: AppState) => Partial<AppState>)) => void;

export type SessionReadOptions = {
	/** Write `sessionCache` only. The live transcript slot stays on the conversation that is already up. */
	cacheOnly?: boolean;
};

function drainQueued(finishedId: string, set: Set, get: Get): void {
	const next = queued;
	queued = null;
	if (!next) return;
	if (next.cacheOnly) {
		void readSelectedSession(next.meta, set, get, next.resync, { cacheOnly: true });
		return;
	}
	if (get().activeSessionId !== next.meta.id) return;
	if (next.meta.id === finishedId && !next.resync) return;
	void readSelectedSession(next.meta, set, get, next.resync);
}

function stashInCache(
	meta: SessionMeta,
	snapshot: NonNullable<Awaited<ReturnType<typeof bridge.sessions.transcript>>>,
	events: ReturnType<typeof beginSessionRead>,
	set: Set,
	get: Get,
): void {
	const intactSnapshot = { ...snapshot, messages: intact(snapshot.messages) };
	let merged: Cache[string] = {
		meta: intactSnapshot.meta,
		messages: intactSnapshot.messages,
		toolRuns: rebuildToolRuns(intactSnapshot.messages),
		state: {
			running: intactSnapshot.running,
			commandRuns: intactSnapshot.commandRuns ?? [],
			todos: todosFrom(intactSnapshot.messages),
			compactions: (intactSnapshot.compactions ?? []).map((at) => ({ at, before: 0, after: 0 })),
			approvals: intactSnapshot.pendingApprovals,
			stopped: howItStopped(intactSnapshot.messages),
			retrying: null,
			capabilities: null,
			pendingUserMessage: null,
		},
	};
	for (const event of events) {
		if (event.type === "message_start" && intactSnapshot.messages.some((message) => message.role === event.message.role && message.timestamp === event.message.timestamp)) continue;
		if (event.type === "message_update" && intactSnapshot.messages.some((message) => message.role === "assistant" && message.timestamp === event.message.timestamp && message.stopReason !== "pending")) continue;
		if (event.type === "approval_request" && intactSnapshot.pendingApprovals.some((approval) => approval.id === event.requestId)) continue;
		merged = cachedEvent(merged, event);
	}
	set({
		sessionCache: prune({ ...get().sessionCache, [meta.id]: merged }, get().activeSessionId ?? meta.id),
	});
}

export async function readSelectedSession(meta: SessionMeta, set: Set, get: Get, resync = false, options: SessionReadOptions = {}): Promise<void> {
	const cacheOnly = options.cacheOnly === true;
	const cached = get().sessionCache[meta.id];
	if (reading !== null) {
		queued = {
			meta,
			resync: resync || (queued?.meta.id === meta.id && queued.resync),
			cacheOnly: cacheOnly || (queued?.meta.id === meta.id && queued.cacheOnly),
		};
		return;
	}
	reading = meta.id;
	const before = get();
	const events = beginSessionRead(meta.id);

	let snapshot: Awaited<ReturnType<typeof bridge.sessions.transcript>>;
	try {
		snapshot = await bridge.sessions.transcript(meta.projectId, meta.id);
	} catch (cause) {
		if (!cacheOnly && get().activeSessionId === meta.id) {
			set({ loadingSession: false });
			get().notify(translate("sessionRead.failed", { reason: cause instanceof Error ? cause.message : String(cause) }), "error");
		} else if (cacheOnly && get().pendingSessionId === meta.id) {
			get().notify(translate("sessionRead.failed", { reason: cause instanceof Error ? cause.message : String(cause) }), "error");
		}
		return;
	} finally {
		endSessionRead(meta.id);
		reading = null;
		// Whatever was clicked last while this was running is the one that still wants reading.
		drainQueued(meta.id, set, get);
	}

	if (cacheOnly) {
		if (snapshot) stashInCache(meta, snapshot, events, set, get);
		return;
	}
	// A second click while this was in flight wins; discard the stale arrival.
	if (get().activeSessionId !== meta.id) return;
	if (get().pendingSessionId && get().pendingSessionId !== meta.id) {
		if (snapshot) stashInCache(meta, snapshot, events, set, get);
		return;
	}
	flushCoalesced();
	if (!snapshot) {
		set({ loadingSession: false });
		return;
	}
	/*
	 * 从主进程拿到的转录，进门先过一道闸。
	 *
	 * 这一条数组紧接着要交给 `rebuildToolRuns`、`todosFrom`、`howItStopped`，三个都直接读 `role`，
	 * 而 core 那边的校验只问「有没有 message」不问它长什么样（`store.ts` 的 `if (record.message)`）——
	 * 一条缺 `content` 的记录能原样送到这里。
	 *
	 * 后果比崩溃更难认：这几个函数一抛，整条 `readSelectedSession` 就断在半路，`loadingSession`
	 * 再也没人置回 false，会话**永远停在「正在加载对话…」**。实测就是这样——同一份数据，全好的能
	 * 打开，塞两条坏记录进去就再也打不开，而且一句报错都不给。
	 *
	 * 没有损坏时 `intact` 交回同一个引用，所以下面那些靠引用相等判断的缓存路径不受影响。
	 */
	snapshot = { ...snapshot, messages: intact(snapshot.messages) };

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

export async function restoreLiveState(id: string, set: Set, get: Get): Promise<void> {
	// A cold read that merges events needs the same runtime details as an unchanged transcript.
	void bridge.subAgents.list(id).then((subAgentsList) => {
		if (!Array.isArray(subAgentsList)) return;
		// Kept for the conversation either way: another screen may be showing it.
		if (get().activeSessionId === id) useSubAgents.getState().sync(subAgentsList, id);
		else useSubAgents.getState().retain(id, subAgentsList);
	});

	// Capabilities describe a running agent; a transcript read from disk has none until the
	// session is activated, which the first message does.
	const capabilities = await bridge.sessions.capabilities(id);
	if (get().activeSessionId === id) set({ capabilities });
}
