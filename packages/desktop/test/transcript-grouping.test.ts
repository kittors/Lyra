/**
 * Which row a tool call lands in, and whether it ever moves.
 *
 * The bug these are written against: a call made by a reply that was still streaming got a row of
 * its own — "执行 3 个操作" under a finished run — and jumped into the run above the moment the
 * reply settled. So the tests are mostly about a property rather than a layout: grouping the same
 * transcript before and after a message finishes has to give the same rows.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import type { AssistantContent, AssistantMessage, Message, StopReason, ToolCallContent } from "@lyra/core";
import { emptyUsage } from "@lyra/core";

import { computeTurnStats, runs, runKey, type Run } from "../src/features/conversation/grouping.ts";
import { CARRY_ON_PROMPTS } from "../src/store/derive.ts";

function user(text: string): Message {
	return { role: "user", content: [{ type: "text", text }], timestamp: 1 };
}

function nudge(): Message {
	return { role: "user", content: [{ type: "text", text: "（自动继续）继续" }], timestamp: 1 };
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

/** Rows reduced to what a reader would see change: the kind, and which calls are in it. */
function shape(rows: Run[]): string[] {
	return rows.map((row) => {
		if (row.kind === "compaction") return "compaction";
		if (row.kind === "command") return `command:${row.command.id}`;
		if (row.kind === "hiccup") return `hiccup:${row.hiccup.id}`;
		if (row.kind === "message") return `message@${row.index}:${row.upTo}`;
		return `tools:${row.calls.map((c) => c.block.id).join(",")}`;
	});
}

test("a call from a reply that is still streaming joins the run above, not a row of its own", () => {
	const rows = runs([
		user("看看这个项目"),
		assistant([call("a"), call("b")], "toolUse"),
		answered("a"),
		answered("b"),
		// The reply the agent is writing right now, its first calls already through.
		assistant([call("c"), call("d"), call("e")], "pending"),
	]);

	assert.deepEqual(shape(rows), ["message@0:1", "tools:a,b,c,d,e"]);
});

test("a manual command remains before resumed tool work even when the continuation has no visible user message", () => {
	const messages = [user("inspect"), assistant([call("a")], "aborted"), answered("a"), nudge(), assistant([call("b")], "pending")];
	const rows = runs(messages, [], [{ id: "manual", name: "compact", input: "/compact", at: 3, timestamp: 3, status: "done", detail: "完成" }]);
	assert.deepEqual(shape(rows), ["message@0:1", "tools:a", "command:manual", "tools:b"]);
});

/*
 * 断线画在它断的地方。
 *
 * 从前这些记录一律堆在转录末尾、运行指示器底下：一轮跑四十分钟、中间断过一次又接上，那句「重连 N
 * 次后恢复」贴在最后一行 loading 下面——说的是某个时刻的事，站的却是「此刻」的位置。见 `hiccup.ts`
 * 的 `at`。
 */

function hiccup(id: string, at: number, outcome: "waiting" | "recovered" | "gave_up" = "recovered") {
	return { id, at, attempts: 2, until: 0, summary: "连接断了", kind: "network" as const, fingerprint: id, repeated: 1, outcome, resume: false };
}

test("一次断线留在它发生的那一段旁边，后面来的消息不会把它挤到末尾", () => {
	const messages = [user("跑个长活"), assistant([call("a")], "toolUse"), answered("a"), assistant([text("做完了")], "endTurn")];
	// 断在第一条回复之后、后面那些还没来的时候。
	const rows = runs(messages, [], [], [hiccup("h1", 2)]);
	assert.deepEqual(shape(rows), ["message@0:1", "tools:a", "hiccup:h1", "message@3:1"]);
});

test("还在等的那一条数出来正好是末尾，因为它确实正在此刻发生", () => {
	const messages = [user("跑个长活"), assistant([call("a")], "toolUse"), answered("a")];
	const rows = runs(messages, [], [], [hiccup("h1", messages.length, "waiting")]);
	assert.deepEqual(shape(rows), ["message@0:1", "tools:a", "hiccup:h1"]);
});

test("断过两次就是两条，各自站在各自的位置上", () => {
	const messages = [user("问一句"), assistant([text("答一句")], "endTurn"), user("再问一句"), assistant([text("再答一句")], "endTurn")];
	const rows = runs(messages, [], [], [hiccup("h2", 3), hiccup("h1", 1)]);
	// 传进来的顺序不算数，位置才算数。
	assert.deepEqual(shape(rows), ["message@0:1", "hiccup:h1", "message@1:1", "message@2:1", "hiccup:h2", "message@3:1"]);
});

