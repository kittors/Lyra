/**
 * The current branch's row has no hover buttons, so on hover its name gives way nothing.
 *
 * It used to write a fixed 36px onto `--ly-row-controls`. With no strip there to measure it, the
 * mask cleared 36px off the name's tail on hover, and `ScrollText` counted that run as unreadable:
 * a name that fits its box lost its last letters and started scrolling the moment it was hovered.
 * Rows with buttons are the other half of the rule: the strip measures how much of the name it
 * covers, and that is exactly what they give way.
 *
 * happy-dom does no layout and does not inherit custom properties. The geometry is the real
 * window's (a 300px Git panel, see `e2e/branch-row-hover-probe.ts`): the name box runs 934–1184,
 * or 934–1142 once the "current" tag takes its place, and three buttons start at 1108. Inheritance
 * is patched in, and ResizeObserver is replaced by one that fires only when a test says a size
 * changed, notifying just the observers watching that element, as a browser would.
 */

import assert from "node:assert/strict";
import { beforeEach, test, type TestContext } from "node:test";
import { act, createElement as h } from "react";
import { BranchRow } from "../../src/features/git/BranchRow.tsx";
import { mount } from "../helpers/mount.ts";

/** 195px in the real window: it fits the current row's 208px box, with under 36px to spare. */
const NAME = "fix/current-branch-row-fade";
const geometry = { titleLeft: 934, titleRight: 1184, stripLeft: 1108, stripRight: 1190, text: 195 };

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

function resized(target: Element) {
	return act(async () => {
		for (const observer of RecordingObserver.live) {
			if (observer.targets.has(target)) observer.callback([], observer as unknown as ResizeObserver);
		}
	});
}

function layout(t: TestContext) {
	RecordingObserver.live = [];
	replace(t, globalThis, "ResizeObserver", { value: RecordingObserver, writable: true });
	const rect = (left: number, right: number) => new DOMRect(left, 0, right - left, 26);
	replace(t, HTMLElement.prototype, "getBoundingClientRect", {
		value(this: HTMLElement) {
			if (this.hasAttribute("data-ly-hover-reveal")) return rect(geometry.stripLeft, geometry.stripRight);
			if (this.classList.contains("ly-fade-tail")) return rect(geometry.titleLeft, geometry.titleRight);
			return rect(0, 0);
		},
	});
	// ScrollText compares layout sizes: the name box's clientWidth against the text's offsetWidth.
	replace(t, HTMLElement.prototype, "clientWidth", {
		get(this: HTMLElement) {
			return this.classList.contains("ly-fade-tail") ? geometry.titleRight - geometry.titleLeft : 0;
		},
	});
	replace(t, HTMLElement.prototype, "offsetWidth", {
		get(this: HTMLElement) {
			const inTitle = this.parentElement?.parentElement?.classList.contains("ly-fade-tail");
			return inTitle && !this.hasAttribute("data-ly-scroll-dup") ? geometry.text : 0;
		},
	});
	// ScrollText reads `--ly-row-controls` on the name box, and it is written on the row above it.
	const original = globalThis.getComputedStyle;
	replace(t, globalThis, "getComputedStyle", {
		writable: true,
		value: (el: Element, pseudo?: string | null) =>
			new Proxy(original(el, pseudo), {
				get(target, key) {
					if (key === "getPropertyValue") {
						return (name: string) => {
							const own = target.getPropertyValue(name);
							if (own || !name.startsWith("--")) return own;
							for (let at = el.parentElement; at; at = at.parentElement) {
								const value = at.style.getPropertyValue(name);
								if (value) return value;
							}
							return "";
						};
					}
					const value = Reflect.get(target, key, target);
					return typeof value === "function" ? value.bind(target) : value;
				},
			}),
	});
}

const noop = () => {};

beforeEach(() => {
	Object.assign(geometry, { titleLeft: 934, titleRight: 1184, stripLeft: 1108, stripRight: 1190, text: 195 });
});

test("the current branch gives way nothing on hover, so a name that fits never scrolls", async (t) => {
	layout(t);
	geometry.titleRight = 1142;
	const view = await mount(h(BranchRow, { name: NAME, current: true, busy: false, onSwitch: noop }));
	try {
		assert.equal(view.find("[data-ly-hover-row]").style.getPropertyValue("--ly-row-controls"), "0px");
		// 195px of name in a 208px box, and nothing lands on it on hover: no scroll, no standing fade.
		const title = view.find(".ly-fade-tail");
		assert.equal(title.getAttribute("data-ly-scroll-fit"), null);
		assert.doesNotMatch(title.className, /\bly-fade-edge\b/);
	} finally {
		await view.unmount();
	}
});

test("rows with buttons give way what the strip covers, and switching to one drops it to nothing", async (t) => {
	layout(t);
	const view = await mount(h(BranchRow, { name: NAME, current: false, busy: false, onSwitch: noop, onCompare: noop, onDelete: noop }));
	try {
		const row = view.find("[data-ly-hover-row]");
		const title = view.find(".ly-fade-tail");
		// Measured, not the 68px three-button fallback: the strip starts at 1108 over a box ending at 1184.
		assert.equal(row.style.getPropertyValue("--ly-row-controls"), "76px");
		// 250 − 76 = 174px readable under the buttons, so the 195px name yields and reads itself out.
		assert.equal(title.getAttribute("data-ly-scroll-fit"), "yield");

		// Switched to: the strip goes, the tag pushes in and the box narrows. The row keeps its node.
		await view.rerender(h(BranchRow, { name: NAME, current: true, busy: false, onSwitch: noop }));
		assert.equal(view.all("[data-ly-hover-reveal]").length, 0);
		geometry.titleRight = 1142;
		await resized(title);

		assert.equal(row.style.getPropertyValue("--ly-row-controls"), "0px");
		assert.equal(title.getAttribute("data-ly-scroll-fit"), null);
	} finally {
		await view.unmount();
	}
});
