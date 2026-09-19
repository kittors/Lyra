import assert from "node:assert/strict";
import { test } from "node:test";
import { act, createElement as h } from "react";
import { Terminal } from "@xterm/xterm";
import { SessionScope } from "../../src/app/session-scope.tsx";
import { TerminalPane } from "../../src/features/terminal/TerminalPane.tsx";
import { TerminalTabs } from "../../src/features/terminal/TerminalTabs.tsx";
import { useTerminals } from "../../src/store/terminals.ts";
import { useApp } from "../../src/store/index.ts";
import { translate } from "../../src/i18n/translate.ts";
import { mount } from "../helpers/mount.ts";

test("a background shell exit removes its tab without replacing the current shell or its status", async (t) => {
	const css = Object.getOwnPropertyDescriptor(globalThis, "CSS");
	Object.defineProperty(globalThis, "CSS", { value: window.CSS, configurable: true });
	t.after(() => {
		if (css) Object.defineProperty(globalThis, "CSS", css);
		else Reflect.deleteProperty(globalThis, "CSS");
	});
	// Extend the existing xterm test stub; the real pane and tab strip still own the event lifecycle.
	const additions = { focus() {}, reset() {}, onData: () => ({ dispose() {} }), cols: 80, rows: 24, options: {} };
	for (const [name, value] of Object.entries(additions)) {
		const original = Object.getOwnPropertyDescriptor(Terminal.prototype, name);
		Object.defineProperty(Terminal.prototype, name, { value, configurable: true });
		t.after(() => {
			if (original) Object.defineProperty(Terminal.prototype, name, original);
			else Reflect.deleteProperty(Terminal.prototype, name);
		});
	}
	const tabs = [{ id: "other", title: "Other" }, { id: "current", title: "Current" }, { id: "last", title: "Last" }];
	const exits = new Set<(event: { id: string; code: number }) => void>();
	const detached: string[] = [];
	Reflect.set(window, "lyra", { terminal: {
		listAll: async () => tabs,
		list: async () => [tabs[1]],
		attach: async (id: string) => ({ id, epoch: 2, replay: "" }),
		detach: (id: string) => { detached.push(id); },
		onData: () => () => {},
		onExit: (listener: (event: { id: string; code: number }) => void) => {
			exits.add(listener);
			return () => { exits.delete(listener); };
		},
	} });
	window.localStorage.clear();
	useTerminals.setState({ tabs, active: "", activeByScope: { scope: "current" } });
	useApp.setState({ settings: null, workspace: null, meta: null, activeSessionId: "scope" });
	const view = await mount(h(SessionScope.Provider, { value: "scope" }, h("div", null, h(TerminalTabs), h(TerminalPane))));
	try {
		assert.ok(exits.size > 0);
		assert.equal(view.all("[data-tab]").length, 3);
		await act(() => { for (const emit of exits) emit({ id: "other", code: 9 }); });
		assert.deepEqual(view.all("[data-tab]").map((tab) => tab.dataset.tab), ["current", "last"]);
		assert.equal(view.find("[data-terminal-id]").dataset.terminalId, "current");
		assert.equal(detached.length, 0);
		assert.ok(!view.host.textContent?.includes(translate("terminal.shellExitedCode", { code: 9 })));
		await act(() => { for (const emit of exits) emit({ id: "current", code: 7 }); });
		assert.deepEqual(view.all("[data-tab]").map((tab) => tab.dataset.tab), ["last"]);
		assert.ok(view.host.textContent?.includes(translate("terminal.shellExitedCode", { code: 7 })));
		await act(() => { for (const emit of exits) emit({ id: "last", code: 0 }); });
		assert.equal(view.all("[data-tab]").length, 0);
		assert.ok(view.host.textContent?.includes(translate("terminal.shellExitedCode", { code: 7 })));
	} finally {
		await view.unmount();
		Reflect.deleteProperty(window, "lyra");
	}
});
