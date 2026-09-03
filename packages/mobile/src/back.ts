/**
 * What Android's back button should do.
 *
 * On Android the back button is the way out of things, and an app that ignores it is an app that
 * quits when you meant to close a drawer. The interface it would be backing out of lives inside a
 * WebView, though, so the two halves of this are split: the page reports how many layers it has
 * open, and the native side decides — synchronously, because `BackHandler` wants an answer on the
 * spot and cannot wait for a round trip into the WebView and back.
 *
 * That is the whole reason the depth is mirrored rather than asked for. Both halves are here as
 * plain functions so the decision can be argued with in a test, which matters more than usual: this
 * is the one piece of the phone build that cannot be checked on the machine it was written on.
 */

/** What the page reports, and the native side remembers between presses. */
export interface BackState {
	/** Layers open inside the page: a drawer, a dialog. Reported by the bridge. */
	depth: number;
	/** When the last press happened and found nothing to close. */
	armedAt?: number;
}

export type BackAction =
	/** Close one layer inside the page. */
	| { do: "close" }
	/** Nothing left to close: say so, and wait to see if they mean it. */
	| { do: "warn"; state: BackState }
	/** They meant it. */
	| { do: "exit" };

/**
 * How long a warned press stays armed.
 *
 * Long enough to read four words and press again, short enough that a press a minute later is a
 * fresh intention rather than the second half of one from before.
 */
export const ARM_MS = 2000;

/**
 * Decide what one press of the back button means.
 *
 * Pure, and takes the clock, because the interesting cases are all about timing and none of them
 * are reproducible by waiting.
 */
export function backPress(state: BackState, now: number): BackAction {
	// Something is open. Closing it is what back means, every time, and it never exits.
	if (state.depth > 0) return { do: "close" };

	const armed = state.armedAt !== undefined && now - state.armedAt < ARM_MS;
	if (armed) return { do: "exit" };

	return { do: "warn", state: { ...state, armedAt: now } };
}

/**
 * How many layers the page has open, from the document.
 *
 * Read off the two attributes the renderer already maintains rather than from anything added for
 * the phone: a drawer is `[data-pane="drawer"]` and carries `inert` while closed, and every modal
 * is `[aria-modal="true"]`. Nothing new to keep in step, and nothing to forget when a new kind of
 * dialog is added.
 *
 * Menus are deliberately not counted. They have no such marking, and guessing at one — treating
 * every `aria-expanded="true"` as a layer — would count the collapsible sections in settings too,
 * leaving the back button apparently dead on a page with an expanded section on it. A menu closes
 * on the tap that opens the next thing anyway.
 */
export function layerDepth(root: {
	querySelectorAll(selector: string): ArrayLike<{ hasAttribute(name: string): boolean }>;
}): number {
	let depth = 0;
	for (const element of Array.from(root.querySelectorAll('[data-pane="drawer"]'))) {
		if (!element.hasAttribute("inert")) depth++;
	}
	for (const element of Array.from(root.querySelectorAll('[aria-modal="true"]'))) {
		// The drawer is itself `aria-modal` when it is one, and must not be counted twice.
		if (!element.hasAttribute("inert") && !element.hasAttribute("data-pane")) depth++;
	}
	return depth;
}
