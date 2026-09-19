import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import type { AssistantMessage, SessionMeta } from "@lyra/core";
import { useApp } from "../../src/store/index.ts";
import { applyAgentEvent } from "../../src/store/apply-event.ts";
import { flushCoalesced } from "../../src/store/coalesce.ts";
import { prune, type Cache } from "../../src/store/derive.ts";
import { afterPaint } from "../../src/lib/after-paint.ts";
import { readSelectedSession } from "../../src/store/session-read.ts";
import { applySessionChange } from "../../src/store/session-changes.ts";
import { abandonSessionReveal, revealSession } from "../../src/features/split/actions.ts";
import type { LyraApi } from "../../electron/ipc-types.ts";

type Snapshot = Awaited<ReturnType<LyraApi["sessions"]["transcript"]>>;
let readTranscript: LyraApi["sessions"]["transcript"];
let capabilityReads: string[];
let rosterReads: string[];

function deferredRead() {
	let resolve!: (value: Snapshot) => void;
	const promise = new Promise<Snapshot>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

function snapshot(id: string): Snapshot {
	return { meta: meta(id), messages: [reply(id)], running: false, pendingApprovals: [], compactions: [] };
}

const usage = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	total: 0,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};
function meta(id: string): SessionMeta {
	return {
		id,
		title: id,
		cwd: "/test/project",
		projectId: "test",
		projectName: "test",
		createdAt: 1,
		updatedAt: 2,
		modelId: "test",
		messageCount: 1,
		seq: 2,
		usage,
	};
}
function reply(text: string): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		api: "anthropic-messages",
		provider: "test",
		model: "test",
		stopReason: "stop",
		timestamp: 10,
		usage,
	};
}

beforeEach(() => {
	abandonSessionReveal();
	flushCoalesced();
	readTranscript = async (_projectId, id) => snapshot(id);
	capabilityReads = [];
	rosterReads = [];
	useApp.setState({
		activeSessionId: "a",
		pendingSessionId: null,
		meta: meta("a"),
		messages: [reply("a")],
		toolRuns: {},
		sessionCache: {},
		running: false,
		approvals: [],
		todos: [],
		compactions: [],
		stopped: null,
		retrying: null,
		capabilities: null,
		activity: {},
		turns: {},
		carried: {},
		scratchRoots: ["/test"],
		scratchCwd: "/test",
		workspace: null,
		loadingSession: false,
		pendingUserMessage: null,
		view: "chat",
		sessions: [meta("a"), meta("b")],
	});
	Object.defineProperty(window, "lyra", {
		configurable: true,
		value: {
			sessions: {
				transcript: (projectId: string, id: string) => readTranscript(projectId, id),
				capabilities: async (id: string) => { capabilityReads.push(id); return null; },
			},
			subAgents: { list: async (id: string) => { rosterReads.push(id); return []; } },
			git: { generalScratch: async () => "/test" },
		},
	});
});

test("previewing a session lights it without swapping the live transcript", () => {
	const original = useApp.getState().messages;
	const epoch = useApp.getState().previewSession(meta("b"));
	assert.equal(useApp.getState().pendingSessionId, "b");
	assert.equal(useApp.getState().activeSessionId, "a");
	assert.equal(useApp.getState().messages, original);
	assert.equal(useApp.getState().view, "chat");
	assert.equal(useApp.getState().selectionEpoch, epoch);
	assert.equal(useApp.getState().previewSession(meta("b")), epoch, "a second preview of the same row is not a new navigation");
	useApp.setState({ view: "settings" });
	useApp.getState().previewSession(meta("c"));
	assert.equal(useApp.getState().view, "settings", "the row lights without tearing down the page that is still on screen");
	assert.equal(useApp.getState().pendingSessionId, "c");
});

test("clicking the loaded conversation from another page reveals it without reloading or replacing its state", async () => {
	const reads: string[] = [];
	readTranscript = async (_projectId, id) => { reads.push(id); return snapshot(id); };
	useApp.setState({ running: true, drafts: { a: { text: "unsent draft", attachments: [] } } });
	const original = useApp.getState();
	for (const view of ["plugins", "pull-requests", "scheduled", "settings"] as const) {
		useApp.setState({ view });
		revealSession(meta("a"));
		const current = useApp.getState();
		assert.equal(current.view, "chat", `the sidebar must leave ${view}`);
		assert.equal(current.messages, original.messages);
		assert.equal(current.drafts, original.drafts);
		assert.equal(current.running, true);
		assert.equal(current.loadingSession, false);
		assert.equal(current.selectionEpoch, original.selectionEpoch);
	}
	await afterPaint();
	assert.deepEqual(reads, []);
	assert.deepEqual(capabilityReads, []);
	assert.deepEqual(rosterReads, []);
});

