/**
 * Whether a transcript follows its own bottom, and what is allowed to decide that.
 *
 * Every case below is one that was reported or reasoned out against the old implementation, where
 * the answer was recomputed from `scrollTop` on every event. Nothing here reimplements the rule —
 * `nextState` and the predicates are imported from the code that runs, for the reason spelled out
 * at the top of `glide.test.ts`: a rule copied into a test file can never disagree with itself.
 *
 * What the tests supply is readings and events.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
	atBottom,
	distanceToBottom,
	fitsInView,
	followsAfterRestore,
	isAway,
	isDegenerate,
	marker,
	nextState,
	sameMarker,
	targetScrollTop,
	unreadSince,
	visualBottom,
	type FollowEvent,
	type FollowState,
	type Reading,
} from "../src/ui/scroll/follow.ts";

/**
 * A transcript of `content` pixels in a `view`-pixel window, scrolled to `top`.
 *
 * Named rather than built inline so the interesting number in each test is the one that differs.
 */
function at(top: number, { content = 4000, view = 800 }: { content?: number; view?: number } = {}): Reading {
	return { scrollTop: top, scrollHeight: content, clientHeight: view };
}

/** The bottom of the default transcript above: 4000 − 800. */
const BOTTOM = 3200;

// ---------------------------------------------------------------------------
// Reading the geometry
// ---------------------------------------------------------------------------

test("the bottom is where the end of the content meets the foot of the view", () => {
	assert.equal(visualBottom(at(0)), BOTTOM);
	assert.equal(distanceToBottom(at(BOTTOM)), 0);
	assert.equal(distanceToBottom(at(BOTTOM - 50)), 50);
});

test("content that fits is always at the bottom and never away", () => {
	const short = { scrollTop: 0, scrollHeight: 400, clientHeight: 800 };
	assert.equal(fitsInView(short), true);
	assert.equal(atBottom(short), true);
	assert.equal(isAway(short), false);
	assert.equal(visualBottom(short), 0, "and there is nowhere to scroll it to");
});

test("the two thresholds leave a band where the surface is detached but says nothing", () => {
	// Between the slack and the away threshold: no longer following, not yet worth a button.
	assert.equal(atBottom(at(BOTTOM - 100)), false, "100px up is past the slack");
	assert.equal(isAway(at(BOTTOM - 100)), false, "but not yet far enough to offer a way back");
	assert.equal(isAway(at(BOTTOM - 400)), true);
	// And the band is what keeps the button from flickering as a scroll settles near the end.
	assert.equal(isAway(at(BOTTOM - 30)), false);
});

test("a reading taken while the pane is hidden is not a reading", () => {
	/*
	 * A pane put away with `display: none`, a `ResizeObserver` firing as an element detaches, a
	 * minimised window: all report zero, and zero satisfies every at-the-bottom test there is.
	 * Acting on one is how switching dock panels used to overwrite a conversation's remembered
	 * position with "scrolled to the top, and counted as pinned".
	 */
	const hidden = { scrollTop: 0, scrollHeight: 0, clientHeight: 0 };
	assert.equal(isDegenerate(hidden), true);
	assert.equal(atBottom(hidden), true, "which is exactly why it must never be asked");
});

// ---------------------------------------------------------------------------
// Leaving is an event; returning is a position
// ---------------------------------------------------------------------------

test("one notch upwards detaches, however small — the reported bug", () => {
	/*
	 * The report: during a streaming reply, scrolling up to re-read the previous paragraph does
	 * nothing. The old rule asked how far the gesture had gone and compared it against the slack,
	 * so anything under 80px still counted as pinned and the next token snapped it back. Tokens
	 * arrive every few tens of milliseconds, so within that distance the wheel simply did not work.
	 */
	const barely = at(BOTTOM - 12);
	assert.equal(atBottom(barely), true, "still inside the slack, by the old measure");
	assert.equal(nextState("following", { kind: "user-scroll", direction: "up" }, barely), "detached");
});

test("downwards re-attaches only on arrival", () => {
	assert.equal(nextState("detached", { kind: "user-scroll", direction: "down" }, at(BOTTOM - 400)), "detached");
	assert.equal(nextState("detached", { kind: "user-scroll", direction: "down" }, at(BOTTOM - 10)), "following");
});

test("a drag whose direction is not knowable is answered by where it ended", () => {
	// The scrollbar thumb and a finger report no direction; the position is the whole answer.
	assert.equal(nextState("following", { kind: "user-scroll", direction: "unknown" }, at(BOTTOM - 900)), "detached");
	assert.equal(nextState("detached", { kind: "user-scroll", direction: "unknown" }, at(BOTTOM)), "following");
});

