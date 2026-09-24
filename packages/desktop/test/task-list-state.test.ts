import assert from "node:assert/strict";
import { test } from "node:test";
import { isUserPaused, taskListHeadline } from "../src/features/task/task-list-state.ts";

const step = { content: "编写 Issue 文档并保存至 issue 目录", activeForm: "正在写 Issue" };

/**
 * 没在跑的那一步，不能再用 `activeForm` 说话。
 *
 * 这条从前锁的是 `"step"`——也就是折叠行继续显示「正在写 Issue」，而那一轮已经 `done` 了几分钟。
 * 真实的一次是「正在强制推送到远程并修正本地」：读到的人有充分理由相信自己的 Git 历史此刻正在被
 * 覆盖上去，而实际上一个字节都没有推出去。
 */
test("a clean stop with leftover todos is not a pause, and not motion either", () => {
	assert.equal(isUserPaused(false, null), false);
	assert.equal(taskListHeadline({ running: false, stopped: null, active: step, done: 3, total: 4 }), "stalled");
});

test("only a user abort reads as paused", () => {
	assert.equal(isUserPaused(false, "user"), true);
	assert.equal(taskListHeadline({ running: false, stopped: "user", active: step, done: 3, total: 4 }), "paused");
	assert.equal(taskListHeadline({ running: false, stopped: "interrupt", active: step, done: 3, total: 4 }), "stalled");
	assert.equal(taskListHeadline({ running: false, stopped: "error", active: step, done: 3, total: 4 }), "stalled");
});

test("a running step keeps its live label", () => {
	assert.equal(taskListHeadline({ running: true, stopped: null, active: step, done: 1, total: 4 }), "step");
	assert.equal(isUserPaused(true, "user"), false);
});

/** 没有正在进行的那一步时，说的是整张清单的进度，跟跑不跑无关。 */
test("with no step in progress the row describes the plan", () => {
	assert.equal(taskListHeadline({ running: false, stopped: null, done: 4, total: 4 }), "allDone");
	assert.equal(taskListHeadline({ running: false, stopped: null, done: 0, total: 4 }), "notStarted");
	assert.equal(taskListHeadline({ running: true, stopped: null, done: 1, total: 4 }), "notStarted");
});
