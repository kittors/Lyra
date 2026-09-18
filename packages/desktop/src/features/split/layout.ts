/**
 * The tree, flattened into rectangles.
 *
 * Rendered as a flat, keyed list so a pane that moves from one branch to another is the same
 * React element — unmounting a conversation mid-drag would throw away its scroll position and
 * its composer draft. The dock already learned this; the same answer applies here.
 */

import type { Axis, SplitNode } from "./tree.ts";

export interface Box {
	left: number;
	top: number;
	width: number;
	height: number;
}

export interface PaneBox extends Box {
	sessionId: string | null;
}

export interface SplitterBox extends Box {
	path: number[];
	index: number;
	dir: Axis;
	share: number;
	pair: number;
	split: Box;
}

const FULL: Box = { left: 0, top: 0, width: 1, height: 1 };

export const SPLITTER_HIT = 9;
export const SPLITTER_STEP = 0.02;
export const GRIP_SPAN = 30;

function slice(rect: Box, dir: Axis, offset: number, share: number): Box {
	return dir === "row"
		? { left: rect.left + offset * rect.width, top: rect.top, width: share * rect.width, height: rect.height }
		: { left: rect.left, top: rect.top + offset * rect.height, width: rect.width, height: share * rect.height };
}

export function layoutPanes(tree: SplitNode, within: Box = FULL): PaneBox[] {
	const out: PaneBox[] = [];
	const walk = (node: SplitNode, rect: Box) => {
		if (node.type === "leaf") {
			out.push({ sessionId: node.sessionId, ...rect });
			return;
		}
		let offset = 0;
		node.children.forEach((child, i) => {
			const share = node.sizes[i] ?? 0;
			walk(child, slice(rect, node.dir, offset, share));
			offset += share;
		});
	};
	walk(tree, within);
	return out;
}

export function layoutSplitters(tree: SplitNode, within: Box = FULL): SplitterBox[] {
	const out: SplitterBox[] = [];
	const walk = (node: SplitNode, rect: Box, path: number[]) => {
		if (node.type === "leaf") return;
		let offset = 0;
		node.children.forEach((child, i) => {
			const share = node.sizes[i] ?? 0;
			const childRect = slice(rect, node.dir, offset, share);
			walk(child, childRect, [...path, i]);
			offset += share;
			if (i < node.children.length - 1) {
				const next = node.sizes[i + 1] ?? 0;
				out.push({
					path,
					index: i,
					dir: node.dir,
					share,
					pair: share + next,
					split: rect,
					...(node.dir === "row"
						? { left: rect.left + offset * rect.width, top: rect.top, width: 0, height: rect.height }
						: { left: rect.left, top: rect.top + offset * rect.height, width: rect.width, height: 0 }),
				});
			}
		});
	};
	walk(tree, within, []);
	return out;
}

export const pct = (fraction: number): string => `${(fraction * 100).toFixed(6)}%`;

const NEAR = 1e-6;

/** Top-left of the workspace: this screen sits on the traffic lights. */
export const isOriginPane = (pane: Box): boolean => pane.left <= NEAR && pane.top <= NEAR;

/** Top-right of the workspace: this screen holds the window's panel buttons. */
export const isTopEndPane = (pane: Box): boolean => pane.top <= NEAR && Math.abs(pane.left + pane.width - 1) <= NEAR;

export function shareFromPointer(
	handle: SplitterBox,
	position: number,
	container: { left: number; top: number; width: number; height: number },
): number {
	const { split } = handle;
	const row = handle.dir === "row";
	const span = row ? split.width * container.width : split.height * container.height;
	if (!(span > 0)) return handle.share;
	const origin = row ? container.left + split.left * container.width : container.top + split.top * container.height;
	const at = (position - origin) / span;
	const boundary = row ? (handle.left - split.left) / split.width : (handle.top - split.top) / split.height;
	return at - (boundary - handle.share);
}
