/**
 * One tooltip for the whole window, driven by an attribute.
 *
 * The React `<Tooltip>` wrapper could only reach elements React renders. CodeMirror builds its
 * search panel itself, so its buttons were stuck with the native `title` — a different shape, a
 * different delay, and the wrong colour against the rest of the app.
 *
 * An attribute works on anything: `data-ly-tip="下一个"` on a React node or on a DOM node
 * CodeMirror just created behaves identically, because the thing that shows the bubble is a
 * single listener on the document rather than a component per target.
 */

import { shortcutLabel } from "../keyboard.ts";
import { hoverLayersSuppressed, onHoverLayersDismissed } from "./hover-layers.ts";

const DELAY_MS = 420;
/** Long enough to be seen leaving, short enough not to trail the pointer. Matches `ly-tip-out`. */
const EXIT_MS = 110;
const GAP = 6;
const MARGIN = 6;
/**
 * Above the sidebar's hover card (210), which is the one other thing the pointer can summon.
 *
 * They meet on a conversation row: resting on the archive icon shows both, and the bubble is
 * centred under an icon a few pixels from the pane's edge while the card starts 8px past it — so
 * 「归档会话」 overhangs the row by just enough to slide under the card. At 200 it lost, and the
 * label naming the button directly beneath the pointer is the more specific of the two.
 *
 * Still under the toasts (1000). CodeMirror's gutters are at 200, which this now clears outright
 * rather than tying with and winning on document order.
 */
const TIP_Z = 220;

let host: HTMLElement | null = null;
let timer = 0;
let leaving = 0;
let current: HTMLElement | null = null;

/*
 * Menus and dialogs are asked about once, in `hover-layers`, rather than looked for here.
 *
 * This used to keep its own flag (set by `Popover` alone) *and* re-run a selector for the class
 * list a popover happens to carry. `Overlay`'s dialogs matched neither, so a modal opened without
 * a click left a bubble hanging over it — while a dialog's own tooltips, which it has plenty of,
 * go on working: a modal clears the screen once rather than suppressing for its lifetime.
 */
onHoverLayersDismissed(hideTooltipImmediate);

function ensureHost(): HTMLElement {
	if (host) return host;
	host = document.createElement("div");
	host.className = "ly-tooltip";
	host.setAttribute("role", "tooltip");
	host.style.position = "fixed";
	host.style.zIndex = String(TIP_Z);
	host.style.pointerEvents = "none";
	host.hidden = true;
	document.body.appendChild(host);
	return host;
}

/**
 * 「只有真被截断时才说」。
 *
 * 一列 `truncate` 的文字里，大多数是完整的——给每一个都挂一个气泡，等于把「这里还有没读到的
 * 字」这个信号稀释成背景噪音，而那恰恰是唯一值得提示的时候。
 *
 * 现场量，不预先算：一个格子截不截断取决于窗口宽度、字体和当下的内容，任何一个变了上次的结论
 * 就过期了。`pointerover` 时量一次是准的，而且只量指针底下那一个。
 */
function truncated(el: HTMLElement): boolean {
	// 四舍五入：分数像素下 scrollWidth 会比 clientWidth 大零点几，那不是截断。
	return Math.round(el.scrollWidth) > Math.round(el.clientWidth);
}

/** The nearest ancestor carrying a tip, so an icon inside a button still counts as the button. */
function targetOf(node: EventTarget | null): HTMLElement | null {
	if (!(node instanceof Element)) return null;
	const el = node.closest<HTMLElement>("[data-ly-tip]");
	if (!el || !el.dataset.lyTip) return null;
	// `data-ly-tip-when="truncated"`：这句话屏幕上已经写着了，只在写不下的时候才重复一遍。
	return el.dataset.lyTipWhen === "truncated" && !truncated(el) ? null : el;
}

interface Box {
	top: number;
	bottom: number;
	left: number;
	width: number;
	height: number;
}

/**
 * Where the bubble goes: centred on the target, on the requested side unless that side is off
 * screen, and never past either edge.
 *
 * Exported and free of the DOM because the flip is the part that is easy to get backwards, and
 * getting it backwards is invisible until someone points at the one control near an edge. It was in
 * fact backwards — every `side="top"` tip rendered below its target — and went unnoticed because a
 * separate bug meant no tooltip appeared at all.
 */