test("没有断过的转录，和从前一模一样", () => {
	const messages = [user("问一句"), assistant([text("答一句")], "endTurn")];
	assert.deepEqual(shape(runs(messages, [], [], [])), shape(runs(messages)));
});

test("finishing a reply does not move its calls into a different row", () => {
	const before: Message[] = [
		user("看看这个项目"),
		assistant([call("a")], "toolUse"),
		answered("a"),
		assistant([thinking("先读一下"), call("b"), call("c")], "pending"),
	];
	// The same transcript one event later: `message_end` settled the tail, nothing else changed.
	const after = [...before.slice(0, 3), assistant([thinking("先读一下"), call("b"), call("c")], "toolUse")];

	assert.deepEqual(shape(runs(before)), shape(runs(after)), "settling a message must not regroup the transcript");
	// The reasoning stands between the two batches, which is where the model wrote it.
	assert.deepEqual(shape(runs(after)), ["message@0:1", "tools:a", "message@3:1", "tools:b,c"]);
});

test("a run grows call by call as the reply streams, in the row it started in", () => {
	const opening: Message[] = [user("跑一下"), assistant([call("a")], "toolUse"), answered("a")];
	// Each frame of the stream, as the renderer would see it.
	const frames = [
		[...opening, assistant([thinking("嗯")], "pending")],
		[...opening, assistant([thinking("嗯"), call("b")], "pending")],
		[...opening, assistant([thinking("嗯"), call("b"), call("c")], "pending")],
	];

	// The reasoning ends the run above it and the calls it drives start a new one under it.
	assert.deepEqual(shape(runs(frames[0])), ["message@0:1", "tools:a", "message@3:1"], "live reasoning gets a row");
	assert.deepEqual(shape(runs(frames[1])), ["message@0:1", "tools:a", "message@3:1", "tools:b"], "its first call opens the run below");
	assert.deepEqual(shape(runs(frames[2])), ["message@0:1", "tools:a", "message@3:1", "tools:b,c"], "and the next joins it");
});

test("each stretch of reasoning keeps a row of its own, where it was written", () => {
	const first = assistant([thinking("先看"), call("a")], "toolUse");
	// Each frame of a turn, as the renderer sees it: reason, call, wait, reason, call, answer.
	const frames: Message[][] = [
		[user("跑"), assistant([thinking("先看")], "pending")],
		[user("跑"), assistant([thinking("先看"), call("a")], "pending")],
		[user("跑"), first],
		[user("跑"), first, answered("a")],
		[user("跑"), first, answered("a"), assistant([thinking("再看")], "pending")],
		[user("跑"), first, answered("a"), assistant([thinking("再看"), call("b")], "pending")],
	];
	assert.deepEqual(shape(runs(frames[0])), ["message@0:1", "message@1:1"], "the first thought, alone");
	assert.deepEqual(shape(runs(frames[1])), ["message@0:1", "message@1:1", "tools:a"]);
	assert.deepEqual(shape(runs(frames[2])), ["message@0:1", "message@1:1", "tools:a"], "still there while the tool runs");
	assert.deepEqual(shape(runs(frames[3])), ["message@0:1", "message@1:1", "tools:a"], "and after it answers");

	/*
	 * The second thought does not take the first one's row. It gets its own, under the work the
	 * first one drove — think, work, think, work, the shape the turn actually ran in.
	 *
	 * There used to be one row for the whole turn, holding whichever reasoning was newest. Every
	 * thought before the last one was drawn nowhere at all, and a reader watching the line saw it
	 * replaced under them with no way back to what it had said.
	 */
	assert.deepEqual(shape(runs(frames[4])), ["message@0:1", "message@1:1", "tools:a", "message@3:1"]);
	assert.deepEqual(shape(runs(frames[5])), ["message@0:1", "message@1:1", "tools:a", "message@3:1", "tools:b"]);

	// The answer lands at the end, after the work, with the reasoning that produced it above it.
	const done = [...frames[5].slice(0, 3), assistant([thinking("再看"), call("b")], "toolUse"), answered("b"), assistant([thinking("好了"), text("完成")], "stop")];
	assert.deepEqual(shape(runs(done)), ["message@0:1", "message@1:1", "tools:a", "message@3:1", "tools:b", "message@5:1", "message@5:2"]);
});

