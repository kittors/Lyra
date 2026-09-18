/**
 * How small a conversation screen may be, and which edges may still take a split.
 *
 * Shares cannot say this. 8% of a wide window is a usable column and 8% of a small one is a
 * ribbon, and a 50/50 drop on a 500px pane produces two 250px chats that cannot hold a title,
 * a composer and a line of transcript. The floor is in pixels; whether a drop is legal is
 * asked of the pane under the pointer, not of the tree.
 */

import { axisOf, MIN_FRACTION, sideFromBox, type Axis, type DropSide, type SplitNode } from "./tree.ts";

/**
 * Same readability floor as the dock's conversation pane: below this the words break one per
 * line and the composer starts eating the transcript.
 */
export const SCREEN_MIN_WIDTH_PX = 420;
/** Title bar, composer, and a few lines between them. */
export const SCREEN_MIN_HEIGHT_PX = 260;

export function canSplitSide(width: number, height: number, side: DropSide): boolean {
	return axisOf(side) === "row" ? width >= 2 * SCREEN_MIN_WIDTH_PX : height >= 2 * SCREEN_MIN_HEIGHT_PX;
}

export function viableSides(width: number, height: number): DropSide[] {
	return (["left", "right", "top", "bottom"] as const).filter((side) => canSplitSide(width, height, side));
}

/** Menu split has no pointer: the trailing side of the longer axis, if that axis still fits. */
export function preferredSide(width: number, height: number): DropSide | null {
	const sides = viableSides(width, height);
	if (sides.length === 0) return null;
	const want = sideFromBox(width, height);
	return sides.includes(want) ? want : sides[0]!;
}

export interface ScreenBox {
	sessionId: string | null;
	width: number;
	height: number;
}

/**
 * A pane that can still be halved, preferring the one the caller named, then the largest.
 *
 * Dragging already refused the hovered edge. The menu has to pick on its own, and "the focused
 * pane" is the wrong answer once that pane is a sliver.
 */
export function pickSplitTarget(panes: ScreenBox[], preferred: string | null): { target: string | null; side: DropSide } | null {
	if (panes.length === 0) return null;
	const ordered = [...panes].sort((a, b) => {
		const aHit = (a.sessionId ?? null) === preferred;
		const bHit = (b.sessionId ?? null) === preferred;
		if (aHit !== bHit) return aHit ? -1 : 1;
		return b.width * b.height - a.width * a.height;
	});
	for (const pane of ordered) {
		const side = preferredSide(pane.width, pane.height);
		if (side) return { target: pane.sessionId, side };
	}
	return null;
}

/** Pixels a subtree needs along `axis` before any of its leaves fall under the floor. */
export function subtreeMinPx(node: SplitNode, axis: Axis): number {
	if (node.type === "leaf") return axis === "row" ? SCREEN_MIN_WIDTH_PX : SCREEN_MIN_HEIGHT_PX;
	const parts = node.children.map((child) => subtreeMinPx(child, axis));
	return node.dir === axis
		? parts.reduce((sum, size) => sum + size, 0)
		: parts.reduce((largest, size) => Math.max(largest, size), 0);
}

export function resizeFloors(
	node: Extract<SplitNode, { type: "split" }>,
	index: number,
	spanPx: number,
): { near: number; far: number } {
	const near = node.children[index];
	const far = node.children[index + 1];
	if (!near || !far || !(spanPx > 0)) return { near: MIN_FRACTION, far: MIN_FRACTION };
	return {
		near: Math.max(MIN_FRACTION, subtreeMinPx(near, node.dir) / spanPx),
		far: Math.max(MIN_FRACTION, subtreeMinPx(far, node.dir) / spanPx),
	};
}