export function tipPlacement(
	target: Box,
	tip: { width: number; height: number },
	side: "top" | "bottom" | "right",
	viewport: { width: number; height: number },
): { left: number; top: number } {
	/*
	 * Beside rather than under, for a column of buttons: a tip below one of the icon rail's buttons
	 * lands on the next button down, which is the one the pointer is about to move to.
	 */
	if (side === "right") {
		const right = target.left + target.width + GAP;
		const left = right + tip.width < viewport.width - MARGIN ? right : Math.max(MARGIN, target.left - tip.width - GAP);
		const middle = target.top + target.height / 2 - tip.height / 2;
		return { left, top: Math.max(MARGIN, Math.min(middle, viewport.height - tip.height - MARGIN)) };
	}
	const below = target.bottom + GAP;
	const above = target.top - tip.height - GAP;
	const fits = side === "bottom" ? below + tip.height < viewport.height - MARGIN : above > MARGIN;
	// The preferred side when it fits, the other one when it does not.
	const preferred = fits === (side === "bottom") ? below : above;
	const top = Math.max(MARGIN, Math.min(preferred, viewport.height - tip.height - MARGIN));

	const centred = target.left + target.width / 2 - tip.width / 2;
	const left = Math.max(MARGIN, Math.min(centred, viewport.width - tip.width - MARGIN));
	return { left, top };
}

/**
 * Where a long label may end a line, beyond what the browser already allows.
 *
 * To the line breaker a path or a filename is one unbroken word — `_`, `.` and `/` are not break
 * opportunities — so a tip naming `REQUIREMENTS_POLICY_PORTAL_v2_final_review_notes.md` filled the
 * width cap and `overflow-wrap` cut it wherever the cap fell, leaving 「d」 alone on the second line.
 * Inside long runs of ASCII (16 characters or more: paths, filenames, URLs, identifiers — not "85.3%"
 * or "v1.2" in a sentence) a line may now end right after any of `/ \ _ - . : ? & = # + @`.
 *
 * Returns the pieces between those places; the caller joins them with `<wbr>`, a break opportunity
 * that adds nothing to the text.
 */
