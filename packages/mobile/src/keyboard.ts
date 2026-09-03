/** A rectangle in screen coordinates, measured in density-independent pixels. */
export interface ScreenFrame {
	x: number;
	y: number;
	width: number;
	height: number;
}

/**
 * How much of a native view is covered by the software keyboard.
 *
 * Android can either resize an edge-to-edge window or put the IME over it, depending on the OS and
 * WebView combination. Measuring the intersection handles both: a resized view ends above the IME
 * and returns zero, while an overlaid view reserves only the strip that is actually covered.
 */
export function keyboardOverlap(view: ScreenFrame, keyboard: ScreenFrame): number {
	const horizontalOverlap = Math.min(view.x + view.width, keyboard.x + keyboard.width) - Math.max(view.x, keyboard.x);
	const verticalOverlap = Math.min(view.y + view.height, keyboard.y + keyboard.height) - Math.max(view.y, keyboard.y);
	if (horizontalOverlap <= 0 || verticalOverlap <= 0) return 0;

	return Math.min(view.height, Math.max(0, Math.round(view.y + view.height - keyboard.y)));
}
