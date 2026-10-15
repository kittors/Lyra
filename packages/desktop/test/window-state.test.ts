/**
 * What the main window writes to window.json, and whether it reopens maximised.
 *
 * Measured on Windows 11 at 125%: the window grew by 4×5 or 4×6 on every launch (1202×802 → 1206×807
 * → 1210×813 → 1214×819), because what it read back was saved as the next launch's request; and a
 * window closed maximised came back as an ordinary one, because maximised bounds were never written
 * and the fact went with them.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { reopenMaximized, stateToSave } from "../electron/window-state.ts";

const box = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });
const still = { maximized: false, fullScreen: false, minimized: false };

test("a window nobody touched saves the size it was asked for, not the size it came out at", () => {
	const opened = { asked: box(167, 7, 1202, 802), got: box(167, 7, 1206, 807) };
	assert.deepEqual(stateToSave({ ...still, normal: opened.got, opened }), { x: 167, y: 7, width: 1202, height: 802 });
});

test("launch after launch, the size stays where it was put", () => {
	// Each launch comes out a few pixels larger than asked, the way it does at 125% on Windows.
	const grow = (b: ReturnType<typeof box>) => box(b.x, b.y, b.width + 4, b.height + 5);
	let asked = box(167, 7, 1202, 802);
	for (let launch = 0; launch < 5; launch++) {
		const opened = { asked, got: grow(asked) };
		const saved = stateToSave({ ...still, normal: opened.got, opened })!;
		asked = box(saved.x!, saved.y!, saved.width, saved.height);
	}
	assert.deepEqual(asked, box(167, 7, 1202, 802));
});

test("a window someone resized or moved saves what they made it", () => {
	const opened = { asked: box(167, 7, 1202, 802), got: box(167, 7, 1206, 807) };
	assert.deepEqual(stateToSave({ ...still, normal: box(167, 7, 1000, 700), opened }), { x: 167, y: 7, width: 1000, height: 700 });
	assert.deepEqual(stateToSave({ ...still, normal: box(300, 40, 1206, 807), opened }), { x: 300, y: 40, width: 1206, height: 807 });
});

test("maximised, the normal bounds are kept and being maximised is written beside them", () => {
	const opened = { asked: box(167, 7, 1202, 802), got: box(167, 7, 1206, 807) };
	assert.deepEqual(stateToSave({ ...still, maximized: true, normal: opened.got, opened }), { x: 167, y: 7, width: 1202, height: 802, maximized: true });
	// Restored again: the flag is gone.
	assert.equal(stateToSave({ ...still, normal: opened.got, opened })!.maximized, undefined);
});

test("full screen and minimised write nothing", () => {
	const normal = box(0, 0, 900, 600);
	assert.equal(stateToSave({ ...still, fullScreen: true, normal, opened: null }), null);
	assert.equal(stateToSave({ ...still, minimized: true, normal, opened: null }), null);
});

test("Windows and Linux reopen a maximised window maximised; macOS reopens it at its size", () => {
	const state = { width: 1202, height: 802, maximized: true };
	assert.equal(reopenMaximized(state, "win32"), true);
	assert.equal(reopenMaximized(state, "linux"), true);
	assert.equal(reopenMaximized(state, "darwin"), false);
	assert.equal(reopenMaximized({ width: 1202, height: 802 }, "win32"), false);
	assert.equal(reopenMaximized(null, "win32"), false);
});
