/**
 * How deep the pinned rows reach, so the list can be softened below them rather than through them.
 *
 * The rows themselves are `position: sticky` and need nothing from JavaScript — the browser holds
 * them on the compositor, which is the only way they keep up with a wheel. This is the one thing
 * CSS cannot answer: where the *bottom* of the pinned band currently is, so the scroller's fade can
 * start there instead of at the top of the viewport.
 *
 * An earlier version placed the rows by hand, outside the scroller's mask, so they needed no fill
 * of their own and the translucent pane stayed translucent. It worked and it was wrong: the list
 * scrolls on the compositor and the placement ran on the main thread, so every pinned row sat one
 * wheel tick behind the list — measured at 14px of wobble on a trackpad. Pinned rows carry an
 * opaque fill now, and this number is all that is left.
 *
 * Being a frame late here costs nothing, which is the point of the split: the rows are placed by
 * CSS and cannot lag, and a fade whose start is a few pixels stale is a gradient in a slightly
 * different place — not a row that jumps.
 */

/** A pinned row, measured from the top of the scroll viewport. */
export interface StickyRow {
	top: number;
	bottom: number;
	/** The offset it comes to rest at — its own `top` in CSS terms. */
	rail: number;
}

/**
 * A hair over half a pixel.
 *
 * These are `getBoundingClientRect` values, so "has it reached its rail" is a comparison between
 * two subpixel numbers that agree in every way that matters until a fractional scroll position
 * makes them differ in the ninth decimal.
 */
const EPSILON = 0.5;

/**
 * Whether this row is currently being held rather than travelling with the list.
 *
 * A row counts once it has reached its rail — at or above it, which also covers the one being
 * pushed out by the next, since that travels upwards past its rail on the way out. A row still
 * arriving is not being held and covers nothing; it is part of the list, and the list is what the
 * fade is for.
 *
 * Asked twice, for two different reasons. The fade needs the depth below; the row itself needs to
 * know because being held is the only moment it may draw a fill — see `.ly-pin` and `data-ly-stuck`.
 * A row flowing with the list has nothing to hide and an opaque backing on it is just a band of the
 * wrong colour laid across a translucent pane.
 */
export function isPinned(row: StickyRow): boolean {
	return row.top <= row.rail + EPSILON;
}

/**
 * The band the list must not be softened through, as a top and an underside.
 *
 * Wider than "what has reached its rail", and that difference is the point. The fade eats whatever
 * is in the top few pixels of the viewport, and a row on its way to the rail travels through
 * exactly there — so the strip dissolved as it approached the top, hung there as a ghost of itself,
 * and snapped back to full strength the instant it landed. The row was never the list; it only
 * looked like it because it was passing through where the list gets erased.
 *
 * So a row counts as held once it is within one fade-depth of its rail: from there the mask holds
 * it whole and softens above and below it instead. `fade` is that depth — `Scroller`'s `FADE_TOP`,
 * and zero when the scroller is at the top and nothing is being softened at all.
 *
 * `top` is where the band starts, which is what lets the list keep fading above a row that has not
 * landed yet. It is zero once anything has actually reached its rail, and the band then reaches the
 * top edge the way it always did.
 */
export interface HeldBand {
	top: number;
	bottom: number;
}

export function heldBand(rows: StickyRow[], fade: number): HeldBand {
	let top = 0;
	let bottom = 0;
	let found = false;
	for (const row of rows) {
		if (row.top > row.rail + fade + EPSILON) continue;
		// Clamped: a row being pushed out sits above the viewport, and the band starts at its edge.
		const at = Math.max(row.top, 0);
		top = found ? Math.min(top, at) : at;
		bottom = Math.max(bottom, row.bottom);
		found = true;
	}
	return found ? { top, bottom } : { top: 0, bottom: 0 };
}

/**
 * The underside of the pinned band: the lowest edge of everything that has actually landed.
 *
 * `heldBand` with no fade to allow for — the same question this always asked, kept because it is
 * the one the tests are written against and the one `isPinned` agrees with row by row.
 */
export function pinnedDepth(rows: StickyRow[]): number {
	return heldBand(rows, 0).bottom;
}
