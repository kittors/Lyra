/**
 * Conversation tiling, as data.
 *
 * This is not the tool dock. The dock's leaves are kinds (`conversation`, `files`, …) and it
 * promises exactly one conversation. This tree's leaves are sessions: each is an independent
 * screen (own title bar, transcript, composer). A window may hold at most four. A drop that
 * would make a fifth is refused; the caller may replace the hovered screen instead.
 *
 * Everything here is pure. The overlay, the drag and the Electron window are somebody else's
 * problem — which is what lets the four-pane ceiling, the four-edge drop and the close
 * normalisation be tested as arithmetic.
 *
 * A drop splits the hovered pane on the edge the pointer is nearest: left / right / top /
 * bottom. Same geometry as the tool dock, so the first conversation split is not locked to
 * "new chat on the right of a wide pane".
 */

export const MAX_PANES = 4;

export type Axis = "row" | "col";
export type DropSide = "left" | "right" | "top" | "bottom";

export interface SplitLeaf {
	type: "leaf";
	/** Null is the blank conversation that has not been sent yet. */
	sessionId: string | null;
}

export interface SplitBranch {
	type: "split";
	dir: Axis;
	children: SplitNode[];
	/** Shares of the split's length, one per child, summing to 1. */
	sizes: number[];
}

export type SplitNode = SplitLeaf | SplitBranch;

export const EPSILON = 1e-6;
export const MIN_FRACTION = 0.08;

export type ResizeFloor = number | { near: number; far: number };

function floorsOf(floor: ResizeFloor): { near: number; far: number } {
	return typeof floor === "number" ? { near: floor, far: floor } : floor;
}

export const leafOf = (sessionId: string | null): SplitLeaf => ({ type: "leaf", sessionId });

export const defaultTree = (): SplitNode => leafOf(null);

export function longestAxis(width: number, height: number): Axis {
	return width >= height ? "row" : "col";
}

export const axisOf = (side: DropSide): Axis => (side === "left" || side === "right" ? "row" : "col");

export const isLeading = (side: DropSide): boolean => side === "left" || side === "top";

/** Menu "分屏" has no pointer: put the new chat on the trailing side of the longer axis. */
export function sideFromBox(width: number, height: number): DropSide {
	return longestAxis(width, height) === "row" ? "right" : "bottom";
}

export function leafCount(node: SplitNode): number {
	if (node.type === "leaf") return 1;
	return node.children.reduce((sum, child) => sum + leafCount(child), 0);
}

export function sessionIds(node: SplitNode): string[] {
	const out: string[] = [];
	const walk = (item: SplitNode) => {
		if (item.type === "leaf") {
			if (item.sessionId) out.push(item.sessionId);
			return;
		}
		for (const child of item.children) walk(child);
	};
	walk(node);
	return out;
}

export function contains(node: SplitNode, sessionId: string): boolean {
	if (node.type === "leaf") return node.sessionId === sessionId;
	return node.children.some((child) => contains(child, sessionId));
}

export function focusedOrFirst(node: SplitNode, focused: string | null): string | null {
	if (focused && contains(node, focused)) return focused;
	return firstSession(node);
}

export function firstSession(node: SplitNode): string | null {
	if (node.type === "leaf") return node.sessionId;
	for (const child of node.children) {
		const id = firstSession(child);
		if (id) return id;
	}
	return null;
}

function even(count: number): number[] {
	return Array.from({ length: count }, () => 1 / count);
}

function balance(sizes: number[]): number[] {
	const total = sizes.reduce((sum, n) => sum + n, 0);
	if (total <= 0) return even(sizes.length);
	const next = sizes.map((n) => n / total);
	const floor = Math.min(MIN_FRACTION, 1 / next.length);
	const raised = next.map((n) => Math.max(n, floor));
	const raisedTotal = raised.reduce((sum, n) => sum + n, 0);
	return raised.map((n) => n / raisedTotal);
}

