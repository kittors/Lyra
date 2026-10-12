/**
 * However a popover is closed, its exit plays — and what plays it is gone afterwards.
 *
 * Two things used to cut it short. Closing from outside the popover — the trigger pressed again, a
 * row that calls `onClose`, a hover preview whose state goes null — unmounts it on the spot, so it
 * vanished in one frame; now it leaves an inert copy behind to fade (`afterimage.ts`). And the exits
 * it did play were ended by a 120ms timer, which the phone's 150ms exit outlasted: it was cut off at
 * half opacity. Now the exit's own `animationend` ends it.
 *
 * happy-dom runs no CSS animations, so the tests say which elements are animating by answering
 * `getAnimations` for them, and deliver the `animationend` the browser would have.
 */

import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { act, createElement as h } from "react";

import { leaveAfterimage } from "../../src/ui/overlay/afterimage.ts";
import { Popover } from "../../src/ui/overlay/Popover.tsx";
import { fire, mount, press } from "../helpers/mount.ts";

/** Which elements count as animating: by default, anything playing an exit. */
function animating(t: TestContext, which: (element: Element) => boolean = (element) => element.classList.contains("ly-pop-out")) {
	const previous = Object.getOwnPropertyDescriptor(Element.prototype, "getAnimations");
	Object.defineProperty(Element.prototype, "getAnimations", {
		configurable: true,
		writable: true,
		value(this: Element) {
			return which(this) ? [{ playState: "running" }] : [];
		},
	});
	t.after(() => {
		if (previous) Object.defineProperty(Element.prototype, "getAnimations", previous);
	});
}

function ended(target: Element, animationName: string): Promise<void> {
	return fire(target, new window.AnimationEvent("animationend", { animationName, bubbles: true }) as unknown as Event);
}

/** A menu with every kind of name a lookup could find it by. */
function content() {
	return h(
		"div",
		null,
		h("input", { id: "probe-search", name: "query", "aria-label": "搜索", defaultValue: "pro" }),
		h("button", { type: "button", role: "menuitem", "aria-checked": true }, "第一项"),
		h("span", { "data-spinner": "" }, "…"),
	);
}

function Menu({ open, anchor, onClose }: { open: boolean; anchor: HTMLElement; onClose: () => void }) {
	return open ? h(Popover, { anchor, onClose, label: "测试菜单", children: content() }) : null;
}

async function opened(t: TestContext, onClose: () => void = () => {}) {
	const anchor = document.createElement("button");
	document.body.append(anchor);
	const view = await mount(h(Menu, { open: true, anchor, onClose }));
	t.after(async () => {
		await view.unmount();
		anchor.remove();
		for (const ghost of document.querySelectorAll("[data-ly-popover-ghost]")) ghost.remove();
		delete document.documentElement.dataset.reduceMotion;
	});
	const card = document.querySelector<HTMLElement>("[data-ly-popover]");
	assert.ok(card, "the popover was not drawn");
	return { anchor, view, card };
}

test("Escape closes when the exit's own end arrives, not when a timer guesses it has", async (t) => {
	animating(t);
	let closes = 0;
	const { card } = await opened(t, () => closes++);

	await press(document.body, "Escape");
	assert.ok(card.classList.contains("ly-pop-out"), "the exit starts at once");
	// Past the old 120ms and past the phone's 150ms: still fading, so still open.
	await act(() => new Promise((resolve) => setTimeout(resolve, 200)));
	assert.equal(closes, 0, "closed before its exit had finished");

	await ended(card, "ly-pop-in");
	await ended(card.querySelector("[data-spinner]")!, "ly-pop-out");
	assert.equal(closes, 0, "an entrance, or something inside it, ending is not the exit ending");

	await ended(card, "ly-phone-pop-out");
	assert.equal(closes, 1, "the exit's end closes it, once");
});

test("where nothing animates, Escape does not wait for an end that will never come", async (t) => {
	let closes = 0;
	await opened(t, () => closes++);
	await press(document.body, "Escape");
	assert.equal(closes, 1);
});

