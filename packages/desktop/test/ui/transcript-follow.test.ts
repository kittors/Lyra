import assert from "node:assert/strict";
import { act, createElement as h } from "react";
import { test } from "node:test";
import { useFollowBottom, type FollowBottom } from "../../src/ui/scroll/useFollowBottom.ts";
import { writeFollow, readFollow } from "../../src/ui/scroll/memory.ts";
import { mount } from "../helpers/mount.ts";

let controls: FollowBottom;
let contentHeight = 2400;
let viewportHeight = 400;

// Geometry is controlled here because happy-dom does not perform browser layout.
function Harness({ id, ready = true }: { id: string; ready?: boolean }) {
	const follow = useFollowBottom({
		surfaceId: id,
		namespace: "follow-test",
		count: ready ? 40 : 0,
		tail: "same",
		ready,
	});
	controls = follow;
	return h(
		"div",
		{ className: "ly-scroll-host" },
		h(
			"div",
			{
				className: "ly-scroll-view",
				ref: (el: HTMLDivElement | null) => {
					follow.scrollRef.current = el;
					if (!el) return;
					let top = el.scrollTop;
					Object.defineProperties(el, {
						clientHeight: { configurable: true, get: () => viewportHeight },
						scrollHeight: { configurable: true, get: () => (ready ? contentHeight : viewportHeight) },
						scrollTop: {
							configurable: true,
							get: () => top,
							set: (value: number) => {
								top = Math.max(
									0,
									Math.min(value, (ready ? contentHeight : viewportHeight) - viewportHeight),
								);
							},
						},
					});
				},
				onScroll: (event: React.UIEvent<HTMLDivElement>) => follow.onScroll(event.currentTarget),
			},
			h("div", { ref: follow.tailRef }),
		),
	);
}

test("a saved position is restored after asynchronous content, never against the placeholder", async () => {
	writeFollow("follow-test", "cold", { following: false, scrollTop: 900, seen: null });
	const view = await mount(h(Harness, { id: "cold", ready: false }));
	assert.equal(view.find(".ly-scroll-view").scrollTop, 0);
	await view.rerender(h(Harness, { id: "cold", ready: true }));
	assert.equal(view.find(".ly-scroll-view").scrollTop, 900);
	await view.unmount();
	assert.equal(readFollow("follow-test", "cold")?.scrollTop, 900);
});

test("leaving a loading session preserves its saved reading position", async () => {
	writeFollow("follow-test", "loading", { following: false, scrollTop: 700, seen: null });
	const view = await mount(h(Harness, { id: "loading", ready: false }));
	await view.rerender(h(Harness, { id: "elsewhere" }));
	assert.equal(readFollow("follow-test", "loading")?.scrollTop, 700);
	await view.unmount();
});

test("an in-progress return animation cannot scroll the next session", async () => {
	writeFollow("follow-test", "ride", { following: false, scrollTop: 600, seen: null });
	writeFollow("follow-test", "reader", { following: false, scrollTop: 800, seen: null });
	const view = await mount(h(Harness, { id: "ride" }));
	await act(async () => controls.returnToBottom());
	await view.rerender(h(Harness, { id: "reader" }));
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 70));
	});
	assert.equal(view.find(".ly-scroll-view").scrollTop, 800);
	assert.equal(readFollow("follow-test", "ride")?.following, true, "returning is an intention to follow the end");
	await view.unmount();
});

test("a pane mounted while hidden restores when it becomes measurable", async () => {
	writeFollow("follow-test", "hidden", { following: false, scrollTop: 500, seen: null });
	viewportHeight = 0;
	const view = await mount(h(Harness, { id: "hidden" }));
	viewportHeight = 400;
	await act(async () => controls.onResize(view.find<HTMLDivElement>(".ly-scroll-view")));
	assert.equal(view.find(".ly-scroll-view").scrollTop, 500);
	await view.unmount();
});

test("keyboard scrolling detaches from future content growth", async () => {
	const view = await mount(h(Harness, { id: "keyboard" }));
	const el = view.find<HTMLDivElement>(".ly-scroll-view");
	assert.equal(el.scrollTop, 2000, "new conversations follow the end");
	await act(async () => {
		el.dispatchEvent(new KeyboardEvent("keydown", { key: "PageUp", bubbles: true }));
		el.scrollTop = 1600;
		controls.onScroll(el);
		contentHeight += 300;
		controls.onResize(el);
	});
	assert.equal(el.scrollTop, 1600);
	await view.unmount();
	contentHeight = 2400;
});

test("the app's reduce-motion preference makes return to bottom immediate", async () => {
	document.documentElement.dataset.reduceMotion = "on";
	writeFollow("follow-test", "reduced", { following: false, scrollTop: 600, seen: null });
	const view = await mount(h(Harness, { id: "reduced" }));
	try {
		await act(async () => controls.returnToBottom());
		assert.equal(view.find(".ly-scroll-view").scrollTop, 2000);
	} finally {
		await view.unmount();
		delete document.documentElement.dataset.reduceMotion;
	}
});
