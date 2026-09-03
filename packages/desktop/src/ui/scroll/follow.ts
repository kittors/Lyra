/**
 * Whether a scrolling surface is following its own bottom, and what is allowed to change that.
 *
 * Every transcript in the window — the conversation, the side chat, a delegate's log — wants the
 * same behaviour: ride the bottom while something is arriving, stay put when the reader has gone
 * up to look at something, and offer a way back. Three copies of that grew separately and drifted,
 * so this file is the rule and the three surfaces are callers.
 *
 * Nothing here touches the DOM. Everything is a pure function of a geometry reading and an event,
 * which is what lets the interesting cases — the ones that only happen on one frame in the middle
 * of a streaming turn — be written down as tests instead of reproduced by hand.
 *
 * The one idea worth carrying out of here:
 *
 *   Following is an *intention*, not a position.
 *
 * The previous implementation asked "is scrollTop near the end?" on every scroll event and took
 * the answer as the reader's wish. But scrollTop is written by the program as well as by the
 * reader — a viewport that shrinks, an image that loads, a panel that is hidden and shown all move
 * it — so the program kept overruling the reader with its own writes. Hence the asymmetry in
 * `nextState`: leaving is driven by events (a wheel notch upwards is unambiguous, however small),
 * and returning is driven by position (there is no event for "I want to follow again"; arriving at
 * the bottom is the only way to say it).
 */

export type FollowState =
	/** Riding the bottom: tail growth and viewport changes both re-pin. */
	| "following"
	/** The reader is somewhere above, and nothing but the reader may move them. */
	| "detached"
	/** A glide back down is in flight. Interruptible — see `nextState`. */
	| "returning";

/** What a scroller looks like at one instant. The three numbers every decision here is made from. */
export interface Geometry {
	scrollTop: number;
	scrollHeight: number;
	clientHeight: number;
}

/**
 * How close to the bottom counts as "back with it", in pixels.
 *
 * Only ever used to decide *re-entry*. It used to double as the test for whether the reader had
 * left, which is what made a 50px nudge upwards impossible during a streaming turn: the nudge
 * landed inside the slack, the surface still called itself pinned, and the next token snapped it
 * back. Leaving now costs one wheel notch and no distance at all.
 *
 * Wide enough to forgive the last few pixels of an inertial scroll, narrow enough that it cannot
 * be reached by accident from a screenful away.
 */
export const FOLLOW_SLACK = 72;

/**
 * How far past the slack the reader must be before the way back is offered, in pixels.
 *
 * A second, larger threshold rather than the same one, so the button has a band it does not
 * flicker in: between `FOLLOW_SLACK` and this the surface is detached but says nothing, which is
 * where a scroll that stops just short of the end lands.
 */
export const AWAY_THRESHOLD = 160;

/**
 * A reading of the surface that decisions are made against.
 *
 * Deliberately just the geometry. What floats over the last of the content — an approval card, the
 * way-back button — is handled where it belongs, as padding at the foot of the scrolled content
 * (`--ly-bottom-inset`), so that the bottom of the page is somewhere the newest message can
 * actually be seen. Folding the overlap into the arithmetic here instead was the first attempt and
 * is wrong twice over: `scrollTop` cannot exceed `scrollHeight - clientHeight`, so a positive inset
 * would make `atBottom` unreachable and pin a transcript that can never satisfy its own test.
 */
export type Reading = Geometry;

/** The scrollTop that puts the end of the content against the foot of the viewport. */
export function visualBottom(reading: Reading): number {
	return Math.max(0, reading.scrollHeight - reading.clientHeight);
}

/** How far the reader is from the bottom. */
export function distanceToBottom(reading: Reading): number {
	return reading.scrollHeight - reading.scrollTop - reading.clientHeight;
}

/** Content that does not fill its viewport. Always "at the bottom", never worth a button. */
export function fitsInView(reading: Geometry): boolean {
	return reading.scrollHeight - reading.clientHeight <= 1;
}

/**
 * A reading taken while the surface was not on screen.
 *
 * A pane put away with `display: none`, a window minimised, a `ResizeObserver` firing as an
 * element is detached: all report zero, and zero satisfies every "at the bottom" test there is. A
 * reading like this is not evidence of anything and must never reach the state machine — acting on
 * one is how switching panels used to overwrite a session's remembered position with "top of the
 * transcript, and counted as pinned".
 */
export function isDegenerate(reading: Geometry): boolean {
	return reading.clientHeight <= 0;
}

/** Where the reader is, in the two bands that matter. */
export function atBottom(reading: Reading): boolean {
	return fitsInView(reading) || distanceToBottom(reading) <= FOLLOW_SLACK;
}

export function isAway(reading: Reading): boolean {
	return !fitsInView(reading) && distanceToBottom(reading) > AWAY_THRESHOLD;
}

/**
 * Which way a gesture was going, when that is knowable.
 *
 * A wheel or a key says so outright. Dragging the scrollbar thumb or putting a finger down does
 * not, and is reported as `"unknown"`: the position afterwards decides, which is the same rule
 * a drag that ends at the bottom has always followed.
 */
export type Direction = "up" | "down" | "unknown";

