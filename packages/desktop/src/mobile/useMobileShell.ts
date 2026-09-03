/**
 * The two things a phone does to a window that a desktop never does.
 *
 * It slides a keyboard over the bottom of it without saying so, and it expects panels to follow a
 * finger. Both are wired here, both only when the interface is actually being shown on a phone —
 * the same bundle runs on the desktop, where a narrow window is still a window.
 *
 * Neither hook re-renders while a finger is down. A drag that goes through React is a drag that
 * arrives a frame or two late, and late is exactly what makes a gesture feel like a button.
 * `drawer-gesture.ts` decides what the finger means; this writes the result to the document.
 */

import { useEffect } from "react";

import { begin, drawerWidth, extend, progress, release, type Gesture } from "./drawer-gesture.ts";
import { watchKeyboard } from "./keyboard.ts";

/** True when the interface is being shown through the phone's bridge rather than in a window. */
export function onPhone(): boolean {
	return typeof window !== "undefined" && window.lyra?.host === "mobile";
}

/**
 * Publish the height the keyboard is covering, as `--ly-keyboard`.
 *
 * A variable rather than a layout change: what has to move is the composer, and the transcript
 * behind it should keep its scroll position rather than reflow under a shrinking container. The
 * stylesheet spends it as padding on the one element that needs it.
 */
export function useKeyboardInset(): void {
	useEffect(() => {
		if (!onPhone()) return;
		// The window itself, so `innerHeight` is re-read on every update rather than captured —
		// rotating the phone changes it, and a stale one mis-measures the keyboard by the difference.
		return watchKeyboard(window, document.documentElement);
	}, []);
}

/**
 * Let the navigation drawer be dragged in from the left edge and pushed back.
 *
 * The position is published as `--ly-drawer`, 0 to 1. While no finger is down the variable is
 * absent and the drawer falls back to the open/closed value its own style carries, with the usual
 * transition; during a drag the variable overrides that and the drawer tracks the finger with no
 * transition at all. That fallback is the whole trick — it means there is no second source of truth
 * to keep in step with React's.
 */
export function useDrawerGesture(open: boolean, setOpen: (next: boolean) => void): void {
	useEffect(() => {
		if (!onPhone()) return;

		const root = document.documentElement;
		let gesture: Gesture | null = null;
		let width = drawerWidth(window.innerWidth);

		const clear = () => {
			gesture = null;
			root.style.removeProperty("--ly-drawer");
			root.removeAttribute("data-drawer-dragging");
		};

		const onStart = (event: TouchEvent) => {
			// A second finger during a drag is a pinch or a stray palm; either way the drag is over.
			if (event.touches.length !== 1) {
				if (gesture) clear();
				return;
			}
			const touch = event.touches[0];
			/*
			 * Not when the finger landed on something over the shell.
			 *
			 * Menus, dialogs and viewers are portalled to `document.body`, so anything outside
			 * `.ly-shell` is a layer above the drawer — including a modal's full-screen scrim, which
			 * is what makes this catch a dialog opened over a drawer the gesture would otherwise
			 * slide out from underneath. Asked of the touch point rather than of the document,
			 * because a toast in the corner is not in anyone's way.
			 */
			const under = document.elementFromPoint(touch.clientX, touch.clientY);
			if (under && !under.closest(".ly-shell")) return;

			width = drawerWidth(window.innerWidth);
			gesture = begin({ x: touch.clientX, y: touch.clientY, t: event.timeStamp }, open);
		};

		const onMove = (event: TouchEvent) => {
			if (!gesture || event.touches.length !== 1) return;
			const touch = event.touches[0];
			gesture = extend(gesture, { x: touch.clientX, y: touch.clientY, t: event.timeStamp });
			if (gesture.declined || gesture.deciding) return;

			/*
			 * Now that this is definitely a drawer drag, the page must not also scroll under it.
			 * Only reachable once `deciding` is false, so a scroll is never blocked on the strength
			 * of a guess about where the finger is going.
			 */
			if (event.cancelable) event.preventDefault();
			root.setAttribute("data-drawer-dragging", "");
			root.style.setProperty("--ly-drawer", progress(gesture, width).toFixed(4));
		};

		const onEnd = () => {
			if (!gesture) return;
			const settled = release(gesture, width);
			const wasDragging = !gesture.deciding && !gesture.declined;
			clear();
			/*
			 * Told to React only when it differs, and only after the override is gone: setting the
			 * same value re-renders for nothing, and clearing the variable first is what lets the
			 * drawer animate from where the finger left it to where it belongs.
			 */
			if (settled !== open) setOpen(settled);
			else if (wasDragging) {
				// It came back to where it started, which still has to be animated — the finger left
				// it part-way out.
				root.setAttribute("data-drawer-settling", "");
				window.setTimeout(() => root.removeAttribute("data-drawer-settling"), 240);
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
			clear();
		};
	}, [open, setOpen]);
}
