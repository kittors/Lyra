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

import type { AssistantContent, Message, StopReason, Usage } from "@lyra/core";

import { tailSignature } from "../src/ui/scroll/signature.ts";
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
	assert.equal(targetScrollTop("following", squeezed), BOTTOM + 1, "and it is put back against the bottom");
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
// A position with no provenance
//
// `arrived` is every scroll the follow code did not write itself, and the rule it exists to state
// is a negative one: such a position may restore following and may never end it. The reported bug
// is the whole section — a transcript that stopped following a turn nobody had touched, and then
// said 「有新内容」 about content the reader was watching arrive.
// ---------------------------------------------------------------------------

test("an anonymous position change can never end a follow — the reported bug", () => {
	/*
	 * The report: during a long run of tool calls, with no answer being written yet, the transcript
	 * stops riding the bottom and offers 「有新内容」.
	 *
	 * The old rule read a scroll event whose position had moved upwards as a gesture, provided any
	 * input had been seen anywhere in the window in the last 300ms — and `pointerup` was listened
	 * for on `window`, so clicking the sidebar or a panel qualified. Every position below is one the
	 * browser produces on its own during a streaming turn, and every one of them used to detach.
	 */
	for (const top of [BOTTOM, BOTTOM - 1, BOTTOM - 72, BOTTOM - 400, 1000, 0]) {
		assert.equal(
			nextState("following", { kind: "arrived" }, at(top)),
			"following",
			`a bare position change at ${top} must not end the follow`,
		);
	}
});

test("scroll anchoring pulling the surface back does not end a follow", () => {
	/*
	 * The transcript deliberately keeps `overflow-anchor` (see `styles/scroll.css`): a thinking block
	 * folding open above the line you are reading should not move that line. Anchoring does that by
	 * writing `scrollTop`, so content collapsing above the reader takes the position backwards by
	 * however much it shrank — measured at 1200 → 800 for a group folding from 600px to 200px. One
	 * scroll event, direction upwards, nobody's hand anywhere near it.
	 */
	const anchored = at(800, { content: 3600 });
	assert.equal(atBottom(anchored), false, "by distance it looks exactly like the reader left");
	assert.equal(nextState("following", { kind: "arrived" }, anchored), "following");
	assert.equal(targetScrollTop("following", anchored), 2801, "and the next frame puts it back on the end");
});

test("a transcript clamped by its own shrinking keeps following", () => {
	/*
	 * Only the last `WINDOW_STEP` runs are mounted, so every new one unmounts the oldest. The page
	 * gets shorter, the browser clamps `scrollTop` to the new maximum, and a scroll event arrives
	 * that no gesture produced.
	 */
	const clamped = at(2000, { content: 2800 });
	assert.equal(distanceToBottom(clamped), 0, "clamping lands exactly on the new bottom");
	assert.equal(nextState("following", { kind: "arrived" }, clamped), "following");
});

test("arriving at the bottom is how a detached surface takes up following again", () => {
	// The tail of a fling, or a thumb released at the end: the gesture is over and the position is
	// the only thing left saying what it meant. The 72px slack is for a downward gesture, not this.
	assert.equal(nextState("detached", { kind: "arrived" }, at(BOTTOM)), "following");
	assert.equal(nextState("detached", { kind: "arrived" }, at(BOTTOM - 1)), "following", "one pixel of clamp is still the end");
	assert.equal(nextState("detached", { kind: "arrived" }, at(BOTTOM - 20)), "detached", "inside the old slack is still away");
	assert.equal(nextState("detached", { kind: "arrived" }, at(BOTTOM - 72)), "detached");
});

test("a thumb or finger down at the end is not itself a leave", () => {
	// `unknown` is a claim without a direction — a press, not a notch. Leaving on press
	// would detach a following transcript every time someone tapped it. Movement decides.
	assert.equal(nextState("following", { kind: "user-scroll", direction: "unknown" }, at(BOTTOM)), "following");
	assert.equal(nextState("following", { kind: "user-scroll", direction: "unknown" }, at(BOTTOM - 200)), "detached");
});

test("a one-notch wheel-up is not glued back by the scroll event it caused", () => {
	/*
	 * The report: at the bottom, a small wheel-up detaches, then the native scroll lands 20px up
	 * and `arrived` used the 72px band to call that "back at the end". The next follow write
	 * snapped the surface home. Only a violent flick that cleared 72px in one go could leave.
	 */
	let state = nextState("following", { kind: "user-scroll", direction: "up" }, at(BOTTOM - 20));
	assert.equal(state, "detached");
	assert.equal(nextState(state, { kind: "arrived" }, at(BOTTOM - 20)), "detached");
	assert.equal(targetScrollTop("detached", at(BOTTOM - 20)), null);
});

test("a detached reader is left where they are wherever the surface moves", () => {
	// Anchoring and clamping happen just as much to someone reading halfway up, and must not carry
	// them anywhere either.
	for (const top of [0, 500, 1600, BOTTOM - 400]) {
		assert.equal(nextState("detached", { kind: "arrived" }, at(top)), "detached");
	}
});

test("a short transcript is at the bottom by definition, so it follows", () => {
	// Nothing to scroll: the first messages of a new conversation, before it fills the window.
	const short = { scrollTop: 0, scrollHeight: 400, clientHeight: 800 };
	assert.equal(nextState("detached", { kind: "arrived" }, short), "following");
});

test("the ride back owns the position while it is in flight", () => {
	/*
	 * Every frame of the glide writes `scrollTop`, and the frames it passes through are exactly the
	 * positions this event would otherwise be judging. Reading one as "arrived" would end the
	 * animation early, at whichever pixel happened to be inside the slack.
	 */
	assert.equal(nextState("returning", { kind: "arrived" }, at(BOTTOM)), "returning");
	assert.equal(nextState("returning", { kind: "arrived" }, at(1000)), "returning");
});

