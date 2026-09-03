/**
 * Which run's summary line glides, and — the part that keeps breaking — when React is told.
 *
 * This bug has now survived three fixes, and the tests are the reason. They used to check a *copy*
 * of the rule, rewritten into this file as `glides(index, total, running)`, and a copy cannot
 * disagree with the thing it was copied from. The copy said "the last run, while the turn runs",
 * which is exactly what the app said, and both were wrong in the same way: the last run in the
 * transcript stays the last run after you ask something else, so a finished stretch of work went
 * on gliding through the whole of the next reply. Every test here passed while it did.
 *
 * So nothing below reimplements anything. `runs` marks the live run and `sameRun` is the memo
 * comparison, both imported from the code that runs. What the tests supply is transcripts.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import type { AssistantContent, AssistantMessage, Message, StopReason, ToolCallContent } from "@lyra/core";
import { emptyUsage } from "@lyra/core";

import { runs, sameRun, type Call, type Run } from "../src/features/conversation/grouping.ts";

function user(text: string): Message {
	return { role: "user", content: [{ type: "text", text }], timestamp: 1 };
}

/** 「继续」 as the app composes it: in the log, never in the transcript, and not a new turn. */
function carryOn(): Message {
	return { ...user("继续，从暂停的地方接着做。"), synthetic: true };
}

/** The runtime keeping a turn moving, which is invisible for the same reasons. */
function nudge(): Message {
	return user("（自动继续）继续");
}

function assistant(content: AssistantContent[], stopReason: StopReason): AssistantMessage {
	return {
		role: "assistant",
		content,
		api: "anthropic-messages",
		provider: "p",
		model: "m",
		usage: emptyUsage(),
		stopReason,
		timestamp: 1,
	};
}

function call(id: string, name = "read"): ToolCallContent {
	return { type: "toolCall", id, name, arguments: { path: `/tmp/${id}.ts` } };
}

function text(value: string): AssistantContent {
	return { type: "text", text: value };
}

function thinking(value: string): AssistantContent {
	return { type: "thinking", thinking: value };
}

function answered(id: string): Message {
	return { role: "toolResult", toolCallId: id, toolName: "read", content: [], isError: false, timestamp: 2 };
}

/**
 * The run that glides, named by the calls in it — or "none".
 *
 * Named rather than numbered so a failure says which stretch of work is lit rather than which
 * array slot, and so inserting a row above does not have to be reflected in every expectation.
 */
function gliding(messages: Message[], compactions: { at: number }[] = []): string {
	const rows = runs(messages, compactions);
	const lit = rows.filter((row): row is Extract<Run, { kind: "tools" }> => row.kind === "tools" && row.live === true);
	// The claim the whole design rests on: one thing is happening, so one line says so.
	assert.ok(lit.length <= 1, `${lit.length} runs glide at once`);
	return lit.length === 0 ? "none" : lit[0].calls.map((c) => c.block.id).join(",");
}

// ---------------------------------------------------------------------------
// While a turn is working
// ---------------------------------------------------------------------------

test("the run a reply is calling into glides", () => {
	assert.equal(gliding([user("干活"), assistant([call("a")], "pending")]), "a");
});

test("a batch that has finished keeps the highlight while the next reply spins up", () => {
	/*
	 * The beat between `message_start` and the first block of the next reply — several hundred
	 * milliseconds with a real model, and it happens between every batch of a turn. A rule that
	 * looked only at the newest reply would drop the highlight in each of those gaps, which reads
	 * as a flicker rather than as work finishing.
	 */
	const base: Message[] = [user("干活"), assistant([call("a")], "toolUse"), answered("a")];
	assert.equal(gliding(base), "a", "between the result landing and the next reply starting");
	assert.equal(gliding([...base, assistant([], "pending")]), "a", "the next reply, still empty");
	assert.equal(gliding([...base, assistant([thinking("再看看")], "pending")]), "a", "and once it is thinking");
});

