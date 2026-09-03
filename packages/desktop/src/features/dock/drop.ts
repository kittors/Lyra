/**
 * Where a dragged pane would land, given where the pointer is.
 *
 * Pure geometry, deliberately: this decides the single most visible thing about the drag, and
 * getting it wrong is the difference between "the layout does what I meant" and "the layout
 * fights me". Stated as arithmetic over rectangles, it can be tested at every boundary instead
 * of being eyeballed by dragging a real pane around a real window.
 */

import { EDGE_BAND, ROOT_BAND } from "./geometry.ts";
import type { DropAt, DropSide, PaneKind } from "./tree.ts";

/** The parts of a `DOMRect` this needs, so tests can pass plain objects. */
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
	let best = candidates[0];
	for (const candidate of candidates) if (candidate[1] < best[1]) best = candidate;
	return best;
}

/**
 * Which edge band of a pane the pointer is in, or null for its middle.
 *
 * The four bands are measured as shares of the pane's own width and height, so a tall narrow pane
 * and a short wide one both offer four bands you can actually hit. Taking the *nearest* edge is
 * also what gives the corners a diagonal boundary for free: at a corner, being closer to the left
 * edge than to the top edge is precisely the condition `|dx| < |dy|` describes. A rectangular
 * carve-up would make the answer jump as the pointer crosses a corner; this one changes along a
 * straight line through it.
 *
 * The middle returning null is the whole reason for the band being 28% rather than 50%: dropping
 * a pane onto the centre of another should do nothing, so a hand that wobbles mid-drag does not
 * split a pane the user was only passing over.
 */
export function edgeOf(box: Rect, x: number, y: number): DropSide | null {
	if (box.width <= 0 || box.height <= 0) return null;
	if (!inside(box, x, y)) return null;
	const u = (x - box.left) / box.width;
	const v = (y - box.top) / box.height;
	const best = nearest([
		["left", u],
		["right", 1 - u],
		["top", v],
		["bottom", 1 - v],
	]);
	return best[1] <= EDGE_BAND ? best[0] : null;
}

/**
 * Whether the pointer is on the dock's own outer edge — a drop that makes a new outermost column
 * or row rather than splitting whichever pane happens to be there.
 *
 * In pixels rather than a share, because this is a target the hand aims at rather than a region
 * of a pane: a band that grew with the window would have to be re-learned on every resize.
 */
export function rootEdge(box: Rect, x: number, y: number): DropSide | null {
	if (!inside(box, x, y)) return null;
	const best = nearest([
		["left", x - box.left],
		["right", box.left + box.width - x],
		["top", y - box.top],
		["bottom", box.top + box.height - y],
	]);
	return best[1] <= ROOT_BAND ? best[0] : null;
}

/**
 * The landing place for a pointer at (x, y), or null if there is not one.
 *
 * The dock's outer band is tested first and wins where the two overlap. That overlap is the outer
 * few pixels of the outermost panes, and "against the very edge of the window" reads as *outside*
 * everything rather than as an edge of the pane that happens to be there — so the outer meaning
 * is the one that should win.
 *
 * Panes tile, so at most one of them contains the pointer and the order they are given in does
 * not matter.
 */
export function dropAt(
	root: Rect,
	panes: { kind: PaneKind; box: Rect }[],
	x: number,
	y: number,
): DropAt | null {
	const edge = rootEdge(root, x, y);
	if (edge) return { side: edge, kind: null };
	for (const pane of panes) {
		const side = edgeOf(pane.box, x, y);
		if (side) return { side, kind: pane.kind };
	}
	return null;
}

/**
 * Whether two landing places are the same one.
 *
 * The drag commits a new tree when this changes and at no other time. Comparing the *target*
 * rather than the pointer is what keeps a drag from rebuilding the layout on every mouse move —
 * the panes settle once per region crossed, which is both what the reference does and what keeps
 * a terminal or an editor from re-measuring itself sixty times a second.
 */
export const sameDrop = (a: DropAt | null, b: DropAt | null): boolean =>
	a === b || (a !== null && b !== null && a.side === b.side && a.kind === b.kind);
