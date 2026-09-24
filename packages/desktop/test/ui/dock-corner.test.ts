/**
 * 谁得给窗口左上角让位，让多少。
 *
 * 那个角上有两样东西：系统画的窗口控件（macOS 的红绿灯，Windows 在另一头所以是没有），以及
 * **这个应用自己的侧边栏开关**。第二样是这一组测试真正守的东西——它不归系统管，全屏也不会
 * 把它拿走，而侧边栏收起来的时候它是回去的唯一一条路。
 *
 * 曾经原生全屏是被豁免的：理由是「全屏之后红绿灯没了，角上空出来了」。空出来的只有红绿灯。
 * 开关还在原地，于是画在原点的那个面板从 x=0 开始画自己的标签栏，开关正落在第一个标签上——
 * 终端的「终端 1」糊成一团，而底下那个还在、还能按的开关看着像是不见了。
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { cornerReserved, paneAtCorner, startInset } from "../../src/features/dock/DockView.tsx";
import { prInsets } from "../../src/features/pull-requests/PullRequestsView.tsx";
import { HEADER_PAD } from "../../src/features/dock/geometry.ts";
import { TOOLBAR_BUTTON } from "../../src/app/window/WindowControls.tsx";
import { OVERLAY_FALLBACK, TOOLBAR_EDGE, TRAFFIC_LIGHTS_WIDTH, hasHeaderBar, overlayReserved, titlebarInsets } from "../../src/app/window/titlebar.ts";

/*
 * 这件事分两半：工作区决定「占着窗口左上角的那一屏要让多少」（`startInset`），那一屏自己决定
 * 「画在它左上角的是哪一块」（`paneAtCorner`）。单屏就是只有一屏的分屏，所以两半对单屏和分屏都成立。
 */
const at = (kind: string, left: number, top: number, width = 0.5, height = 1) => ({ kind: kind as never, left, top, width, height });

test("侧边栏开着的时候，没有面板需要让位", () => {
	// 那个角是侧边栏的，开关画在侧边栏自己身上，让位的事它自己办了。
	assert.equal(startInset({ headerBar: false, navOpen: true, start: TRAFFIC_LIGHTS_WIDTH }), 0);
});

test("侧边栏收起来，让位的是画在原点的那个面板", () => {
	const boxes = [at("terminal", 0, 0), at("conversation", 0.5, 0)];
	assert.equal(paneAtCorner({ compact: false, focusedPane: "browser", boxes, corner: "start" }), "terminal");
	// 原点上没有面板时没人需要让。
	assert.equal(paneAtCorner({ compact: false, focusedPane: "browser", boxes: [at("conversation", 0.5, 0)], corner: "start" }), null);
	assert.ok(startInset({ headerBar: false, navOpen: false, start: TRAFFIC_LIGHTS_WIDTH }) > 0);
});

test("右上角让位的是摸到右边缘那一行最上面的面板", () => {
	const boxes = [at("conversation", 0, 0, 0.7), at("browser", 0.7, 0, 0.3, 0.5), at("terminal", 0.7, 0.5, 0.3, 0.5)];
	assert.equal(paneAtCorner({ compact: false, focusedPane: "conversation", boxes, corner: "end" }), "browser");
});

test("窄布局里让位的是当前那一个，不看它摆在哪", () => {
	/*
	 * 窄布局把一个面板铺满整个屏，所以它就是角上那个——始终是，而不是「碰巧被排在原点时」。
	 */
	assert.equal(paneAtCorner({ compact: true, focusedPane: "browser", boxes: [at("terminal", 0, 0)], corner: "start" }), "browser");
});

test("原生全屏不豁免让位，只是让得少一些", () => {
	/*
	 * 这一条是回归。
	 *
	 * 全屏拿走的是红绿灯，不是侧边栏开关。让位的量跟着 `titlebarInsets` 自己变小——78 变 12——
	 * 但**不能变成零**，否则开关就压在标签栏上了。
	 */
	const windowed = titlebarInsets("darwin", false, { start: 0, end: 0 });
	const fullScreen = titlebarInsets("darwin", true, { start: 0, end: 0 });
	assert.equal(windowed.start, TRAFFIC_LIGHTS_WIDTH);
	assert.equal(fullScreen.start, TOOLBAR_EDGE, "全屏之后红绿灯没了，起点回到普通边距");

	const full = startInset({ headerBar: false, navOpen: false, start: fullScreen.start });
	assert.ok(full >= TOOLBAR_BUTTON, `全屏时只让出 ${full}px，装不下 ${TOOLBAR_BUTTON}px 的开关`);
	assert.ok(full < startInset({ headerBar: false, navOpen: false, start: windowed.start }), "全屏该让得比不全屏少——红绿灯已经不在那儿了");
});

