/**
 * 一个停下的子代理，面板上给哪条出路。
 *
 * 反馈里那一个——跑满步数停下的子代理——在面板上是 `done` + `incomplete`，而「重新派发」只挂在
 * `failed` 和 `aborted` 上，于是它什么出路都没有：人只能自己跟主 Agent 说「再派一个」，新派的
 * 从零开始，又跑满。这里钉住三件事：它有出路；上下文还在时出路是「接着跑」而不是「重派」；
 * 正常做完的不给任何按钮。
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { wayBack } from "../src/features/subagents/way-back.ts";

test("one that stopped at a checkpoint with its context kept is offered a way to continue", () => {
	assert.equal(wayBack({ status: "done", incomplete: true, resumable: true }), "resume");
});

test("a failed or stopped one with its context kept is continued, not dispatched again from zero", () => {
	assert.equal(wayBack({ status: "failed", incomplete: true, resumable: true }), "resume");
	assert.equal(wayBack({ status: "aborted", resumable: true }), "resume");
});

test("only when the context is gone does it fall back to dispatching again", () => {
	assert.equal(wayBack({ status: "failed" }), "redispatch");
	assert.equal(wayBack({ status: "aborted" }), "redispatch");
	assert.equal(wayBack({ status: "done", incomplete: true }), null, "a partial report with nothing to continue has nothing to press");
});

test("a clean finish and a running one get no button", () => {
	assert.equal(wayBack({ status: "done", resumable: true }), null);
	assert.equal(wayBack({ status: "running" }), null);
});
