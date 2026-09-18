import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import type { UserContent } from "@lyra/core";
import type { SessionSnapshot } from "../../electron/ipc-types.ts";
import { useApp } from "../../src/store/index.ts";

const content: UserContent[] = [{ type: "text", text: "相同的问题" }];
const requests: { resolve: (snapshot: SessionSnapshot) => void }[] = [];
const prompted: string[] = [];
function snapshot(id: string): SessionSnapshot {
	return {
		meta: { id, title: "相同的问题", projectId: "test", projectName: "test", cwd: "/test", createdAt: 1, updatedAt: 2, modelId: "", messageCount: 1, seq: 2,
			usage: { input: 0, output: 0, total: 0, cacheRead: 0, cacheWrite: 0, cost: { input: 0, output: 0, total: 0, cacheRead: 0, cacheWrite: 0 } } },
		messages: [{ role: "user", content, timestamp: 10 }], running: true, pendingApprovals: [],
	};
}

beforeEach(() => {
	requests.length = 0; prompted.length = 0;
	useApp.setState({ activeSessionId: null, meta: null, messages: [], sessions: [], workspace: null, scratchCwd: "/test", scratchRoots: ["/test"], sessionCache: {}, toolRuns: {}, running: false, pendingUserMessage: null, activity: {}, turns: {}, carried: {}, notices: [], settings: null });
	Object.defineProperty(window, "lyra", { configurable: true, value: {
		sessions: {
			create: () => new Promise<SessionSnapshot>((resolve) => requests.push({ resolve })),
			capabilities: async () => null,
		},
		agent: { prompt: async (id: string) => { prompted.push(id); return snapshot(id).meta; } },
		git: { generalScratch: async () => "/test" },
	} });
});

test("two same-prompt creations resolving out of order keep their identities and selection", async () => {
	const first = useApp.getState().send(content);
	await useApp.getState().newSession();
	const second = useApp.getState().send(content);
	requests[1].resolve(snapshot("b"));
	await second;
	requests[0].resolve(snapshot("a"));
	await first;
	assert.equal(useApp.getState().activeSessionId, "b", "a late create must not steal navigation");
	assert.deepEqual(new Set(useApp.getState().sessions.map((session) => session.id)), new Set(["a", "b"]));
	assert.deepEqual(prompted, ["b", "a"]);
	assert.equal(useApp.getState().messages.length, 1);
	assert.equal(useApp.getState().sessionCache.a.meta.id, "a");
});

test("leaving a pending creation for a blank draft does not populate that draft", async () => {
	const sending = useApp.getState().send(content);
	await useApp.getState().newSession();
	requests[0].resolve(snapshot("a"));
	await sending;
	assert.equal(useApp.getState().activeSessionId, null);
	assert.deepEqual(useApp.getState().messages, []);
	assert.equal(useApp.getState().running, false);
	assert.equal(useApp.getState().sessions[0].title, "相同的问题");
});


test("two submissions in the same draft create a single conversation", async () => {
	const first = useApp.getState().send(content);
	const second = useApp.getState().send([{ type: "text", text: "补充一句" }]);
	assert.equal(requests.length, 1);
	requests[0].resolve(snapshot("a"));
	await Promise.all([first, second]);
	assert.equal(useApp.getState().sessions.length, 1);
	assert.deepEqual(prompted, ["a", "a"]);
	assert.equal(useApp.getState().messages.length, 2);
});

test("a failed capability refresh does not turn an accepted prompt into a retryable send", async () => {
	const active = snapshot("a");
	useApp.setState({ activeSessionId: "a", meta: active.meta, sessions: [active.meta] });
	Object.defineProperty(window, "lyra", { configurable: true, value: {
		agent: { prompt: async () => active.meta },
		sessions: { capabilities: async () => { throw new Error("connection lost after acknowledgement"); } },
	} });
	assert.equal(await useApp.getState().send(content), true);
	assert.equal(useApp.getState().running, true);
	assert.ok(useApp.getState().notices.every(notice => !notice.message.startsWith("发送失败")));
});

test("undoing the last user message cuts the tail and fills the composer", async () => {
	const active = snapshot("a");
	useApp.setState({
		activeSessionId: "a",
		meta: active.meta,
		messages: active.messages,
		running: false,
		composerDraft: { text: "", replace: false, attachments: [], sessionRefs: [] },
	});
	const called: number[] = [];
	Object.defineProperty(window, "lyra", { configurable: true, value: {
		agent: { revertMessage: async (_id: string, index: number) => { called.push(index); } },
	} });
	await useApp.getState().revertMessage(0);
	assert.deepEqual(called, [0]);
	assert.deepEqual(useApp.getState().messages, []);
	assert.equal(useApp.getState().composerDraft.text, "相同的问题");
	assert.equal(useApp.getState().running, false);
});

