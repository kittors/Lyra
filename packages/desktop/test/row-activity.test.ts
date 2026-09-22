import assert from "node:assert/strict";
import { test } from "node:test";

import { rowActivity, sideChatRunning } from "../src/lib/row-activity.ts";

test("an idle row breathes when its side chat is running", () => {
	assert.equal(rowActivity(null, true, false), "running");
	assert.equal(rowActivity(null, true, true), "running");
});

test("a side chat does not invent an unread result after it stops", () => {
	assert.equal(rowActivity(null, false, false), null);
	assert.equal(rowActivity("done", false, true), null);
});

test("the main turn still wins while it is running or waiting", () => {
	assert.equal(rowActivity("waiting", true, false), "waiting");
	assert.equal(rowActivity("running", true, true), "running");
});

test("an unread main result yields to a live side chat", () => {
	assert.equal(rowActivity("done", true, false), "running");
	assert.equal(rowActivity("failed", true, false), "running");
});

test("sideChatRunning asks each session's own side chat, attached pane or not", () => {
	assert.equal(sideChatRunning({ chats: { a: { running: true } } }, "a"), true);
	assert.equal(sideChatRunning({ chats: { a: { running: false } } }, "a"), false);
	// 分屏时两个会话的侧边聊天同时开着，一边在跑不代表另一边在跑。
	assert.equal(sideChatRunning({ chats: { a: { running: false }, b: { running: true } } }, "b"), true);
	assert.equal(sideChatRunning({ chats: { a: { running: true } } }, "b"), false);
	// 没开过侧边聊天的会话问起来不是错，答案是「没在跑」。
	assert.equal(sideChatRunning({ chats: {} }, "a"), false);
});
