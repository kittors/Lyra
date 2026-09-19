import assert from "node:assert/strict";
import { test } from "node:test";
import { act, createElement as h, useLayoutEffect, useRef } from "react";
import { paneFloor } from "../../src/features/dock/geometry.ts";
import { usePanelWindows } from "../../src/features/dock/popout.ts";
import { useDock } from "../../src/features/dock/store.ts";
import { defaultTree, has, insert } from "../../src/features/dock/tree.ts";
import { useOverflowWindows } from "../../src/features/dock/useOverflowWindows.ts";
import { mount } from "../helpers/mount.ts";

function Overflow({ width = 528 }: { width?: number }) {
	const tree = useDock(state => state.tree);
	const container = useRef<HTMLDivElement>(null);
	useLayoutEffect(() => {
		// Happy DOM has no visual layout; the native demo measures the real dock dimensions.
		if (container.current) container.current.checkVisibility = () => true;
	}, []);
	useOverflowWindows({
		tree, size: { width, height: 286 }, floor: paneFloor, dock: "window", scope: "window",
		sessionId: null, paused: false, container, onFailure: error => { throw error; },
	});
	return h("div", { ref: container });
}

function reset() {
	window.localStorage.clear();
	useDock.setState({ tree: insert(defaultTree(), "terminal", { kind: "conversation", side: "right" }) });
	usePanelWindows.setState({ panels: [], opening: [] });
}

for (const state of ["panels", "opening"] as const) {
	test(`an overflowing restored pane waits for the old ${state} window, then transfers once`, async () => {
		reset();
		const opened: unknown[] = [];
		Reflect.set(window, "lyra", { windows: { openPanel: async (input: unknown) => { opened.push(input); return { ok: true }; } } });
		usePanelWindows.setState({ [state]: [{ kind: "terminal", scope: "window" }] });
		const view = await mount(h(Overflow, {}));
		try {
			assert.equal(opened.length, 0, "a closing native window must not be focused repeatedly");
			assert.ok(has(useDock.getState().tree, "terminal"), "the restored dock still owns the pane while the old window closes");
			await act(async () => { usePanelWindows.setState({ [state]: [] }); });
			assert.deepEqual(opened, [{ kind: "terminal", scope: "window", sessionId: null }]);
			assert.equal(has(useDock.getState().tree, "terminal"), false, "the unchanged undersized dock relinquishes ownership");
			assert.ok(window.localStorage.getItem("dw:homes")?.includes("window:terminal"));
			await act(async () => { usePanelWindows.setState({ panels: [{ kind: "terminal", scope: "window" }], opening: [] }); });
			assert.equal(opened.length, 1);
		} finally {
			await view.unmount();
		}
	});
}

test("a failed overflow does not retry on unrelated window events, but a new size can retry", async () => {
	reset();
	let attempts = 0;
	Reflect.set(window, "lyra", { windows: { openPanel: async () => { attempts++; return { ok: false }; } } });
	const view = await mount(h(Overflow, {}));
	try {
		assert.equal(attempts, 1);
		assert.ok(has(useDock.getState().tree, "terminal"), "a refused native window restores its pane");
		await act(async () => { usePanelWindows.setState({ panels: [{ kind: "browser", scope: "other" }] }); });
		await act(async () => { usePanelWindows.setState({ panels: [] }); });
		assert.equal(attempts, 1, "native failure must not become an automatic retry loop");
		await view.rerender(h(Overflow, { width: 520 }));
		assert.equal(attempts, 2);
	} finally {
		await view.unmount();
	}
});
