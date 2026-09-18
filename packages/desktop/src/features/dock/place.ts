/**
 * Which edges of a dock still have room for a pane.
 *
 * Opening and dragging used to pick a landing from the tree's shape alone — first panel to the
 * right, next one under the last — and then `fitTree` drew whatever was left. In a 2×2 tile that
 * leftover is a conversation sliver: the insert succeeded, the floors did not, and the overlap
 * was treated as a drawing problem.
 *
 * The question this file answers is the one that has to come first: after this insert, does the
 * tile still clear every floor? If no edge does, the pane does not go in. The caller opens a
 * window instead of crushing the conversation.
 */

import { defaultDrop } from "./store.ts";
import { clearsFloors, type Floor } from "./layout.ts";
import {
	has,
	insert,
	kinds,
	nodeAt,
	pathTo,
	type DockNode,
	type DropAt,
	type DropSide,
	type PaneKind,
} from "./tree.ts";

const SIDES: DropSide[] = ["right", "bottom", "left", "top"];

export type Span = { width: number; height: number };

const dropKey = (at: DropAt): string => `${at.side}:${at.kind ?? ""}`;

/** Every edge a pane could land on: the dock's own, then each pane that is already there. */
export function candidateDrops(tree: DockNode): DropAt[] {
	const seen = new Set<string>();
	const out: DropAt[] = [];
	const add = (at: DropAt) => {
		const key = dropKey(at);
		if (seen.has(key)) return;
		seen.add(key);
		out.push(at);
	};
	for (const side of SIDES) add({ side, kind: null });
	for (const kind of kinds(tree)) {
		for (const side of SIDES) add({ side, kind });
	}
	return out;
}

export function dropFits(
	tree: DockNode,
	span: Span,
	floor: (kind: PaneKind) => Floor,
	kind: PaneKind,
	at: DropAt,
): boolean {
	if (has(tree, kind)) return false;
	return clearsFloors(insert(tree, kind, at), span, floor);
}

export function viableDrops(
	tree: DockNode,
	span: Span,
	floor: (kind: PaneKind) => Floor,
	kind: PaneKind,
): DropAt[] {
	if (has(tree, kind)) return [];
	return candidateDrops(tree).filter((at) => dropFits(tree, span, floor, kind, at));
}

/**
 * The landing an open from the menu should use, or null when the tile has no room left.
 *
 * Prefers the usual pairing (column, then stack) when that pairing still clears. A 2×2 tile is
 * too narrow for a column beside the conversation and still tall enough to stack — so the first
 * panel goes under the chat, and the second has nowhere to go.
 */
export function placePanel(
	tree: DockNode,
	span: Span,
	floor: (kind: PaneKind) => Floor,
	kind: PaneKind,
): DropAt | null {
	const viable = viableDrops(tree, span, floor, kind);
	if (viable.length === 0) return null;
	const preferred = defaultDrop(tree);
	const same = (at: DropAt) => at.side === preferred.side && at.kind === preferred.kind;
	return (
		viable.find(same)
		?? viable.find((at) => at.side === "bottom" && at.kind === "conversation")
		?? viable.find((at) => at.side === "right" && (at.kind === "conversation" || at.kind === null))
		?? viable[0]
	);
}

/**
 * The drop that would put this pane back next to the neighbour it has now.
 *
 * Remembered when the pane is popped into a window, so restore is not a fresh `defaultDrop`.
 */
export function homeOf(tree: DockNode, kind: PaneKind): DropAt | null {
	if (!has(tree, kind)) return null;
	const path = pathTo(tree, kind);
	if (!path || path.length === 0) return { side: "right", kind: null };
	const parent = nodeAt(tree, path.slice(0, -1));
	if (parent?.type !== "split") return { side: "right", kind: null };
	const index = path[path.length - 1] ?? 0;
	const neighbor = parent.children[index === 0 ? 1 : index - 1];
	const neighborKind = neighbor?.type === "leaf" ? neighbor.kind : null;
	const side: DropSide =
		parent.dir === "row" ? (index === 0 ? "left" : "right") : index === 0 ? "top" : "bottom";
	return { side, kind: neighborKind };
}
