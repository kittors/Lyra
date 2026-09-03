import assert from "node:assert/strict";
import { test } from "node:test";

import type { AssistantMessage, Message } from "@lyra/core";

import { emptyUsage } from "@lyra/core";

import { hasRetryPoint, howItStopped, rebuildToolRuns, wasCutShort } from "../src/store/derive.ts";
import { settleTail } from "../src/lib/transcript.ts";

function reply(stopReason: AssistantMessage["stopReason"], text = "你好！"): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		stopReason,
		timestamp: 1,
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, cost: { input: 0, output: 0, total: 0 } },
	};
}

const asked: Message = { role: "user", content: [{ type: "text", text: "你好呀" }], timestamp: 0 };

test("a reply cut off by a dropped connection is marked as failed, not left pending", () => {
	const settled = settleTail([asked, reply("pending")], {
		type: "agent_end",
		reason: "error",
		error: "terminated (UND_ERR_SOCKET)",
	});

	const tail = settled[1] as AssistantMessage;
	assert.equal(tail.stopReason, "error");
	assert.equal(tail.errorMessage, "terminated (UND_ERR_SOCKET)");
	// The text that did arrive before the socket died is still worth showing.
	assert.deepEqual(tail.content, [{ type: "text", text: "你好！" }]);
});

test("stopping a turn marks the tail as aborted rather than as a failure", () => {
	const settled = settleTail([asked, reply("pending")], { type: "agent_end", reason: "aborted" });
	assert.equal((settled[1] as AssistantMessage).stopReason, "aborted");
	assert.equal((settled[1] as AssistantMessage).errorMessage, undefined);
});

test("a turn that ended normally is left exactly as the stream settled it", () => {
	const messages = [asked, reply("stop")];
	const settled = settleTail(messages, { type: "agent_end", reason: "done" });
	assert.equal(settled, messages, "no pending tail means no new array");
});

test("only the tail is touched, not an earlier turn that failed the same way", () => {
	const earlier = { ...reply("pending", "上一轮"), timestamp: 0 };
	const settled = settleTail([asked, earlier, asked, reply("pending")], { type: "agent_end", reason: "done" });

	assert.equal((settled[1] as AssistantMessage).stopReason, "pending", "an older turn is not this run's to settle");
	assert.equal((settled[3] as AssistantMessage).stopReason, "stop");
});

test("a call left without a result is settled, not left spinning", () => {
	/*
	 * The shape a log has after the app is quit mid-command: the call was written, the result
	 * never was, and the turn was closed out on the next load.
	 */
	const messages: Message[] = [
		{ role: "user", content: [{ type: "text", text: "跑一下" }], timestamp: 1 },
		{
			role: "assistant",
			content: [{ type: "toolCall", id: "call-1", name: "bash", arguments: { command: "git status" } }],
			stopReason: "stop",
			timestamp: 2,
			usage: emptyUsage(),
		},
	];

	const runs = rebuildToolRuns(messages);
	assert.equal(runs["call-1"].status, "error");
	assert.ok(runs["call-1"].finishedAt, "a settled run has an end, so the timer stops");
});

test("a turn still in flight keeps its running calls", () => {
	const messages: Message[] = [
		{ role: "user", content: [{ type: "text", text: "跑一下" }], timestamp: 1 },
		{
			role: "assistant",
			content: [{ type: "toolCall", id: "call-1", name: "bash", arguments: { command: "sleep 30" } }],
			stopReason: "pending",
			timestamp: 2,
			usage: emptyUsage(),
		},
	];

	// Reopening a session that is genuinely mid-turn must not fake a failure.
	assert.equal(rebuildToolRuns(messages)["call-1"].status, "running");
});

test("a call that did get its result is unaffected", () => {
	const messages: Message[] = [
		{ role: "user", content: [{ type: "text", text: "跑一下" }], timestamp: 1 },
		{
			role: "assistant",
			content: [{ type: "toolCall", id: "call-1", name: "bash", arguments: {} }],
			stopReason: "stop",
			timestamp: 2,
			usage: emptyUsage(),
		},
		{ role: "toolResult", toolCallId: "call-1", content: [{ type: "text", text: "ok" }], timestamp: 3 },
	];
	assert.equal(rebuildToolRuns(messages)["call-1"].status, "done");
});