test("the transcript only grows: a row that has been drawn is never rewritten", () => {
	const opening: Message[] = [user("跑"), assistant([thinking("先看"), call("a")], "toolUse"), answered("a")];
	// Reasoning, more work, the answer starting, the answer finished: every frame the reader sees.
	const frames: Message[][] = [
		[...opening, assistant([thinking("再看")], "pending")],
		[...opening, assistant([thinking("再看"), call("b")], "pending")],
		[...opening, assistant([thinking("再看"), call("b")], "toolUse"), answered("b"), assistant([thinking("好了")], "pending")],
		[...opening, assistant([thinking("再看"), call("b")], "toolUse"), answered("b"), assistant([thinking("好了"), text("完")], "pending")],
		[...opening, assistant([thinking("再看"), call("b")], "toolUse"), answered("b"), assistant([thinking("好了"), text("完成了。")], "stop")],
	];

	/*
	 * Every frame is a prefix of the one after it.
	 *
	 * This is the property the single shared row could not have: it changed what it held, so one
	 * line said four different things over a turn and three of them were gone for good. Rows that
	 * are only ever appended cannot lose anything — and cannot move what is above them either,
	 * which is what the old arrangement was trying to buy by throwing the reasoning away.
	 */
	let previous = shape(runs(frames[0]));
	for (const [at, frame] of frames.slice(1).entries()) {
		const now = shape(runs(frame));
		assert.deepEqual(now.slice(0, previous.length), previous, `frame ${at + 1} rewrote a row that was already drawn`);
		previous = now;
	}
	assert.deepEqual(previous, ["message@0:1", "message@1:1", "tools:a", "message@3:1", "tools:b", "message@5:1", "message@5:2"]);
});

test("a reply that thinks and then speaks gets two rows, with distinct identities", () => {
	const rows = runs([
		user("跑"),
		assistant([thinking("先看"), call("a")], "toolUse"),
		answered("a"),
		assistant([thinking("好了"), text("完成")], "stop"),
	]);

	// Two rows for one message: the reasoning, then the answer. `from` is what keeps the reasoning
	// out of the second one — without it the same paragraph appears twice.
	const above = rows[3];
	const below = rows[4];
	assert.equal(above.kind === "message" && above.index, 3);
	assert.deepEqual(above.kind === "message" && [above.from ?? 0, above.upTo], [0, 1], "the reasoning, and only it");
	assert.equal(above.kind === "message" && above.lead, true, "a lead-in: the timestamp belongs to the answer below it");
	assert.equal(below.kind === "message" && below.index, 3);
	assert.deepEqual(below.kind === "message" && [below.from, below.upTo], [1, 2], "the answer, starting after the reasoning");
	const keys = rows.filter(row => row.kind !== "compaction").map(runKey);
	assert.equal(new Set(keys).size, keys.length, "split content must also have distinct React identities");
});

test("a reasoning row keeps its identity, and never becomes another stretch's row", () => {
	const base: Message[] = [user("work"), assistant([thinking("first"), call("a")], "toolUse"), answered("a")];
	const before = runs(base)[1];
	const after = runs([...base, assistant([thinking("next"), text("done")], "stop")]);
	assert.ok(before.kind === "message");
	// The first stretch is the row it always was, still holding the words it always held.
	assert.equal(runKey(before), runKey(after[1]));
	// And the second is a row of its own rather than a new tenant of the first.
	assert.notEqual(runKey(after[1]), runKey(after[3]));
});

test("a turn that never called a tool still gives its reasoning a row", () => {
	const rows = runs([user("你好"), assistant([thinking("打个招呼"), text("你好！")], "stop")]);
	assert.deepEqual(shape(rows), ["message@0:1", "message@1:1", "message@1:2"]);
	assert.equal(rows[2].kind === "message" && rows[2].from, 1, "the answer starts after the reasoning above it");
});

