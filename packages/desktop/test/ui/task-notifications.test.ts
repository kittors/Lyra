import assert from "node:assert/strict";
import { beforeEach, mock, test } from "node:test";
import { act, createElement as h } from "react";
import type { SessionMeta } from "@lyra/core";
import { useApp } from "../../src/store/index.ts";
import { applyAgentEvent } from "../../src/store/apply-event.ts";
import { WindowControls } from "../../src/app/window/WindowControls.tsx";
import { useTrayCommands } from "../../src/app/window/tray-commands.ts";
import { Toaster } from "../../src/features/toast/Toaster.tsx";
import { LayoutProvider } from "../../src/app/layout.tsx";
import type { LyraApi } from "../../electron/ipc-types.ts";
import { click, mount } from "../helpers/mount.ts";

const usage = { input: 0, output: 0, total: 0, cacheRead: 0, cacheWrite: 0, cost: { input: 0, output: 0, total: 0, cacheRead: 0, cacheWrite: 0 } };
const meta = (id: string): SessionMeta => ({ id, title: "同名任务", cwd: "/test/project", projectId: "test", projectName: "test", createdAt: 1, updatedAt: 2, modelId: "", messageCount: 1, seq: 2, usage });
let list: () => Promise<SessionMeta[]>;
let onTray: Parameters<LyraApi["onTrayCommand"]>[0] | undefined;
function deferredList() {
	let resolve!: (sessions: SessionMeta[]) => void;
	let reject!: (cause: Error) => void;
	const promise = new Promise<SessionMeta[]>((done, fail) => { resolve = done; reject = fail; });
	return { promise, resolve, reject };
}
beforeEach(() => {
	list = async () => [meta("a"), meta("b")];
	onTray = undefined;
	useApp.setState({ selectionEpoch: 0, activeSessionId: "a", meta: meta("a"), sessions: [meta("a"), meta("b")], activity: {}, turns: {}, carried: {}, notices: [],
		messages: [], approvals: [], sessionCache: {}, toolRuns: {}, scratchRoots: ["/test"], scratchCwd: "/test", workspace: null, running: false, loadingSession: false });
	Object.defineProperty(window, "lyra", { configurable: true, value: {
		onTrayCommand: (listener: Parameters<LyraApi["onTrayCommand"]>[0]) => { onTray = listener; return () => { onTray = undefined; }; },
		sessions: { list: () => list(), transcript: async (_project: string, id: string) => ({ meta: meta(id), messages: [], running: false, pendingApprovals: [] }), capabilities: async () => null },
		subAgents: { list: async () => [] },
	} });
});

test("background completion is immediate, singular, and cleared when the session is opened", async () => {
	const read = deferredList(); list = () => read.promise;
	useApp.setState({ activity: { b: "running" } });
	applyAgentEvent("b", { type: "agent_end", reason: "done" }, useApp.setState, useApp.getState);
	assert.equal(useApp.getState().notices.length, 1, "the list refresh must not delay completion feedback");
	applyAgentEvent("b", { type: "agent_end", reason: "done" }, useApp.setState, useApp.getState);
	assert.equal(useApp.getState().notices.length, 1, "a duplicate end event must not rearm a toast");
	await useApp.getState().openSession(meta("b"));
	assert.equal(useApp.getState().notices.length, 0);
	read.resolve([meta("a"), meta("b")]); await read.promise;
	assert.equal(useApp.getState().notices.length, 0, "a late refresh cannot toast the conversation now on screen");
});

test("active and cancelled tasks stay quiet; a later background turn can notify again", async () => {
	applyAgentEvent("a", { type: "agent_end", reason: "done" }, useApp.setState, useApp.getState);
	applyAgentEvent("b", { type: "agent_end", reason: "aborted" }, useApp.setState, useApp.getState);
	assert.equal(useApp.getState().notices.length, 0);
	for (let turn = 0; turn < 2; turn++) {
		applyAgentEvent("b", { type: "agent_start", sessionId: "b" }, useApp.setState, useApp.getState);
		applyAgentEvent("b", { type: "agent_end", reason: "error" }, useApp.setState, useApp.getState);
	}
	assert.equal(useApp.getState().notices.length, 2);
	assert.ok(useApp.getState().notices.every((notice) => notice.sessionId === "b" && notice.level === "error"));
	await Promise.resolve();
});

test("notification navigation resolves an unloaded target and respects newer navigation", async () => {
	useApp.setState({ sessions: [] });
	assert.equal(await useApp.getState().openSessionById("b"), true);
	assert.equal(useApp.getState().activeSessionId, "b");
	assert.equal(useApp.getState().view, "chat");
	const read = deferredList(); list = () => read.promise;
	const opening = useApp.getState().openSessionById("unloaded");
	await useApp.getState().openSession(meta("a"));
	read.resolve([meta("unloaded")]);
	assert.equal(await opening, false);
	assert.equal(useApp.getState().activeSessionId, "a");
});

