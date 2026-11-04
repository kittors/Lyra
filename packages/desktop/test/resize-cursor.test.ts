/**
 * On Windows `col-resize`/`row-resize` are Chromium's own faint ←‖→ bitmaps; the system's ↔ and ↕
 * are `ew-resize`/`ns-resize`. Measured on the Windows test machine with `GetCursorInfo`: the
 * former matched no system cursor, the latter were IDC_SIZEWE and IDC_SIZENS. macOS is unchanged.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { resizeCursor } from "../src/ui/layout/resize-cursor.ts";

test("Windows gets the system's resize cursors", () => {
	assert.equal(resizeCursor("columns", "win32"), "ew-resize");
	assert.equal(resizeCursor("rows", "win32"), "ns-resize");
});

test("macOS and Linux keep the column and row cursors", () => {
	for (const platform of ["darwin", "linux"]) {
		assert.equal(resizeCursor("columns", platform), "col-resize");
		assert.equal(resizeCursor("rows", platform), "row-resize");
	}
});
