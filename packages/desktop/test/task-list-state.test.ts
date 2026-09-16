import assert from "node:assert/strict";
import { test } from "node:test";
import { isUserPaused, taskListHeadline } from "../src/features/task/task-list-state.ts";

const step = { content: "编写 Issue 文档并保存至 issue 目录", activeForm: "正在写 Issue" };

test("a clean stop with leftover todos is not a pause", () => {
	assert.equal(isUserPaused(false, null), false);
	assert.equal(taskListHeadline({ running: false, stopped: null, active: step, done: 3, total: 4 }), "step");
});

test("only a user abort reads as paused", () => {
	assert.equal(isUserPaused(false, "user"), true);
	assert.equal(taskListHeadline({ running: false, stopped: "user", active: step, done: 3, total: 4 }), "paused");
	assert.equal(taskListHeadline({ running: false, stopped: "interrupt", active: step, done: 3, total: 4 }), "step");
	assert.equal(taskListHeadline({ running: false, stopped: "error", active: step, done: 3, total: 4 }), "step");
});

test("a running step keeps its live label", () => {
	assert.equal(taskListHeadline({ running: true, stopped: null, active: step, done: 1, total: 4 }), "step");
	assert.equal(isUserPaused(true, "user"), false);
});
