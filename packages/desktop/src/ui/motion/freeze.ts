/**
 * Holding still for the length of a drag.
 *
 * A few elements ease towards their new geometry, which is right when a layout changes on its own
 * and wrong while a pointer is moving the boundary: each frame starts a transition the next frame
 * overrides, so the pane trails the pointer instead of tracking it and never quite settles.
 *
 * The freeze used to be a flag on `<html>` and rules keyed on it — `:root[data-resizing] *`. That
 * reads well and is the single most expensive thing this app did while dragging. Measured against
 * a real session of 8,948 messages, 8,585 elements on screen:
 *
 *   set data-dock-dragging   94ms      (universal selector)
 *   set data-dock-dragging   44ms      (after narrowing it to `:root[data-…] .ly-dock-pane`)
 *   set an unrelated attr     0ms      (the control)
 *
 * Narrowing the selector is not enough, and the middle line is why. An attribute on an ancestor
 * still has to be resolved against the subtree beneath it, so a flag on the root is a question
 * asked about the whole document however specific the answer turns out to be — and a drag flips
 * two or three of these on the way in and again on the way out. That was the stall at the moment
 * you grabbed something: not the layout, not React, one attribute.
 *
 * So the elements are named instead. `.ly-freeze` marks the ones whose geometry a drag actually
 * changes — the panes, the frame the sidebar sits in, the collapsible groups whose height follows
 * what fits — and this adds a class to exactly those, which the style engine resolves through its
 * class index without walking anything.
 */

/** What a drag holds still: the panes, and anything that has asked to be held with them. */
const FREEZABLE = ".ly-dock-pane, .ly-freeze";

/**
 * An attribute, not a class, and this is not a stylistic choice.
 *
 * React owns `className` on these elements and writes the whole attribute whenever the string it
 * renders changes — which is exactly what putting a pane down does, since `carried` going null
 * drops `ly-dock-pane-carried` from it. A class added here by hand is silently wiped by that
 * write, and the pane it was holding still is released in the same frame it changes positioning
 * models: it then eases from its `fixed` pixel values to its `absolute` percentages, which
 * describe the same place in different numbers. What that looks like is a clean flight home
 * followed by a second, wrong drift — the pane flickering as it lands.
 *
 * React does not touch attributes it was not given, so this survives the render.
 */
const FROZEN = "data-ly-frozen";

/**
 * Hold the moving parts still, and hand back the release.
 *
 * The elements are collected once, at the start. A drag lasts a few hundred milliseconds and the
 * set does not change within one: the dock rearranges by moving panes that already exist, which is
 * the whole reason a pane keeps its terminal across a drop.
 *
 * A pane that does not exist yet is therefore out of scope here, and deliberately so — see
 * `data-dock-settling` in `styles.css` for the one case that needs it and why it is worth what it
 * costs there.
 *
 * Reference-counted, because two of these overlap in ordinary use: dragging the sidebar's edge
 * far enough resizes the window's content area, and a window resize freezes as well. Without the
 * count the first release would unfreeze under the second drag, which is the judder this prevents.
 */
let held = 0;
let frozen: Element[] = [];

/**
 * Refusing the selection a drag would otherwise start.
 *
 * `user-select: none` is the obvious way and it is the wrong one here: the property inherits, so
 * setting it on `<html>` or `<body>` — anywhere above the transcript — invalidates the inherited
 * style of every element beneath it. Measured at 49ms per drag on a real session, to express
 * something one refused event says for nothing.
 */
const refuseSelection = (event: Event) => event.preventDefault();

export function freezeMotion(): () => void {
	if (held === 0) {
		frozen = [...document.querySelectorAll(FREEZABLE)];
		for (const element of frozen) element.setAttribute(FROZEN, "");
		document.addEventListener("selectstart", refuseSelection);
	}
	held++;

	let released = false;
	return () => {
		// Idempotent: an effect's cleanup can run twice under StrictMode, and a drag that ends
		// while its component unmounts would otherwise decrement twice for one freeze.
		if (released) return;
		released = true;
		held--;
		if (held > 0) return;
		for (const element of frozen) element.removeAttribute(FROZEN);
		frozen = [];
		document.removeEventListener("selectstart", refuseSelection);
	};
}

/**
 * Stop the panes taking the pointer, for the length of a pane being carried.
 *
 * A pane may hold a <webview>, which is a separate process: it swallows the pointer the moment the
 * drag crosses it, and pointer capture — which handles same-document iframes — cannot reach it.
 * Declining hit tests on the panes is what covers that case; the drag listens on the window, so it
 * is unaffected.
 *
 * Applied the same way and for the same reasons as the freeze above: this used to be
 * `:root[data-dock-dragging] .ly-dock-pane`, and the flag is on the root of a document holding a
 * transcript — and it is an attribute rather than a class because React rewrites `className` on
 * these elements the moment a pane is picked up.
 */
const INERT = "data-ly-inert";

export function inertPanes(): () => void {
	const panes = [...document.querySelectorAll(".ly-dock-pane")];
	for (const pane of panes) pane.setAttribute(INERT, "");
	let released = false;
	return () => {
		if (released) return;
		released = true;
		for (const pane of panes) pane.removeAttribute(INERT);
	};
}
