/**
 * A wide table in a reply, and the two ways out of it.
 *
 * happy-dom has no layout, so every box measures zero and nothing ever appears to overflow — which
 * is exactly the condition the control keys off. So the width is faked on the prototype for the
 * tests that need a table wider than its column, and left alone for the one that needs a narrow
 * one: a table that fits must not grow a control it has no use for.
 *
 * Whether the thumb is *visible* at the right moment is a question about `:hover` and paint, and it
 * is measured in the running window instead.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement as h } from "react";
import { Markdown } from "../../src/features/conversation/Markdown.tsx";
import { click, mount } from "../helpers/mount.ts";

const TABLE = ["| 字段 | 本次处理 |", "| --- | --- |", "| User-Agent | 统一网页与原生请求 |"].join("\n");

/** Every element wider than its box, until the returned function puts the DOM back. */
function widen(): () => void {
	const proto = globalThis.HTMLElement.prototype;
	const saved = ["scrollWidth", "clientWidth"].map((name) => [name, Object.getOwnPropertyDescriptor(proto, name)] as const);
	Object.defineProperty(proto, "scrollWidth", { configurable: true, get: () => 900 });
	Object.defineProperty(proto, "clientWidth", { configurable: true, get: () => 300 });
	return () => {
		for (const [name, descriptor] of saved) {
			if (descriptor) Object.defineProperty(proto, name, descriptor);
			else Reflect.deleteProperty(proto, name);
		}
	};
}

test("a table scrolls inside a frame the thumb and the wrap control can be pinned to", async () => {
	const restore = widen();
	const view = await mount(h(Markdown, { text: TABLE }));
	try {
		const host = view.find(".ly-table");
		const scroller = view.find(".ly-table-scroll");
		// The frame does not scroll and the box inside it does; a control pinned to the scrolling
		// one would slide away with the content it is meant to act on.
		assert.equal(scroller.parentElement, host);
		assert.equal(scroller.querySelector("table")?.tagName, "TABLE");
		assert.equal(host.getAttribute("data-wrap"), "false");
		// The app's own thumb, since the native one is off everywhere.
		assert.ok(host.querySelector(".ly-hthumb"));

		/*
		 * The control is inside the frame and outside the scroller, and nothing else will do.
		 *
		 * Inside the scroller, the content slides underneath it: clear at the left edge, over a
		 * header cell two hundred pixels along. This is the structural half of "never covers a
		 * cell" — the geometric half is measured in the running window.
		 */
		const toggle = view.find(".ly-table-toggle button");
		assert.equal(scroller.contains(toggle), false);
		assert.equal(host.contains(toggle), true);
		assert.ok(view.find(".ly-table-bar").contains(toggle));
	} finally {
		await view.unmount();
		restore();
	}
});

test("the wrap control flips the flag the cells are styled from, and offers the way back", async () => {
	const restore = widen();
	const view = await mount(h(Markdown, { text: TABLE }));
	try {
		const host = view.find(".ly-table");
		const before = view.find(".ly-table-toggle button").getAttribute("aria-label");

		await click(view.find(".ly-table-toggle button"));
		assert.equal(host.getAttribute("data-wrap"), "true");
		// Pressed, and relabelled — a toggle that still says 「自动换行」 once wrapped is a control
		// you cannot undo by reading it.
		assert.equal(view.find(".ly-table-toggle button").getAttribute("aria-pressed"), "true");
		assert.notEqual(view.find(".ly-table-toggle button").getAttribute("aria-label"), before);

		await click(view.find(".ly-table-toggle button"));
		assert.equal(host.getAttribute("data-wrap"), "false");
	} finally {
		await view.unmount();
		restore();
	}
});

test("a table that fits its column offers no control, and an excerpt offers none either", async () => {
	const narrow = await mount(h(Markdown, { text: TABLE }));
	try {
		assert.ok(narrow.find(".ly-table-scroll table"));
		assert.equal(narrow.host.querySelector(".ly-table-toggle"), null);
	} finally {
		await narrow.unmount();
	}

	const restore = widen();
	const excerpt = await mount(h(Markdown, { text: TABLE, preview: true }));
	try {
		assert.ok(excerpt.find(".ly-table-scroll table"));
		assert.equal(excerpt.host.querySelector(".ly-table-toggle"), null);
		assert.equal(excerpt.host.querySelector(".ly-hthumb"), null);
	} finally {
		await excerpt.unmount();
		restore();
	}
});
