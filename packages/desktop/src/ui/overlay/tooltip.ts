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

const DELAY_MS = 420;
/** Long enough to be seen leaving, short enough not to trail the pointer. Matches `ly-tip-out`. */
const EXIT_MS = 110;
const GAP = 6;
const MARGIN = 6;

let host: HTMLElement | null = null;
let timer = 0;
let leaving = 0;
let current: HTMLElement | null = null;

let popoverSuppressed = false;

export function setTooltipSuppressed(suppressed: boolean) {
	popoverSuppressed = suppressed;
	if (suppressed) {
		hideTooltipImmediate();
	}
}

function ensureHost(): HTMLElement {
	if (host) return host;
	host = document.createElement("div");
	host.className = "ly-tooltip";
	host.setAttribute("role", "tooltip");
	host.style.position = "fixed";
	host.style.zIndex = "200";
	host.style.pointerEvents = "none";
	host.hidden = true;
	document.body.appendChild(host);
	return host;
}

/** The nearest ancestor carrying a tip, so an icon inside a button still counts as the button. */
function targetOf(node: EventTarget | null): HTMLElement | null {
	if (!(node instanceof Element)) return null;
	const el = node.closest<HTMLElement>("[data-ly-tip]");
	return el && el.dataset.lyTip ? el : null;
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
	side: "top" | "bottom",
	viewport: { width: number; height: number },
): { left: number; top: number } {
	const below = target.bottom + GAP;
	const above = target.top - tip.height - GAP;
	const fits = side === "bottom" ? below + tip.height < viewport.height - MARGIN : above > MARGIN;
	// The preferred side when it fits, the other one when it does not.
	const top = fits === (side === "bottom") ? below : above;

	const centred = target.left + target.width / 2 - tip.width / 2;
	const left = Math.min(Math.max(MARGIN, centred), viewport.width - tip.width - MARGIN);
	return { left, top };
}

function place(el: HTMLElement) {
	const tip = ensureHost();
	// Cancel a departure in progress, or the bubble would vanish mid-arrival.
	window.clearTimeout(leaving);
	delete tip.dataset.leaving;
	tip.textContent = el.dataset.lyTip ?? "";
	tip.hidden = false;

	const a = el.getBoundingClientRect();
	const b = tip.getBoundingClientRect();
	const at = tipPlacement(a, b, el.dataset.lyTipSide === "top" ? "top" : "bottom", {
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
export function hide() {
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
export function hideTooltipImmediate() {
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
			if (popoverSuppressed || document.querySelector('.fixed.z-\\[60\\][role="menu"], .fixed.z-\\[60\\][role="dialog"]')) return;
			const el = targetOf(event.target);
			if (el === current) return;
			hide();
			if (!el) return;
			current = el;
			timer = window.setTimeout(() => {
				// Still under the pointer, and still in the document, by the time the delay is up.
				if (!popoverSuppressed && !document.querySelector('.fixed.z-\\[60\\][role="menu"], .fixed.z-\\[60\\][role="dialog"]') && current === el && el.isConnected) place(el);
			}, DELAY_MS);
		},
		true,
	);

	// Any of these means the target is gone or no longer the thing being pointed at.
	for (const type of ["pointerdown", "pointerout", "wheel", "keydown", "contextmenu"] as const) {
		document.addEventListener(type, hideTooltipImmediate, true);
	}
	window.addEventListener("blur", hide);
	window.addEventListener("scroll", hide, true);
}