/**
 * Flatten same-axis nesting and drop single-child splits.
 *
 * A split of one child is that child wearing a handle with nothing on the other side. A row
 * inside a row draws two handles on one boundary. Both are repaired here rather than forbidden
 * at the call sites, because close and replace produce them as a matter of course.
 */
export function normalize(node: SplitNode): SplitNode {
	if (node.type === "leaf") return node;
	const children: SplitNode[] = [];
	const sizes: number[] = [];
	node.children.forEach((child, i) => {
		const next = normalize(child);
		if (next.type === "split" && next.dir === node.dir) {
			const parentShare = node.sizes[i] ?? 0;
			next.children.forEach((grand, j) => {
				children.push(grand);
				sizes.push(parentShare * (next.sizes[j] ?? 0));
			});
			return;
		}
		children.push(next);
		sizes.push(node.sizes[i] ?? 0);
	});
	if (children.length === 0) return leafOf(null);
	if (children.length === 1) return children[0];
	return { type: "split", dir: node.dir, children, sizes: balance(sizes) };
}

function mapLeaves(node: SplitNode, change: (leaf: SplitLeaf) => SplitNode): SplitNode {
	if (node.type === "leaf") return change(node);
	return {
		...node,
		children: node.children.map((child) => mapLeaves(child, change)),
	};
}

/**
 * Split `target` on `side`, putting `incoming` on that edge.
 *
 * Returns null when the tree is already at four panes, when the incoming session is already
 * showing, or when the target is not in the tree. The caller decides whether to replace instead.
 */
export function splitLeaf(
	root: SplitNode,
	targetSessionId: string | null,
	incoming: string,
	side: DropSide,
): SplitNode | null {
	if (leafCount(root) >= MAX_PANES) return null;
	if (contains(root, incoming)) return null;
	const dir = axisOf(side);
	const leading = isLeading(side);
	let hit = false;
	const next = mapLeaves(root, (leaf) => {
		if (hit || leaf.sessionId !== targetSessionId) return leaf;
		hit = true;
		const added = leafOf(incoming);
		return {
			type: "split",
			dir,
			children: leading ? [added, leaf] : [leaf, added],
			sizes: [0.5, 0.5],
		};
	});
	return hit ? normalize(next) : null;
}

/** Swap one pane's session. Used when the window is already at four panes. */
export function replaceLeaf(root: SplitNode, targetSessionId: string | null, incoming: string): SplitNode {
	if (contains(root, incoming)) return root;
	let hit = false;
	const next = mapLeaves(root, (leaf) => {
		if (hit || leaf.sessionId !== targetSessionId) return leaf;
		hit = true;
		return leafOf(incoming);
	});
	return hit ? normalize(next) : root;
}

/**
 * Take a pane away. The last pane stays — a window with no conversation is a crash, not a close.
 */
export function removeLeaf(root: SplitNode, sessionId: string): SplitNode {
	if (leafCount(root) <= 1) return root;
	const next = strip(root, sessionId);
	return next ? normalize(next) : root;
}

function strip(node: SplitNode, sessionId: string): SplitNode | null {
	if (node.type === "leaf") return node.sessionId === sessionId ? null : node;
	const children: SplitNode[] = [];
	const sizes: number[] = [];
	node.children.forEach((child, i) => {
		const kept = strip(child, sessionId);
		if (!kept) return;
		children.push(kept);
		sizes.push(node.sizes[i] ?? 0);
	});
	if (children.length === 0) return null;
	if (children.length === 1) return children[0];
	return { type: "split", dir: node.dir, children, sizes };
}

/** Drop leaves whose session no longer exists. */
export function adopt(root: SplitNode, existing: Set<string>): SplitNode {
	const next = keep(root, existing);
	return next ? normalize(next) : defaultTree();
}

function keep(node: SplitNode, existing: Set<string>): SplitNode | null {
	if (node.type === "leaf") {
		if (node.sessionId === null || existing.has(node.sessionId)) return node;
		return null;
	}
	const children: SplitNode[] = [];
	const sizes: number[] = [];
	node.children.forEach((child, i) => {
		const kept = keep(child, existing);
		if (!kept) return;
		children.push(kept);
		sizes.push(node.sizes[i] ?? 0);
	});
	if (children.length === 0) return null;
	if (children.length === 1) return children[0];
	return { type: "split", dir: node.dir, children, sizes };
}

