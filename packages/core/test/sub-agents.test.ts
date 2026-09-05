/**
 * What the sub-agent registry promises to anything watching or steering a delegated run.
 *
 * Delegation used to be write-only — dispatched, then a paragraph of answer — so all of this is
 * about the two things that were missing: seeing what a sub-agent is doing, and being able to
 * change its course without killing it.
 *
 * The claims worth testing are the ones where getting it wrong is silent. A record stuck on
 * `running` after its run threw looks exactly like work still in progress. A finished sub-agent
 * that still accepts steering swallows the message and reports nothing. Retiring the wrong record
 * throws away the transcript somebody is reading.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { SubAgentRegistry } from "../src/runtime/sub-agents.ts";
import type { Message } from "../src/types/message.ts";
import { emptyUsage } from "../src/types.ts";

function said(text: string): Message {
	// `usage` is required on a real one, and the registry adds it up — a double without it would crash the sum.
	return { role: "assistant", content: [{ type: "text", text }], timestamp: 0, usage: emptyUsage() } as Message;
}

/** A registry plus a count of how many times it announced a change. */
function harness() {
	let changes = 0;
	const registry = new SubAgentRegistry(() => {
		changes += 1;
	});
	const dispatch = (id: string, over: Partial<{ agent: string; description: string }> = {}) => {
		let aborted = false;
		registry.start({
			id,
			agent: over.agent ?? "general",
			description: over.description ?? "找一处代码",
			abort: () => {
				aborted = true;
			},
		});
		return { get aborted() { return aborted; } };
	};
	return { registry, dispatch, changes: () => changes };
}

test("a dispatched sub-agent is listed as running, with what it was asked to do", () => {
	const { registry, dispatch } = harness();
	dispatch("s1", { agent: "explore", description: "找登录入口" });

	assert.deepEqual(
		registry.list().map((one) => ({ id: one.id, agent: one.agent, description: one.description, status: one.status })),
		[{ id: "s1", agent: "explore", description: "找登录入口", status: "running" }],
	);
	assert.equal(registry.running, 1);
});

test("its transcript accumulates as it speaks, and stays its own", () => {
	const { registry, dispatch } = harness();
	dispatch("s1");
	dispatch("s2");

	registry.record("s1", said("读到了"));
	registry.record("s2", said("别的"));
	registry.record("s1", said("再一句"));

	assert.equal(registry.detail("s1")?.messages.length, 2, "two of its own");
	assert.equal(registry.detail("s2")?.messages.length, 1, "and none of its sibling's");
});

test("activity is a reading of progress, not a history", () => {
	// What a viewer asks is "is this stuck?", and thirty lines of 「读取文件」 answer it worse than
	// the newest one plus a count.
	const { registry, dispatch } = harness();
	dispatch("s1");

	registry.activity("s1", "读取文件 a.ts");
	registry.activity("s1", "读取文件 b.ts");

	const one = registry.list()[0];
	assert.equal(one.toolCalls, 2);
	assert.equal(one.lastActivity, "读取文件 b.ts");
});

test("steering a running sub-agent queues the message and shows it in the transcript", () => {
	/*
	 * Both halves matter. Queued is what reaches the loop; recorded is what stops the reply from
	 * appearing in the pane as an answer to a question nobody can see being asked.
	 */
	const { registry, dispatch } = harness();
	dispatch("s1");

	assert.ok(registry.steer("s1", "别看测试目录"), "the message it queued, for the caller to announce");

	assert.deepEqual(
		registry.detail("s1")?.messages.map((m) => (m.content[0] as { text: string }).text),
		["别看测试目录"],
		"said to it, and visible as having been said",
	);
	const drained = registry.drainSteering("s1");
	assert.equal(drained.length, 1, "and waiting for the loop");
	assert.deepEqual(registry.drainSteering("s1"), [], "drained once, not twice");
});

test("a finished sub-agent cannot be steered", () => {
	// The message would be queued against a loop that will never drain it — accepted, and silently
	// never delivered, which is the worst of the three possible answers.
	const { registry, dispatch } = harness();
	dispatch("s1");
	registry.finish("s1", { status: "done", answer: "找到了" });

	assert.equal(registry.steer("s1", "再看看"), null);
	assert.equal(registry.detail("s1")?.messages.length, 0, "and nothing was written to its transcript");
});

test("steering something that was never dispatched says so rather than inventing it", () => {
	const { registry } = harness();
	assert.equal(registry.steer("nope", "喂"), null);
});

test("blank steering is not a message", () => {
	const { registry, dispatch } = harness();
	dispatch("s1");
	assert.equal(registry.steer("s1", "   "), null);
});

test("finishing records the answer and takes the levers away", () => {
	const { registry, dispatch } = harness();
	const one = dispatch("s1");
	registry.finish("s1", { status: "done", answer: "在 auth.ts:42" });

	const summary = registry.list()[0];
	assert.equal(summary.status, "done");
	assert.equal(summary.answer, "在 auth.ts:42");
	assert.ok(summary.endedAt, "and when");
	assert.equal(registry.running, 0);
	assert.equal(registry.abort("s1"), false, "a finished run has nothing to abort");
	assert.equal(one.aborted, false);
});

test("aborting a running sub-agent pulls its trigger and leaves the rest alone", () => {
	const { registry, dispatch } = harness();
	const first = dispatch("s1");
	const second = dispatch("s2");

	assert.equal(registry.abort("s1"), true);

	assert.equal(first.aborted, true);
	assert.equal(second.aborted, false, "its sibling is untouched");
	/*
	 * Still `running` here on purpose: the run's own teardown is what records how it ended, so a
	 * sub-agent that was already finishing when the button was pressed is not filed as killed.
	 */
	assert.equal(registry.list()[0].status, "running");
});

