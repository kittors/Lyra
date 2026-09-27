/**
 * The long-press look: the thing you are holding rises, everything else sinks behind glass.
 *
 * A copy, not the element itself. The row lives inside a drawer that is transformed, inside a
 * scroller that is masked — each of those is a stacking context, and nothing inside one can be
 * raised above a scrim that sits outside it. So the layer draws a snapshot of what was under the
 * finger over a blurred page, exactly where it was, and the original is hidden underneath until
 * the menu is done with. The snapshot is inert: it is a picture of the row, and every action still
 * goes through the real one.
 *
 * Only what was visible is copied. A reply can be taller than the screen; lifting all of it would
 * push the menu off the bottom, so the copy is clipped to what the scroller was showing, and to a
 * window around the finger when even that is most of the screen.
 */

import { motionReduced } from "../ui/motion/reduced.ts";
import type { Rect } from "../ui/overlay/keep-clear.ts";

export interface Lifted {
	/** Where the copy sits now, for the menu to keep clear of. */
	rect: Rect;
	/** Move the copy vertically — the menu needed its place. */
	shift(dy: number): void;
	/** Put it back and take the layer away. Safe to call more than once. */
	drop(): void;
}

/** A rectangle, in viewport coordinates, shrunk to the part every clipping ancestor lets through. */
function visibleRect(element: HTMLElement): Rect {
	const box = element.getBoundingClientRect();
	let rect: Rect = { top: box.top, bottom: box.bottom, left: box.left, right: box.right };
	for (let node = element.parentElement; node && node !== document.body; node = node.parentElement) {
		const style = getComputedStyle(node);
		if (style.overflowY === "visible" && style.overflowX === "visible") continue;
		const clip = node.getBoundingClientRect();
		rect = {
			top: Math.max(rect.top, clip.top),
			bottom: Math.min(rect.bottom, clip.bottom),
			left: Math.max(rect.left, clip.left),
			right: Math.min(rect.right, clip.right),
		};
	}
	return {
		top: Math.max(rect.top, 0),
		bottom: Math.min(rect.bottom, window.innerHeight),
		left: Math.max(rect.left, 0),
		right: Math.min(rect.right, window.innerWidth),
	};
}

/**
 * The most of a tall target the copy shows, as a share of the window.
 *
 * Enough to recognise the message by, short enough to leave room for its menu below or above it.
 */
const TALLEST = 0.38;

/** What a long press on this kind of thing lifts, and how far. */
export type LiftKind = "row" | "message";

export function lift(target: HTMLElement, kind: LiftKind, finger: { x: number; y: number }): Lifted {
	const box = target.getBoundingClientRect();
	let view = visibleRect(target);
	const tallest = window.innerHeight * TALLEST;
	if (view.bottom - view.top > tallest) {
		// Centred on the finger, then pushed back inside what was visible.
		let top = Math.max(view.top, finger.y - tallest / 2);
		top = Math.min(top, view.bottom - tallest);
		view = { ...view, top, bottom: top + tallest };
	}

	/*
	 * A reply has no surface of its own, so its copy is given one, with room around the text — a
	 * bare paragraph floating over a blurred page reads as a rendering glitch rather than as the
	 * thing you picked up. Rows and bubbles already have a shape and keep it.
	 */
	const bubble = target.classList.contains("ly-user-bubble");
	const pad = kind === "message" && !bubble ? 12 : 0;
	// Never wider than the screen minus a margin: a full-width reply given padding and then scaled up
	// would otherwise hang off both edges.
	const margin = 8;
	const card: Rect = {
		top: view.top - pad,
		bottom: view.bottom + pad,
		left: Math.max(margin, view.left - pad),
		right: Math.min(window.innerWidth - margin, view.right + pad),
	};
	/*
	 * Which ends were cut off. A copy that starts mid-paragraph fades in from that edge instead of
	 * slicing a line of text in half — it says "this goes on" the way a scroller's own edges do.
	 */
	const clip = [view.top > box.top + 1 ? "top" : "", view.bottom < box.bottom - 1 ? "bottom" : ""].filter(Boolean).join(" ");

	const layer = document.createElement("div");
	layer.setAttribute("data-ly-lift", kind);
	layer.className = "ly-lift";
	layer.setAttribute("aria-hidden", "true");

	const scrim = document.createElement("div");
	scrim.className = "ly-lift-scrim";
	layer.append(scrim);
	/*
	 * A tap anywhere but the menu puts everything down — as a press outside, which is what every
	 * popover here already listens for. Dispatched rather than left to the compatibility events a
	 * touch produces, because iOS only sends those to things it considers clickable, and whether a
	 * plain layer counts has changed between releases.
	 */
	layer.addEventListener("pointerdown", (event) => {
		if (event.target instanceof Element && event.target.closest("[data-ly-popover]")) return;
		scrim.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
	});

	const frame = document.createElement("div");
	frame.className = "ly-lift-card";
	frame.dataset.kind = bubble ? "bubble" : kind;
	if (clip) frame.dataset.clip = clip;
	Object.assign(frame.style, {
		left: `${card.left}px`,
		top: `${card.top}px`,
		width: `${card.right - card.left}px`,
		height: `${card.bottom - card.top}px`,
	});
	const style = getComputedStyle(target);
	if (bubble) frame.style.borderRadius = style.borderRadius;

	/*
	 * Inherited type and colour, written down: the copy is no longer under the transcript or the
	 * sidebar that set them, and a reply copied without them comes out in the page's default face.
	 */
	const content = document.createElement("div");
	content.className = "ly-lift-content";
	Object.assign(content.style, {
		width: `${box.width}px`,
		transform: `translate(${box.left - card.left}px, ${box.top - card.top}px)`,
		color: style.color,
		fontFamily: style.fontFamily,
		fontSize: style.fontSize,
		fontWeight: style.fontWeight,
		lineHeight: style.lineHeight,
	});
	const copy = target.cloneNode(true) as HTMLElement;
	copy.removeAttribute("id");
	for (const node of copy.querySelectorAll("[id]")) node.removeAttribute("id");
	copy.setAttribute("inert", "");
	content.append(copy);
	// The fade lives on a layer of its own, so it thins the text and not the card behind it.
	const pane = document.createElement("div");
	pane.className = "ly-lift-window";
	pane.append(content);
	frame.append(pane);
	layer.append(frame);
	document.body.append(layer);

	target.setAttribute("data-ly-lift-source", "");
	const still = motionReduced();
	// Next frame, so the transition runs from the resting state rather than starting at the end.
	requestAnimationFrame(() => layer.setAttribute("data-open", ""));

	let dropped = false;
	const lifted: Lifted = {
		rect: card,
		shift(dy) {
			frame.style.translate = dy ? `0 ${Math.round(dy)}px` : "";
		},
		drop() {
			if (dropped) return;
			dropped = true;
			layer.removeAttribute("data-open");
			layer.setAttribute("data-closing", "");
			const finish = () => {
				layer.remove();
				target.removeAttribute("data-ly-lift-source");
			};
			if (still) finish();
			else window.setTimeout(finish, 220);
		},
	};
	return lifted;
}
