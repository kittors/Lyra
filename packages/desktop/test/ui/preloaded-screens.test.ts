/**
 * 独立页的代码提前取到了，第一次打开就直接画出来，不再先露一段骨架。
 *
 * 只用 `lazy` 做不到：它的第一次渲染总要挂起一次——哪怕代码早就到了——而 React 19 一旦把骨架露
 * 出来，至少留它 300ms。创作页第一次打开时，骨架从 55ms 一直挂到 355ms，等的是一个几毫秒就到了
 * 的 54KB 分包。
 */

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { createElement as h, Suspense } from "react";
import { preloadableScreen } from "../../src/app/screens.tsx";
import { mount, type Mounted } from "../helpers/mount.ts";

let view: Mounted | undefined;
let skeletons = 0;

afterEach(async () => {
	await view?.unmount();
	view = undefined;
	skeletons = 0;
});

function Skeleton() {
	skeletons++;
	return h("i", { "data-skeleton": "" });
}

const page = () =>
	function Page() {
		return h("p", { "data-page": "" }, "page");
	};

const shown = (screen: { View: React.ComponentType }) => mount(h(Suspense, { fallback: h(Skeleton) }, h(screen.View)));

test("代码已经取到的页面：第一次渲染就是它，骨架一次也没画", async () => {
	const screen = preloadableScreen(async () => page());
	await screen.preload();
	view = await shown(screen);
	assert.ok(view.find("[data-page]"));
	assert.equal(skeletons, 0, "nothing suspended, so there was no fallback to hold for 300ms");
});

test("代码还在路上的页面：照旧挂起，到了再画", async () => {
	const screen = preloadableScreen(async () => page());
	view = await shown(screen);
	assert.ok(view.find("[data-page]"));
	assert.ok(skeletons > 0, "suspended while the chunk was on its way — what `lazy` is kept for");
});

test("同一页取几次都只发一次请求；失败的那次之后还能再取", async () => {
	let loads = 0;
	let offline = true;
	const screen = preloadableScreen(async () => {
		loads++;
		if (offline) throw new Error("offline");
		return page();
	});
	await assert.rejects(screen.preload());
	offline = false;
	await Promise.all([screen.preload(), screen.preload()]);
	await screen.preload();
	assert.equal(loads, 2);
});
