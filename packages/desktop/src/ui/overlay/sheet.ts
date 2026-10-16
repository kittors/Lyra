/**
 * A popover drawn as a sheet from the bottom edge, where the host asks for one.
 *
 * On a phone held upright a menu hung off its trigger is the desktop's answer to a pointer: a small
 * card next to a 44pt button, its rows wherever the trigger happened to be, often at the top of the
 * screen and out of the thumb's reach. Every phone answers the same need with a sheet — up from the
 * bottom edge, the page dimmed behind it, put away with a tap on the dimmed page or a pull down.
 *
 * The host declares it (`--ly-menu-sheet: 1`, see `phone-sheet.css`) the way it declares the menu
 * width scale: `ui/` is a leaf and cannot ask which host it is in, and the stylesheet is also the
 * one place that knows the layout is compact — a tablet keeps menus beside their triggers.
 */

import { useEffect } from "react";

/** Whether menus anchored to a control are drawn as sheets here. Read when one opens. */
export function sheetHost(): boolean {
	if (typeof document === "undefined" || !document.documentElement) return false;
	return getComputedStyle(document.documentElement).getPropertyValue("--ly-menu-sheet").trim() === "1";
}

/** Far enough down that it cannot be an accident; a flick counts from less. */
const CLOSE_DISTANCE = 96;
/** Points per millisecond, averaged over the pull: a flick, not a slow drag that stopped short. */
const CLOSE_SPEED = 0.6;
/** How far a finger moves before it has said which way it is going. */
const DECIDE = 8;

/**
 * Pull the sheet down to put it away.
 *
 * From anywhere on it, as on every phone — not only the handle — but only while what is under the
 * finger is scrolled to its top: pulling a list that has somewhere to go scrolls it. Sideways or
 * upward movement is never a pull, so a row's own swipe and an ordinary scroll are left alone.
 *
 * Written with `translate` rather than `transform`, which the entrance and exit animations own: the
 * two compose, so a sheet let go half-way down leaves from where it is rather than jumping back to
 * start its exit.
 */
export function useSheetDrag(card: React.RefObject<HTMLElement | null>, enabled: boolean, dismiss: () => void): void {
	useEffect(() => {
		const element = card.current;
		if (!enabled || !element) return;
		let start: { x: number; y: number; t: number } | null = null;
		let pulling = false;
		let distance = 0;

		const scrolled = (target: EventTarget | null) => {
			for (let node = target instanceof Element ? target : null; node && node !== element; node = node.parentElement) {
				if (node.scrollTop > 0) return true;
			}
			return false;
		};

		const onStart = (event: TouchEvent) => {
			start = null;
			if (event.touches.length !== 1 || scrolled(event.target)) return;
			// A finger in a field is placing a caret or selecting, not holding the sheet.
			if (event.target instanceof Element && event.target.closest("input, textarea, [contenteditable]")) return;
			const touch = event.touches[0];
			start = { x: touch.clientX, y: touch.clientY, t: event.timeStamp };
			pulling = false;
			distance = 0;
		};

		const onMove = (event: TouchEvent) => {
			if (!start || event.touches.length !== 1) return;
			const touch = event.touches[0];
			const across = touch.clientX - start.x;
			const down = touch.clientY - start.y;
			if (!pulling) {
				if (Math.abs(down) < DECIDE && Math.abs(across) < DECIDE) return;
				if (down <= 0 || Math.abs(across) > down) {
					start = null;
					return;
				}
				pulling = true;
				element.setAttribute("data-dragging", "");
			}
			// The list under the finger must not scroll — or bounce — while the sheet is following it.
			if (event.cancelable) event.preventDefault();
			distance = Math.max(0, down);
			element.style.translate = `0 ${distance}px`;
		};

		const onEnd = (event: TouchEvent) => {
			const began = start;
			const was = pulling;
			start = null;
			pulling = false;
			if (!began || !was) return;
			element.removeAttribute("data-dragging");
			const speed = distance / Math.max(1, event.timeStamp - began.t);
			if (distance > CLOSE_DISTANCE || (distance > 24 && speed > CLOSE_SPEED)) {
				dismiss();
				return;
			}
			element.style.translate = "";
		};

		element.addEventListener("touchstart", onStart, { passive: true });
		element.addEventListener("touchmove", onMove, { passive: false });
		element.addEventListener("touchend", onEnd, { passive: true });
		element.addEventListener("touchcancel", onEnd, { passive: true });
		return () => {
			element.removeEventListener("touchstart", onStart);
			element.removeEventListener("touchmove", onMove);
			element.removeEventListener("touchend", onEnd);
			element.removeEventListener("touchcancel", onEnd);
		};
	}, [card, enabled, dismiss]);
}
