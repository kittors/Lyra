import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import type { AssistantMessage, SessionMeta } from "@lyra/core";
import { useApp } from "../../src/store/index.ts";
import { applyAgentEvent } from "../../src/store/apply-event.ts";
import { flushCoalesced } from "../../src/store/coalesce.ts";
import { prune, type Cache } from "../../src/store/derive.ts";
import type { LyraApi } from "../../electron/ipc-types.ts";

type Snapshot = Awaited<ReturnType<LyraApi["sessions"]["transcript"]>>;
let readTranscript: LyraApi["sessions"]["transcript"];

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
	flushCoalesced();
	readTranscript = async (_projectId, id) => snapshot(id);
	useApp.setState({
		activeSessionId: "a",
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
		view: "chat",
		sessions: [meta("a"), meta("b")],
	});
	Object.defineProperty(window, "lyra", {
		configurable: true,
		value: {
			sessions: {
				transcript: (projectId: string, id: string) => readTranscript(projectId, id),
				capabilities: async () => null,
			},
			subAgents: { list: async () => [] },
			git: { generalScratch: async () => "/test" },
		},
	});
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
