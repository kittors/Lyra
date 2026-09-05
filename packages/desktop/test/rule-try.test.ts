/**
 * A pattern against the last few replies: where it would hit, and why the loader would refuse it.
 *
 * The quiet failures this guards against: a hit in a tool's arguments reported as prose (the
 * scope that would catch it is a different one), the oldest message counted as 「倒数第 1 条」,
 * a run that quietly looks at more than it says, and a refusal worded differently from the
 * loader's — the page and the loader must be one voice.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import type { AssistantMessage, Message } from "@lyra/core";
import { RECENT_LIMIT, snippetAround, tryCondition } from "../src/features/settings/rule-try.ts";

function said(text: string, extra: AssistantMessage["content"] = []): AssistantMessage {
	return { role: "assistant", content: [{ type: "text", text }, ...extra], timestamp: 0 } as AssistantMessage;
}

function asked(text: string): Message {
	return { role: "user", content: [{ type: "text", text }], timestamp: 0 };
}

test("hits are labelled by where they are, newest reply first", () => {
	const messages: Message[] = [
		asked("清一下临时目录"),
		said("好，我先看看。", [{ type: "toolCall", id: "c1", name: "bash", arguments: { command: "rm -rf /tmp/x" }, argumentsText: '{"command":"rm -rf /tmp/x"}' }]),
		said("这里我打算用 rm -rf 清掉整个目录。", [{ type: "thinking", thinking: "也许 rm -rf 太狠了" }]),
	];
	const outcome = tryCondition("rm -rf", messages);
	assert.equal(outcome.reason, undefined);
	assert.equal(outcome.checked, 2, "two replies were looked at; the user's line is not one of them");
	assert.deepEqual(
		outcome.hits.map((hit) => [hit.nth, hit.source, hit.toolName ?? null]),
		[
			[1, "text", null],
			[1, "thinking", null],
			[2, "tool", "bash"],
		],
		"the reply on screen is 倒数第 1 条; the tool call is a tool hit, not prose",
	);
	assert.match(outcome.hits[2].snippet, /"command":"rm -rf \/tmp\/x"/);
});

test("the run looks at the last twenty replies and says so", () => {
	const messages: Message[] = [];
	for (let i = 1; i <= RECENT_LIMIT + 5; i++) messages.push(said(`第 ${i} 条 NEEDLE`));
	const outcome = tryCondition("NEEDLE", messages);
	assert.equal(outcome.checked, RECENT_LIMIT);
	assert.equal(outcome.hits.length, RECENT_LIMIT, "older replies are not quietly included");
	assert.match(outcome.hits[0].snippet, new RegExp(`第 ${RECENT_LIMIT + 5} 条`), "and the first hit is the newest");
});

test("a refused pattern carries the loader's reason and no hits", () => {
	const messages: Message[] = [said("aaaa")];
	const nested = tryCondition("(a+)+$", messages);
	assert.match(nested.reason ?? "", /嵌套量词/);
	assert.equal(nested.hits.length, 0, "a refused pattern is never run — that is the point of refusing it");

	const broken = tryCondition("([", messages);
	assert.match(broken.reason ?? "", /不是合法正则/);
});

test("inline flags work the way the loader reads them", () => {
	const outcome = tryCondition("(?i)todo", [said("A TODO left behind")]);
	assert.equal(outcome.hits.length, 1);
});

test("nothing typed and nothing to try against are both quiet, not errors", () => {
	assert.deepEqual(tryCondition("", [said("x")]), { pattern: "", hits: [], checked: 1 });
	assert.deepEqual(tryCondition("x", []), { pattern: "x", hits: [], checked: 0 });
});

test("a snippet keeps a little context and marks what it cut", () => {
	const text = `${"前".repeat(50)}NEEDLE${"后".repeat(50)}`;
	const snippet = snippetAround(text, 50, 6);
	assert.ok(snippet.startsWith("…") && snippet.endsWith("…"));
	assert.ok(snippet.includes("NEEDLE"));
	assert.ok(snippet.length < 80, `not the whole message: ${snippet.length}`);
	assert.equal(snippetAround("short NEEDLE", 6, 6), "short NEEDLE", "nothing cut, nothing marked");
});
