/**
 * Which conversation screen a pointer is over, without measuring every pane.
 *
 * A drag used to call `getBoundingClientRect` on the root and on each tile, every animation
 * frame. That forces a layout of the transcripts underneath. The tiles do not move during a
 * carry — only the pointer does — so the root is measured once and the rest is share arithmetic.
 */

import type { Box, PaneBox } from "./layout.ts";

export interface PixelBox {
	left: number;
	top: number;
	width: number;
	height: number;
}

let cachedRoot: PixelBox | null = null;

export function rememberSplitRoot(element: HTMLElement | null): PixelBox | null {
	if (cachedRoot) return cachedRoot;
	if (!element) return null;
	const box = element.getBoundingClientRect();
	cachedRoot = { left: box.left, top: box.top, width: box.width, height: box.height };
	return cachedRoot;
}

export function forgetSplitRoot(): void {
	cachedRoot = null;
}

export function paneAtShare(panes: PaneBox[], root: PixelBox, x: number, y: number): PaneBox | null {
	if (!(root.width > 0) || !(root.height > 0)) return null;
	if (x < root.left || x > root.left + root.width || y < root.top || y > root.top + root.height) return null;
	const u = (x - root.left) / root.width;
	const v = (y - root.top) / root.height;
	for (const pane of panes) {
		if (u >= pane.left && u <= pane.left + pane.width && v >= pane.top && v <= pane.top + pane.height) return pane;
	}
	return null;
}

export function panePixels(pane: Box, root: PixelBox): PixelBox {
	return {
		left: root.left + pane.left * root.width,
		top: root.top + pane.top * root.height,
		width: pane.width * root.width,
		height: pane.height * root.height,
	};
}
