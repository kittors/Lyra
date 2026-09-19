/**
 * 从会话内容里打开一个面板，它该落在哪。
 *
 * 十几个入口——点一个文件链接、点「审核」、点子智能体、「在终端运行」——从前一律写死
 * `useDock.open`，不问人在哪一屏。同一个「打开文件」，从工具条点落在这一屏，从转录里点却横在
 * 两屏旁边，看不出规律。而 `SplitWorkspace` 的注释早就定了规矩：
 *
 *   「从 tile 打开的面板属于那个 tile 的 dock；已经在窗口 dock 上的留在那儿。」
 *
 * 这个文件把那条规矩的三种情形各钉一条。
 *
 * 「人在哪一屏」是注入进来的（`provideScope`），不是 dock 去问分屏——dock 反过来依赖分屏会连出
 * 一个环，而把这段挪进分屏那一域也一样，它要用 dock 的东西，走前门就把整个 dock 域拉了进来，
 * 绕一圈还是回到分屏。所以这里也用注入来摆场景，和真实接线走同一条路。
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { openScopedPanel, provideScope } from "../../src/features/dock/popout.ts";
import { usePaneDock } from "../../src/features/dock/pane-store.ts";
import { useDock } from "../../src/features/dock/store.ts";
import { defaultTree, has } from "../../src/features/dock/tree.ts";

function reset(scope: string | null): void {
	window.localStorage.clear();
	useDock.setState({ tree: defaultTree(), scope: null, adopted: false, drag: null });
	usePaneDock.setState({ trees: {}, sizes: {}, drag: null });
	provideScope(() => scope);
}

/** 一屏的像素跨度。给得宽是为了让落点唯一——放不下时面板照样进去，只是画得挤。 */
const ROOMY = { width: 1200, height: 900 };

test("单屏：落在窗口 dock，和从前一样", () => {
	reset(null);
	openScopedPanel("terminal");
	assert.ok(has(useDock.getState().tree, "terminal"), "单屏时窗口 dock 就是唯一的 dock");
	assert.equal(usePaneDock.getState().trees["any"], undefined);
});

test("分屏：落在人正看着的那一屏，不是窗口 dock", () => {
	reset("sess-a");
	usePaneDock.getState().rememberSize("sess-a", ROOMY);
	openScopedPanel("terminal");
	assert.ok(has(usePaneDock.getState().tree("sess-a"), "terminal"), "没落进那一屏");
	assert.ok(!has(useDock.getState().tree, "terminal"), "落到窗口 dock 上了——那正是要修的毛病");
});

test("已经在窗口 dock 上的，留在那儿，只是把焦点给它", () => {
	reset("sess-a");
	usePaneDock.getState().rememberSize("sess-a", ROOMY);
	useDock.getState().open("browser");
	assert.ok(has(useDock.getState().tree, "browser"));

	openScopedPanel("browser");
	assert.ok(has(useDock.getState().tree, "browser"), "被从窗口 dock 搬走了");
	assert.ok(!has(usePaneDock.getState().tree("sess-a"), "browser"), "在那一屏里又开了一个，成了两份");
	assert.equal(useDock.getState().focused, "browser", "留在原处的同时该把焦点给它");
});

test("那一屏里已经有了，不再开第二个", () => {
	reset("sess-a");
	usePaneDock.getState().rememberSize("sess-a", ROOMY);
	openScopedPanel("terminal");
	const once = JSON.stringify(usePaneDock.getState().tree("sess-a"));
	openScopedPanel("terminal");
	assert.equal(JSON.stringify(usePaneDock.getState().tree("sess-a")), once, "同一种面板在一屏里开了两次");
});

test("换一屏，就落到换过去的那一屏", () => {
	reset("sess-a");
	usePaneDock.getState().rememberSize("sess-a", ROOMY);
	usePaneDock.getState().rememberSize("sess-b", ROOMY);
	openScopedPanel("terminal");
	assert.ok(has(usePaneDock.getState().tree("sess-a"), "terminal"));

	provideScope(() => "sess-b");
	openScopedPanel("files");
	assert.ok(has(usePaneDock.getState().tree("sess-b"), "files"), "焦点换了屏，新面板还是开在老地方");
	assert.ok(!has(usePaneDock.getState().tree("sess-a"), "files"));
});

test("没人注册过「在哪一屏」时，退回窗口 dock", () => {
	// 会话窗口和面板窗口根本不加载 SplitWorkspace，于是没人调用 provideScope——
	// 默认答案必须是「只有窗口 dock」，而不是抛错或什么都不做。
	window.localStorage.clear();
	useDock.setState({ tree: defaultTree(), scope: null, adopted: false, drag: null });
	usePaneDock.setState({ trees: {}, sizes: {}, drag: null });
	provideScope(() => null);
	openScopedPanel("files");
	assert.ok(has(useDock.getState().tree, "files"));
});

/*
 * 面板窗口里没有 dock，所以请求要转给有 dock 的那个窗口。
 *
 * 从前它落到这一行的最后一条分支——`useDock.open`——而面板窗口里没有任何东西订阅 `useDock`：
 * 它只画一个面板。于是在弹出去的文件树里点文件，改的是一份没人读的状态，点下去什么也不发生，
 * 而文件树正是那个窗口的全部用途。见 `docs/architecture/split-window-conflicts.md` 第七节。
 */
test("面板窗口：请求转给主窗口，不动本地那两棵树", () => {
	reset(null);
	const asked: unknown[] = [];
	Reflect.set(window, "lyra", {
		bootWindow: { kind: "panel", panelKind: "files", panelScope: "window", sessionId: null, id: "p1" },
		windows: { openPanelInMain: async (input: unknown) => { asked.push(input); return { ok: true }; } },
	});
	try {
		openScopedPanel("file", { kind: "files", side: "bottom" });
		assert.deepEqual(asked, [{ kind: "file", beside: { kind: "files", side: "bottom" } }]);
		assert.ok(!has(useDock.getState().tree, "file"), "面板窗口的 dock 树是没人画的，往里写等于把点击吞掉");
	} finally {
		Reflect.deleteProperty(window, "lyra");
	}
});