test("cold tray commands use the same ID lookup as the toast action", async () => {
	function Harness() { useTrayCommands(); return null; }
	useApp.setState({ sessions: [] });
	const view = await mount(h(Harness));
	try {
		assert.ok(onTray); onTray("open-session:b");
		await act(async () => { await Promise.resolve(); });
		assert.equal(useApp.getState().activeSessionId, "b");
	} finally { await view.unmount(); }
});

test("task toasts offer one action and keep the source session ID", async () => {
	useApp.getState().notify("同名任务执行失败", "error", "b");
	const open = mock.method(useApp.getState(), "openSessionById", async () => true);
	// 提示条在应用里就挂在 `LayoutProvider` 里面（App.tsx），它要按侧边栏宽度让开位置。
	const view = await mount(h(LayoutProvider, null, h(Toaster)));
	try {
		const action = document.querySelector<HTMLButtonElement>('[aria-label="跳转到该会话"]');
		assert.ok(action);
		assert.equal(document.querySelector('[aria-label="新开一个对话来排查"]'), null);
		await click(action);
		assert.equal(open.mock.calls[0]?.arguments[0], "b");
	} finally { open.mock.restore(); await view.unmount(); }
});

test("collapsed sidebar distinguishes waiting, failed and done without animating the badge", async () => {
	const view = await mount(h(WindowControls, { navOpen: false, onToggleNav() {} }));
	try {
		for (const [activity, label, color] of [["done", "有任务已完成", "bg-ok"], ["failed", "有任务执行失败", "bg-danger"], ["waiting", "有任务等待处理", "bg-accent"]] as const) {
			await act(async () => { useApp.setState({ activity: { a: "waiting", b: activity } }); });
			assert.match(view.find("button").getAttribute("aria-label") ?? "", new RegExp(label));
			assert.ok(view.host.querySelector(`span.${color}`));
			assert.equal(view.host.querySelector('[class*="pulse"], [class*="bloom"], [class*="shadow"]'), null);
		}
		await view.rerender(h(WindowControls, { navOpen: true, onToggleNav() {} }));
		assert.equal(view.host.querySelector("span.bg-accent"), null);
	} finally { await view.unmount(); }
});

for (const olderFirst of [true, false]) {
	test(`the latest cold notification wins when ${olderFirst ? "older" : "newer"} lookup resolves first`, async () => {
		useApp.setState({ sessions: [] });
		const older = deferredList(), newer = deferredList();
		let reads = 0;
		list = () => reads++ === 0 ? older.promise : newer.promise;
		const openingOlder = useApp.getState().openSessionById("older");
		const openingNewer = useApp.getState().openSessionById("newer");
		if (olderFirst) {
			older.resolve([meta("older"), meta("newer")]);
			assert.equal(await openingOlder, false);
			newer.resolve([meta("older"), meta("newer")]);
		} else {
			newer.resolve([meta("older"), meta("newer")]);
			assert.equal(await openingNewer, true);
			older.resolve([meta("older"), meta("newer")]);
		}
		assert.equal(await openingOlder, false);
		assert.equal(await openingNewer, true);
		assert.equal(useApp.getState().activeSessionId, "newer");
	});
}

test("a failed older lookup stays quiet while the latest notification is still loading", async () => {
	useApp.setState({ sessions: [] });
	const older = deferredList(), newer = deferredList();
	let reads = 0;
	list = () => reads++ === 0 ? older.promise : newer.promise;
	const openingOlder = useApp.getState().openSessionById("older");
	const openingNewer = useApp.getState().openSessionById("newer");
	older.reject(new Error("old lookup failed"));
	assert.equal(await openingOlder, false);
	assert.equal(useApp.getState().notices.length, 0);
	newer.resolve([meta("newer")]);
	assert.equal(await openingNewer, true);
	assert.equal(useApp.getState().activeSessionId, "newer");
});

test("a failed latest lookup does not let an older notification navigate afterward", async () => {
	useApp.setState({ sessions: [] });
	const older = deferredList(), newer = deferredList();
	let reads = 0;
	list = () => reads++ === 0 ? older.promise : newer.promise;
	const openingOlder = useApp.getState().openSessionById("older");
	const openingNewer = useApp.getState().openSessionById("newer");
	newer.reject(new Error("latest lookup failed"));
	assert.equal(await openingNewer, false);
	older.resolve([meta("older")]);
	assert.equal(await openingOlder, false);
	assert.equal(useApp.getState().activeSessionId, "a");
	assert.equal(useApp.getState().notices.length, 1);
	assert.match(useApp.getState().notices[0].message, /latest lookup failed/);
});

for (const failed of [false, true]) {
	test(`a new blank session supersedes a cold notification ${failed ? "failure" : "result"}`, async () => {
		const read = deferredList(); list = () => read.promise;
		const opening = useApp.getState().openSessionById("unloaded");
		useApp.setState({ workspace: { path: "/test/project", name: "test", isGitRepo: false, branch: null } });
		await useApp.getState().newSession();
		if (failed) read.reject(new Error("late lookup failed"));
		else read.resolve([meta("unloaded")]);
		assert.equal(await opening, false);
		assert.equal(useApp.getState().activeSessionId, null);
		assert.equal(useApp.getState().notices.length, 0);
	});
}