test("a turn stopped between a tool result and the reply counts as cut short", () => {
	const messages = [
		{ role: "user", content: [{ type: "text", text: "跑一下" }], timestamp: 1 },
		{
			role: "assistant",
			content: [{ type: "toolCall", id: "c1", name: "bash", arguments: {} }],
			stopReason: "toolUse",
			timestamp: 2,
		},
		{ role: "toolResult", toolCallId: "c1", content: [{ type: "text", text: "done" }], timestamp: 3 },
	] as unknown as Message[];

	assert.equal(wasCutShort(messages), true, "the answer never arrived");

	const complete = [
		...messages,
		{ role: "assistant", content: [{ type: "text", text: "好了" }], stopReason: "stop", timestamp: 4 },
	] as unknown as Message[];
	assert.equal(wasCutShort(complete), false);
});

// ---------------------------------------------------------------------------
// How the turn stopped
// ---------------------------------------------------------------------------

test("a finished turn is not offering to be resumed", () => {
	assert.equal(howItStopped([asked, reply("stop")], "done"), null);
});

test("pressing stop mid-sentence is a pause, not an interruption", () => {
	/*
	 * The case the whole thing was written for. `settleTail` has just marked the reply `aborted`,
	 * and it holds no tool calls — which is the shape `wasCutShort` reads as a complete turn, so
	 * before this the window offered nothing at all after a pause.
	 */
	const settled = settleTail([asked, reply("pending")], { type: "agent_end", reason: "aborted" });
	assert.equal(wasCutShort(settled), false, "a stopped sentence looks finished by shape alone");
	assert.equal(howItStopped(settled, "aborted"), "user");
	// And still says so next week, with no event left to ask.
	assert.equal(howItStopped(settled), "user");
});

test("stopping while a tool runs is a pause too, though the transcript cannot tell", () => {
	/*
	 * The last reply was settled as `toolUse` long before the stop, so nothing in the log records
	 * who ended the turn. The event does, and that is why it wins where the two disagree.
	 */
	const midTool = [
		asked,
		{
			role: "assistant",
			content: [{ type: "toolCall", id: "c1", name: "bash", arguments: {} }],
			stopReason: "toolUse",
			timestamp: 2,
		},
	] as unknown as Message[];

	assert.equal(howItStopped(midTool, "aborted"), "user");
	// Reopened later, it reads as an interruption — which is the honest answer, and offers the same two things.
	assert.equal(howItStopped(midTool), "interrupt");
});

test("a turn the app never came back from is an interruption", () => {
	assert.equal(howItStopped([asked, reply("pending")]), "interrupt");
});

test("a failed request is a turn to be resumed, not only one to be re-asked", () => {
	/*
	 * This used to answer `null`, on the reasoning that the failed reply already puts 重试 under
	 * the error text and a second offer would be the same button further away. The two are not the
	 * same button, which is the whole of the mistake: 重试 discards the turn and asks again, and
	 * for a turn that had spent a minute reading a codebase before a 503 that is the expensive
	 * answer to a question nobody asked. `error` is what makes 继续 appear, and 继续 keeps the
	 * work.
	 */
	assert.equal(howItStopped([asked, reply("error")], "error"), "error");
	// And from the transcript alone, days later, with no event to go by.
	assert.equal(howItStopped([asked, reply("error")]), "error");
	// Still distinct from a pause and from a crash: the three say different things to the user.
	assert.equal(howItStopped([asked, reply("aborted")], "aborted"), "user");
	assert.equal(howItStopped([asked, reply("pending")]), "interrupt");
});

test("there is nothing to re-ask when nobody has asked anything", () => {
	assert.equal(hasRetryPoint([reply("stop")]), false);
	assert.equal(hasRetryPoint([asked, reply("stop")]), true);
	// The runtime's own nudges are not something anyone typed, so they are not a retry point.
	const nudged = [{ ...asked, synthetic: true }] as Message[];
	assert.equal(hasRetryPoint(nudged), false);
});
