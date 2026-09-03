/**
 * Dragging the navigation drawer with a thumb.
 *
 * On a phone the drawer is the only way back to the session list, and reaching for a button in the
 * far corner to get there is the wrong shape of gesture — every other app on the device opens that
 * drawer by swiping in from the left edge, and closes it by pushing it back. Following the finger
 * matters as much as the direction: a drawer that waits for the finger to lift and then animates
 * reads as a button that was slow to respond, not as something you are holding.
 *
 * The decisions here are pure so they can be argued with in a test — the hard part is not moving a
 * panel, it is telling a horizontal drag apart from the vertical scroll it starts out looking
 * identical to, and being wrong in either direction is felt immediately: steal the gesture and the
 * transcript will not scroll, decline it and the drawer will not open.
 *
 * `useDrawerGesture.ts` binds this to touch events and writes the transform.
 */

/** A touch, at a moment. `t` is `event.timeStamp` — only differences are used. */
export interface Point {
	x: number;
	y: number;
	t: number;
}

/**
 * How close to the left edge a drag has to start to mean "open the drawer".
 *
 * Wide enough to hit without aiming, narrow enough that a drag starting on the transcript is not
 * mistaken for one — iOS reserves a comparable strip for its own back gesture, and matching that
 * width is what makes the two feel like the same gesture rather than two that compete.
 */
export const EDGE = 28;

/**
 * How much further the finger must travel across than down before this counts as a drawer drag.
 *
 * Not 1:1. At 1:1 a scroll that begins with any sideways wobble — most of them, on a thumb — is
 * taken for a drawer pull, and the transcript locks up in the user's hand. Requiring the horizontal
 * component to clearly lead resolves the ambiguity in favour of scrolling, which is both the more
 * common intent and the less annoying thing to get wrong.
 */
const LEAD = 1.4;

/** Movement below this is noise from a stationary thumb, and decides nothing. */
const SLOP = 8;

/**
 * Past this fraction of the drawer's width, letting go finishes the job.
 *
 * Under half, because a drag that stops early is more often a hand running out of screen than a
 * change of mind.
 */
const COMMIT = 0.38;

/**
 * A flick, in pixels per millisecond.
 *
 * Fast enough that it cannot be reached by the steady drag that `COMMIT` already governs, so the
 * two rules never fight over the same gesture. A flick counts whatever the distance: throwing the
 * drawer open from the edge is a gesture people make without waiting to see it move.
 */
const FLICK = 0.45;

export interface Gesture {
	/** Whether the finger is pulling the drawer out or pushing it back. */
	kind: "open" | "close";
	start: Point;
	/** Still deciding whether this is a drawer drag or a scroll. */
	deciding: boolean;
	/** Decided against: this was a scroll, and the rest of the gesture is not ours. */
	declined: boolean;
	prev: Point;
	last: Point;
}

/**
 * Whether a touch that has just landed could be the start of a drawer drag.
 *
 * Returns a gesture in its undecided state, or null when the touch cannot be one at all: a drag
 * from the middle of a closed drawer's screen is someone using the page.
 */
export function begin(point: Point, open: boolean): Gesture | null {
	if (!open && point.x > EDGE) return null;
	return {
		kind: open ? "close" : "open",
		start: point,
		deciding: true,
		declined: false,
		prev: point,
		last: point,
	};
}

/**
 * Fold in the next touch position.
 *
 * While `deciding`, each point is a chance to resolve the gesture one way or the other; the first
 * movement past the slop threshold settles it. Once settled — either way — the verdict stands for
 * the rest of the gesture, because a scroll that curves sideways halfway down should not suddenly
 * start dragging the drawer, and a drawer being pulled should not stop following the finger just
 * because the hand drifted downward.
 */
export function extend(gesture: Gesture, point: Point): Gesture {
	if (gesture.declined) return gesture;

	const next = { ...gesture, prev: gesture.last, last: point };
	if (!gesture.deciding) return next;

	const dx = point.x - gesture.start.x;
	const dy = point.y - gesture.start.y;
	if (Math.abs(dx) < SLOP && Math.abs(dy) < SLOP) return next;

	// The direction has to agree with what the drawer can actually do: pulling right on an open
	// drawer, or pushing left on a closed one, is not a gesture — it is slack.
	const along = gesture.kind === "open" ? dx : -dx;
	if (along > 0 && Math.abs(dx) > Math.abs(dy) * LEAD) return { ...next, deciding: false };
	return { ...next, deciding: false, declined: true };
}

/**
 * How much of the drawer should be showing, from 0 (hidden) to 1 (fully out).
 *
 * Measured from where the finger started rather than from the screen edge, so the drawer does not
 * jump to meet a finger that began its pull a few pixels in.
 */
export function progress(gesture: Gesture, width: number): number {
	if (gesture.declined || gesture.deciding) return gesture.kind === "open" ? 0 : 1;
	const travelled = (gesture.last.x - gesture.start.x) / width;
	const raw = gesture.kind === "open" ? travelled : 1 + travelled;
	return Math.max(0, Math.min(1, raw));
}

/**
 * Where the drawer lands when the finger lifts: true for open.
 *
 * Speed is read from the last two points rather than the whole drag, because what the hand is doing
 * at the moment of release is what the release means — a slow drag that ends in a flick is a flick.
 */
export function release(gesture: Gesture, width: number): boolean {
	if (gesture.declined || gesture.deciding) return gesture.kind === "close";

	const elapsed = gesture.last.t - gesture.prev.t;
	const velocity = elapsed > 0 ? (gesture.last.x - gesture.prev.x) / elapsed : 0;

	// A flick decides on its own, and can reverse a drag that had already crossed the threshold —
	// pulling the drawer most of the way out and then throwing it back is a clear "no".
	if (velocity > FLICK) return true;
	if (velocity < -FLICK) return false;

	return progress(gesture, width) > COMMIT;
}

/**
 * How wide to draw the drawer on a screen of a given width.
 *
 * Short of the full width on purpose. The strip of conversation left showing is what says the
 * drawer is over the page rather than a page of its own — so the way back is obvious without a
 * button for it, and the drag that opened it visibly has somewhere to go.
 */
export function drawerWidth(screen: number): number {
	return Math.min(Math.round(screen * 0.86), 340);
}