test("a second batch takes the highlight from the first, and takes it into the same run", () => {
	const rows = runs([
		user("干活"),
		assistant([call("a")], "toolUse"),
		answered("a"),
		assistant([call("b")], "pending"),
	]);
	// The two batches are one run — so this is the highlight staying put, not moving.
	assert.deepEqual(
		rows.filter((r) => r.kind === "tools").map((r) => (r.kind === "tools" ? r.calls.map((c) => c.block.id).join(",") : "")),
		["a,b"],
	);
	assert.equal(gliding([user("干活"), assistant([call("a")], "toolUse"), answered("a"), assistant([call("b")], "pending")]), "a,b");
});

test("text splits the run, and the highlight goes to the half being worked on", () => {
	const messages: Message[] = [
		user("干活"),
		assistant([call("a")], "toolUse"),
		answered("a"),
		assistant([text("先看看这两个文件："), call("b")], "pending"),
	];
	assert.equal(gliding(messages), "b", "the calls after the sentence are the current work");
});

// ---------------------------------------------------------------------------
// The reported bug: a new question, and a line still gliding for the last one
// ---------------------------------------------------------------------------

test("asking something else puts the previous turn's work out", () => {
	/*
	 * The reported case, frame for frame. A turn of tool work finishes and answers; the next
	 * question goes in and the reply is still thinking. Nothing in the transcript has moved, which
	 * is precisely why the old rule kept the line lit: the finished run was still the last one.
	 */
	const done: Message[] = [
		user("改共用的 ComposerShell"),
		assistant([call("a"), call("b"), call("c")], "toolUse"),
		answered("a"),
		assistant([text("改的是共用壳。")], "stop"),
	];
	assert.equal(gliding(done), "none", "the turn is over");
	assert.equal(gliding([...done, user("那这个交互怎么设计？")]), "none", "the question is in, the reply has not started");
	assert.equal(gliding([...done, user("那这个交互怎么设计？"), assistant([], "pending")]), "none", "the reply has started");
	assert.equal(
		gliding([...done, user("那这个交互怎么设计？"), assistant([thinking("在想")], "pending")]),
		"none",
		"and is thinking — 24 seconds of it, in the report",
	);
});

test("a reply that only talks never lights the work above it", () => {
	/*
	 * The worst version of the same bug: a turn that answers in prose and touches no tool at all.
	 * There is never a new run to take the highlight away, so the old rule left the previous turn's
	 * line gliding for the entire reply.
	 */
	const done: Message[] = [user("干活"), assistant([call("a")], "toolUse"), answered("a"), assistant([text("好了")], "stop")];
	const asking = [...done, user("先别改代码，说说思路")];
	assert.equal(gliding([...asking, assistant([thinking("想")], "pending")]), "none");
	assert.equal(gliding([...asking, assistant([thinking("想"), text("思路是这样")], "pending")]), "none");
	assert.equal(gliding([...asking, assistant([thinking("想"), text("思路是这样。")], "stop")]), "none");
});

test("the new turn's own work is what glides once it starts", () => {
	const messages: Message[] = [
		user("干活"),
		assistant([call("a")], "toolUse"),
		answered("a"),
		assistant([text("好了")], "stop"),
		user("再干一件"),
		assistant([call("b")], "pending"),
	];
	assert.equal(gliding(messages), "b");
});

test("an answer being written puts out the work it is reporting on", () => {
	/*
	 * A deliberate change of behaviour, pinned here rather than left to be noticed. The line means
	 * "this work is happening"; once the reply has stopped calling tools and started writing, it is
	 * not. The previous rule kept it lit until the turn ended, so a line saying 读取文件 8 个 went
	 * on gliding underneath a finished answer about them.
	 */
	const messages: Message[] = [user("干活"), assistant([call("a")], "toolUse"), answered("a")];
	assert.equal(gliding([...messages, assistant([thinking("写答案")], "pending")]), "a", "still thinking: the work stands");
	assert.equal(gliding([...messages, assistant([text("看完了，")], "pending")]), "none", "the first words of the answer end it");
});

// ---------------------------------------------------------------------------
// The two transcripts that look the same
// ---------------------------------------------------------------------------

/*
 * A person's message at the end with a reply before it is two completely different situations, and
 * the rows cannot tell them apart. Steering typed into a running turn does not stop the turn — the
 * runtime holds the message and the work carries on — while the same shape with a settled reply is
 * a new question against a conversation that has finished. `stopReason` is the whole difference,
 * and it is why the walk starts where it does.
 */

