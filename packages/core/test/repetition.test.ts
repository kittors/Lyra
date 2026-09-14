/**
 * Noticing a turn that has stopped learning anything.
 *
 * The line between "working" and "stuck" is whether the world changed: the same call with the same
 * arguments returning the same answer teaches nothing, however many times it is made.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { RepetitionWatch, REPEAT_STOP, REPEAT_WARN } from "../src/agent/repetition.ts";
import type { Message } from "../src/types.ts";

const result = (text: string): Message =>
	({ role: "toolResult", toolCallId: "c", content: [{ type: "text", text }], timestamp: 1 }) as Message;

const call = (name: string, args: unknown) => [{ name, arguments: args }];

test("the same call with the same answer is what counts as repetition", () => {
	const watch = new RepetitionWatch();
	for (let i = 1; i < REPEAT_WARN; i++) {
		assert.equal(watch.observe(call("bash", { command: "ls" }), [result("a.txt")]).warn, null, "not yet");
	}
	assert.equal(watch.observe(call("bash", { command: "ls" }), [result("a.txt")]).warn, "bash", "said once");
	assert.equal(watch.observe(call("bash", { command: "ls" }), [result("a.txt")]).warn, null, "and only once");
});

test("a call whose answer changed is progress, not repetition", () => {
	const watch = new RepetitionWatch();
	for (let i = 0; i < REPEAT_STOP + 3; i++) {
		watch.observe(call("bash", { command: "npm test" }), [result(`run ${i}: still failing`)]);
	}
	assert.equal(watch.exhausted(), false, "the world kept changing, so it kept learning");
});

test("argument order does not disguise an identical call", () => {
	const watch = new RepetitionWatch();
	watch.observe(call("read", { path: "a", limit: 3 }), [result("x")]);
	watch.observe(call("read", { limit: 3, path: "a" }), [result("x")]);
	assert.equal(watch.observe(call("read", { path: "a", limit: 3 }), [result("x")]).worst, 3);
});

test("alternating between two useless probes is still stuck", () => {
	const watch = new RepetitionWatch();
	for (let i = 0; i < REPEAT_STOP; i++) {
		watch.observe(call("bash", { command: "check a" }), [result("same")]);
		watch.observe(call("bash", { command: "check b" }), [result("same")]);
	}
	assert.equal(watch.exhausted(), true, "consecutive counting would have missed this");
});

test("the turn is stopped once it has been told and carried on anyway", () => {
	const watch = new RepetitionWatch();
	for (let i = 0; i < REPEAT_STOP - 1; i++) {
		watch.observe(call("browser_act", { action: "eval" }), [result("no cap")]);
		assert.equal(watch.exhausted(), false);
	}
	watch.observe(call("browser_act", { action: "eval" }), [result("no cap")]);
	assert.equal(watch.exhausted(), true);
});
