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
import { has } from "../../src/features/dock/tree.ts";

function reset(scope: string | null): void {
	window.localStorage.clear();
	usePaneDock.setState({ trees: {}, sizes: {}, drag: null, maximized: {}, focused: {}, crossRatio: {}, host: null });
	provideScope(() => scope);
}

/** 一屏的像素跨度。给得宽是为了让落点唯一——放不下时面板照样进去，只是画得挤。 */
const ROOMY = { width: 1200, height: 900 };

test("单屏：落在那一屏自己的 dock——单屏就是只有一屏的分屏", () => {
	reset("sess-a");
	usePaneDock.getState().rememberSize("sess-a", ROOMY);
	openScopedPanel("terminal");
	assert.ok(has(usePaneDock.getState().tree("sess-a"), "terminal"), "面板属于这个会话，开在它这一屏");
	assert.deepEqual(Object.keys(usePaneDock.getState().trees), ["sess-a"], "没有第二个地方可以落");
});

test("分屏：落在人正看着的那一屏", () => {
	reset("sess-a");
	usePaneDock.getState().rememberSize("sess-a", ROOMY);
	usePaneDock.getState().rememberSize("sess-b", ROOMY);
	openScopedPanel("terminal");
	assert.ok(has(usePaneDock.getState().tree("sess-a"), "terminal"), "没落进那一屏");
	assert.ok(!has(usePaneDock.getState().tree("sess-b"), "terminal"), "落到了别的会话身上");
});

test("另一屏开着同一种面板，不妨碍这一屏开自己的——面板各归各的会话", () => {
	reset("sess-a");
	usePaneDock.getState().rememberSize("sess-a", ROOMY);
	usePaneDock.getState().rememberSize("sess-b", ROOMY);
	usePaneDock.getState().open("sess-b", "browser");

	openScopedPanel("browser");
	assert.ok(has(usePaneDock.getState().tree("sess-a"), "browser"), "从前这里只是把焦点给了另一处的浏览器，点了没反应");
	assert.ok(has(usePaneDock.getState().tree("sess-b"), "browser"), "另一屏的那个原样留着");
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

test("不是点出来的请求（比如子智能体开工的通报）落在它点名的那一屏，不跟着焦点", () => {
	reset("sess-a");
	usePaneDock.getState().rememberSize("sess-a", ROOMY);
	usePaneDock.getState().rememberSize("sess-b", ROOMY);
	openScopedPanel("subagents", undefined, "sess-b");
	assert.ok(has(usePaneDock.getState().tree("sess-b"), "subagents"), "开工的是 b 的子智能体");
	assert.ok(!has(usePaneDock.getState().tree("sess-a"), "subagents"), "焦点在 a，不代表通报属于 a");

	// 点名的那一屏不在屏上时，退回人所在的那一屏，而不是写进一棵没人画的树。
	openScopedPanel("tasks", undefined, "sess-gone");
	assert.ok(has(usePaneDock.getState().tree("sess-a"), "tasks"));
});

test("没有工作区的窗口里（会话窗口），什么也不写", () => {
	// 会话窗口不加载 SplitWorkspace，没人调用 provideScope——那里没有可以开面板的地方。
	reset(null);
	openScopedPanel("files");
	assert.deepEqual(usePaneDock.getState().trees, {});
});

/*
 * 面板窗口里没有 dock，所以请求要转给有 dock 的那个窗口。
 *
 * 在弹出去的文件树里点文件，改一份没人读的状态等于把点击吞掉，而文件树正是那个窗口的全部用途。
 * 见 `docs/architecture/split-window-conflicts.md` 第七节。
 */
test("面板窗口：请求转给主窗口，不动本地的树", () => {
	reset(null);
	const asked: unknown[] = [];
	Reflect.set(window, "lyra", {
		bootWindow: { kind: "panel", panelKind: "files", panelScope: "sess-a", sessionId: null, id: "p1" },
		windows: { openPanelInMain: async (input: unknown) => { asked.push(input); return { ok: true }; } },
	});
	try {
		openScopedPanel("file", { kind: "files", side: "bottom" });
		assert.deepEqual(asked, [{ kind: "file", beside: { kind: "files", side: "bottom" } }]);
		assert.deepEqual(usePaneDock.getState().trees, {}, "面板窗口里的树是没人画的，往里写等于把点击吞掉");
	} finally {
		Reflect.deleteProperty(window, "lyra");
	}
});