test("a reply with no reasoning of its own does not borrow the last one's", () => {
	const first = assistant([thinking("先看"), call("a")], "toolUse");
	const base: Message[] = [user("跑"), first, answered("a")];
	const drawn = ["message@0:1", "message@1:1", "tools:a"];
	// The beat between a reply starting and its first word of reasoning, in the shapes it takes.
	assert.deepEqual(shape(runs([...base, assistant([], "pending")])), drawn, "an empty reply");
	assert.deepEqual(shape(runs([...base, assistant([thinking("")], "pending")])), drawn, "a reasoning block with nothing in it yet");
	// A reply that calls without reasoning at all: nothing breaks the run, so its call joins it.
	assert.deepEqual(shape(runs([...base, assistant([call("b")], "pending")])), ["message@0:1", "message@1:1", "tools:a,b"]);
	// The runtime nudging the model along is not the start of a new turn.
	assert.deepEqual(shape(runs([...base, nudge(), assistant([], "pending")])), drawn);
});

test("reasoning stays inside the turn that produced it", () => {
	const first = assistant([thinking("先看"), call("a")], "toolUse");
	// A new question from the person: the old turn's reasoning stays where it was written.
	assert.deepEqual(
		shape(runs([user("跑"), first, answered("a"), user("等等"), assistant([], "pending")])),
		["message@0:1", "message@1:1", "tools:a", "message@3:1"],
	);
	// A reply that reasons, speaks, then calls: three rows, in the order it wrote them.
	assert.deepEqual(
		shape(runs([user("跑"), first, answered("a"), assistant([thinking("想"), text("先看这个："), call("b")], "toolUse"), answered("b"), assistant([], "pending")])),
		["message@0:1", "message@1:1", "tools:a", "message@3:1", "message@3:2", "tools:b"],
	);
	// The user's next message, sent while the turn runs, still comes after the work it interrupted.
	assert.deepEqual(
		shape(runs([user("跑"), first, answered("a"), assistant([thinking("再看")], "pending"), user("顺便")])),
		["message@0:1", "message@1:1", "tools:a", "message@3:1", "message@4:1"],
	);
	// Stopped mid-call: the reasoning stays rather than vanishing along with the turn.
	assert.deepEqual(shape(runs([user("跑"), assistant([thinking("先看"), call("a")], "aborted")])), ["message@0:1", "message@1:1", "tools:a"]);
});

test("a finished reply's reasoning keeps its row", () => {
	/*
	 * The bug this is written against: reasoning that came before a call was drawn nowhere at all
	 * once the reply settled, because a reply with calls and no prose got no row. On a real turn
	 * that is nearly every thought it had — one session on disk holds 327 stretches of reasoning,
	 * of which four were ever drawn.
	 */
	const rows = runs([user("跑"), assistant([thinking("想想"), call("a")], "toolUse"), answered("a"), assistant([text("好了")], "stop")]);
	assert.deepEqual(shape(rows), ["message@0:1", "message@1:1", "tools:a", "message@3:1"]);
});

test("text ends a run, and the calls after it start the one the next reply joins", () => {
	const rows = runs([
		user("改一下"),
		assistant([thinking("想想"), text("先看看这两个文件："), call("a")], "toolUse"),
		answered("a"),
		assistant([call("b")], "toolUse"),
	]);

	/*
	 * The sentence keeps its row and stops at its own last word; the call it introduced belongs
	 * to the run under it, which is where the next reply's calls go too. Drawing that call inside
	 * the message instead is what used to leave two identical grey lines with nothing between.
	 */
	assert.deepEqual(shape(rows), ["message@0:1", "message@1:1", "message@1:2", "tools:a,b"]);
});

test("a reply that only talks keeps all of itself", () => {
	const rows = runs([user("你好"), assistant([text("你好！")], "stop")]);
	assert.deepEqual(shape(rows), ["message@0:1", "message@1:1"]);
});

test("the runtime's nudge does not split the work on either side of it", () => {
	const rows = runs([
		user("继续干"),
		assistant([call("a")], "toolUse"),
		answered("a"),
		// Invisible in the transcript, so it must be invisible to the grouping as well.
		nudge(),
		assistant([call("b")], "toolUse"),
	]);

	assert.deepEqual(shape(rows), ["message@0:1", "tools:a,b"]);
});

test("a synthetic user message is passed over the same way", () => {
	const injected: Message = { role: "user", content: [{ type: "text", text: "系统插话" }], timestamp: 1, synthetic: true };
	const rows = runs([user("干活"), assistant([call("a")], "toolUse"), injected, assistant([call("b")], "toolUse")]);
	assert.deepEqual(shape(rows), ["message@0:1", "tools:a,b"]);
});

