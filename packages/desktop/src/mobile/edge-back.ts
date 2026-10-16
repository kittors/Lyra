/**
 * Swipe in from the left edge to go back, on a page pushed over another.
 *
 * A panel over the conversation and a settings page over the list both came in from the right, and
 * every phone takes such a page back the way it came: a thumb from the left edge, the page following
 * it, the page underneath sliding back into place, and letting go part-way deciding which way it
 * settles. The back button in the corner is the far end of the screen from that thumb.
 *
 * The decisions are the drawer's (`drawer-gesture.ts`): the same edge strip, the same test for telling
 * a sideways drag from a scroll, the same threshold and flick. It is the same gesture — on the
 * conversation it pulls out the drawer, on a pushed page it pops the page, and the drawer stays put
 * there (`data-ly-no-drawer`).
 */

import { useEffect, useRef } from "react";

import { onPhone } from "../services/host.ts";
import { begin, extend, progress, release, type Gesture } from "./drawer-gesture.ts";
import { touchClaimed } from "./long-press.ts";

/** How far the page underneath sits to the left while it is covered — `phone-chrome.css`. */
const UNDER_SHIFT = 24;

/**
 * Long enough for the settle to be seen; short enough to read as a continuation of the throw. The
 * motion token's own value (`--ly-t-base`), so a timer can stand in for a `transitionend` that never
 * comes; the transition itself names the token, so reduce-motion collapses it like any other.
 */
const SETTLE_MS = 220;

export function useEdgeBack({
	page,
	under,
	active,
	onBack,
}: {
	/** The page being swiped away. Read when a touch lands, so a remounted page is found again. */
	page: () => HTMLElement | null;
	/**
	 * What is uncovered as it goes, drawn sliding back into place under it. If it is put away
	 * (`visibility: hidden`, as the conversation is under settings) it is shown for the length of the
	 * swipe, and put away again if the page stays.
	 */
	under: () => HTMLElement | null;
	/** Only while this page is the one in front. */
	active: boolean;
	/** The page has gone: drop it, without an exit of its own — the finger was the exit. */
	onBack: () => void;
}): void {
	// Held, not depended on: callers pass fresh functions every render, and the listeners stay.
	const back = useRef(onBack);
	back.current = onBack;
	const find = useRef({ page, under });
	find.current = { page, under };

	useEffect(() => {
		if (!active || !onPhone()) return;
		let gesture: Gesture | null = null;
		let target: HTMLElement | null = null;
		let below: HTMLElement | null = null;
		let revealed = false;
		const conceal = (element: HTMLElement | null) => {
			if (!element || !revealed) return;
			revealed = false;
			element.style.visibility = "";
		};

		const settle = (element: HTMLElement | null, property: "translate" | "transform", value: string, then?: () => void) => {
			if (!element) {
				then?.();
				return;
			}
			element.style.transition = `${property} var(--ly-t-base) var(--ly-e-out)`;
			element.style[property] = value;
			let finished = false;
			const finish = () => {
				if (finished) return;
				finished = true;
				element.style.transition = "";
				then?.();
			};
			element.addEventListener("transitionend", finish, { once: true });
			window.setTimeout(finish, SETTLE_MS + 80);
		};

		const onStart = (event: TouchEvent) => {
			gesture = null;
			if (event.touches.length !== 1) return;
			const touch = event.touches[0];
			target = find.current.page();
			if (!target) return;
			// A touch on a sheet or a dialog over the page belongs to that layer, not to the page.
			const hit = document.elementFromPoint(touch.clientX, touch.clientY);
			if (!hit || !target.contains(hit)) return;
			below = find.current.under();
			gesture = begin({ x: touch.clientX, y: touch.clientY, t: event.timeStamp }, false);
		};

		const onMove = (event: TouchEvent) => {
			if (!gesture || !target || event.touches.length !== 1) return;
			// A long press turned this touch into a menu; the drift is not a swipe.
			if (touchClaimed()) {
				gesture = null;
				target.style.translate = "";
				if (below) below.style.transform = "";
				conceal(below);
				return;
			}
			const touch = event.touches[0];
			gesture = extend(gesture, { x: touch.clientX, y: touch.clientY, t: event.timeStamp });
			if (gesture.declined || gesture.deciding) return;
			if (event.cancelable) event.preventDefault();
			const shown = progress(gesture, window.innerWidth);
			target.style.transition = "none";
			target.style.translate = `${(shown * 100).toFixed(2)}% 0`;
			if (below) {
				if (!revealed && getComputedStyle(below).visibility === "hidden") {
					below.style.visibility = "visible";
					revealed = true;
				}
				below.style.transition = "none";
				below.style.transform = `translateX(${(-UNDER_SHIFT * (1 - shown)).toFixed(2)}%)`;
			}
		};

		const onEnd = () => {
			const ended = gesture;
			gesture = null;
			if (!ended || ended.deciding || ended.declined || !target) return;
			const gone = release(ended, window.innerWidth);
			const page = target;
			const uncovered = below;
			if (gone) {
				settle(uncovered, "transform", "translateX(0)");
				settle(page, "translate", "100% 0", () => {
					back.current();
					// Whatever is left of the page — a retained pane — is put back for next time.
					requestAnimationFrame(() => {
						page.style.translate = "";
						if (uncovered) uncovered.style.transform = "";
						conceal(uncovered);
					});
				});
			} else {
				settle(uncovered, "transform", `translateX(-${UNDER_SHIFT}%)`, () => {
					if (uncovered) uncovered.style.transform = "";
					conceal(uncovered);
				});
				settle(page, "translate", "0% 0", () => {
					page.style.translate = "";
				});
			}
		};

		document.addEventListener("touchstart", onStart, { passive: true });
		document.addEventListener("touchmove", onMove, { passive: false });
		document.addEventListener("touchend", onEnd, { passive: true });
		document.addEventListener("touchcancel", onEnd, { passive: true });
		return () => {
			document.removeEventListener("touchstart", onStart);
			document.removeEventListener("touchmove", onMove);
			document.removeEventListener("touchend", onEnd);
			document.removeEventListener("touchcancel", onEnd);
		};
	}, [active]);
}
