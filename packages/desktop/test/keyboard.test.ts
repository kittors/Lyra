/**
 * Working out how much of the window the keyboard is sitting on.
 *
 * The failure this prevents is not subtle — the composer ends up under the keyboard and you type
 * into a field you cannot see — but the arithmetic has to hold across two different things phones
 * do when a field is focused, and has to ignore several smaller shifts that look the same.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { keyboardInset, watchKeyboard } from "../src/mobile/keyboard.ts";

/** An iPhone 14-ish window. */
const WINDOW = 844;

test("no keyboard, nothing reserved", () => {
	assert.equal(keyboardInset({ height: WINDOW, offsetTop: 0 }, WINDOW), 0);
});

test("a keyboard that shortens the viewport is measured", () => {
	assert.equal(keyboardInset({ height: 508, offsetTop: 0 }, WINDOW), 336);
});

test("a viewport pushed down to reveal the field is measured from where it now ends", () => {
	/*
	 * iOS does not only shorten the visual viewport — it also slides it down the page to bring the
	 * focused field into view. What has to be reserved is the gap between where that viewport now
	 * ends and the bottom of the layout the composer is positioned in, which is less than the
	 * keyboard's own height. Subtracting only the height over-reserves by `offsetTop` and leaves a
	 * band of empty page above the keyboard.
	 */
	assert.equal(keyboardInset({ height: 508, offsetTop: 100 }, WINDOW), 236);
});

test("the two effects together, which is what a mid-animation frame looks like", () => {
	assert.equal(keyboardInset({ height: 600, offsetTop: 144 }, WINDOW), 100);
});

test("a collapsing address bar is not a keyboard", () => {
	// Small shifts happen while scrolling. Reserving space for them makes the composer twitch under
	// the reader's thumb.
	assert.equal(keyboardInset({ height: WINDOW - 60, offsetTop: 0 }, WINDOW), 0);
});

test("nor is an accessory strip appearing by itself", () => {
	assert.equal(keyboardInset({ height: WINDOW - 44, offsetTop: 0 }, WINDOW), 0);
});

test("a real keyboard clears the threshold on the smallest phone worth supporting", () => {
	// An iPhone SE with the shortest keyboard still covers far more than the floor.
	assert.ok(keyboardInset({ height: 667 - 260, offsetTop: 0 }, 667) > 0);
});

test("a viewport larger than the window reserves nothing rather than a negative", () => {
	// Rounding between the two measurements can put the viewport a pixel over; a negative padding
	// would be dropped by CSS, but a negative in a calc() takes the layout with it.
	assert.equal(keyboardInset({ height: WINDOW + 2, offsetTop: 0 }, WINDOW), 0);
});

test("a zoomed page is not read as a keyboard", () => {
	// Magnification shrinks the visual viewport for an unrelated reason, and the difference is
	// easily keyboard-sized.
	assert.equal(keyboardInset({ height: 400, offsetTop: 0, scale: 2 }, WINDOW), 0);
	// A scale of 1 with float noise is still no zoom.
	assert.equal(keyboardInset({ height: 508, offsetTop: 0, scale: 1.0000001 }, WINDOW), 336);
});

test("no viewport API at all means no reservation", () => {
	// The desktop renderer runs this same code; there the keyboard is a hardware object that covers
	// nothing.
	assert.equal(keyboardInset(undefined, WINDOW), 0);
});

test("the result is a whole number of pixels", () => {
	// Fractional device pixels are a real reading, and a fractional reservation on a bottom edge
	// leaves a hairline of the transcript showing through beneath the composer.
	assert.equal(keyboardInset({ height: 507.5, offsetTop: 0 }, WINDOW), 337);
});

/*
 * The wiring, which is where the failures actually live.
 *
 * The arithmetic above is the easy half. What goes wrong in practice is subscribing to the wrong
 * event and missing the phones that slide the viewport rather than shrink it, or leaving the
 * variable behind on unmount so a window keeps a keyboard's worth of padding it no longer needs.
 */

