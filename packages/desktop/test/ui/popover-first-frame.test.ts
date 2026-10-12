/**
 * A menu with a ceiling opens where it is going to stay.
 *
 * The project menu prefers the side above its chip; on the new-chat page there is no room there, so
 * it hangs below. It used to get there one frame late. The first measurement ran before the menu's
 * ceiling was on it, read fifteen projects at full length (596px), found that fitting neither side,
 * and slid the card into the window over the chip. The ceiling landed with that placement, the
 * observer measured again, 340px fitted below, and the menu dropped — on every open.
 *
 * happy-dom does no layout, so the card's height is patched to behave as the browser's does: its
 * full length until a `max-height` is on it, then capped by it. The observer fires only when the
 * test says, and the frame it schedules runs on the shim's 16ms timer. Geometry is the recorded
 * window's: 790px tall, the chip from 357 to 383.
 */

import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { act, createElement as h } from "react";

import { Popover } from "../../src/ui/overlay/Popover.tsx";
import { mount } from "../helpers/mount.ts";

const WINDOW = { width: 1072, height: 790 };
/** Fifteen rows, the search field and the two footer actions, laid out with nothing capping them. */
const FULL_HEIGHT = 596;
const CEILING = 340;
const GAP = 8;

function replace(t: TestContext, target: object, key: PropertyKey, descriptor: PropertyDescriptor) {
	const previous = Object.getOwnPropertyDescriptor(target, key);
	Object.defineProperty(target, key, { configurable: true, ...descriptor });
	t.after(() => {
		if (previous) Object.defineProperty(target, key, previous);
		else Reflect.deleteProperty(target, key);
	});
}

class RecordingObserver {
	static live: RecordingObserver[] = [];
	readonly targets = new Set<Element>();
	constructor(readonly callback: ResizeObserverCallback) {
		RecordingObserver.live.push(this);
	}
	observe(target: Element) {
		this.targets.add(target);
	}
	unobserve(target: Element) {
		this.targets.delete(target);
	}
	disconnect() {
		this.targets.clear();
	}
}

function layout(t: TestContext) {
	RecordingObserver.live = [];
	replace(t, globalThis, "ResizeObserver", { value: RecordingObserver, writable: true });
	replace(t, window, "innerHeight", { value: WINDOW.height, writable: true });
	replace(t, window, "innerWidth", { value: WINDOW.width, writable: true });
	replace(t, HTMLElement.prototype, "offsetHeight", {
		get(this: HTMLElement) {
			if (!this.hasAttribute("data-ly-popover")) return 0;
			const ceiling = Number.parseFloat(this.style.maxHeight);
			return Number.isFinite(ceiling) ? Math.min(FULL_HEIGHT, ceiling) : FULL_HEIGHT;
		},
	});
	replace(t, HTMLElement.prototype, "offsetWidth", {
		get(this: HTMLElement) {
			return this.hasAttribute("data-ly-popover") ? Number.parseFloat(this.style.width) || 0 : 0;
		},
	});
}

/** The observer's first report, and the frame it schedules — where the browser measured again. */
function nextFrame(card: Element) {
	return act(async () => {
		for (const observer of RecordingObserver.live) {
			if (observer.targets.has(card)) observer.callback([], observer as unknown as ResizeObserver);
		}
		await new Promise((resolve) => setTimeout(resolve, 40));
	});
}

/** Where the card's top edge is, whichever edge it was pinned by. */
function topOf(card: HTMLElement): number {
	if (card.style.top) return Number.parseFloat(card.style.top);
	return WINDOW.height - Number.parseFloat(card.style.bottom) - Math.min(FULL_HEIGHT, CEILING);
}

async function open(t: TestContext, chipTop: number) {
	layout(t);
	const chip = document.createElement("button");
	chip.getBoundingClientRect = () => new DOMRect(408, chipTop, 112, 26);
	document.body.append(chip);
	const view = await mount(
		h(Popover, { anchor: chip, onClose: () => {}, placement: "top", align: "start", width: "wide", maxHeight: CEILING, children: "projects" }),
	);
	t.after(async () => {
		await view.unmount();
		chip.remove();
	});
	const card = document.querySelector<HTMLElement>("[data-ly-popover]");
	assert.ok(card, "the menu was not drawn");
	return card;
}

test("with no room above, the first frame already hangs below the chip", async (t) => {
	const card = await open(t, 357);
	const first = topOf(card);
	await nextFrame(card);

	assert.equal(first, 357 + 26 + GAP, `first frame at ${first}, not under the chip`);
	assert.equal(topOf(card), first, `measured again, it moved from ${first} to ${topOf(card)}`);
});

test("with room above, the first frame already opens above the chip", async (t) => {
	// Lower in the window, where a composer at the bottom of a conversation puts it.
	const card = await open(t, 600);
	const first = topOf(card);
	await nextFrame(card);

	assert.equal(first, 600 - GAP - CEILING, `first frame at ${first}, not above the chip`);
	assert.equal(topOf(card), first, `measured again, it moved from ${first} to ${topOf(card)}`);
});
