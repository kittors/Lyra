/**
 * The durations and curves, for the code that cannot read a CSS variable.
 *
 * CSS is the source of truth — `styles/tokens.css` is where these are defined and what every
 * stylesheet reads. This file exists for the handful of animations driven from JavaScript: a
 * `setTimeout` that has to outlast a transition, a Web Animations call that needs an easing string.
 *
 * Two copies of a number is exactly the arrangement that drifts, so `test/ui/motion-tokens.test.ts`
 * reads the stylesheet and asserts these match. Change one and the test names the other.
 *
 * The scale is about *what is moving*, not about how important it is:
 *
 *   quick   a state, not a position — hover, press, a colour changing under your finger
 *   base    something moving or resizing: a pane, a slider handle, a column giving up its width
 *   slow    something arriving that was not there — a section unfolding
 *
 * The curves say which direction the thing is going. `out` decelerates into place, which is what
 * makes an arrival look settled rather than stopped; `in` is its mirror, for things leaving.
 */

/** Milliseconds. The same numbers as `--ly-t-*`. */
export const DURATION = {
	quick: 150,
	base: 220,
	slow: 340,
} as const;

/** The same strings as `--ly-e-*`. */
export const EASING = {
	out: "cubic-bezier(0.22, 1, 0.36, 1)",
	in: "cubic-bezier(0.55, 0, 1, 0.45)",
	soft: "cubic-bezier(0.4, 0, 0.2, 1)",
} as const;

export type DurationName = keyof typeof DURATION;
export type EasingName = keyof typeof EASING;