test("a reply that ended with nothing to show still gets a row", () => {
	// A dropped socket settles the tail as an error; without a row the failure is never drawn.
	const rows = runs([user("跑一下"), assistant([thinking("在想")], "error")]);
	assert.deepEqual(shape(rows), ["message@0:1", "message@1:1"]);
});

test("a real user message ends the run", () => {
	const rows = runs([
		user("先看看"),
		assistant([call("a")], "toolUse"),
		answered("a"),
		user("再看看"),
		assistant([call("b")], "toolUse"),
	]);
	assert.deepEqual(shape(rows), ["message@0:1", "tools:a", "message@3:1", "tools:b"]);
});

test("a compaction marker interrupts the run at the message it was taken from", () => {
	const rows = runs(
		[user("干活"), assistant([call("a")], "toolUse"), answered("a"), assistant([call("b")], "toolUse")],
		[{ at: 3 }],
	);
	assert.deepEqual(shape(rows), ["message@0:1", "tools:a", "compaction", "tools:b"]);
});

test("a compaction recorded past the end still lands at the end", () => {
	const rows = runs([user("干活"), assistant([call("a")], "toolUse")], [{ at: 9 }]);
	assert.deepEqual(shape(rows), ["message@0:1", "tools:a", "compaction"]);
});

test("the reply carries the calls it made, so a live one reads as live", () => {
	const rows = runs([user("跑"), assistant([call("a")], "toolUse"), answered("a"), assistant([call("b")], "pending")]);
	const tools = rows[1];
	assert.equal(tools.kind, "tools");
	if (tools.kind !== "tools") return;
	assert.deepEqual(
		tools.calls.map((c) => c.stopReason),
		["toolUse", "pending"],
	);
});

test("computeTurnStats aggregates duration and output tokens across all assistant requests in a turn", () => {
	const msg1 = assistant([call("a")], "toolUse");
	msg1.durationMs = 1200;
	msg1.sseDurationMs = 900;
	msg1.usage = { input: 100, output: 50, cacheRead: 0, cacheWrite: 0, total: 150 };

	const msg2 = assistant([call("b")], "toolUse");
	msg2.durationMs = 800;
	msg2.sseDurationMs = 600;
	msg2.usage = { input: 200, output: 30, cacheRead: 0, cacheWrite: 0, total: 230 };

	const msg3 = assistant([text("完成了")], "stop");
	msg3.durationMs = 2000;
	msg3.sseDurationMs = 1500;
	msg3.usage = { input: 300, output: 120, cacheRead: 0, cacheWrite: 0, total: 420 };

	const messages: Message[] = [
		user("第一轮问题"),
		assistant([text("第一轮回答")], "stop"),
		user("第二轮问题"),
		msg1,
		answered("a"),
		nudge(),
		msg2,
		answered("b"),
		msg3,
	];

	const stats = computeTurnStats(messages, 8);
	assert.equal(stats.durationMs, 4000);
	assert.equal(stats.sseDurationMs, 3000);
	assert.equal(stats.outputTokens, 200);
	assert.equal(stats.requestCount, 3);
});

/*
 * A turn broken by a failure and picked up again is one turn.
 *
 * The reported figures are what a task cost, and a task that failed halfway and was resumed cost
 * both halves. Counting the 继续 as a new turn reported the second half only — so a job that took
 * twenty minutes over two legs claimed the length of the shorter one, and its tokens-per-second
 * described a stretch of work that was never run on its own.
 */
test("continuing after a failure keeps the turn's totals whole", () => {
	const first = assistant([call("a")], "error");
	first.durationMs = 5000;
	first.sseDurationMs = 4000;
	first.usage = { input: 100, output: 200, cacheRead: 0, cacheWrite: 0, total: 300 };

	const second = assistant([text("做完了")], "stop");
	second.durationMs = 3000;
	second.sseDurationMs = 2500;
	second.usage = { input: 50, output: 80, cacheRead: 0, cacheWrite: 0, total: 130 };

	const messages: Message[] = [
		user("干这件事"),
		first,
		user("继续，从中断的地方接着做。"),
		second,
	];

	const stats = computeTurnStats(messages, 3);
	assert.equal(stats.durationMs, 8000, "两段的耗时要加起来");
	assert.equal(stats.outputTokens, 280, "两段的 token 要加起来");
	assert.equal(stats.requestCount, 2);
});

