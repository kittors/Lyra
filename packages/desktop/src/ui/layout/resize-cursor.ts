/**
 * The cursor for dragging a boundary, in the platform's own shape.
 *
 * On Windows CSS `col-resize` and `row-resize` are Chromium's own monochrome bitmaps (←‖→), drawn
 * by XOR, so on a mid-grey surface they all but vanish — and every other split on Windows shows the
 * system's ↔ and ↕, which are `ew-resize` and `ns-resize`. macOS keeps col/row-resize, whose look
 * there this does not touch. The same choice the stylesheet makes for the handles themselves
 * (`dock.css`); this is for the body while a drag is in flight, which is set inline.
 */
export function resizeCursor(across: "columns" | "rows", platform = document.documentElement.dataset.lyPlatform): string {
	const windows = platform === "win32";
	if (across === "columns") return windows ? "ew-resize" : "col-resize";
	return windows ? "ns-resize" : "row-resize";
}