test("a single sidebar click hydrates in the same turn", async () => {
	revealSession(meta("b"));
	assert.equal(useApp.getState().activeSessionId, "b");
	assert.equal(useApp.getState().pendingSessionId, null);
	assert.equal(useApp.getState().loadingSession, true);
	assert.equal(useApp.getState().messages.length, 0);
	for (let i = 0; i < 10 && useApp.getState().loadingSession; i++) await afterPaint();
	assert.equal(useApp.getState().loadingSession, false);
	assert.equal(useApp.getState().messages.length, 1);
});

test("a burst of sidebar clicks keeps the last row and skips intermediate disk reads", async () => {
	const reads: string[] = [];
	readTranscript = async (_projectId, id) => {
		reads.push(id);
		return snapshot(id);
	};
	let swaps = 0;
	let seen = useApp.getState().activeSessionId;
	const stop = useApp.subscribe((state) => {
		if (state.activeSessionId !== seen) {
			swaps += 1;
			seen = state.activeSessionId;
		}
	});
	try {
		for (const id of ["b", "c", "d", "e"]) revealSession(meta(id));
		assert.equal(useApp.getState().activeSessionId, "e");
		assert.equal(useApp.getState().pendingSessionId, null);
		assert.ok(swaps >= 1, "the pane follows the press");
		for (let i = 0; i < 10 && useApp.getState().loadingSession; i++) await afterPaint();
		assert.equal(useApp.getState().loadingSession, false);
		assert.ok(reads.includes("e"), "the row that stayed must hit disk");
		assert.ok(!reads.includes("c") && !reads.includes("d"), "intermediate rows must not hit disk");
	} finally {
		stop();
	}
});

test("an in-flight cold read does not paint if a newer row is pending", async () => {
	const first = deferredRead();
	const second = deferredRead();
	readTranscript = (_projectId, id) => (id === "b" ? first.promise : second.promise);
	revealSession(meta("b"));
	await afterPaint();
	assert.equal(useApp.getState().activeSessionId, "b");
	assert.equal(useApp.getState().loadingSession, true);
	revealSession(meta("c"));
	await afterPaint();
	assert.equal(useApp.getState().activeSessionId, "c");
	assert.equal(useApp.getState().pendingSessionId, null);
	first.resolve(snapshot("b"));
	await new Promise<void>((resolve) => setTimeout(resolve, 20));
	assert.equal(useApp.getState().messages.length, 0, "b's snapshot must not land after a newer row took the pane");
	second.resolve(snapshot("c"));
	for (let i = 0; i < 20 && useApp.getState().activeSessionId !== "c"; i++) await afterPaint();
	assert.equal(useApp.getState().activeSessionId, "c");
	assert.equal(useApp.getState().pendingSessionId, null);
	for (let i = 0; i < 10 && useApp.getState().loadingSession; i++) await afterPaint();
	assert.deepEqual(useApp.getState().messages[0]?.content, reply("c").content);
});

test("a clean cache hit does not read the transcript again", async () => {
	const reads: string[] = [];
	readTranscript = async (_projectId, id) => {
		reads.push(id);
		return snapshot(id);
	};
	await useApp.getState().openSession(meta("b"));
	assert.deepEqual(reads, ["b"]);
	reads.length = 0;
	await useApp.getState().openSession(meta("a"));
	assert.deepEqual(reads, [], "a parked finished log must not clone the file again");
	assert.equal(useApp.getState().activeSessionId, "a");
	assert.deepEqual(useApp.getState().messages[0]?.content, reply("a").content);
});

test("a dirty cache still refreshes from disk", async () => {
	const reads: string[] = [];
	readTranscript = async (_projectId, id) => {
		reads.push(id);
		return snapshot(id);
	};
	await useApp.getState().openSession(meta("b"));
	useApp.setState((state) => ({
		sessionCache: { ...state.sessionCache, a: { ...state.sessionCache.a, dirty: true } },
	}));
	reads.length = 0;
	await useApp.getState().openSession(meta("a"));
	assert.deepEqual(reads, ["a"]);
});