// ---------------------------------------------------------------------------
// Nothing else may change the intention
// ---------------------------------------------------------------------------

test("growing content does not decide anything", () => {
	for (const state of ["following", "detached"] as FollowState[]) {
		assert.equal(nextState(state, { kind: "tail-growth" }, at(BOTTOM - 400)), state);
	}
});

test("a shrinking viewport keeps following — the composer growing as you type", () => {
	/*
	 * Pasting twenty lines into the composer takes 200px off the transcript's height without
	 * touching its content. The old code re-tested the distance, found 200 > 80, and concluded the
	 * reader had scrolled away: a 「回到最新」 button appearing while you type, on a transcript
	 * nobody had moved.
	 */
	const squeezed = at(BOTTOM - 200);
	assert.equal(atBottom(squeezed), false, "by distance alone it looks like the reader left");
	assert.equal(nextState("following", { kind: "viewport" }, squeezed), "following");
	assert.equal(targetScrollTop("following", squeezed), BOTTOM, "and it is put back against the bottom");
});

test("a reflow above does not decide anything either", () => {
	// A tool group folding open, an image landing, an estimated row cashing in its real height.
	assert.equal(nextState("detached", { kind: "reflow" }, at(1000)), "detached");
	assert.equal(nextState("following", { kind: "reflow" }, at(1000)), "following");
});

test("a hidden pane cannot change the state at all", () => {
	const hidden = { scrollTop: 0, scrollHeight: 0, clientHeight: 0 };
	assert.equal(nextState("detached", { kind: "viewport" }, hidden), "detached");
	assert.equal(nextState("detached", { kind: "user-scroll", direction: "down" }, hidden), "detached");
	assert.equal(targetScrollTop("following", hidden), null, "and nothing is written to it");
});

// ---------------------------------------------------------------------------
// The ride back
// ---------------------------------------------------------------------------

test("asking to go back from the bottom is not a journey", () => {
	assert.equal(nextState("following", { kind: "user-return" }, at(BOTTOM)), "following");
	assert.equal(nextState("detached", { kind: "user-return" }, at(BOTTOM - 5)), "following", "inside the slack");
	assert.equal(nextState("detached", { kind: "user-return" }, at(1000)), "returning");
});

test("any gesture during the ride ends it, in either direction", () => {
	// The 420ms during which the old implementation ignored the wheel entirely — half a second of
	// the surface pulling against the reader's hand.
	assert.equal(nextState("returning", { kind: "user-scroll", direction: "up" }, at(2000)), "detached");
	assert.equal(nextState("returning", { kind: "user-scroll", direction: "down" }, at(2000)), "detached");
	assert.equal(nextState("returning", { kind: "user-scroll", direction: "unknown" }, at(BOTTOM)), "detached");
});

test("only a ride that finishes settles into following", () => {
	assert.equal(nextState("returning", { kind: "settle" }, at(BOTTOM)), "following");
	assert.equal(nextState("detached", { kind: "settle" }, at(BOTTOM)), "detached", "a stale frame changes nothing");
});

test("the write is skipped when there is nothing to move", () => {
	// Assigning `scrollTop` cancels an inertial scroll in progress, and on a pinned transcript the
	// assignment would otherwise happen on every streamed token.
	assert.equal(targetScrollTop("following", at(BOTTOM)), null);
	assert.equal(targetScrollTop("following", at(BOTTOM - 300)), BOTTOM);
	assert.equal(targetScrollTop("detached", at(1000)), null, "a detached surface is never moved");
	assert.equal(targetScrollTop("returning", at(1000)), null, "the animation owns the position");
});

// ---------------------------------------------------------------------------
// Swapping surfaces
// ---------------------------------------------------------------------------

test("a swap takes the incoming surface's intention, never the outgoing one's", () => {
	/*
	 * `pinned` was a ref that outlived the conversation it described. Scroll up in one conversation,
	 * open another, and the new one inherited "not following" — which is half of why the remembered
	 * position never worked and all of why the unread dot appeared on a transcript nobody had added
	 * anything to.
	 */
	assert.equal(nextState("detached", { kind: "surface-swap", following: true }, at(0)), "following");
	assert.equal(nextState("following", { kind: "surface-swap", following: false }, at(0)), "detached");
});

