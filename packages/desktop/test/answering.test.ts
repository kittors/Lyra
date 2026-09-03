/**
 * When the running indicator stops being informative.
 *
 * It stays put for the whole of a turn on purpose: it used to appear only between tool calls, so
 * its 46px came and went and the transcript shifted up and down all through a turn. But once the
 * answer itself is streaming in above it, "Nearly there…" is describing something the reader can
 * already see, and sitting under a finished-looking answer saying almost-done reads as the app
 * having lost track of what it is doing.
 *
 * `proseLength` is imported rather than restated. The version of this file that restated it passed
 * every case below while the window was visibly broken, because the restatement modelled a reply
 * that talks and then calls a tool as *two messages* — and the real thing is one message holding
 * both. A rule copied into a test file cannot disagree with itself, which is the whole problem: it
 * can only agree with the copy.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { proseLength } from "../src/features/conversation/answering.ts";
import type { AssistantContent, Message } from "@lyra/core";

/** A reply mid-flight, built from whatever blocks the case is about. */
function pending(...content: AssistantContent[]): Message {
	return {
		role: "assistant",
		content,
		stopReason: "pending",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			total: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		timestamp: 1,
		api: "anthropic-messages",
		provider: "local",
		model: "scripted",
	};
}

const text = (value: string): AssistantContent => ({ type: "text", text: value });
const thinking = (value: string): AssistantContent => ({ type: "thinking", thinking: value });
const call = (): AssistantContent => ({ type: "toolCall", id: "t1", name: "read", arguments: {} });

const user: Message = { role: "user", content: [{ type: "text", text: "介绍下这个项目" }], timestamp: 0 };

/** The condition as `Conversation` asks it, minus the clock — see `useAnswering` for that half. */
const answering = (messages: Message[]) => proseLength(messages) !== null;

test("before anything comes back, the indicator stays", () => {
	assert.equal(answering([user]), false);
});

test("through tool calls, the indicator stays — that is what it is for", () => {
	assert.equal(answering([user, pending(call())]), false);
});

test("reasoning alone is not the answer, so the indicator stays", () => {
	// 思考过程 is not what anyone is waiting to read.
	assert.equal(answering([user, pending(thinking("先看看…"))]), false);
});

test("the first words of prose fold it away", () => {
	assert.equal(answering([user, pending(text("这是 Ink 博客"))]), true);
});

test("empty or whitespace text is not the answer starting", () => {
	/*
	 * A text block often arrives empty and fills in. Treating its arrival as the answer would fold
	 * the indicator away a beat early and — since the turn is still going — flap it back.
	 */
	for (const blank of ["", "   ", "\n"]) {
		assert.equal(answering([user, pending(text(blank))]), false, `for ${JSON.stringify(blank)}`);
	}
});

test("a settled message is not answering — the turn is over and the indicator is gone anyway", () => {
	const done: Message = { ...pending(text("这是 Ink 博客")), stopReason: "stop" } as Message;
	assert.equal(answering([user, done]), false);
});

test("prose, then another tool call in a message of its own: the indicator comes back", () => {
	const prose = pending(text("先说结论"));
	assert.equal(answering([user, prose]), true);
	assert.equal(answering([user, prose, pending(call())]), false);
});

test("prose and the call it leads to, in one message: the indicator comes back", () => {
	/*
	 * The shape the old rule got wrong, and the ordinary one: a model that says what it is about to
	 * do and then does it produces a single `pending` reply holding `[text, toolCall]`. Asking
	 * whether the message contains *any* text answers yes for the whole of the work that follows —
	 * so the line folded at the first word and stayed folded for however long the tools took, while
	 * the composer went on offering 停止.
	 */
	assert.equal(answering([user, pending(text("先看看这个文件"), call())]), false);
});

test("several calls after the prose are still not the answer arriving", () => {
	assert.equal(answering([user, pending(text("我来查三处"), call(), call(), call())]), false);
});

test("prose resumed after a call is the answer arriving again", () => {
	// The other direction: the model finishes its tools and goes back to writing, in the same reply.
	assert.equal(answering([user, pending(text("先看看"), call(), text("看完了，结论是"))]), true);
});

test("reasoning after prose is not prose", () => {
	// Thinking that follows a sentence is the model gone quiet again, not the answer continuing.
	assert.equal(answering([user, pending(text("先说结论"), thinking("再想想"))]), false);
});

test("the length grows with the text, which is what marks a live stream", () => {
	/*
	 * `useAnswering` tells a stalled stream from a live one by watching this number change, so what
	 * matters is not the value but that it moves with every chunk. A boolean could not say that.
	 */
	assert.equal(proseLength([user, pending(text("一"))]), 1);
	assert.equal(proseLength([user, pending(text("一二三"))]), 3);
	// Trimmed, so trailing whitespace in a chunk does not read as progress.
	assert.equal(proseLength([user, pending(text("一二三   "))]), 3);
});
