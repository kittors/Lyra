/**
 * The delivery card opens this turn's recorded diffs, not Git and not the file viewer.
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

test("the delivery pane is registered, hidden from the chooser, and not persisted", async () => {
	const source = await readFile(new URL("../src/features/dock/panels/builtin.tsx", import.meta.url), "utf8");
	assert.match(source, /kind: "delivery"/);
	assert.match(source, /listed: false/);
	assert.match(source, /ephemeral: true/);
	assert.match(source, /DeliveryPanel/);
	assert.doesNotMatch(source, /kind: "delivery"[\s\S]*mobile: true/);
});

test("the chooser skips unlisted panes and storage skips ephemeral ones", async () => {
	const toolbar = await readFile(new URL("../src/app/window/WindowToolbar.tsx", import.meta.url), "utf8");
	const dock = await readFile(new URL("../src/features/dock/DockView.tsx", import.meta.url), "utf8");
	assert.match(toolbar, /listed !== false/);
	assert.match(dock, /!def\.ephemeral/);
});

test("the pane renders recorded hunks, not the worktree and not the open file", async () => {
	const file = await readFile(new URL("../src/features/dock/panels/builtin.tsx", import.meta.url), "utf8");
	/*
	 * 只看交付面板自己那几段——标题和正文。
	 *
	 * 这个文件还挂着别的面板：子智能体面板从这里拿到「把一份文件打开到旁边」（它那个域不能引 dock），
	 * 那一段当然要碰打开的文件。这条要守的是「交付面板画的是记录下来的 diff，不是打开的文件」，不是
	 * 「这个文件里不许出现 useOpenFile」。
	 */
	const start = file.indexOf("function DeliveryTitle(");
	const end = file.indexOf("const BUILTIN_PANELS");
	assert.ok(start > 0 && end > start, "交付面板那几段还在原处");
	const source = file.slice(start, end);
	assert.match(source, /data-delivery-diff/);
	assert.match(file, /DiffView/);
	assert.match(source, /useDeliveryReview/);
	assert.doesNotMatch(source, /useOpenFile/);
	assert.doesNotMatch(file, /bridge\.git/);
	const card = await readFile(new URL("../src/features/conversation/TurnDelivery.tsx", import.meta.url), "utf8");
	// 认的是「开的是这一轮的 diff 面板」，不是某一个函数名——分屏之后这些入口改走
	// 认 scope 的 openScopedPanel，语义没变。
	assert.match(card, /open\w*\("delivery"\)/);
	assert.doesNotMatch(card, /open\w*\("review"\)/);
});

test("a mouse click on a file row does not open the hover preview", async () => {
	const card = await readFile(new URL("../src/features/conversation/TurnDelivery.tsx", import.meta.url), "utf8");
	assert.match(card, /onPointerDown=\{\(\) => hideHover\(\)\}/, "press must cancel a pending hover before focus");
	assert.match(card, /matches\(":focus-visible"\)/, "mouse focus must not open the preview");
	assert.doesNotMatch(
		card,
		/onFocus=\{\(event\) => \{ keepHover\(\); setHover/,
		"unconditional focus-open is the click flash",
	);
});