test("a warm visit restores session status before its background refresh", async () => {
	useApp.setState({
		stopped: "interrupt",
		compactions: [{ at: 1, before: 100, after: 10 }],
		retrying: { attempt: 2, until: 500, reason: "retry", resume: false },
	});
	const original = useApp.getState().messages;
	await useApp.getState().openSession(meta("b"));
	const opening = useApp.getState().openSession(meta("a"));
	assert.equal(useApp.getState().stopped, "interrupt");
	assert.equal(useApp.getState().retrying?.attempt, 2);
	assert.equal(useApp.getState().compactions.length, 1);
	assert.equal(useApp.getState().messages, original);
	await opening;
	assert.equal(useApp.getState().messages, original, "unchanged snapshots preserve message identity");
});

test("queued stream updates cannot write into a newly selected session", () => {
	const a = reply("stream from a");
	applyAgentEvent(
		"a",
		{ type: "message_update", message: a, delta: { type: "text_delta", index: 0, delta: "a", partial: a } },
		useApp.setState,
		useApp.getState,
	);
	useApp.setState({ activeSessionId: "b", meta: meta("b"), messages: [reply("b")] });
	flushCoalesced();
	assert.deepEqual(useApp.getState().messages[0].content, [{ type: "text", text: "b" }]);
	const b = reply("stream from b");
	applyAgentEvent(
		"b",
		{ type: "message_update", message: b, delta: { type: "text_delta", index: 0, delta: "b", partial: b } },
		useApp.setState,
		useApp.getState,
	);
	flushCoalesced();
	assert.deepEqual(useApp.getState().messages[0].content, [{ type: "text", text: "stream from b" }]);
});

test("pruning always respects the limit even when the oldest entry is active", () => {
	const cache: Cache = {};
	for (let i = 0; i < 15; i++) cache[`s-${i}`] = { meta: meta(`s-${i}`), messages: [], toolRuns: {} };
	const kept = prune(cache, "s-0");
	assert.equal(Object.keys(kept).length, 12);
	assert.ok(kept["s-0"]);
	assert.ok(kept["s-14"]);
});

test("visiting an old session makes it recent for cache eviction", async () => {
	const cache: Cache = {};
	for (let i = 0; i < 12; i++) cache[`s-${i}`] = { meta: meta(`s-${i}`), messages: [reply(`s-${i}`)], toolRuns: {} };
	useApp.setState({ activeSessionId: "s-11", meta: meta("s-11"), sessionCache: cache });
	await useApp.getState().openSession(meta("s-0"));
	await useApp.getState().openSession(meta("new"));
	assert.ok(useApp.getState().sessionCache["s-0"]);
	assert.equal(Object.keys(useApp.getState().sessionCache).length, 12);
});

test("a warm refresh cannot roll back live events received while reading", async () => {
	await useApp.getState().openSession(meta("b"));
	useApp.setState((state) => ({
		sessionCache: { ...state.sessionCache, a: { ...state.sessionCache.a, dirty: true } },
	}));
	const read = deferredRead();
	readTranscript = () => read.promise;
	const opening = useApp.getState().openSession(meta("a"));
	const latest = reply("new live message");
	applyAgentEvent("a", { type: "message_update", message: latest, delta: { type: "text_delta", index: 0, delta: "new", partial: latest } }, useApp.setState, useApp.getState);
	read.resolve(snapshot("a"));
	await opening;
	assert.deepEqual(useApp.getState().messages[0].content, latest.content);
});

test("draining queued reads does not reset a warm selection a second time", async () => {
	const first = deferredRead();
	const next = deferredRead();
	readTranscript = (_projectId, id) => (id === "b" ? first.promise : next.promise);
	const loading = useApp.getState().openSession(meta("b"));
	await useApp.getState().openSession(meta("a"));
	useApp.setState({ stopped: "error" });
	first.resolve(snapshot("b"));
	await loading;
	assert.equal(useApp.getState().stopped, "error", "the queued loader must not reselect/reset the view");
	next.resolve(snapshot("a"));
	await new Promise((resolve) => setTimeout(resolve, 0));
});

