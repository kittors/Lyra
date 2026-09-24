/**
 * A blank conversation's panels, the moment it gets an id.
 *
 * The screen does not remount when the first message is sent: `assignPaneKeys` hands the draft's
 * slot to the new session, so the same `DockView` sees its scope go from `@draft` to the id. So does
 * clicking an existing conversation from a blank one — same slot, same transition. Only the first
 * should carry the arrangement across, and `draftBecame` is how the screen tells them apart.
 */

import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { act, createElement as h } from "react";
import { Terminal } from "lucide-react";
import { DockView } from "../../src/features/dock/DockView.tsx";
import { LayoutProvider } from "../../src/app/layout.tsx";
import { usePaneDock } from "../../src/features/dock/pane-store.ts";
import { registerPanels } from "../../src/features/dock/panels/registry.ts";
import { kinds } from "../../src/features/dock/tree.ts";
import { useApp } from "../../src/store/index.ts";
import { mount } from "../helpers/mount.ts";

function screen(scope: string) {
	return h(LayoutProvider, { children: h(DockView, { scope, header: () => null, children: h("textarea", { "data-test-chat": "" }) }) });
}

let unregister: () => void = () => {};

beforeEach(() => {
	Object.defineProperty(window, "lyra", { configurable: true, value: { platform: "darwin" } });
	window.localStorage.clear();
	usePaneDock.setState({ trees: {}, sizes: {}, drag: null, maximized: {}, focused: {}, crossRatio: {}, host: null });
	useApp.setState({ draftBecame: null });
	unregister = registerPanels([{
		kind: "terminal", label: "common.terminal", icon: Terminal, shortcut: "",
		render: () => h("div", { "data-test-terminal": "" }),
	}]);
});

afterEach(() => {
	unregister();
	useApp.setState({ draftBecame: null });
	Reflect.deleteProperty(window, "lyra");
});

test("sending a blank conversation keeps the panels it was arranged with, on the same screen", async () => {
	const view = await mount(screen("@draft"));
	try {
		await act(async () => { usePaneDock.getState().open("@draft", "terminal"); });
		assert.ok(view.find('[data-dock-panes="@draft"] [data-dock-pane="terminal"]'));

		// What `send` does: the id arrives, and the store says which conversation the draft became.
		useApp.setState({ draftBecame: "s-sent" });
		await view.rerender(screen("s-sent"));

		assert.deepEqual(kinds(usePaneDock.getState().tree("s-sent")).sort(), ["conversation", "terminal"]);
		assert.ok(view.find('[data-dock-panes="s-sent"] [data-dock-pane="terminal"] [data-test-terminal]'), "and it is drawn there");
	} finally {
		await view.unmount();
	}
});

test("opening an existing conversation from a blank one does not hand it the blank one's panels", async () => {
	const view = await mount(screen("@draft"));
	try {
		await act(async () => { usePaneDock.getState().open("@draft", "terminal"); });

		// Same slot, same scope change — but nothing was sent.
		await view.rerender(screen("s-old"));

		assert.deepEqual(kinds(usePaneDock.getState().tree("s-old")), ["conversation"]);
		assert.equal(view.all('[data-dock-panes="s-old"] [data-dock-pane="terminal"]').length, 0);
	} finally {
		await view.unmount();
	}
});

test("a draft that became some other conversation does not leak into this one", async () => {
	const view = await mount(screen("@draft"));
	try {
		await act(async () => { usePaneDock.getState().open("@draft", "terminal"); });
		// Sent in another screen a moment ago; this screen is being pointed at an old conversation.
		useApp.setState({ draftBecame: "s-elsewhere" });

		await view.rerender(screen("s-old"));

		assert.deepEqual(kinds(usePaneDock.getState().tree("s-old")), ["conversation"]);
	} finally {
		await view.unmount();
	}
});
