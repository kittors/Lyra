/**
 * Asking a conversation to show one of its drawings: scrolled into the middle, flashed once.
 *
 * A request rather than a call, because what knows how to scroll — the transcript's window and its
 * follow-the-bottom state — lives inside `Conversation`, and when the gallery asks, that conversation
 * may not be on screen at all: it is opened, read from disk, and only then has the card. The request
 * waits here until the conversation it names is ready to take it (`Conversation.tsx`).
 */

import { create } from "zustand";

export const useDrawingReveal = create<{ sessionId: string; toolCallId: string; nonce: number }>(() => ({ sessionId: "", toolCallId: "", nonce: 0 }));

export function revealDrawing(sessionId: string, toolCallId: string): void {
	useDrawingReveal.setState((state) => ({ sessionId, toolCallId, nonce: state.nonce + 1 }));
}

export function settleReveal(nonce: number): void {
	// A late consumer must not discard a newer request.
	useDrawingReveal.setState((state) => (state.nonce === nonce ? { ...state, sessionId: "", toolCallId: "" } : state));
}

/**
 * Light the card up once, so the eye lands on it after the jump.
 *
 * An attribute the stylesheet animates, taken off when the animation ends — or straight away, when
 * motion is reduced and there is no animation to end.
 */
export function flash(element: HTMLElement, reduced: boolean): void {
	if (reduced) return;
	element.removeAttribute("data-ly-flash");
	// Read layout so a second flash on the same card restarts the animation instead of being merged into the first.
	void element.offsetWidth;
	element.setAttribute("data-ly-flash", "");
	const done = () => element.removeAttribute("data-ly-flash");
	element.addEventListener("animationend", done, { once: true });
	window.setTimeout(done, 2400);
}