test("steering typed into a running turn does not put the work out", () => {
	const messages: Message[] = [user("干活"), assistant([call("a")], "pending"), user("顺便看下这个")];
	assert.equal(gliding(messages), "a", "the turn is still running; its work is still the work");
});

test("the same shape with a finished reply is a new question, and puts it out", () => {
	// Interrupted mid-call, then asked something else: the composer sets `running` the moment you
	// press enter, so without this the abandoned run lights up again as the next turn starts.
	const messages: Message[] = [user("干活"), assistant([call("a")], "aborted"), user("算了，换个事")];
	assert.equal(gliding(messages), "none");
});

// ---------------------------------------------------------------------------
// Continuing, in its three forms
// ---------------------------------------------------------------------------

test("继续 sent by the app carries on the same stretch of work", () => {
	// Synthetic: not the person speaking, so it is not a boundary — and the calls that follow join
	// the run above it rather than starting a new one.
	const messages: Message[] = [user("干活"), assistant([call("a")], "aborted"), carryOn(), assistant([], "pending")];
	assert.equal(gliding(messages), "a");
});

test("the runtime's nudge does the same", () => {
	const messages: Message[] = [user("干活"), assistant([call("a")], "toolUse"), answered("a"), nudge(), assistant([], "pending")];
	assert.equal(gliding(messages), "a");
});

test("继续 typed out by hand is a person speaking, and starts a new run", () => {
	const typed: Message[] = [user("干活"), assistant([call("a")], "aborted"), user("继续，从暂停的地方接着做。")];
	assert.equal(gliding([...typed, assistant([], "pending")]), "none", "nothing yet — the old run is not it");
	assert.equal(gliding([...typed, assistant([call("b")], "pending")]), "b", "the work it starts is");
});

// ---------------------------------------------------------------------------
// Edges
// ---------------------------------------------------------------------------

test("a transcript with no work in it glides nowhere", () => {
	assert.equal(gliding([]), "none");
	assert.equal(gliding([user("你好")]), "none");
	assert.equal(gliding([user("你好"), assistant([text("你好！")], "stop")]), "none");
});

test("a delegate's transcript is marked the same way", () => {
	/*
	 * The sub-agent panel draws the same rows from the same function, and used to carry its own
	 * copy of the "last run" rule beside the one in `Conversation`. It has the shape a delegate's
	 * transcript always has: one instruction at the top and replies all the way down, so the run
	 * being worked on is whichever the newest reply is calling into.
	 *
	 * Whether anyone is working is still the panel's own question — it passes `isLive` — for the
	 * same reason the conversation passes `running`.
	 */
	const task = user("去把这几个文件读一遍");
	assert.equal(gliding([task, assistant([call("a")], "pending")]), "a");
	assert.equal(gliding([task, assistant([call("a")], "toolUse"), answered("a"), assistant([], "pending")]), "a");
	assert.equal(gliding([task, assistant([call("a")], "toolUse"), answered("a"), assistant([text("读完了")], "stop")]), "none");
});

test("a compaction between the batches does not move the mark off the run", () => {
	// The rows are appended as the transcript is walked, and a marker is a row like any other —
	// so the index recorded for a reply's calls has to still point at its run afterwards.
	const messages: Message[] = [user("干活"), assistant([call("a")], "toolUse"), answered("a"), assistant([call("b")], "pending")];
	assert.equal(gliding(messages, [{ at: 3 }]), "b", "the second batch is its own run, past the marker");
	assert.equal(gliding(messages, [{ at: 1 }]), "a,b");
});

