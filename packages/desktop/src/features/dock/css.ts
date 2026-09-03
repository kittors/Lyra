/**
 * Fractions to CSS.
 *
 * Rounded, and deliberately not to a whole percent. The dock's boxes are computed as exact
 * fractions that tile perfectly; writing them into CSS at low precision reopens the gap between
 * two panes that the arithmetic had just closed, and a sub-pixel seam of window background is
 * visible against a pane. Six decimals is well past what any display can resolve and short enough
 * that the strings stay stable between frames — which matters, because a style string that
 * changes on every frame invalidates the transition it is meant to be animating.
 */

export const pct = (fraction: number): string => `${(fraction * 100).toFixed(6)}%`;