test("a new blank session cancels queued navigation and parks the previous view", async () => {
	useApp.setState({ stopped: "interrupt" });
	await useApp.getState().newSession();
	assert.equal(useApp.getState().sessionCache.a.state?.stopped, "interrupt");
	const read = deferredRead();
	readTranscript = () => read.promise;
	const opening = useApp.getState().openSession(meta("b"));
	await useApp.getState().openSession(meta("a"));
	await useApp.getState().newSession();
	read.resolve(snapshot("b"));
	await opening;
	assert.equal(useApp.getState().activeSessionId, null);
	assert.deepEqual(useApp.getState().messages, []);
});


test("background messages update a parked session without flashing a cold loader", async () => {
	await useApp.getState().openSession(meta("b"));
	const message = reply("background result");
	message.timestamp = 20;
	applyAgentEvent("a", { type: "message_start", message }, useApp.setState, useApp.getState);
	applyAgentEvent("a", { type: "message_end", message }, useApp.setState, useApp.getState);
	assert.ok(useApp.getState().sessionCache.a, "an updated cache must remain readable");
	const delayed = deferredRead();
	readTranscript = () => delayed.promise;
	const opening = useApp.getState().openSession(meta("a"));
	assert.equal(useApp.getState().loadingSession, false);
	assert.deepEqual(useApp.getState().messages.at(-1)?.content, message.content);
	delayed.resolve({ ...snapshot("a")!, messages: [reply("a"), message] });
	await opening;
});


test("a cold open leaves the previous transcript in this turn", async () => {
	const deferred = deferredRead();
	readTranscript = () => deferred.promise;
	const opening = useApp.getState().openSession({ ...meta("cold"), messageCount: 800 });
	assert.equal(useApp.getState().activeSessionId, "cold");
	assert.equal(useApp.getState().messages.length, 0);
	assert.equal(useApp.getState().loadingSession, true, "the next conversation owns the pane while it is read");
	assert.equal(useApp.getState().sessionCache.a?.messages.length, 1, "the conversation we left is parked");
	deferred.resolve(snapshot("cold"));
	await opening;
	assert.equal(useApp.getState().activeSessionId, "cold");
	assert.equal(useApp.getState().loadingSession, false);
	assert.equal(useApp.getState().messages.length, 1);
});

test("a cold open from a blank slot still shows a loader", async () => {
	useApp.setState({ activeSessionId: null, meta: null, messages: [], loadingSession: false });
	const deferred = deferredRead();
	readTranscript = () => deferred.promise;
	const opening = useApp.getState().openSession({ ...meta("cold"), messageCount: 800 });
	assert.equal(useApp.getState().loadingSession, true);
	assert.equal(useApp.getState().messages.length, 0);
	assert.equal(useApp.getState().meta?.messageCount, 800);
	deferred.resolve(snapshot("cold"));
	await opening;
	assert.equal(useApp.getState().loadingSession, false);
	assert.equal(useApp.getState().messages.length, 1);
});

test("a cold read retains the history prefix and events arriving while it was in flight", async () => {
	const deferred = deferredRead();
	readTranscript = () => deferred.promise;
	const opening = useApp.getState().openSession(meta("b"));
	const message = { ...reply("new reply"), timestamp: 20 };
	applyAgentEvent("b", { type: "agent_start", sessionId: "b" }, useApp.setState, useApp.getState);
	applyAgentEvent("b", { type: "message_end", message }, useApp.setState, useApp.getState);
	deferred.resolve(snapshot("b"));
	await opening;
	assert.deepEqual(useApp.getState().messages.map((message) => message.content), [reply("b").content, reply("new reply").content]);
	assert.equal(useApp.getState().running, true);
	assert.equal(useApp.getState().loadingSession, false);
	assert.deepEqual(capabilityReads, ["b"]);
	assert.deepEqual(rosterReads, ["b"]);
});

test("Windows scratch conversations retain their projectless identity on selection", async () => {
	const cwd = "C:\\Users\\Tester\\.lyra\\scratch\\session";
	useApp.setState({ scratchRoots: ["C:\\Users\\Tester\\.lyra\\scratch"], workspace: { path: "C:\\code\\project", name: "project", isGitRepo: false, branch: null } });
	await useApp.getState().openSession({ ...meta("b"), cwd });
	assert.equal(useApp.getState().workspace, null);
	assert.equal(useApp.getState().scratchCwd, cwd);
});

