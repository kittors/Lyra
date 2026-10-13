/**
 * A picture's family laid out as the gallery draws its history: one column of pictures, and the lines
 * between them.
 *
 * Read top to bottom like a story — the dog, then the hat, then the girl holding it. The pictures stay
 * in a single column whatever the shape of the family; shifting a branch sideways made the column
 * zigzag and the words beside it start at a different place on every row. What shows a branch is the
 * line instead:
 *
 * - An edit listed right under the picture it was made from hangs off it by a short straight line.
 * - Every other link — a second edit of the same picture, a picture drawn from two — leaves the
 *   picture's left edge, runs down a gutter beside the column and turns into the picture it led to.
 *
 * Each branch is listed whole, after the branch before it, so most links are the straight kind: a
 * picture's first edit comes right after it, and everything made from that comes before its second.
 */

export interface FamilyNode {
	id: string;
	at: number;
	/** Order among the pictures of one call, which arrive together. */
	index?: number;
	parents: readonly string[];
}

const byTime = (a: FamilyNode, b: FamilyNode) => a.at - b.at || (a.index ?? 0) - (b.index ?? 0) || a.id.localeCompare(b.id);

/** Everything a picture came from and everything made from those, in one connected family, oldest first. */
export function familyOf(id: string, nodes: ReadonlyMap<string, FamilyNode>): FamilyNode[] {
	const start = nodes.get(id);
	if (!start) return [];
	const children = new Map<string, string[]>();
	for (const node of nodes.values()) {
		for (const parent of node.parents) {
			const list = children.get(parent);
			if (list) list.push(node.id);
			else children.set(parent, [node.id]);
		}
	}
	const seen = new Set([id]);
	const queue = [id];
	while (queue.length) {
		const current = queue.pop() as string;
		for (const next of [...(nodes.get(current)?.parents ?? []), ...(children.get(current) ?? [])]) {
			if (seen.has(next) || !nodes.has(next)) continue;
			seen.add(next);
			queue.push(next);
		}
	}
	return [...seen].map((member) => nodes.get(member) as FamilyNode).sort(byTime);
}

export interface TreeLink {
	/** Rows of the picture it was made from and of the one made; always downwards. */
	from: number;
	to: number;
	/** The gutter lane it runs down, counted outwards from the column; null when the rows touch and it is a straight line. */
	lane: number | null;
	/** Part of how the picture being looked at came to be. */
	onPath: boolean;
}

export interface LineageTree {
	order: FamilyNode[];
	links: TreeLink[];
	/** How many gutter lanes the links need; 0 for a family with no branches. */
	lanes: number;
}

/**
 * The rows and the lines for a family, given which picture is being looked at.
 *
 * The order is a walk from the oldest picture down each branch in turn, earlier edits first. A picture
 * drawn from two is listed only once both are, so no line ever runs upwards — time goes down the column.
 */
export function lineageTree(family: readonly FamilyNode[], current: string): LineageTree {
	const members = new Map(family.map((node) => [node.id, node]));
	const parentsOf = (node: FamilyNode) => [...new Set(node.parents)].filter((parent) => members.has(parent));
	const children = new Map<string, FamilyNode[]>();
	for (const node of family) {
		for (const parent of parentsOf(node)) {
			const list = children.get(parent);
			if (list) list.push(node);
			else children.set(parent, [node]);
		}
	}
	for (const list of children.values()) list.sort(byTime);

	const order: FamilyNode[] = [];
	const seen = new Set<string>();
	const visit = (start: FamilyNode) => {
		// An explicit stack: a long history would otherwise be a deep recursion. Children are pushed
		// in reverse so the earliest edit is walked first.
		const stack = [start];
		while (stack.length) {
			const node = stack.pop() as FamilyNode;
			if (seen.has(node.id)) continue;
			seen.add(node.id);
			order.push(node);
			const ready = (children.get(node.id) ?? []).filter((child) => !seen.has(child.id) && parentsOf(child).every((parent) => seen.has(parent)));
			for (let at = ready.length - 1; at >= 0; at--) stack.push(ready[at]);
		}
	};
	for (const node of [...family].sort(byTime)) if (parentsOf(node).length === 0) visit(node);
	// Only a family with a cycle in it gets here, which recorded sources cannot make; listed rather than lost.
	for (const node of [...family].sort(byTime)) visit(node);

	const row = new Map(order.map((node, at) => [node.id, at]));
	const path = new Set<string>();
	const climb = [current];
	while (climb.length) {
		const id = climb.pop() as string;
		if (path.has(id) || !members.has(id)) continue;
		path.add(id);
		climb.push(...parentsOf(members.get(id) as FamilyNode));
	}

	const links: TreeLink[] = [];
	for (const node of order) {
		for (const parent of parentsOf(node)) {
			const from = row.get(parent) as number;
			const to = row.get(node.id) as number;
			links.push({ from: Math.min(from, to), to: Math.max(from, to), lane: null, onPath: path.has(parent) && path.has(node.id) });
		}
	}

	// Lanes for the links that cannot go straight: the nearest one free over all the rows it spans,
	// ends included, so two lines never share a stretch of the gutter or the stub into a picture.
	const taken: { from: number; to: number }[][] = [];
	const bent = links.filter((link) => link.to !== link.from + 1).sort((a, b) => a.from - b.from || a.to - b.to);
	for (const link of bent) {
		let lane = taken.findIndex((spans) => spans.every((span) => span.to < link.from || span.from > link.to));
		if (lane === -1) lane = taken.push([]) - 1;
		taken[lane].push({ from: link.from, to: link.to });
		link.lane = lane;
	}
	return { order, links, lanes: taken.length };
}
