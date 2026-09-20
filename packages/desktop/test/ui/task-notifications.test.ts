import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";
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
/**
 * 把此刻还在路上的异步工作等落地。
 *
 * 这个文件里有几笔写入是没人接着的：后台回合结束会顺手刷一次会话列表（`apply-event.ts` 里那句
 * `void bridge.sessions.list()`），打开会话之后还跟着一趟读转录。它们落地时写的正是这里断言的东西
 * ——`sessions`、`selectionEpoch`、当前会话。谁发起的谁等完，落在自己这一格里，下一条测试拿到的就
 * 只有 `beforeEach` 摆好的那份。
 *
 * 判据是 store 不再变：zustand 每次 `set` 都换一个状态对象，连着几拍还是同一个，就是没人再写了。
 */
async function settle(): Promise<void> {
	let state = useApp.getState();
	// 上限只为兜底：真要有谁每拍都在写，与其在这里空转到超时，不如把这一格让给断言去说话。
	for (let quiet = 0, spins = 0; quiet < 3 && spins < 100; spins++) {
		await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
		const now = useApp.getState();
		quiet = now === state ? quiet + 1 : 0;
		state = now;
	}
}

/** 真正的导航动作，在任何一条测试替换它之前拿在手上——每条测试开始时都还原成它。 */
const openSessionById = useApp.getState().openSessionById;

beforeEach(() => {
	list = async () => [meta("a"), meta("b")];
	onTray = undefined;
	/*
	 * 动作和状态一起还原。
	 *
	 * `openSessionById` 在这里是因为它被替换过，而还回去这件事得有人兜底——这一整个文件问的就是它答
	 * 什么，一条测试的桩漏出来，后面每一条都在问一个假的。`pendingSessionId` 是另一处：它留着上一条
	 * 测试选到一半的 id，会让 `previewSessionId` 认成「这一行已经在选了」而不推进 `selectionEpoch`，
	 * 后面比对世代的那几条就全错了位。
	 */
	useApp.setState({ selectionEpoch: 0, activeSessionId: "a", pendingSessionId: null, meta: meta("a"), sessions: [meta("a"), meta("b")], activity: {}, turns: {}, carried: {}, notices: [],
		messages: [], approvals: [], sessionCache: {}, toolRuns: {}, scratchRoots: ["/test"], scratchCwd: "/test", workspace: null, running: false, loadingSession: false, view: "chat", openSessionById });
	Object.defineProperty(window, "lyra", { configurable: true, value: {
		onTrayCommand: (listener: Parameters<LyraApi["onTrayCommand"]>[0]) => { onTray = listener; return () => { onTray = undefined; }; },
		sessions: { list: () => list(), transcript: async (_project: string, id: string) => ({ meta: meta(id), messages: [], running: false, pendingApprovals: [] }), capabilities: async () => null },
		subAgents: { list: async () => [] },
	} });
});

afterEach(settle);

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
	// 三次后台结束各自甩出一次列表刷新，落地时会整份改写 `sessions`——在这里等完，别写进下一条测试。
	await settle();
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
	/*
	 * 托盘那一脚是 `void openSessionById(id)`——发出去就不回头，测试没有任何把手能知道它什么时候落地。
	 * 所以在这里替一层只做记录的壳，把那个 Promise 接住等完：等一个微任务只够它把冷查找发出去，剩下
	 * 的「查到了、开会话」会漏到下一条测试里，写在别人的 store 上。
	 */
	const navigations: Promise<boolean>[] = [];
	const original = useApp.getState().openSessionById;
	useApp.setState({ openSessionById: (id: string) => { const navigation = original(id); navigations.push(navigation); return navigation; } });
	const view = await mount(h(Harness));
	try {
		assert.ok(onTray); onTray("open-session:b");
		assert.equal(navigations.length, 1, "托盘命令必须当场走 ID 查找这条路");
		await act(async () => { await Promise.all(navigations); });
		assert.equal(useApp.getState().activeSessionId, "b");
	} finally { useApp.setState({ openSessionById: original }); await view.unmount(); }
});

test("task toasts offer one action and keep the source session ID", async () => {
	useApp.getState().notify("同名任务执行失败", "error", "b");
	/*
	 * 换掉动作，走 `setState` 而不是 `mock.method`。
	 *
	 * zustand 每次 `set` 都交出一个新的状态对象，动作只是被复制过去的字段。`mock.method` 补的是当时
	 * 取到的那一个对象，`restore()` 也只还得回那一个——而点完动作，提示条会排一个 170ms 的退场定时器，
	 * 它落地时写一次 `notices`，store 就换了对象。机器一忙，这条测试走到 `finally` 已经超过 170ms，
	 * 于是还回去的是被换下来的旧对象，活着的 store 一直留着这个「永远答 true」的桩：后面每一条问
	 * `openSessionById` 的测试都被它答成了 true。整整六条红，全是这一个字段没还回去。
	 */
	const open = mock.fn(async (_id: string) => true);
	const original = useApp.getState().openSessionById;
	useApp.setState({ openSessionById: open });
	// 提示条在应用里就挂在 `LayoutProvider` 里面（App.tsx），它要按侧边栏宽度让开位置。
	const view = await mount(h(LayoutProvider, null, h(Toaster)));
	try {
		const action = document.querySelector<HTMLButtonElement>('[aria-label="跳转到该会话"]');
		assert.ok(action);
		assert.equal(document.querySelector('[aria-label="新开一个对话来排查"]'), null);
		await click(action);
		assert.equal(open.mock.calls[0]?.arguments[0], "b");
	} finally { useApp.setState({ openSessionById: original }); await view.unmount(); }
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
