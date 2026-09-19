/**
 * Nothing opens a native window unless a person asked for one.
 *
 * The dock used to hand a panel to a real window whenever the layout could not hold its floors —
 * on a window resize, on a second split screen, on a cold start with a narrow window. It was
 * removed in `docs/issue/2026-09-19/2026-09-19-2304-01-dock-auto-popout-window-on-overflow.md`,
 * and these are the guards that keep it removed: the three entry points that used to reach for
 * `windows.openPanel` on their own, plus the panel that must never be handed over at all.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { openScopedPanel, popOutPanel, toggleScopedPanel } from "../../src/features/dock/popout.ts";
import { usePaneDock } from "../../src/features/dock/pane-store.ts";
import { useDock } from "../../src/features/dock/store.ts";
import { defaultTree, has } from "../../src/features/dock/tree.ts";
import "../../src/features/dock/panels/builtin.tsx";

/** Every call the renderer could make to open one, recorded instead of performed. */
function watchWindows(): { opened: unknown[] } {
	const opened: unknown[] = [];
	Reflect.set(window, "lyra", {
		windows: {
			openPanel: async (input: unknown) => {
				opened.push(input);
				return { ok: true };
			},
			open: async (input: unknown) => {
				opened.push(input);
				return { ok: true };
			},
		},
	});
	return { opened };
}

function reset(): void {
	window.localStorage.clear();
	useDock.setState({ tree: defaultTree(), maximized: null, focused: "conversation" });
	usePaneDock.setState({ trees: {}, sizes: {}, drag: null, maximized: {} });
}

test("a tile with no room for a panel takes it rather than opening a window", () => {
	reset();
	const { opened } = watchWindows();
	// 700×400 clears no edge for a 300×150 panel beside a 420×260 conversation.
	usePaneDock.getState().rememberSize("tile", { width: 700, height: 400 });
	openScopedPanel("terminal");
	assert.deepEqual(opened, [], "opening a panel is not a request for a second window");
});

test("toggling a panel into a tile with no room does not open a window either", () => {
	reset();
	const { opened } = watchWindows();
	usePaneDock.getState().rememberSize("tile", { width: 700, height: 400 });
	toggleScopedPanel("tile", "terminal");
	assert.ok(has(usePaneDock.getState().tree("tile"), "terminal"), "the panel landed in the tile");
	assert.deepEqual(opened, [], "the toolbar button is not a request for a second window either");
});

test("the browser refuses to be moved into a window of its own", async () => {
	reset();
	const { opened } = watchWindows();
	// A `<webview>` belongs to the document that created it; "the same page" elsewhere is a reload.
	assert.equal(await popOutPanel({ dock: "window", scope: "window", kind: "browser", sessionId: null }), false);
	assert.deepEqual(opened, [], "a panel declaring detach: none is never handed over");
});

test("a panel that can travel still travels when a person asks", async () => {
	reset();
	const { opened } = watchWindows();
	assert.equal(await popOutPanel({ dock: "window", scope: "window", kind: "terminal", sessionId: null }), true);
	assert.equal(opened.length, 1, "the header button still works — only the automatic route is gone");
});
