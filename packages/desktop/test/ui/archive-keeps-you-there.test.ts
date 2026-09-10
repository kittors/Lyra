/**
 * 归档正开着的会话应切回新会话。
 *
 * 在常规列表里归档当前对话，对话应移出常规列表，且工作区切至空白新对话。
 * 若是查看已归档的会话（打开时已为 archived），后续变更不应把人弹走。
 */

import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import type { SessionMeta } from "@lyra/core";
import { useApp } from "../../src/store/index.ts";
import { applySessionChange } from "../../src/store/session-changes.ts";

const usage = { input: 0, output: 0, total: 0, cacheRead: 0, cacheWrite: 0, cost: { input: 0, output: 0, total: 0, cacheRead: 0, cacheWrite: 0 } };
const meta = (id: string, over: Partial<SessionMeta> = {}): SessionMeta => ({
	id, title: id, cwd: "/test", projectId: "test", projectName: "test",
	createdAt: 1, updatedAt: 2, modelId: "", messageCount: 3, seq: 2, usage, ...over,
});

/** 被带去新对话的次数——这是「人被弹走了」唯一说得清的迹象。 */
let leftForNewSession: number;

beforeEach(() => {
	leftForNewSession = 0;
	useApp.setState({
		activeSessionId: "a", meta: meta("a"), messages: [], sessions: [meta("a")],
		sessionCache: {}, queued: {}, drafts: {}, notices: [],
		newSession: async () => { leftForNewSession++; },
	});
});

test("归档正开着的那个对话，人被切去新对话", () => {
	applySessionChange({ id: "a", projectId: "test", meta: meta("a", { archived: true, seq: 3 }) }, useApp.setState, useApp.getState);
	assert.equal(leftForNewSession, 1, "归档当前会话，触发 newSession 离开当前会话");
});

test("查看已归档会话时收到后续变更，不把人弹走", () => {
	// 会话在进入状态前就已经 archived
	useApp.setState({
		activeSessionId: "a",
		meta: meta("a", { archived: true }),
		sessions: [meta("a", { archived: true })],
	});
	applySessionChange({ id: "a", projectId: "test", meta: meta("a", { archived: true, seq: 3 }) }, useApp.setState, useApp.getState);
	assert.equal(leftForNewSession, 0, "已经在看归档会话时，正常接收更新，不弹走");
	assert.equal(useApp.getState().activeSessionId, "a");
});

test("对话真的没了，才把人带走", () => {
	applySessionChange({ id: "a", projectId: "test", meta: null }, useApp.setState, useApp.getState);
	assert.equal(leftForNewSession, 1, "被删掉的对话没有「留在里面」这一说");
	assert.equal(useApp.getState().sessions.some((one) => one.id === "a"), false);
});

test("归档的是别人，谁也不用动", () => {
	useApp.setState({ sessions: [meta("a"), meta("b")] });
	applySessionChange({ id: "b", projectId: "test", meta: meta("b", { archived: true, seq: 3 }) }, useApp.setState, useApp.getState);
	assert.equal(leftForNewSession, 0);
	assert.equal(useApp.getState().activeSessionId, "a");
});