test("a swap is decided even from a hidden pane", () => {
	// The one event that must survive a degenerate reading: opening a conversation into a pane that
	// has not been laid out yet is ordinary, and it still has to arrive following.
	const hidden = { scrollTop: 0, scrollHeight: 0, clientHeight: 0 };
	assert.equal(nextState("detached", { kind: "surface-swap", following: true }, hidden), "following");
});

test("a return in flight is remembered as an intention to follow", () => {
	/*
	 * Opening another conversation during the 420ms glide used to collapse `returning` to false.
	 * Coming back then restored the intermediate scrollTop as detached and offered the same button
	 * again, even though the reader had already asked to return.
	 */
	assert.equal(followsAfterRestore("following"), true);
	assert.equal(followsAfterRestore("returning"), true);

	const interrupted = nextState("returning", { kind: "user-scroll", direction: "up" }, at(1800));
	assert.equal(interrupted, "detached");
	assert.equal(
		followsAfterRestore(interrupted),
		false,
		"an interrupted return still preserves the reader's position",
	);
});

// ---------------------------------------------------------------------------
// Unread
// ---------------------------------------------------------------------------

test("the same transcript handed over twice is not new content — the reported bug", () => {
	/*
	 * Opening a session sets its messages twice: once from the cache, once when the read off disk
	 * lands. The second set changes the array's identity and nothing else. An unread flag driven by
	 * identity called that new content, which is why a conversation you had merely scrolled up in
	 * and come back to greeted you with 「有新内容」 over messages you had already read.
	 */
	const before = marker(42, "assistant-1730000000000-41:900");
	const after = marker(42, "assistant-1730000000000-41:900");
	assert.equal(sameMarker(before, after), true, "different objects, same transcript");
	assert.equal(unreadSince(before, after), 0);
});

test("messages arriving are counted", () => {
	const seen = marker(10, "a:100");
	assert.equal(unreadSince(seen, marker(13, "b:20")), 3);
});

test("a reply being written counts once, however many tokens it gains", () => {
	const seen = marker(10, "assistant-7-9:120");
	assert.equal(unreadSince(seen, marker(10, "assistant-7-9:340")), 1);
	assert.equal(unreadSince(seen, marker(10, "assistant-7-9:980")), 1, "still the one reply");
});

test("a rewind or a compaction leaves nothing to catch up on", () => {
	const seen = marker(40, "z:10");
	assert.equal(unreadSince(seen, marker(12, "m:4")), 0);
});

test("a surface with no mark yet reports nothing unread", () => {
	// Where every surface starts: it has been read up to wherever it opens.
	assert.equal(unreadSince(null, marker(80, "x:1")), 0);
});

// ---------------------------------------------------------------------------
// The two reported paths, end to end
// ---------------------------------------------------------------------------

test("scrolling up mid-reply, then the reply continuing", () => {
	/*
	 * Frame by frame: a turn is streaming and pinned, the reader nudges up 40px to re-read
	 * something, and three more tokens land. The nudge has to survive all three.
	 */
	let state: FollowState = "following";
	const play = (event: FollowEvent, reading: Reading) => {
		state = nextState(state, event, reading);
		return state;
	};

	assert.equal(play({ kind: "tail-growth" }, at(BOTTOM)), "following");
	assert.equal(play({ kind: "user-scroll", direction: "up" }, at(BOTTOM - 40)), "detached");
	for (const content of [4200, 4400, 4600]) {
		assert.equal(
			play({ kind: "tail-growth" }, at(BOTTOM - 40, { content })),
			"detached",
			"the reader's nudge outranks every token that follows it",
		);
		assert.equal(targetScrollTop(state, at(BOTTOM - 40, { content })), null, "and nothing moves them");
	}
});

test("scrolling up, switching away, and coming back", () => {
	/*
	 * The other report. The position is remembered as an intention plus an offset, and the unread
	 * count is recomputed from the transcript rather than from the fact that it was re-assigned.
	 */
	let state: FollowState = "following";
	state = nextState(state, { kind: "user-scroll", direction: "up" }, at(1200));
	assert.equal(state, "detached");

	const parked = { following: state === "following", scrollTop: 1200, seen: marker(42, "a:900") };

	// Somewhere else for a while, then back — and the transcript is unchanged.
	state = nextState("following", { kind: "surface-swap", following: parked.following }, at(1200));
	assert.equal(state, "detached", "still where the reader left it");
	assert.equal(unreadSince(parked.seen, marker(42, "a:900")), 0, "and nothing claims to be new");

	// Now the same return, but two replies did land while away.
	assert.equal(unreadSince(parked.seen, marker(44, "c:30")), 2);
});