test("有 header 的平台上，没有任何面板需要让位", () => {
	/*
	 * Windows 和 Linux 顶上那条横贯的 header 把窗口的两端都收走了：开关在它左端，系统按钮在它
	 * 右端，屏整体从它底下开始。这一条要守的是「别让两遍」。
	 */
	for (const navOpen of [false, true]) {
		assert.equal(startInset({ headerBar: true, navOpen, start: TOOLBAR_EDGE }), 0, `headerBar 下 navOpen=${navOpen} 不该让位`);
	}
});

test("哪些平台有那条 header", () => {
	// macOS 没有：红绿灯在左上角，面板的第一行就是窗口的顶行，一行当两行用。
	assert.equal(hasHeaderBar("darwin"), false);
	// Windows 和 Linux 有：它们的系统按钮在右上角，正压在面板自己的控件上。
	assert.equal(hasHeaderBar("win32"), true);
	assert.equal(hasHeaderBar("linux"), true);
	// 手机上不是窗口，两端都没有要让的东西。
	assert.equal(hasHeaderBar("win32", false), false);
	assert.equal(hasHeaderBar("darwin", false), false);
});

test("Windows 和 Linux 的角上只有开关，没有系统控件", () => {
	/*
	 * 它们的最小化/最大化/关闭在另一头，所以左边这一侧让的就只是开关那点宽度，和 macOS 全屏
	 * 时是同一个数。右边那头由 `insetEnd` 单独让，不走这条路。
	 */
	const insets = titlebarInsets("win32", false, { start: 0, end: 138 });
	assert.equal(insets.start, TOOLBAR_EDGE);
	assert.equal(insets.end, 138, "系统按钮占多宽，右边就让多宽");
	assert.ok(cornerReserved(insets.start) >= TOOLBAR_BUTTON);
});

test("Windows 全屏之后，header 还在，只是右边不再留位", () => {
	/*
	 * Windows 的 F11 全屏会把 `titleBarOverlay` 整个藏起来，于是 `overlayReserved` 读到的是 0。
	 *
	 * 两件事必须分开：**没有系统按钮要让位**（end 归零，header 右端不再空出那 138px），和
	 * **header 本身不该消失**——侧边栏开关是应用自己的，全屏了也还得有地方按。macOS 那边的教训
	 * 就是把这两件事混成了一件，见上面那条回归。
	 */
	const insets = titlebarInsets("win32", false, { start: 0, end: 0 });
	assert.equal(insets.end, 0, "overlay 藏起来之后右边不该再留位");
	assert.equal(insets.start, TOOLBAR_EDGE, "左端始终是普通边距，那里本来就没有系统控件");
	assert.equal(hasHeaderBar("win32"), true, "全屏不该把 header 拿掉——开关还在上面");

	// overlay 开着但还没量出尺寸时，宁可按兜底值让位，也不要把控件塞到关闭按钮底下。
	assert.equal(overlayReserved({ visible: true, getTitlebarAreaRect: () => ({ x: 0, right: 0, width: 0 }) }, 1200).end, OVERLAY_FALLBACK);
	assert.deepEqual(overlayReserved({ visible: false, getTitlebarAreaRect: () => ({ x: 0, right: 0, width: 0 }) }, 1200), { start: 0, end: 0 });
});

test("拉取请求那一页，谁在最左边谁让位", () => {
	/*
	 * 这一页不走 dock，所以 `cornerPane` 一个字也管不到它——而它漏掉过整整一次：注释在、
	 * `transition-[padding-left]` 在，对应的 prop 不见了，于是全屏收起侧边栏之后那颗开关就压在
	 * PR 的标题上（列表展开时压的是「全部」那个筛选按钮）。
	 */
	const start = TRAFFIC_LIGHTS_WIDTH;
	const reserved = cornerReserved(start) + HEADER_PAD + 1; // 也就是 toolbarReserved(start)
	const ask = (over: Partial<Parameters<typeof prInsets>[0]>) =>
		prInsets({ navOpen: false, headerBar: false, compact: false, expanded: false, selected: false, start, ...over });

	// 侧边栏开着：开关画在侧边栏自己身上，两栏都不让。
	assert.deepEqual(ask({ navOpen: true }), { list: 0, detail: 0 });
	assert.deepEqual(ask({ navOpen: true, expanded: true }), { list: 0, detail: 0 });

	// 有 header 的平台：开关在那条带子里，两栏都在它底下。
	assert.deepEqual(ask({ headerBar: true }), { list: 0, detail: 0 });
	assert.deepEqual(ask({ headerBar: true, expanded: true }), { list: 0, detail: 0 });

	// 侧边栏收起：列表在最左边，它让。
	assert.deepEqual(ask({}), { list: reserved, detail: 0 });
	// 列表滑走之后换详情让——这正是用户截到的那一张。
	assert.deepEqual(ask({ expanded: true }), { list: 0, detail: reserved });

	// 窄布局只画一栏，画的那个就是最左边那个。
	assert.deepEqual(ask({ compact: true }), { list: reserved, detail: 0 });
	assert.deepEqual(ask({ compact: true, selected: true }), { list: 0, detail: reserved });

	// 让出来的量要装得下那颗 28px 的开关。
	assert.ok(reserved >= TOOLBAR_BUTTON);
});