/** A viewport that can be moved, and remembers who is listening. */
function fakeHost(height: number, windowHeight: number) {
	const listeners: Record<string, (() => void)[]> = {};
	const viewport = {
		height,
		offsetTop: 0,
		addEventListener(type: string, handler: () => void) {
			(listeners[type] ??= []).push(handler);
		},
		removeEventListener(type: string, handler: () => void) {
			listeners[type] = (listeners[type] ?? []).filter((h) => h !== handler);
		},
	};
	return {
		host: { viewport, innerHeight: windowHeight },
		viewport,
		fire: (type: string) => (listeners[type] ?? []).forEach((h) => h()),
		listening: (type: string) => (listeners[type] ?? []).length,
	};
}

function fakeTarget() {
	const props: Record<string, string> = {};
	const attrs = new Set<string>();
	return {
		props,
		attrs,
		target: {
			style: {
				setProperty: (name: string, value: string) => {
					props[name] = value;
				},
				removeProperty: (name: string) => {
					delete props[name];
				},
			},
			toggleAttribute: (name: string, force: boolean) => (force ? attrs.add(name) : attrs.delete(name)),
			removeAttribute: (name: string) => attrs.delete(name),
		},
	};
}

test("the variable is written straight away, not on the first event", () => {
	// A phone can be rotated or the page reloaded with the keyboard already up; waiting for an event
	// would leave the composer underneath it until something else happened to move.
	const { host } = fakeHost(508, WINDOW);
	const { props, target } = fakeTarget();
	watchKeyboard(host, target);
	assert.equal(props["--ly-keyboard"], "336px");
});

test("both the shrink and the slide are subscribed to", () => {
	// Only `resize` misses the devices that scroll the viewport instead of shortening it.
	const { host, listening } = fakeHost(WINDOW, WINDOW);
	watchKeyboard(host, fakeTarget().target);
	assert.equal(listening("resize"), 1);
	assert.equal(listening("scroll"), 1);
});

test("a keyboard opening and closing is followed", () => {
	const { host, viewport, fire } = fakeHost(WINDOW, WINDOW);
	const { props, attrs, target } = fakeTarget();
	watchKeyboard(host, target);
	assert.equal(props["--ly-keyboard"], "0px");
	assert.equal(attrs.has("data-keyboard"), false);

	viewport.height = 508;
	fire("resize");
	assert.equal(props["--ly-keyboard"], "336px");
	assert.equal(attrs.has("data-keyboard"), true, "键盘起来了，样式要知道");

	viewport.height = WINDOW;
	fire("resize");
	assert.equal(props["--ly-keyboard"], "0px");
	assert.equal(attrs.has("data-keyboard"), false, "键盘收了，标记要跟着撤掉");
});

test("stopping puts everything back", () => {
	/*
	 * The hook stops when the host stops being a phone — which happens on the desktop the moment
	 * this ships there. A leftover reservation would be a band of empty page above the composer that
	 * nothing explains and nothing clears.
	 */
	const { host, viewport, fire, listening } = fakeHost(508, WINDOW);
	const { props, attrs, target } = fakeTarget();
	const stop = watchKeyboard(host, target);
	assert.equal(attrs.has("data-keyboard"), true);

	stop();
	assert.equal(props["--ly-keyboard"], undefined);
	assert.equal(attrs.has("data-keyboard"), false);
	assert.equal(listening("resize"), 0);
	assert.equal(listening("scroll"), 0);

	// And a late event changes nothing, rather than reviving the variable.
	viewport.height = 400;
	fire("resize");
	assert.equal(props["--ly-keyboard"], undefined);
});

test("a host with no viewport API is a no-op that is still safe to stop", () => {
	const stop = watchKeyboard({ viewport: null, innerHeight: WINDOW }, fakeTarget().target);
	assert.doesNotThrow(stop);
});