test("closed by its caller, it leaves a copy that plays the exit and can be found by nothing", async (t) => {
	animating(t);
	const { anchor, view } = await opened(t);

	await view.rerender(h(Menu, { open: false, anchor, onClose: () => {} }));

	assert.ok(!document.querySelector("[data-ly-popover]"), "the popover itself is gone at once");
	const ghost = document.querySelector<HTMLElement>("[data-ly-popover-ghost]");
	assert.ok(ghost, "nothing was left to play the exit");
	assert.ok(ghost.classList.contains("ly-pop-out") && !ghost.classList.contains("ly-pop-in"), ghost.className);
	assert.equal(ghost.inert, true, "the copy must not take focus or clicks");
	assert.equal(ghost.getAttribute("aria-hidden"), "true");
	assert.equal(ghost.style.pointerEvents, "none");
	assert.equal(ghost.style.opacity, "1", "it fades from where the card was");
	assert.equal(ghost.textContent?.includes("第一项"), true, "it is a picture of the menu");
	const everything: Element[] = [ghost, ...ghost.querySelectorAll("*")];
	for (const element of everything) {
		const kept: string[] = element
			.getAttributeNames()
			.filter((attribute) => ["id", "name", "role"].includes(attribute) || (attribute.startsWith("aria-") && !(element === ghost && attribute === "aria-hidden")));
		assert.deepEqual(kept, [], `<${element.tagName.toLowerCase()}> kept ${kept.join(", ")}`);
	}
	assert.ok(!document.querySelector('[role="menuitem"], [role="menu"], #probe-search'), "a lookup in the document found the copy");

	await ended(ghost.querySelector("[data-spinner]")!, "ly-spin");
	assert.ok(ghost.isConnected, "something inside it ending is not its exit ending");
	await ended(ghost, "ly-pop-out");
	assert.ok(!ghost.isConnected, "the copy outlived its exit");
});

test("a copy that never hears its exit end is removed anyway", async (t) => {
	animating(t);
	const { anchor, view } = await opened(t);
	await view.rerender(h(Menu, { open: false, anchor, onClose: () => {} }));
	const ghost = document.querySelector("[data-ly-popover-ghost]");
	assert.ok(ghost);
	await act(() => new Promise((resolve) => setTimeout(resolve, 700)));
	assert.ok(!ghost.isConnected, "a hidden window never delivers the event, and the copy stayed");
});

test("no copy where it would not be seen, or could not be copied", async (t) => {
	// Reduced motion: an exit of 0.01ms is not worth a copy of the menu.
	animating(t);
	const first = await opened(t);
	document.documentElement.dataset.reduceMotion = "on";
	await first.view.rerender(h(Menu, { open: false, anchor: first.anchor, onClose: () => {} }));
	assert.ok(!document.querySelector("[data-ly-popover-ghost]"), "copied under reduced motion");
	delete document.documentElement.dataset.reduceMotion;

	// A frame inside would load again, and a canvas would come out blank.
	const anchor = document.createElement("button");
	document.body.append(anchor);
	const framed = await mount(h(Popover, { anchor, onClose: () => {}, children: h("iframe", { title: "x" }) }));
	await framed.rerender(null);
	assert.ok(!document.querySelector("[data-ly-popover-ghost]"), "copied a popover holding a frame");
	await framed.unmount();
	anchor.remove();
});

test("where nothing animates, a copy is not even left for a moment", async (t) => {
	const { anchor, view } = await opened(t);
	await view.rerender(h(Menu, { open: false, anchor, onClose: () => {} }));
	assert.ok(!document.querySelector("[data-ly-popover-ghost]"));
});

test("a cleanup that is not a removal leaves no copy (StrictMode, a hidden Activity)", async (t) => {
	animating(t);
	const card = document.createElement("div");
	card.className = "ly-menu-card ly-pop-in";
	card.style.opacity = "1";
	document.body.append(card);
	t.after(() => card.remove());
	leaveAfterimage(card);
	await act(async () => {});
	assert.ok(!document.querySelector("[data-ly-popover-ghost]"), "a card still on screen got a stand-in");
});

test("a popover whose anchor leaves the document closes, from where it was", async (t) => {
	let closes = 0;
	const { anchor, card } = await opened(t, () => closes++);
	const placed = { left: card.style.left, top: card.style.top, bottom: card.style.bottom };
	anchor.remove();
	await act(async () => {
		window.dispatchEvent(new Event("resize"));
		await new Promise((resolve) => setTimeout(resolve, 40));
	});
	assert.equal(closes, 1, "kept pointing at nothing");
	assert.deepEqual({ left: card.style.left, top: card.style.top, bottom: card.style.bottom }, placed, "thrown somewhere on its way out");
});