test("a failed transcript read releases loading and preserves warm content", async () => {
	await useApp.getState().openSession(meta("b"));
	await useApp.getState().openSession(meta("a"));
	useApp.setState((state) => ({
		sessionCache: { ...state.sessionCache, b: { ...state.sessionCache.b, dirty: true } },
	}));
	readTranscript = async () => { throw new Error("disk unavailable"); };
	await useApp.getState().openSession(meta("b"));
	assert.equal(useApp.getState().loadingSession, false);
	assert.deepEqual(useApp.getState().messages[0].content, reply("b").content);
	assert.ok(useApp.getState().notices.some((notice) => notice.message.includes("disk unavailable")));
});

test("reconnecting merges the missed history prefix with newly arriving live events", async () => {
	const read = deferredRead();
	readTranscript = () => read.promise;
	const missed = { ...reply("written while offline"), timestamp: 20 };
	const latest = { ...reply("live after reconnect"), timestamp: 30 };
	const reading = readSelectedSession(meta("a"), useApp.setState, useApp.getState, true);
	applyAgentEvent("a", { type: "message_start", message: latest }, useApp.setState, useApp.getState);
	read.resolve({ meta: meta("a"), messages: [reply("a"), missed], running: true, pendingApprovals: [] });
	await reading;
	assert.deepEqual(useApp.getState().messages.map(message => message.timestamp), [10, 20, 30]);
});

test("reconnecting during an existing read queues a fresh snapshot for the same session", async () => {
	const first = deferredRead();
	const second = deferredRead();
	let reads = 0;
	readTranscript = () => (++reads === 1 ? first.promise : second.promise);
	const opening = readSelectedSession(meta("a"), useApp.setState, useApp.getState);
	await readSelectedSession(meta("a"), useApp.setState, useApp.getState, true);
	first.resolve(snapshot("a"));
	await opening;
	// oxlint-disable-next-line no-unmodified-loop-condition -- `reads` increments when the queued IPC starts after paint
	for (let i = 0; i < 10 && reads < 2; i++) await afterPaint();
	assert.equal(reads, 2, "a response requested before reconnect cannot cover the offline gap");
	const missed = { ...reply("offline history"), timestamp: 20 };
	const live = { ...reply("after reconnect"), timestamp: 30 };
	applyAgentEvent("a", { type: "message_start", message: live }, useApp.setState, useApp.getState);
	second.resolve({ meta: meta("a"), messages: [reply("a"), missed], running: true, pendingApprovals: [] });
	await new Promise((resolve) => setTimeout(resolve, 0));
	assert.deepEqual(useApp.getState().messages.map(message => message.timestamp), [10, 20, 30]);
});

test("remote metadata updates the active picker, and deletion clears running state and cached content", () => {
	useApp.setState({ running: true, drafts: { a: { text: "local draft", attachments: [] } } });
	const changed = { ...meta("a"), modelId: "new-model", thinking: "high" as const, seq: 3 };
	applySessionChange({ id: "a", projectId: "test", meta: changed }, useApp.setState, useApp.getState);
	assert.equal(useApp.getState().meta?.modelId, "new-model");
	assert.equal(useApp.getState().meta?.thinking, "high");
	applySessionChange({ id: "a", projectId: "test", meta: null }, useApp.setState, useApp.getState);
	assert.equal(useApp.getState().activeSessionId, null);
	assert.equal(useApp.getState().running, false);
	assert.deepEqual(useApp.getState().messages, []);
	assert.equal(useApp.getState().sessionCache.a, undefined);
	assert.equal(useApp.getState().drafts.a, undefined);
});

test("failed archive and deletion leave the visible session and draft intact", async () => {
	Object.defineProperty(window, "lyra", { configurable: true, value: { sessions: {
		setArchived: async () => { throw new Error("offline"); },
		remove: async () => { throw new Error("offline"); },
	} } });
	useApp.setState({ drafts: { a: { text: "unsent", attachments: [] } }, notices: [] });
	await useApp.getState().setSessionArchived(meta("a"), true);
	await useApp.getState().deleteSession(meta("a"));
	assert.equal(useApp.getState().activeSessionId, "a");
	assert.equal(useApp.getState().sessions.find(session => session.id === "a")?.archived, undefined);
	assert.equal(useApp.getState().drafts.a.text, "unsent");
	assert.equal(useApp.getState().notices.filter(notice => notice.level === "error").length, 2);
});
