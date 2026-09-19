import { layoutPanes } from "./layout.ts";
import { contains, leafCount, leafOf, MAX_PANES, normalize, removeLeaf, splitLeaf, type DropSide, type SplitNode } from "./tree.ts";

export type MoveName = "left" | "right" | "up" | "down" | "topLeft" | "bottomLeft" | "topRight" | "bottomRight" | "newColumn";
export type SplitMove =
	| { name: MoveName; type: "swap"; target: string | null }
	| { name: MoveName; type: "dock"; target: string | null; side: DropSide }
	| { name: "newColumn" | "right"; type: "column" };

export function columnCount(tree: SplitNode): number {
	return tree.type === "split" && tree.dir === "row" ? tree.children.length : 1;
}

/** Menu splits add a whole column; the pointer route still splits the targeted edge. */
export function appendColumn(tree: SplitNode, sessionId: string): SplitNode | null {
	if (contains(tree, sessionId) || leafCount(tree) >= MAX_PANES) return null;
	const columns = tree.type === "split" && tree.dir === "row" ? tree.children : [tree];
	const children = [...columns, leafOf(sessionId)];
	return { type: "split", dir: "row", children, sizes: children.map(() => 1 / children.length) };
}

/** Derive menu destinations from the visible columns, including stacked rows. */
export function splitMoves(tree: SplitNode, sessionId: string): SplitMove[] {
	if (!contains(tree, sessionId) || leafCount(tree) < 2) return [];
	const columns = tree.type === "split" && tree.dir === "row" ? tree.children : [tree];
	const column = columns.findIndex((node) => contains(node, sessionId));
	const rows = layoutPanes(columns[column]);
	const row = rows.findIndex((pane) => pane.sessionId === sessionId);
	const moves: SplitMove[] = [];
	for (const [offset, name] of [[-1, "up"], [1, "down"]] as const) {
		const neighbor = rows[row + offset];
		if (neighbor) moves.push({ name, type: "swap", target: neighbor.sessionId });
	}
	for (const [offset, name, top, bottom] of [
		[-1, "left", "topLeft", "bottomLeft"], [1, "right", "topRight", "bottomRight"],
	] as const) {
		const neighbor = columns[column + offset];
		if (!neighbor) continue;
		const targets = layoutPanes(neighbor);
		const target = targets[Math.min(row, targets.length - 1)];
		if (rows.length > 1) {
			moves.push({ name, type: "dock", target: target.sessionId, side: row === 0 ? "top" : "bottom" });
		} else {
			moves.push({ name, type: "swap", target: target.sessionId });
			if (column === columns.length - 1) {
				moves.push({ name: top, type: "dock", target: targets[0].sessionId, side: "top" });
				moves.push({ name: bottom, type: "dock", target: targets[targets.length - 1].sessionId, side: "bottom" });
			}
		}
	}
	if (rows.length === 1 && column < columns.length - 1) {
		const neighbor = columns[column > 0 ? column - 1 : column + 1];
		const target = layoutPanes(neighbor).at(-1);
		if (target) moves.push({ name: "down", type: "dock", target: target.sessionId, side: "bottom" });
	}
	if (rows.length > 1) moves.push({ name: column === columns.length - 1 ? "right" : "newColumn", type: "column" });
	return moves;
}

export function moveSplit(tree: SplitNode, sessionId: string, move: SplitMove): SplitNode {
	if (!contains(tree, sessionId)) return tree;
	if (move.type === "swap") {
		const swap = (node: SplitNode): SplitNode => node.type === "leaf"
			? node.sessionId === sessionId ? leafOf(move.target) : node.sessionId === move.target ? leafOf(sessionId) : node
			: { ...node, children: node.children.map(swap) };
		return swap(tree);
	}
	const rest = removeLeaf(tree, sessionId);
	if (rest === tree) return tree;
	return move.type === "column"
		? appendColumn(rest, sessionId) ?? tree
		: normalize(splitLeaf(rest, move.target, sessionId, move.side) ?? tree);
}
