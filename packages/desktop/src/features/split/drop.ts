/**
 * Which edge of a conversation pane a carry is aiming at.
 *
 * Copied in spirit from the tool dock, not imported: that one is typed on panel kinds, and
 * this one has no dead centre. A new chat being dropped onto the only pane on screen always
 * has a landing, so wobbling through the middle still picks left / right / top / bottom.
 */

import type { DropSide } from "./tree.ts";

export interface Rect {
	left: number;
	top: number;
	width: number;
	height: number;
}

const inside = (box: Rect, x: number, y: number): boolean =>
	x >= box.left && x <= box.left + box.width && y >= box.top && y <= box.top + box.height;

/** The nearest of four candidates, first one winning a tie so the answer is deterministic. */
function nearest(candidates: [DropSide, number][]): [DropSide, number] {
	let best = candidates[0]!;
	for (const candidate of candidates) if (candidate[1] < best[1]) best = candidate;
	return best;
}

/**
 * The edge the pointer is nearest, or null when it is not over the pane at all.
 *
 * Corners get a diagonal boundary for free: closer to the left than to the top is `|dx| < |dy|`.
 * A rectangular carve-up would jump as the pointer crossed a corner.
 */
export function sideOf(box: Rect, x: number, y: number): DropSide | null {
	if (box.width <= 0 || box.height <= 0) return null;
	if (!inside(box, x, y)) return null;
	const u = (x - box.left) / box.width;
	const v = (y - box.top) / box.height;
	return nearest([
		["left", u],
		["right", 1 - u],
		["top", v],
		["bottom", 1 - v],
	])[0];
}

/** How far the landing sits inside the conversation screen. The dock's card inset. */
export const DROP_INSET = 3;

/** The destination half, as shares of the pane. Used by the overlay and the tests. */
export function regionForSide(side: DropSide): Rect {
	switch (side) {
		case "left":
			return { left: 0, top: 0, width: 0.5, height: 1 };
		case "right":
			return { left: 0.5, top: 0, width: 0.5, height: 1 };
		case "top":
			return { left: 0, top: 0, width: 1, height: 0.5 };
		case "bottom":
			return { left: 0, top: 0.5, width: 1, height: 0.5 };
	}
}
