/**
 * A command still running in a conversation that leaves the live slot and comes back.
 *
 * Split view makes this ordinary: focus moves to the screen beside it, the command keeps printing
 * into the parked copy, and focusing its screen again re-reads the conversation from the main
 * process. That read rebuilt tool state from the log alone — where the reply asking for the command
 * is already final (`toolUse`) and the result is not written until the command ends — so the
 * running command came back drawn as failed, and stayed a red cross until it finished. A screen
 * warmed while its command runs read it the same way.
 */

import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import type { AssistantMessage, Message, SessionMeta, ToolResult } from "@lyra/core";
import { useApp } from "../../src/store/index.ts";
import { applyAgentEvent } from "../../src/store/apply-event.ts";
import { flushCoalesced } from "../../src/store/coalesce.ts";
import { warmSession } from "../../src/features/split/warm.ts";
import type { LyraApi } from "../../electron/ipc-types.ts";

type Snapshot = Awaited<ReturnType<LyraApi["sessions"]["transcript"]>>;

const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };

function meta(id: string): SessionMeta {
	return { id, title: id, cwd: "/test/project", projectId: "test", projectName: "test", createdAt: 1, updatedAt: 2, modelId: "test", messageCount: 2, seq: 3, usage };
}

const ask: Message = { role: "user", content: [{ type: "text", text: "run it" }], timestamp: 1 };
/** The reply that asked for the command: final as soon as it has asked, long before the command ends. */
const asking: AssistantMessage = {
	role: "assistant",
	content: [{ type: "toolCall", id: "call-1", name: "bash", arguments: { command: "for i in 1 2 3; do echo tick; sleep 1; done" } }],
	api: "anthropic-messages",
	provider: "test",
	model: "test",
	usage,
	stopReason: "toolUse",
	timestamp: 2,
};
const answered: AssistantMessage = { ...asking, content: [{ type: "text", text: "b's answer" }], stopReason: "stop" };

const printed = (text: string): ToolResult => ({ content: [{ type: "text", text }] });

/** What the main process answers for a conversation whose command is still running. */
function busy(id: string): Snapshot {
	return { meta: meta(id), messages: [ask, asking], running: true, pendingApprovals: [], compactions: [] };
}
function idle(id: string): Snapshot {
	return { meta: meta(id), messages: [ask, answered], running: false, pendingApprovals: [], compactions: [] };
}

beforeEach(() => {
	flushCoalesced();
	useApp.setState({
		activeSessionId: "a",
		pendingSessionId: null,
		meta: meta("a"),
		messages: [ask, asking],
		toolRuns: {
			"call-1": { toolCallId: "call-1", toolName: "bash", summary: "for i in 1 2 3", args: {}, status: "running", startedAt: 5, result: printed("tick") },
		},
		running: true,
		sessionCache: {},
		approvals: [],
		todos: [],
		compactions: [],
		commandRuns: [],
		stopped: null,
		retrying: null,
		capabilities: null,
		activity: { a: "running" },
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
				transcript: async (_projectId: string, id: string) => (id === "a" ? busy(id) : idle(id)),
				capabilities: async () => null,
			},
			subAgents: { list: async () => [] },
			git: { generalScratch: async () => "/test" },
		},
	});
});

test("focusing a conversation again while its command runs keeps the command running", async () => {
	// Focus moves to the screen beside it; the conversation with the command is parked.
	await useApp.getState().openSession(meta("b"));
	// The command goes on printing while it is parked, which marks the parked copy for a re-read.
	applyAgentEvent("a", { type: "tool_update", toolCallId: "call-1", partial: printed("tick\ntick") }, useApp.setState, useApp.getState);
	assert.ok(useApp.getState().sessionCache.a?.dirty, "the parked copy took the output");

	// Focus comes back, and the conversation is read again from the main process.
	await useApp.getState().openSession(meta("a"));
	const run = useApp.getState().toolRuns["call-1"];
	assert.equal(run?.status, "running", "the command is still running; drawing it failed is the bug");
	assert.equal(run.startedAt, 5, "its clock keeps counting from when it started");
	assert.deepEqual(run.result, printed("tick\ntick"), "what it has printed so far is still shown");
});

test("a screen warmed while its command runs draws the command running", async () => {
	// The screen beside a live one, read without taking the live slot.
	useApp.setState({ activeSessionId: "b", meta: meta("b"), messages: [ask, answered], toolRuns: {}, running: false, sessionCache: {} });
	await warmSession(meta("a"));
	assert.equal(useApp.getState().sessionCache.a?.toolRuns["call-1"]?.status, "running");
});

test("a command that ended while nobody was looking still reads as finished", async () => {
	// The other half of the rule: without the main process saying the turn is running, a call with no
	// result did not survive — a restart mid-command must not leave a spinner counting forever.
	useApp.setState({ activeSessionId: "b", meta: meta("b"), messages: [ask, answered], toolRuns: {}, running: false, sessionCache: {} });
	Object.defineProperty(window, "lyra", {
		configurable: true,
		value: {
			sessions: { transcript: async (_projectId: string, id: string) => ({ ...busy(id), running: false }), capabilities: async () => null },
			subAgents: { list: async () => [] },
		},
	});
	await warmSession(meta("a"));
	assert.equal(useApp.getState().sessionCache.a?.toolRuns["call-1"]?.status, "error");
});