/*
 * The same sentence after a turn that ended normally is a new instruction.
 *
 * "继续" is a perfectly ordinary thing to say to a conversation that finished — carry on with the
 * next thing — and reading it as a continuation would silently glue two separate pieces of work
 * together in the figures.
 */
test("the same wording after a clean finish starts a new turn", () => {
	const first = assistant([text("做完了")], "stop");
	first.durationMs = 5000;
	first.usage = { input: 100, output: 200, cacheRead: 0, cacheWrite: 0, total: 300 };

	const second = assistant([text("好的")], "stop");
	second.durationMs = 3000;
	second.usage = { input: 50, output: 80, cacheRead: 0, cacheWrite: 0, total: 130 };

	const messages: Message[] = [
		user("干这件事"),
		first,
		user("继续，从中断的地方接着做。"),
		second,
	];

	const stats = computeTurnStats(messages, 3);
	assert.equal(stats.durationMs, 3000, "上一轮正常结束，这是新的一轮");
	assert.equal(stats.outputTokens, 80);
	assert.equal(stats.requestCount, 1);
});

test("computeTurnStats returns zeros if no assistant messages or out of bounds", () => {
	const messages: Message[] = [user("问题")];
	const stats = computeTurnStats(messages, 0);
	assert.equal(stats.durationMs, 0);
	assert.equal(stats.sseDurationMs, 0);
	assert.equal(stats.outputTokens, 0);
	assert.equal(stats.requestCount, 0);
});

/*
 * The totals now ride on the rows, computed in the one pass that builds them.
 *
 * They used to be worked out where the row is drawn, which meant a backward scan per visible reply
 * on every render *and* a fresh object each time — so the row's memo compared unequal and every
 * message on screen was rebuilt whenever anything re-rendered the transcript. Both go away by
 * deriving them here, and this is what says the answer did not change on the way.
 */
test("a row carries the same totals computeTurnStats would give for it", () => {
	const first = assistant([text("第一轮回答")], "stop");
	first.durationMs = 500;
	first.sseDurationMs = 400;
	first.usage = { input: 10, output: 20, cacheRead: 0, cacheWrite: 0, total: 30 };

	const msg1 = assistant([call("a")], "toolUse");
	msg1.durationMs = 1200;
	msg1.sseDurationMs = 900;
	msg1.usage = { input: 100, output: 50, cacheRead: 0, cacheWrite: 0, total: 150 };

	const msg2 = assistant([call("b")], "toolUse");
	msg2.durationMs = 800;
	msg2.sseDurationMs = 600;
	msg2.usage = { input: 200, output: 30, cacheRead: 0, cacheWrite: 0, total: 230 };

	const msg3 = assistant([text("完成了")], "stop");
	msg3.durationMs = 2000;
	msg3.sseDurationMs = 1500;
	msg3.usage = { input: 300, output: 120, cacheRead: 0, cacheWrite: 0, total: 420 };

	const messages: Message[] = [
		user("第一轮问题"),
		first,
		user("第二轮问题"),
		msg1,
		answered("a"),
		nudge(),
		msg2,
		answered("b"),
		msg3,
	];

	const rows = runs(messages).filter((run) => run.kind === "message" && run.message.role === "assistant");
	assert.ok(rows.length > 0, "expected assistant rows");
	for (const row of rows) {
		if (row.kind !== "message") continue;
		assert.deepEqual(row.turnStats, computeTurnStats(messages, row.index), `row at ${row.index}`);
	}

	// And specifically: a nudge does not start a new turn, so the last row has all three replies.
	const last = rows[rows.length - 1];
	assert.equal(last.kind === "message" && last.turnStats?.requestCount, 3);
	assert.equal(last.kind === "message" && last.turnStats?.durationMs, 4000);
});

test("a person speaking starts the count over; the first turn's cost stays with the first turn", () => {
	const one = assistant([text("一")], "stop");
	one.durationMs = 500;
	one.usage = { input: 0, output: 20, cacheRead: 0, cacheWrite: 0, total: 20 };
	const two = assistant([text("二")], "stop");
	two.durationMs = 700;
	two.usage = { input: 0, output: 30, cacheRead: 0, cacheWrite: 0, total: 30 };

	const rows = runs([user("甲"), one, user("乙"), two]).filter((run) => run.kind === "message");
	const totals = rows
		.filter((run) => run.kind === "message" && run.message.role === "assistant")
		.map((run) => (run.kind === "message" ? run.turnStats : undefined));

	assert.deepEqual(
		totals.map((t) => t?.durationMs),
		[500, 700],
	);
	assert.deepEqual(
		totals.map((t) => t?.outputTokens),
		[20, 30],
	);
});