test("only ever one run at a time, across a whole turn's worth of frames", () => {
	/*
	 * `gliding` asserts this on every call, so playing a turn through it is the check. The frames
	 * are the ones a renderer actually sees: a question, batches, a nudge, an answer, the next
	 * question, and its first call.
	 */
	const frames: Message[][] = [];
	const push = (...messages: Message[]) => frames.push(messages);
	const first = assistant([call("a"), call("b")], "toolUse");
	const second = assistant([call("c")], "toolUse");

	push(user("干活"));
	push(user("干活"), assistant([], "pending"));
	push(user("干活"), assistant([call("a")], "pending"));
	push(user("干活"), first);
	push(user("干活"), first, answered("a"), answered("b"));
	push(user("干活"), first, answered("a"), answered("b"), assistant([thinking("再来")], "pending"));
	push(user("干活"), first, answered("a"), answered("b"), second);
	push(user("干活"), first, answered("a"), answered("b"), second, answered("c"));
	push(user("干活"), first, answered("a"), answered("b"), second, answered("c"), assistant([text("好了")], "stop"));
	const finished = frames[frames.length - 1];
	push(...finished, user("下一件事"));
	push(...finished, user("下一件事"), assistant([thinking("想")], "pending"));
	push(...finished, user("下一件事"), assistant([thinking("想"), call("d")], "pending"));

	assert.deepEqual(
		frames.map((messages) => gliding(messages)),
		// The ninth frame is the answer arriving, which puts the work out before the turn formally
		// ends — see "an answer being written puts out the work it is reporting on".
		["none", "none", "a", "a,b", "a,b", "a,b", "a,b,c", "a,b,c", "none", "none", "none", "d"],
	);
});

// ---------------------------------------------------------------------------
// And whether React is told
// ---------------------------------------------------------------------------

/*
 * The rule being right is half of it. `ToolRun` is memoised because the transcript re-renders on
 * every streamed token and every settled group above would re-render with it — and a group stops
 * being the current one *without its calls changing*, which is the one case a comparison written
 * around the calls gets wrong. That is what made two earlier fixes look like they had not worked.
 */

const CALLS: Call[] = [{ block: call("a"), stopReason: "toolUse" }];

test("a group that stops being the current one is re-rendered, though its calls are identical", () => {
	assert.equal(sameRun({ calls: CALLS, live: true }, { calls: CALLS, live: false }), false);
});

test("a group that becomes the current one is re-rendered too", () => {
	assert.equal(sameRun({ calls: CALLS, live: false }, { calls: CALLS, live: true }), false);
});

test("a settled group with nothing new is still skipped — the memo has to keep earning its place", () => {
	assert.equal(sameRun({ calls: CALLS, live: false }, { calls: CALLS, live: false }), true);
	assert.equal(sameRun({ calls: CALLS, live: true }, { calls: CALLS, live: true }), true);
});

test("a group gaining a call is re-rendered, as it always was", () => {
	const after = { calls: [...CALLS, { block: call("b"), stopReason: "toolUse" as StopReason }], live: true };
	assert.equal(sameRun({ calls: CALLS, live: true }, after), false);
});

test("a call finishing inside a group is re-rendered", () => {
	const after = { calls: [{ block: call("a"), stopReason: "stop" as StopReason }], live: true };
	assert.equal(sameRun({ calls: CALLS, live: true }, after), false);
});

test("a sub-agent's injected records changing is re-rendered", () => {
	// Nothing in the group subscribes to them, so a new map is the only sign a call has finished.
	assert.equal(sameRun({ calls: CALLS, runs: {} }, { calls: CALLS, runs: {} }), false);
});

test("the reported sequence end to end: the rule, and the render that follows it", () => {
	/*
	 * A turn finishes, a question goes in, the reply thinks. The run's calls are untouched
	 * throughout — so this is both halves of the bug in one place: the answer has to change, and
	 * React has to be told it changed.
	 */
	const done: Message[] = [user("干活"), assistant([call("a")], "toolUse"), answered("a"), assistant([text("好了")], "stop")];
	const working: Message[] = [user("干活"), assistant([call("a")], "pending")];

	const before = runs(working).find((r) => r.kind === "tools");
	const after = runs([...done, user("再问一件"), assistant([thinking("想")], "pending")]).find((r) => r.kind === "tools");
	assert.ok(before?.kind === "tools" && after?.kind === "tools");
	assert.equal(before.live, true, "gliding while the turn works");
	assert.equal(after.live, undefined, "out once the next question is in");
	assert.equal(
		sameRun({ calls: before.calls, live: before.live }, { calls: after.calls, live: after.live }),
		false,
		"and the group is re-rendered, though its calls are the same",
	);
});