test("an offline undo restores the transcript and does not fill the composer", async () => {
	const active = snapshot("a");
	useApp.setState({
		activeSessionId: "a",
		meta: active.meta,
		messages: active.messages,
		running: false,
		composerDraft: { text: "", replace: false, attachments: [], sessionRefs: [] },
	});
	Object.defineProperty(window, "lyra", { configurable: true, value: {
		agent: { revertMessage: async () => { throw new Error("offline"); } },
	} });
	await useApp.getState().revertMessage(0);
	assert.equal(useApp.getState().messages, active.messages);
	assert.equal(useApp.getState().composerDraft.text, "");
	assert.ok(useApp.getState().notices.some((notice) => notice.message.includes("撤销失败")));
});

test("an offline edit preserves the previous transcript and leaves a visible failure", async () => {
	const active = snapshot("a");
	useApp.setState({ activeSessionId: "a", meta: active.meta, messages: active.messages, running: false });
	Object.defineProperty(window, "lyra", { configurable: true, value: {
		agent: { editMessage: async () => { throw new Error("offline"); } },
	} });
	await useApp.getState().editMessage(0, [{ type: "text", text: "未能提交的编辑" }]);
	assert.equal(useApp.getState().messages, active.messages);
	assert.equal(useApp.getState().running, false);
	assert.equal(useApp.getState().pendingUserMessage, null);
	assert.ok(useApp.getState().notices.some(notice => notice.message.includes("编辑重发失败")));
});

test("a failed reasoning-level change rolls back the uncommitted picker value", async () => {
	const active = snapshot("a");
	useApp.setState({ activeSessionId: "a", meta: active.meta });
	Object.defineProperty(window, "lyra", { configurable: true, value: {
		agent: { setThinking: async () => { throw new Error("offline"); } },
	} });
	await useApp.getState().setThinking("high");
	assert.equal(useApp.getState().meta?.thinking, active.meta.thinking);
	assert.ok(useApp.getState().notices.some(notice => notice.message.includes("推理等级设置失败")));
});

test("an unacknowledged approval stays available for retry after a connection failure", async () => {
	const approval = { id: "approval", kind: "shell", title: "Run command", detail: "echo hello" };
	useApp.setState({ activeSessionId: "a", approvals: [approval] });
	Object.defineProperty(window, "lyra", { configurable: true, value: {
		agent: { approve: async () => { throw new Error("offline"); } },
	} });
	await assert.rejects(useApp.getState().respondToApproval("approval", "once"), /offline/);
	assert.deepEqual(useApp.getState().approvals, [approval]);
});

for (const acknowledged of [false, true]) {
test(`a rejected older prompt cannot clear a newer ${acknowledged ? "acknowledged" : "pending"} message in the same session`, async () => {
	const active = snapshot("a");
	useApp.setState({ activeSessionId: "a", meta: active.meta, messages: active.messages, sessions: [active.meta] });
	let rejectOlder!: (error: Error) => void;
	let finishNewer!: (meta: SessionSnapshot["meta"]) => void;
	let submitted = 0;
	Object.defineProperty(window, "lyra", { configurable: true, value: {
		agent: { prompt: () => submitted++ === 0
			? new Promise<SessionSnapshot["meta"]>((_resolve, reject) => { rejectOlder = reject; })
			: new Promise<SessionSnapshot["meta"]>((resolve) => { finishNewer = resolve; }) },
		sessions: { capabilities: async () => null },
	} });
	const older = useApp.getState().send([{ type: "text", text: "older" }]);
	const newer = useApp.getState().send([{ type: "text", text: "newer" }]);
	if (acknowledged) {
		const pending = useApp.getState().pendingUserMessage;
		assert.ok(pending);
		useApp.getState().applyEvent("a", { type: "message_end", message: { ...pending.message, timestamp: pending.message.timestamp + 1 } });
		finishNewer(active.meta);
		assert.equal(await newer, true);
		assert.equal(useApp.getState().pendingUserMessage, null);
	}
	const pending = useApp.getState().pendingUserMessage;
	rejectOlder(new Error("older request rejected"));
	assert.equal(await older, false);
	assert.equal(useApp.getState().pendingUserMessage, pending);
	assert.equal(useApp.getState().running, true);
	assert.equal(useApp.getState().activity.a, "running");
	if (!acknowledged) { finishNewer(active.meta); assert.equal(await newer, true); }
});
}