/*
 * The reported case: paused by hand, then 继续.
 *
 * A pause is `aborted`, not `error`, and the wording 继续 sends for it is the first of the three.
 * Reported as still restarting the clock, so it is pinned here separately from the failure case
 * rather than assumed to follow from it.
 */
test("continuing after a manual pause keeps the turn's totals whole", () => {
	const first = assistant([call("a")], "aborted");
	first.durationMs = 90_000;
	first.usage = { input: 100, output: 1000, cacheRead: 0, cacheWrite: 0, total: 1100 };

	const second = assistant([text("接着做完了")], "stop");
	second.durationMs = 30_000;
	second.usage = { input: 50, output: 200, cacheRead: 0, cacheWrite: 0, total: 250 };

	const messages: Message[] = [
		user("干这件事"),
		first,
		user("继续，从暂停的地方接着做。"),
		second,
	];

	const stats = computeTurnStats(messages, 3);
	assert.equal(stats.durationMs, 120_000, "暂停前后的耗时要加起来");
	assert.equal(stats.outputTokens, 1200);
});

/*
 * 继续 sent by the button, which is a message the app composed rather than one you typed.
 *
 * `synthetic` is how the transcript says so: those messages are not drawn, and they do not open a
 * turn. `ResumeRow` simply never passed it, so pressing 继续 put the sentence in the conversation
 * and restarted the turn's clock. Both halves are checked here — the row is skipped, and the totals
 * carry across it.
 */
test("继续 sent as a synthetic message neither shows nor restarts the turn", () => {
	const first = assistant([call("a")], "aborted");
	first.durationMs = 90_000;
	first.usage = { input: 100, output: 1000, cacheRead: 0, cacheWrite: 0, total: 1100 };

	const second = assistant([text("接着做完了")], "stop");
	second.durationMs = 30_000;
	second.usage = { input: 50, output: 200, cacheRead: 0, cacheWrite: 0, total: 250 };

	const carryOn = user("继续，从暂停的地方接着做。");
	carryOn.synthetic = true;

	const messages: Message[] = [user("干这件事"), first, carryOn, second];

	const stats = computeTurnStats(messages, 3);
	assert.equal(stats.durationMs, 120_000, "暂停前后的耗时要加起来");
	assert.equal(stats.outputTokens, 1200);

	// And it is not a row: `runs` drops synthetic user messages entirely.
	const rows = runs(messages, []);
	const shown = rows.filter((r) => r.kind === "message" && r.message.role === "user");
	assert.equal(shown.length, 1, "只应该看到你真正写的那一条");
});

/*
 * 常量表里的每一句，都要真的能被认出来。
 *
 * 上面几条测试各自钉住一句原文，钉不住的是「这张表整体」：往 `CARRY_ON_PROMPTS` 里加第四句、
 * 或者把这里的匹配从常量换成写死的清单，都不会让它们变红——新那句悄悄地成了一次新提问，而一
 * 轮被打断过的任务从此只报最后一小段的耗时，和一个谁也没跑过的 tokens/s。统计坏了不报错，它
 * 只是开始说一些不真实的数字。所以这条遍历常量，有几句测几句。
 */
test("每一句「继续」都要被认成接着做，而不是一个新问题", () => {
	for (const prompt of CARRY_ON_PROMPTS) {
		const first = assistant([call("a")], "aborted");
		first.durationMs = 90_000;
		first.usage = { input: 100, output: 1000, cacheRead: 0, cacheWrite: 0, total: 1100 };

		const second = assistant([text("接着做完了")], "stop");
		second.durationMs = 30_000;
		second.usage = { input: 50, output: 200, cacheRead: 0, cacheWrite: 0, total: 250 };

		const messages: Message[] = [user("干这件事"), first, user(prompt), second];
		const stats = computeTurnStats(messages, 3);
		assert.equal(stats.durationMs, 120_000, `「${prompt}」没有被认出来`);
		assert.equal(stats.outputTokens, 1200, `「${prompt}」没有被认出来`);
	}
});
