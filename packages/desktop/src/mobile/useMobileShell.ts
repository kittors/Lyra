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
import { touchClaimed } from "./long-press.ts";

/*
 * Re-exported rather than defined here.
 *
 * There were two of these — one in `services/host.ts` and this one — with the same name and the
 * same body. Two functions that answer "is this a phone" is one too many: the day they disagree,
 * half the interface adapts and half does not, and nothing points at the cause.
 *
 * The definition lives with the rest of the host questions; this file keeps the name so its own
 * callers read naturally.
 */
import { onPhone } from "../services/host.ts";

export { onPhone };

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
		const stop = watchKeyboard(window, document.documentElement);
		/*
		 * The field being typed in stays in sight when the keyboard takes the bottom of the window.
		 *
		 * On iOS the shell ends the WebView at the keyboard's top edge and the WebView's own
		 * scroll-to-reveal is switched off (see `desk.tsx`), so revealing the field is this page's
		 * job: a setting half way down a scrolled page would otherwise be under the keyboard. The
		 * scrollers around it move only as far as it takes to bring the field into view, and not at
		 * all when it already is — which is the composer, every time.
		 */
		const reveal = () => {
			const field = document.activeElement;
			if (!(field instanceof HTMLElement) || !field.matches("input, textarea, [contenteditable]")) return;
			requestAnimationFrame(() => field.scrollIntoView({ block: "nearest", inline: "nearest" }));
		};
		window.addEventListener("resize", reveal);
		return () => {
			stop();
			window.removeEventListener("resize", reveal);
		};
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
			/*
			 * A long press has turned this touch into a menu (see `PhoneTouch`). The finger drifting
			 * while it reads the menu is not a pull on the drawer, and following it would slide the
			 * whole pane out from under the row it is holding.
			 */
			if (touchClaimed()) {
				clear();
				return;
			}
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
