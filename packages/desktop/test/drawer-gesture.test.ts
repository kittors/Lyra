/**
 * Telling a drawer pull apart from a scroll.
 *
 * Both start as a finger landing near the left edge and moving. Getting it wrong is felt straight
 * away in one of two ways — a transcript that will not scroll, or a drawer that will not open — so
 * the ambiguous cases below are the point of the file, not the clean ones.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { begin, drawerWidth, EDGE, extend, progress, release, type Point } from "../src/mobile/drawer-gesture.ts";

const WIDTH = 300;

/** Replay a path from a starting touch, one point every 16ms unless the point says otherwise. */
function swipe(from: Point, path: [number, number, number?][], open = false) {
	let gesture = begin(from, open);
	assert.ok(gesture, "手势应当能开始");
	let at = from.t;
	for (const [x, y, dt] of path) {
		at += dt ?? 16;
		gesture = extend(gesture, { x, y, t: at });
	}
	return gesture;
}

test("a drag from the middle of the screen is not a drawer pull", () => {
	// Otherwise every sideways movement over the transcript would fight the drawer for the gesture.
	assert.equal(begin({ x: 200, y: 400, t: 0 }, false), null);
});

test("but with the drawer already open, anywhere is fair — it is being pushed back", () => {
	const gesture = begin({ x: 200, y: 400, t: 0 }, true);
	assert.equal(gesture?.kind, "close");
});

test("a horizontal pull from the edge opens it, and follows the finger", () => {
	const gesture = swipe({ x: 10, y: 400, t: 0 }, [
		[40, 402],
		[90, 404],
		[160, 405],
	]);
	assert.equal(gesture.declined, false);
	assert.equal(gesture.deciding, false);
	assert.equal(progress(gesture, WIDTH), 150 / WIDTH);
});

test("a vertical scroll that starts on the edge is left alone", () => {
	// The common case this whole decision exists for: a thumb resting near the edge, scrolling.
	const gesture = swipe({ x: 10, y: 400, t: 0 }, [
		[12, 370],
		[14, 320],
		[16, 250],
	]);
	assert.equal(gesture.declined, true);
	assert.equal(progress(gesture, WIDTH), 0, "被拒绝的手势不该移动抽屉");
});

test("a scroll with a sideways wobble is still a scroll", () => {
	/*
	 * A thumb pivots around a knuckle, so a "vertical" swipe arrives with a real horizontal
	 * component. At a 1:1 test this reads as a drawer pull and the page locks up mid-scroll.
	 */
	const gesture = swipe({ x: 12, y: 400, t: 0 }, [
		[24, 388],
		[34, 360],
		[40, 320],
	]);
	assert.equal(gesture.declined, true);
});

test("a diagonal that clearly leads sideways is a pull", () => {
	const gesture = swipe({ x: 8, y: 400, t: 0 }, [
		[50, 388],
		[110, 376],
	]);
	assert.equal(gesture.declined, false);
});

test("the verdict is reached once and then holds", () => {
	/*
	 * A drag that curves is still the gesture it started as. Re-deciding each frame would mean a
	 * drawer that detaches from the finger halfway through, or a scroll that suddenly grabs one.
	 */
	const pulled = swipe({ x: 8, y: 400, t: 0 }, [
		[60, 400],
		[80, 300],
		[90, 180],
	]);
	assert.equal(pulled.declined, false, "拐弯了也还是当初那个手势");

	const scrolled = swipe({ x: 8, y: 400, t: 0 }, [
		[10, 340],
		[120, 330],
		[200, 328],
	]);
	assert.equal(scrolled.declined, true);
});

test("a stationary thumb decides nothing", () => {
	// Below the slop threshold there is no direction to read, and guessing at one would resolve
	// the gesture before the user has expressed it.
	const gesture = swipe({ x: 8, y: 400, t: 0 }, [
		[10, 401],
		[11, 403],
	]);
	assert.equal(gesture.deciding, true);
	assert.equal(gesture.declined, false);
});

