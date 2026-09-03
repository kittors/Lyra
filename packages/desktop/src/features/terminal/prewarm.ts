/**
 * A shell already at its prompt by the time the terminal is opened.
 *
 * Opening the pane used to be what started the shell, and a shell takes about a third of a second
 * to reach a prompt — spawn is immediate, the rest is the login files and whatever the prompt
 * shells out to. So the pane opened as an empty rectangle and filled in a moment later, every
 * time. Started at launch instead, the prompt is already recorded in the main process and the
 * first attach replays it in a single frame.
 *
 * Only the first shell of the directory in front of you, and only when the main thread has nothing
 * better to do — see `prewarm` in `terminal-registry.ts` for what is deliberately *not* predicted.
 */

import { useEffect } from "react";
import { useApp } from "../../store/index.ts";
import { bridge } from "../../services/index.ts";

/** Where the last measured pane size is kept, so a prediction can be made at the right width. */
const SIZE_KEY = "lyra.terminal.size";

/**
 * The size to start a shell at before any pane has been measured.
 *
 * A guess, but not a blind one: it is roughly what the dock's default width comes to at the code
 * font. Only ever used on the very first launch — every mount after that has recorded a real
 * measurement, and `attach` resizes the pty to the real size regardless.
 */
const FALLBACK = { cols: 60, rows: 24 };

/**
 * Remember how big the terminal actually is, for the next launch's prediction.
 *
 * A shell wraps its output to the width it was born at and nothing can re-wrap what it has already
 * written, so a prewarmed shell started at the wrong width would have its prompt folded in the
 * wrong place — the one thing the prediction is supposed to make look effortless. Written on every
 * mount rather than on resize: it is one small string, and the value wanted is the size the pane
 * settles at, which is what it has whenever it is built.
 */
export function rememberTerminalSize(cols: number, rows: number): void {
	if (cols < 2 || rows < 2) return;
	try {
		localStorage.setItem(SIZE_KEY, JSON.stringify({ cols, rows }));
	} catch {}
}

/** The last measured pane size, or a first-launch guess. */
export function lastTerminalSize(): { cols: number; rows: number } {
	try {
		const raw = localStorage.getItem(SIZE_KEY);
		if (!raw) return FALLBACK;
		const parsed = JSON.parse(raw) as { cols?: unknown; rows?: unknown };
		const cols = Number(parsed.cols);
		const rows = Number(parsed.rows);
		if (!Number.isFinite(cols) || !Number.isFinite(rows) || cols < 2 || rows < 2) return FALLBACK;
		return { cols, rows };
	} catch {
		return FALLBACK;
	}
}

/**
 * Have one shell ready, once.
 *
 * Mounted at the root rather than in the pane, because the whole point is to have run before the
 * pane exists. Not re-run when the project changes: the strip shows every shell wherever it was
 * started, so one already running is one the pane opens onto instantly — predicting a second per
 * project would spawn shells for a gain that has already been had.
 *
 * On idle, and never during boot. Spawning a shell competes for the main thread with the first
 * paint, and a terminal nobody has asked for yet has no business making the window slower to
 * appear — the whole gain is a third of a second, which is not worth taking from somewhere it
 * would be seen.
 */
export function useTerminalPrewarm(): void {
	const ready = useApp((s) => s.ready);

	useEffect(() => {
		if (!ready) return;
		const cwd = useApp.getState().workspace?.path ?? "";
		const { cols, rows } = lastTerminalSize();
		/*
		 * `requestIdleCallback` where it exists, with a timeout so a permanently busy app still gets
		 * its shell — the deadline is what turns "when convenient" into "soon, and out of the way".
		 */
		const idle = window.requestIdleCallback?.bind(window);
		if (!idle) {
			const timer = window.setTimeout(() => bridge.terminal.prewarm(cwd, cols, rows), 400);
			return () => window.clearTimeout(timer);
		}
		const handle = idle(() => bridge.terminal.prewarm(cwd, cols, rows), { timeout: 2000 });
		return () => window.cancelIdleCallback?.(handle);
	}, [ready]);
}
