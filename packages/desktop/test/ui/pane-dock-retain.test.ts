import assert from "node:assert/strict";
import { test } from "node:test";
import { act, createElement as h } from "react";
import { Terminal } from "lucide-react";
import { PaneDock } from "../../src/features/split/PaneDock.tsx";
import { usePaneDock } from "../../src/features/dock/pane-store.ts";
import { registerPanels } from "../../src/features/dock/panels/registry.ts";
import { kinds, lift } from "../../src/features/dock/tree.ts";
import { flushTree, paneStorageKey, readTree } from "../../src/features/dock/persist.ts";
import { mount, press } from "../helpers/mount.ts";

test("a lifted last panel and the conversation retain their DOM through an empty landing", async () => {
	// happy-dom has no top layer. Its geometry is verified by split-dock-demo in Electron.
	HTMLElement.prototype.showPopover = () => {};
	HTMLElement.prototype.hidePopover = () => {};
	window.localStorage.clear();
	usePaneDock.setState({ trees: {}, sizes: {}, drag: null });
	const unregister = registerPanels([{
		kind: "terminal", label: "common.terminal", icon: Terminal, shortcut: "",
		render: () => h("input", { "data-test-terminal": "", defaultValue: "shell scrollback" }),
	}]);
	const view = await mount(h(PaneDock, { scope: "retain", chrome: h("header", { "data-test-chrome": "" }), children: h("textarea", { "data-test-chat": "" }) }));
	try {
		const conversation = view.find("[data-test-chat]");
		assert.equal(view.find("[data-test-chrome]").closest('[data-ly-pane-slot="conversation"]'), conversation.closest('[data-ly-pane-slot="conversation"]'));
		await act(() => { usePaneDock.getState().open("retain", "terminal"); });
		assert.ok(view.find("[data-test-chat]") === conversation, "opening a panel remounted the composer");
		const terminal = view.find("[data-test-terminal]");
		const grip = view.find('[data-dock-grip="terminal"]');
		await act(() => {
			grip.dispatchEvent(new window.PointerEvent("pointerdown", { bubbles: true, pointerId: 11, button: 0, clientX: 10, clientY: 10 }));
			window.dispatchEvent(new window.PointerEvent("pointermove", { bubbles: true, pointerId: 11, buttons: 1, clientX: 50, clientY: 50 }));
		});
		assert.ok(view.find("[data-test-terminal]") === terminal, "the carried panel was unmounted in the centre dead zone");
		await act(() => { window.dispatchEvent(new Event("blur")); });
		assert.equal(view.all(".ly-dock-pane-carried").length, 0, "blur must not await throttled background animation frames");
		assert.ok(view.find("[data-test-chat]") === conversation);
		assert.ok(view.find("[data-test-terminal]") === terminal);
	} finally {
		await view.unmount();
		unregister();
		Reflect.deleteProperty(HTMLElement.prototype, "showPopover");
		Reflect.deleteProperty(HTMLElement.prototype, "hidePopover");
	}
});

test("arrow keys preview a pane move; Escape cancels and Enter commits without replacing the body", async () => {
	window.localStorage.clear();
	usePaneDock.setState({ trees: {}, sizes: {}, drag: null, maximized: {} });
	const unregister = registerPanels([{
		kind: "terminal", label: "common.terminal", icon: Terminal, shortcut: "",
		render: () => h("textarea", { "data-test-shell": "" }),
	}]);
	const view = await mount(h(PaneDock, { scope: "keyboard", children: h("textarea", { "data-test-chat": "" }) }));
	try {
		await act(() => { usePaneDock.getState().open("keyboard", "terminal"); });
		const before = usePaneDock.getState().tree("keyboard");
		const shell = view.find("[data-test-shell]");
		const grip = view.find('[data-dock-grip="terminal"]');
		await press(grip, "ArrowLeft");
		assert.deepEqual(kinds(usePaneDock.getState().tree("keyboard")), ["terminal", "conversation"]);
		assert.equal(view.all("[data-dock-keyboard-drop]").length, 0);
		assert.equal(view.find("[data-test-shell]"), shell);
		await press(grip, "ArrowRight");
		assert.deepEqual(usePaneDock.getState().tree("keyboard"), before);
		const restored = usePaneDock.getState().tree("keyboard");
		await press(grip, "ArrowDown");
		assert.ok(view.find('[data-dock-keyboard-drop="bottom"]'));
		assert.equal(usePaneDock.getState().tree("keyboard"), restored);
		await press(grip, "Escape");
		assert.equal(view.all("[data-dock-keyboard-drop]").length, 0);
		assert.equal(usePaneDock.getState().tree("keyboard"), restored);
		await press(grip, "ArrowDown");
		await press(grip, "Enter");
		const after = usePaneDock.getState().tree("keyboard");
		assert.ok(after.type === "split" && after.dir === "col");
		assert.equal(view.find("[data-test-shell]"), shell);
	} finally {
		await view.unmount();
		unregister();
	}
});

test("a pane drag never persists its temporarily missing panel, including on unmount", () => {
	window.localStorage.clear();
	usePaneDock.setState({ trees: {}, sizes: {}, drag: null });
	const dock = usePaneDock.getState();
	dock.open("persist-drag", "terminal");
	const before = dock.tree("persist-drag");
	const rest = lift(before, "terminal");
	assert.ok(rest);
	flushTree();
	dock.beginDrag("persist-drag", {
		kind: "terminal", before, rest, at: null,
		from: { left: 0, top: 0, width: 300, height: 300 },
		grip: { x: 10, y: 10 }, pointer: { x: 50, y: 50 },
	});
	dock.preview("persist-drag", rest, "terminal", null);
	flushTree();
	assert.deepEqual(readTree(paneStorageKey("persist-drag"), ["conversation", "terminal"]), before);
	dock.forget("persist-drag");
	assert.deepEqual(readTree(paneStorageKey("persist-drag"), ["conversation", "terminal"]), before);
});