function replaceAt(node: SplitNode, path: number[], change: (node: SplitNode) => SplitNode): SplitNode {
	if (path.length === 0) return change(node);
	if (node.type !== "split") return node;
	const [head, ...rest] = path;
	if (head === undefined || !node.children[head]) return node;
	const child = replaceAt(node.children[head], rest, change);
	if (child === node.children[head]) return node;
	const children = [...node.children];
	children[head] = child;
	return { ...node, children };
}

export function nodeAt(tree: SplitNode, path: number[]): SplitNode | null {
	let node: SplitNode = tree;
	for (const index of path) {
		if (node.type !== "split") return null;
		const child = node.children[index];
		if (!child) return null;
		node = child;
	}
	return node;
}

/**
 * Move one boundary. Same contract as the dock: the two panes either side trade shares and
 * everyone else keeps what they had. Not normalised — this runs per frame of a drag.
 *
 * `floor` may be one share for both sides, or a pixel-derived pair. A column of two chats
 * needs twice the height of a single leaf; one number cannot say that.
 */
export function resize(
	tree: SplitNode,
	path: number[],
	index: number,
	fraction: number,
	floor: ResizeFloor = MIN_FRACTION,
): SplitNode {
	return replaceAt(tree, path, (node) => {
		if (node.type !== "split") return node;
		const near = node.sizes[index];
		const far = node.sizes[index + 1];
		if (near === undefined || far === undefined) return node;
		const pair = near + far;
		const { near: nearFloor, far: farFloor } = floorsOf(floor);
		const need = nearFloor + farFloor;
		const nextNear =
			pair < need
				? need > 0
					? pair * (nearFloor / need)
					: pair / 2
				: Math.min(pair - farFloor, Math.max(nearFloor, fraction));
		const nextFar = pair - nextNear;
		if (Math.abs(nextNear - near) < EPSILON && Math.abs(nextFar - far) < EPSILON) return node;
		const sizes = [...node.sizes];
		sizes[index] = nextNear;
		sizes[index + 1] = nextFar;
		return { ...node, sizes };
	});
}

export function evenSplit(tree: SplitNode, path: number[], index: number): SplitNode {
	return replaceAt(tree, path, (node) => {
		if (node.type !== "split") return node;
		const near = node.sizes[index];
		const far = node.sizes[index + 1];
		if (near === undefined || far === undefined) return node;
		const pair = near + far;
		const sizes = [...node.sizes];
		sizes[index] = pair / 2;
		sizes[index + 1] = pair / 2;
		return { ...node, sizes };
	});
}

/** Hostile storage in, a tree out. Anything that is not a tree becomes the default. */
export function sift(raw: unknown): SplitNode | null {
	if (!raw || typeof raw !== "object") return null;
	const node = raw as Record<string, unknown>;
	if (node.type === "leaf") {
		const sessionId = node.sessionId;
		if (sessionId !== null && typeof sessionId !== "string") return null;
		if (typeof sessionId === "string" && sessionId.length === 0) return leafOf(null);
		return leafOf(sessionId);
	}
	if (node.type !== "split") return null;
	if (node.dir !== "row" && node.dir !== "col") return null;
	if (!Array.isArray(node.children)) return null;
	const stored = Array.isArray(node.sizes) ? node.sizes : [];
	const children: SplitNode[] = [];
	const sizes: number[] = [];
	for (const [i, child] of node.children.entries()) {
		const next = sift(child);
		if (!next) continue;
		children.push(next);
		const share = stored[i];
		sizes.push(typeof share === "number" && Number.isFinite(share) && share > 0 ? share : 0);
	}
	if (children.length === 0) return null;
	return normalize({ type: "split", dir: node.dir, children, sizes });
}

export function canSplit(root: SplitNode): boolean {
	return leafCount(root) < MAX_PANES;
}