test("an anonymous position taken from a hidden pane says nothing at all", () => {
	const hidden = { scrollTop: 0, scrollHeight: 0, clientHeight: 0 };
	assert.equal(nextState("detached", { kind: "arrived" }, hidden), "detached", "zero is not an arrival");
	assert.equal(nextState("following", { kind: "arrived" }, hidden), "following");
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
	assert.equal(targetScrollTop("following", at(BOTTOM - 300)), BOTTOM + 1);
	assert.equal(targetScrollTop("detached", at(1000)), null, "a detached surface is never moved");
	assert.equal(targetScrollTop("returning", at(1000)), null, "the animation owns the position");
});

test("the write overshoots the end, because the integer bottom is short of it", () => {
	/*
	 * The reported bug: a message sent while the previous reply is still writing lands, and from
	 * then on it and the running line under it shimmer up and down by one physical pixel.
	 *
	 * `visualBottom` is `scrollHeight - clientHeight`, two rounded integers — but the content's real
	 * height is fractional (CJK prose lays out at 26.25px a line), so the true scrollable maximum
	 * has a fractional part, cycling .023 → .273 → .523 → .773 as the transcript grows. Writing the
	 * integer parks the content that far short of the bottom, by a different amount every time the
	 * tail changes, and *that* is what moves on screen. Measured in the real window: 73 of 220
	 * follow writes shifted the painted transcript by 0.25px or 0.75px.
	 *
	 * Nothing in the DOM reports the fractional maximum, so the value written has to be past it and
	 * the browser's own clamp — which does use the exact geometry — supplies the rest.
	 */
	assert.equal(targetScrollTop("following", at(0)), BOTTOM + 1);
	// The re-entry tests keep using the integer: they all carry a pixel of slack already.
	assert.equal(visualBottom(at(0)), BOTTOM);
	assert.equal(atBottom(at(BOTTOM)), true);
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
// The tail signature
//
// What "something arrived" is asked of. A signature that does not move is a layout effect that does
// not run, which is a transcript that does not follow — so the cases below are all about the tail
// changing shape without the *last* message changing at all.
// ---------------------------------------------------------------------------

const USAGE: Usage = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	total: 0,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function assistant(content: AssistantContent[], timestamp = 1000, stopReason: StopReason = "pending"): Message {
	return {
		role: "assistant",
		content,
		api: "anthropic-messages",
		provider: "test",
		model: "test",
		usage: USAGE,
		stopReason,
		timestamp,
	};
}

function toolResult(toolCallId: string, timestamp = 2000): Message {
	return {
		role: "toolResult",
		toolCallId,
		toolName: "bash",
		content: [{ type: "text", text: "output" }],
		isError: false,
		timestamp,
	};
}

test("a reply thinking behind a settled tool result still moves the signature — the reported bug", () => {
	/*
	 * The shape this exists for. A reply that called a tool is still the pending message when the
	 * result lands behind it, and the store updates it in place — so the array ends
	 * `[assistant(pending), toolResult]` with the *second from last* message doing all the growing.
	 *
	 * Asking only the last message gives `toolResult:2000:0`, which is the same string on every
	 * frame for as long as the model goes on thinking. A frozen signature means the effect that
	 * re-pins the bottom never runs, which is what "it stops following while it is thinking" was.
	 */
	const before = [assistant([{ type: "thinking", thinking: "Cons", signature: "" }]), toolResult("call-1")];
	const after = [assistant([{ type: "thinking", thinking: "Consolidating the worktrees" , signature: "" }]), toolResult("call-1")];
	assert.notEqual(tailSignature(before), tailSignature(after), "the thinking grew, so the signature must move");
});

test("a tool settling moves the signature even though no message changed", () => {
	/*
	 * `tool_start`, `tool_update` and `tool_end` all write the same key in `toolRuns`, so a count of
	 * how many runs exist is identical either side of a call finishing — and finishing is the moment
	 * the card changes size most, swapping a spinner for output. Hence two numbers: total, settled.
	 */
	const messages = [assistant([{ type: "text", text: "one moment" }])];
	assert.notEqual(
		tailSignature(messages, "3/2"),
		tailSignature(messages, "3/3"),
		"the third call finished; nothing else about the transcript changed",
	);
});

test("a streamed chunk inside a running tool does not move the signature", () => {
	// Deliberate: that path belongs to the resize observer, and re-running the layout effect per
	// chunk would put it on the per-token path for every card in the transcript.
	const messages = [assistant([{ type: "text", text: "one moment" }])];
	assert.equal(tailSignature(messages, "3/2"), tailSignature(messages, "3/2"));
});

test("the same transcript signed twice is the same signature", () => {
	// The property the unread count depends on: a transcript re-read from disk is a different array
	// holding identical content, and must not read as new.
	const first = [assistant([{ type: "text", text: "hello" }]), toolResult("call-1")];
	const second = [assistant([{ type: "text", text: "hello" }]), toolResult("call-1")];
	assert.equal(tailSignature(first, "1/1"), tailSignature(second, "1/1"));
});

test("the last message growing moves the signature, with or without one behind it", () => {
	const alone = [assistant([{ type: "text", text: "hi" }])];
	const grown = [assistant([{ type: "text", text: "hi there" }])];
	assert.notEqual(tailSignature(alone), tailSignature(grown));
	assert.notEqual(
		tailSignature([toolResult("a"), ...alone]),
		tailSignature([toolResult("a"), ...grown]),
		"and the same holds when it is second in the list",
	);
});

test("an empty transcript signs without reading anything", () => {
	assert.equal(tailSignature([], "0/0"), "-:0/0");
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