test("pulling the wrong way is slack, not a gesture", () => {
	// An open drawer dragged further left, or a closed one pushed right off the edge, has nowhere
	// to go; treating it as a drag would move the drawer somewhere it cannot stay.
	const gesture = begin({ x: 200, y: 400, t: 0 }, true);
	assert.ok(gesture);
	const pulled = extend(gesture, { x: 260, y: 402, t: 16 });
	assert.equal(pulled.declined, true);
});

test("the drawer never goes further than open or further than shut", () => {
	const overshot = swipe({ x: 8, y: 400, t: 0 }, [
		[100, 400],
		[600, 400],
	]);
	assert.equal(progress(overshot, WIDTH), 1);

	const pushedPast = swipe({ x: 280, y: 400, t: 0 }, [[-400, 400]], true);
	assert.equal(progress(pushedPast, WIDTH), 0);
});

test("letting go past the commit point finishes opening", () => {
	const gesture = swipe({ x: 8, y: 400, t: 0 }, [
		[60, 400],
		[130, 400],
	]);
	assert.equal(release(gesture, WIDTH), true);
});

test("letting go early puts it back", () => {
	// Slowly — a hesitant drag, not a flick, so the distance rule is the one being read.
	const gesture = swipe({ x: 8, y: 400, t: 0 }, [
		[30, 400, 100],
		[60, 400, 100],
	]);
	assert.equal(release(gesture, WIDTH), false);
});

test("a flick opens it from anywhere, without waiting to see it move", () => {
	// 40px in 16ms — the drawer is thrown, not dragged, and people do this without looking.
	const gesture = swipe({ x: 8, y: 400, t: 0 }, [
		[30, 400],
		[70, 400],
	]);
	assert.equal(release(gesture, WIDTH), true);
});

test("a flick back closes it even from most of the way out", () => {
	/*
	 * Pulling the drawer nearly open and then throwing it back is an unambiguous "no", and the
	 * distance rule alone would read it as a yes.
	 */
	const gesture = swipe({ x: 8, y: 400, t: 0 }, [
		[200, 400],
		[260, 400],
		[180, 400],
	]);
	assert.equal(release(gesture, WIDTH), false);
});

test("a declined gesture leaves the drawer exactly where it was", () => {
	const scroll = swipe({ x: 8, y: 400, t: 0 }, [
		[10, 340],
		[12, 260],
	]);
	assert.equal(release(scroll, WIDTH), false, "关着的抽屉滚动后仍然关着");

	const openScroll = swipe({ x: 200, y: 400, t: 0 }, [[202, 300]], true);
	assert.equal(release(openScroll, WIDTH), true, "开着的抽屉滚动后仍然开着");
});

test("a touch that never moves changes nothing", () => {
	// A tap arrives as a begin and a release with nothing in between.
	const tap = begin({ x: 8, y: 400, t: 0 }, false);
	assert.ok(tap);
	assert.equal(release(tap, WIDTH), false);

	const tapOpen = begin({ x: 8, y: 400, t: 0 }, true);
	assert.ok(tapOpen);
	assert.equal(release(tapOpen, WIDTH), true);
});

test("two points at the same instant do not divide by zero", () => {
	// Coalesced touch events can carry identical timestamps.
	const gesture = swipe({ x: 8, y: 400, t: 0 }, [
		[60, 400, 16],
		[130, 400, 0],
	]);
	assert.equal(Number.isFinite(release(gesture, WIDTH) ? 1 : 0), true);
	assert.equal(release(gesture, WIDTH), true, "落回距离判定");
});

test("the edge strip is wide enough to hit but not to intrude", () => {
	assert.ok(begin({ x: EDGE - 1, y: 400, t: 0 }, false));
	assert.equal(begin({ x: EDGE + 1, y: 400, t: 0 }, false), null);
});

test("the drawer leaves some of the page showing, at any screen size", () => {
	/*
	 * The visible strip is what says the drawer is *over* the conversation — it is how you know to
	 * tap outside rather than hunt for a close button.
	 */
	for (const screen of [320, 375, 390, 430, 744]) {
		assert.ok(drawerWidth(screen) < screen, `${screen} 宽的屏幕上抽屉应当留出余地`);
	}
	// And on a tablet it stops widening rather than becoming a very long line of text.
	assert.equal(drawerWidth(744), 340);
});