test("a run that threw is recorded as failed rather than left running forever", () => {
	// The case that is invisible: a record stuck on `running` looks exactly like work in progress,
	// so the roster shows a spinner for something that died minutes ago.
	const { registry, dispatch } = harness();
	dispatch("s1");
	registry.finish("s1", { status: "failed", error: "provider 429" });

	const summary = registry.list()[0];
	assert.equal(summary.status, "failed");
	assert.equal(summary.error, "provider 429");
	assert.equal(registry.running, 0);
});

test("every change is announced, so a window never has to poll", () => {
	const { registry, dispatch, changes } = harness();
	const before = changes();
	dispatch("s1");
	registry.record("s1", said("嗯"));
	registry.activity("s1", "读取文件");
	registry.steer("s1", "换个方向");
	registry.finish("s1", { status: "done", answer: "" });

	assert.equal(changes() - before, 5, "start, message, activity, steer, finish");
});

test("the roster is bounded, and a running sub-agent is never the one retired", () => {
	/*
	 * A long session dispatches dozens and each carries its whole transcript. Retiring by age is
	 * fine; retiring something still running is not — the roster would lose the row for work that
	 * is still going, and with it the only way to steer or stop it.
	 */
	const { registry, dispatch } = harness();
	dispatch("keep-me");
	for (let i = 0; i < 40; i++) {
		dispatch(`s${i}`);
		registry.finish(`s${i}`, { status: "done", answer: "" });
	}

	const ids = registry.list().map((one) => one.id);
	assert.ok(ids.includes("keep-me"), "the running one survived forty finished ones");
	assert.ok(ids.length <= 24, `bounded, got ${ids.length}`);
	assert.equal(registry.running, 1);
});

test("aborting everything reaches every running sub-agent and no finished one", () => {
	const { registry, dispatch } = harness();
	const first = dispatch("s1");
	const second = dispatch("s2");
	const third = dispatch("s3");
	registry.finish("s3", { status: "done", answer: "" });

	registry.abortAll();

	assert.equal(first.aborted, true);
	assert.equal(second.aborted, true);
	assert.equal(third.aborted, false);
});

test("the summary list carries no transcript, so broadcasting it stays cheap", () => {
	// It is sent on every change; including the messages would put the whole delegated run on the
	// wire each time a tool call finished.
	const { registry, dispatch } = harness();
	dispatch("s1");
	registry.record("s1", said("很长的一段"));

	assert.equal("messages" in registry.list()[0], false);
	assert.equal(registry.detail("s1")?.messages.length, 1, "but the detail still has it");
});

/*
 * Closing a row, and the accident it must not cause.
 *
 * A record is the only handle there is: it carries the abort trigger and the steering queue. So
 * removing one that is still running does not tidy anything up — it strands a sub-agent that goes
 * on spending tokens, holding the parent's `task` call open, and reachable by nothing. That is the
 * failure these are written for, and it is completely invisible from the outside.
 */

test("dismissing a finished sub-agent removes it", () => {
	const { registry, dispatch } = harness();
	dispatch("s1");
	registry.finish("s1", { status: "done", answer: "" });

	assert.equal(registry.dismiss("s1"), "removed");
	assert.deepEqual(registry.list(), []);
});

test("dismissing a running sub-agent stops it instead of stranding it", () => {
	const { registry, dispatch } = harness();
	const one = dispatch("s1");

	assert.equal(registry.dismiss("s1"), "stopping");

	assert.equal(one.aborted, true, "it was told to stop");
	assert.equal(registry.list().length, 1, "and it keeps its row until the run files itself as aborted");
	assert.equal(registry.list()[0].status, "running");
});

test("the row goes on the second dismiss, once the run has ended", () => {
	// The two-step is the point: the first press stops it, the run records how it ended, the second
	// press files the record away. Removing on the first would lose the outcome.
	const { registry, dispatch } = harness();
	dispatch("s1");
	registry.dismiss("s1");
	registry.finish("s1", { status: "aborted" });

	assert.equal(registry.dismiss("s1"), "removed");
	assert.deepEqual(registry.list(), []);
});

test("dismissing something that is not there says so", () => {
	const { registry } = harness();
	assert.equal(registry.dismiss("nope"), "unknown");
});

test("clearing finished ones never touches what is still running", () => {
	const { registry, dispatch } = harness();
	const alive = dispatch("running");
	dispatch("done");
	registry.finish("done", { status: "done", answer: "" });
	dispatch("failed");
	registry.finish("failed", { status: "failed", error: "x" });

	assert.equal(registry.dismissFinished(), 2);

	assert.deepEqual(
		registry.list().map((one) => one.id),
		["running"],
	);
	assert.equal(alive.aborted, false, "clearing a list is not a way to stop work");
});

test("clearing when there is nothing finished changes nothing and announces nothing", () => {
	// `onChange` re-broadcasts the roster to every window; firing it for a no-op is a re-render for
	// nothing, on a path that can be hit repeatedly.
	const { registry, dispatch, changes } = harness();
	dispatch("s1");
	const before = changes();

	assert.equal(registry.dismissFinished(), 0);
	assert.equal(changes(), before);
});

test("a dismissed sub-agent cannot be steered or stopped afterwards", () => {
	// Its record is gone, so both levers are gone with it — and both have to say so rather than
	// pretending to have worked.
	const { registry, dispatch } = harness();
	dispatch("s1");
	registry.finish("s1", { status: "done", answer: "" });
	registry.dismiss("s1");

	assert.equal(registry.steer("s1", "喂"), null);
	assert.equal(registry.abort("s1"), false);
	assert.equal(registry.detail("s1"), null);
});
