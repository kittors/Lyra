/**
 * 归档一个对话，不等于关掉它。
 *
 * 从前这两件事是同一件：会话一变成归档，只要它正开着，人就被扔回一个空白输入框。那条规矩是为另一
 * 条规矩服务的——归档的会话不进侧边栏列表，所以「开着一个列表里没有的对话」这种状态不许存在。
 *
 * 归档列表里点一行现在只是打开它，不再顺手把它取出来（见 `useSidebarLists`），于是那条规矩会让人
 * 根本待不住：一进去，第一条送到的变更就把人弹走了。真正该改的是被服务的那一条——`listableSessions`
 * 放行当前会话，屏幕上的对话任何时候都在侧边栏里。剩下唯一还该把人带走的，是这个对话真的没了。
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

test("归档正开着的那个对话，人还留在里面", () => {
	applySessionChange({ id: "a", projectId: "test", meta: meta("a", { archived: true, seq: 3 }) }, useApp.setState, useApp.getState);
	assert.equal(leftForNewSession, 0, "归档是收纳的决定，不是关闭的决定");
	assert.equal(useApp.getState().activeSessionId, "a");
	assert.equal(useApp.getState().meta?.archived, true, "屏幕上这一份也要知道自己被收起来了——行上那个按钮据此改成「取消归档」");
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