export type FollowEvent =
	/** Content appended at the end: a token, a tool card, a row settling. */
	| { kind: "tail-growth" }
	/** Something above changed size: a group folding, an image landing, an estimate cashing in. */
	| { kind: "reflow" }
	/** The box changed, not what is in it: the composer grew, a splitter moved, the window resized. */
	| { kind: "viewport" }
	/** The reader moved, and this is the only event that may change the intention. */
	| { kind: "user-scroll"; direction: Direction }
	/** The reader asked to go back: the button, End, sending a message. */
	| { kind: "user-return" }
	/** A glide arrived. */
	| { kind: "settle" }
	/** The surface now shows something else — another session, another delegate. */
	| { kind: "surface-swap"; following: boolean };

/**
 * The whole state machine.
 *
 * Reads as a table on purpose: the bugs this replaces were all one branch disagreeing with another
 * about a case neither of them named.
 */
export function nextState(state: FollowState, event: FollowEvent, reading: Reading): FollowState {
	// A reading taken while hidden is not evidence; hold whatever the reader last meant.
	if (isDegenerate(reading) && event.kind !== "surface-swap") return state;

	switch (event.kind) {
		case "surface-swap":
			// The incoming surface's own remembered intention, never the outgoing one's. Carrying the
			// previous session's `pinned` across is what made a transcript you had scrolled up in hand
			// its position — and its unread dot — to whichever conversation you opened next.
			return event.following ? "following" : "detached";

		case "user-scroll":
			// A gesture during the ride back is a change of mind, whichever way it points. Checked
			// before the direction, so that a downward nudge mid-glide stops the animation rather
			// than being read as "yes, keep going" — the reader touched the surface, which is the
			// whole signal.
			if (state === "returning") return "detached";
			if (event.direction === "up") {
				// Zero threshold, deliberately. One notch upwards during a streaming turn is a complete
				// sentence: "stop moving". Asking how far it went is what made the first 80px of every
				// such gesture disappear.
				return "detached";
			}
			// Downwards, or a drag whose direction is not knowable: the position answers. Reaching the
			// bottom is the only way to say "follow again", so it has to be enough on its own.
			return atBottom(reading) ? "following" : "detached";

		case "user-return":
			// From the bottom there is nowhere to glide to; claiming otherwise costs a 420ms animation
			// that moves nothing and a frame of the button fading out of its own click.
			return atBottom(reading) ? "following" : "returning";

		case "settle":
			// Only a glide that ran to completion lands here — an interrupted one has already been
			// taken to `detached` by the gesture that interrupted it.
			return state === "returning" ? "following" : state;

		case "tail-growth":
		case "reflow":
		case "viewport":
			/*
			 * None of these may change the intention.
			 *
			 * This is the half of the rule that keeps being lost. Every one of them changes geometry,
			 * and reading the new geometry back as an answer to "does the reader want to follow?" is
			 * how typing into a composer that grows by 200px produced a 「回到最新」 button, and how a
			 * pane briefly reporting 0×0 produced a pinned transcript scrolled to its top.
			 */
			return state;
	}
}

/**
 * Where the surface should be after an event, or `null` to leave it alone.
 *
 * Split from `nextState` because they answer different questions and get called at different
 * times: the state is decided in an event handler, the position is applied in a layout effect
 * before paint. Returning `null` — rather than the current `scrollTop` — is what lets the caller
 * skip the write entirely, and skipping it is what keeps an inertial scroll from being cancelled.
 */
export function targetScrollTop(state: FollowState, reading: Reading): number | null {
	if (isDegenerate(reading)) return null;
	if (state !== "following") return null;
	const target = visualBottom(reading);
	// Already there. Writing it anyway is not free: assigning `scrollTop` cancels a fling in
	// progress, and on a pinned transcript that assignment happens on every streamed token.
	if (Math.abs(reading.scrollTop - target) < 1) return null;
	return target;
}

// ---------------------------------------------------------------------------
// Unread
// ---------------------------------------------------------------------------

/**
 * Enough of a transcript to tell whether anything actually arrived.
 *
 * `count` alone misses a reply being written — one message, growing. `tail` alone misses two
 * messages landing at once with the same-looking end. Together they are what "is this the same
 * transcript I last looked at?" needs, and — the part that matters — they are both *values*, so a
 * transcript re-read from disk and handed back as a fresh array compares equal to the one it
 * replaced.
 */
export interface Marker {
	count: number;
	/** Something that changes when the last row does: its key plus how much of it exists. */
	tail: string;
}

export function marker(count: number, tail: string): Marker {
	return { count, tail };
}

export function sameMarker(a: Marker | null, b: Marker | null): boolean {
	if (a === b) return true;
	if (!a || !b) return false;
	return a.count === b.count && a.tail === b.tail;
}

/**
 * How many messages have arrived since the reader last saw the end.
 *
 * The bug this exists to make impossible: 「有新内容」 lighting up for a transcript that had merely
 * been handed to React again. Opening a session sets its messages twice — once from the cache,
 * once when the read off disk lands — and the second set changes the array's identity and nothing
 * else. An unread flag driven by identity called that new content. This is driven by the two
 * numbers above, so the second set contributes nothing.
 *
 * Rewinds and compactions shorten the transcript. Neither is new content, and neither leaves the
 * reader anything to catch up on, so both report zero.
 */
export function unreadSince(seen: Marker | null, now: Marker): number {
	if (!seen) return 0;
	if (now.count < seen.count) return 0;
	const added = now.count - seen.count;
	if (added > 0) return added;
	// Same number of messages: the only thing that can have changed is the last one, and a reply
	// growing under the reader's eye is one thing to catch up on however many tokens it gains.
	return now.tail === seen.tail ? 0 : 1;
}