export function softBreaks(text: string): string[] {
	const pieces: string[] = [];
	let from = 0;
	for (const run of text.matchAll(/[!-~]{16,}/g)) {
		for (const mark of run[0].matchAll(/[/\\_.:?&=#+@-](?=[!-~])/g)) {
			const at = run.index + mark.index + 1;
			pieces.push(text.slice(from, at));
			from = at;
		}
	}
	pieces.push(text.slice(from));
	return pieces;
}

/**
 * The narrowest width at which the tip is still no taller than it is at its widest.
 *
 * `max-content` capped by `max-width` fills the first line to the cap and leaves whatever is over for
 * the next one — the filename above came out as a 343px line and a 7px one. Narrowing the bubble
 * until one more pixel would cost a line spreads the text evenly over the lines it needs anyway,
 * whichever break the browser takes, `overflow-wrap`'s break inside a word included. That is also
 * why this is not `text-wrap: balance`: it evens the lines but leaves the box at the cap, with the
 * space beside the shorter lines still inside the bubble.
 *
 * `heightAt` lays the tip out at a width and reports its height. Passed in so the search can be
 * tested without a layout engine.
 */
export function balancedWidth(widest: number, heightAt: (width: number) => number): number {
	const height = heightAt(widest);
	let lo = 0;
	let hi = Math.ceil(widest);
	while (hi - lo > 1) {
		const mid = Math.floor((lo + hi) / 2);
		if (heightAt(mid) <= height) hi = mid;
		else lo = mid;
	}
	return hi;
}

/** The label, with a `<wbr>` wherever `softBreaks` lets a line end. */
function fill(tip: HTMLElement, text: string) {
	const nodes: Node[] = [];
	for (const [index, piece] of softBreaks(text).entries()) {
		if (index > 0) nodes.push(document.createElement("wbr"));
		nodes.push(document.createTextNode(piece));
	}
	tip.replaceChildren(...nodes);
}

/**
 * Narrow the bubble to its balanced width, when the label had to wrap at all.
 *
 * Only then: a label that fits on one line is already as narrow as it gets, and searching for its
 * width would be a dozen layouts for nothing. Lines the caller broke with `\n` do not count as
 * wrapping — `natural` is measured with them in place.
 */
function fit(tip: HTMLElement) {
	tip.style.width = "";
	const widest = tip.offsetWidth;
	tip.style.maxWidth = "none";
	const natural = tip.offsetWidth;
	tip.style.maxWidth = "";
	if (natural <= widest) return;
	const width = balancedWidth(widest, (candidate) => {
		tip.style.width = `${candidate}px`;
		return tip.offsetHeight;
	});
	tip.style.width = `${width}px`;
}

function place(el: HTMLElement) {
	const tip = ensureHost();
	// Cancel a departure in progress, or the bubble would vanish mid-arrival.
	window.clearTimeout(leaving);
	delete tip.dataset.leaving;
	fill(tip, shortcutLabel(el.dataset.lyTip ?? ""));
	tip.hidden = false;
	// Before measuring for placement: the balanced width is the width the bubble is placed with.
	fit(tip);

	const a = el.getBoundingClientRect();
	// Entrance transforms must not shrink the dimensions used to keep the bubble on screen.
	const b = { width: tip.offsetWidth, height: tip.offsetHeight };
	const side = el.dataset.lyTipSide;
	const at = tipPlacement(a, b, side === "top" || side === "right" ? side : "bottom", {
		width: window.innerWidth,
		height: window.innerHeight,
	});
	tip.style.left = `${Math.round(at.left)}px`;
	tip.style.top = `${Math.round(at.top)}px`;
}

/**
 * Fade out rather than disappear.
 *
 * A bubble that is removed on the frame the pointer leaves reads as a glitch — it was there and then
 * it was not, with nothing in between. It also makes moving along a row of buttons flicker, because
 * each tip is torn down instantly before the next fades in.
 *
 * The element stays in the document for the length of the exit and is only hidden afterwards, so a
 * pointer that comes back mid-fade finds it still there and simply cancels the departure.
 */
function hide() {
	window.clearTimeout(timer);
	current = null;
	if (!host || host.hidden || host.dataset.leaving !== undefined) return;
	host.dataset.leaving = "";
	window.clearTimeout(leaving);
	leaving = window.setTimeout(() => {
		if (!host) return;
		host.hidden = true;
		delete host.dataset.leaving;
	}, EXIT_MS);
}

/** Immediately hide the tooltip without playing exit animation. */
function hideTooltipImmediate() {
	window.clearTimeout(timer);
	current = null;
	if (host) {
		window.clearTimeout(leaving);
		host.hidden = true;
		delete host.dataset.leaving;
	}
}

/**
 * Deliberately not shown on focus.
 *
 * Keyboard users get the accessible name from the label, and a bubble that appears while
 * tabbing through a toolbar is noise rather than help.
 */
export function installTooltips() {
	document.addEventListener(
		"pointerover",
		(event) => {
			if (hoverLayersSuppressed()) return;
			const el = targetOf(event.target);
			if (el === current) return;
			hide();
			if (!el) return;
			current = el;
			timer = window.setTimeout(() => {
				// Still under the pointer, and still in the document, by the time the delay is up.
				if (!hoverLayersSuppressed() && current === el && el.isConnected) place(el);
			}, DELAY_MS);
		},
		true,
	);

	// Any of these means the target is gone or no longer the thing being pointed at.
	document.addEventListener("pointerout", (event) => {
		// Moving from a button's label to its icon is still hovering the same target.
		if (targetOf(event.target) !== targetOf(event.relatedTarget)) hide();
	}, true);
	for (const type of ["pointerdown", "wheel", "keydown", "contextmenu"] as const) {
		document.addEventListener(type, hideTooltipImmediate, true);
	}
	window.addEventListener("blur", hide);
	window.addEventListener("scroll", hide, true);
}
