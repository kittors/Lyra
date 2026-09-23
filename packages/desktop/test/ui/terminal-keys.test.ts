/**
 * 终端里的按键，在 Windows 和 Linux 上归谁。
 *
 * xterm 把每个 Ctrl+字母都变成控制字符发给 shell，并吞掉事件；Chromium 在这两个平台上又没有
 * 自己的复制可以兜底。于是选中一段文字按 Ctrl+C，发出去的是 SIGINT——正在跑的 dev server 就
 * 这么被打断了；Ctrl+Alt+S/P/A 这几个面板快捷键在终端有焦点时也按不出来。另外 Windows 上的
 * pty 是 ConPTY，xterm 不被告知就按 Unix pty 处理：调高行数会丢行、老版本上 reflow 会乱。
 */

import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { act, createElement as h } from "react";
import { Terminal } from "@xterm/xterm";

import { SessionScope } from "../../src/app/session-scope.tsx";
import { TerminalPane } from "../../src/features/terminal/TerminalPane.tsx";
import { terminalKey, windowsPtyFor } from "../../src/features/terminal/terminal-keys.ts";
import { useApp } from "../../src/store/index.ts";
import { useTerminals } from "../../src/store/terminals.ts";
import { withKeyboard } from "../helpers/keyboard.ts";
import { click, fire, mount } from "../helpers/mount.ts";

/** A keydown as Chromium sends it: no AltGraph unless the test says so. */
function key(keyName: string, code: string, init: KeyboardEventInit = {}, altGraph = false) {
	const event = new KeyboardEvent("keydown", { key: keyName, code, bubbles: true, cancelable: true, ...init });
	Object.defineProperty(event, "getModifierState", { value: (modifier: string) => altGraph && modifier === "AltGraph" });
	return event;
}

test("Windows/Linux：有选区时 Ctrl+C 是复制，没选区时仍是 ^C", () => {
	const ctrlC = key("c", "KeyC", { ctrlKey: true });
	assert.equal(terminalKey(ctrlC, true, "Win32"), "copy");
	assert.equal(terminalKey(ctrlC, false, "Win32"), "shell", "没有选区，Ctrl+C 还是中断");
	assert.equal(terminalKey(key("C", "KeyC", { ctrlKey: true, shiftKey: true }), false, "Linux x86_64"), "copy");
	assert.equal(terminalKey(key("V", "KeyV", { ctrlKey: true, shiftKey: true }), false, "Win32"), "paste");
	// Russian layout: the C key types Cyrillic "с" and is still Ctrl+C.
	assert.equal(terminalKey(key("с", "KeyC", { ctrlKey: true }), true, "Win32"), "copy");
});

test("Windows/Linux：Ctrl+Alt+S/P/A 归应用；readline 的 Ctrl+B/P/J/T/L 仍归 shell", () => {
	for (const [letter, code] of [["s", "KeyS"], ["p", "KeyP"], ["a", "KeyA"]]) {
		assert.equal(terminalKey(key(letter, code, { ctrlKey: true, altKey: true }), false, "Win32"), "app", letter);
	}
	for (const [letter, code] of [["b", "KeyB"], ["p", "KeyP"], ["j", "KeyJ"], ["t", "KeyT"], ["l", "KeyL"]]) {
		assert.equal(terminalKey(key(letter, code, { ctrlKey: true }), false, "Win32"), "shell", letter);
	}
	// AltGr is Ctrl+Alt on Windows and types letters: Polish ś is AltGr+S.
	assert.equal(terminalKey(key("ś", "KeyS", { ctrlKey: true, altKey: true }, true), false, "Win32"), "shell");
});

test("Mac 上一切照旧：⌘ 不进 shell，复制粘贴走编辑菜单", () => {
	assert.equal(terminalKey(key("c", "KeyC", { ctrlKey: true }), true, "MacIntel"), "shell");
	assert.equal(terminalKey(key("c", "KeyC", { metaKey: true }), true, "MacIntel"), "shell");
	assert.equal(terminalKey(key("s", "KeyS", { ctrlKey: true, altKey: true }), false, "MacIntel"), "shell");
});

test("Windows 的 pty 如实告诉 xterm：后端和版本号", () => {
	assert.deepEqual(windowsPtyFor("win32", "10.0.22631"), { backend: "conpty", buildNumber: 22631 });
	// Below 18309 node-pty falls back to winpty; xterm has to hear the same.
	assert.deepEqual(windowsPtyFor("win32", "10.0.17763"), { backend: "winpty", buildNumber: 17763 });
	// Unreadable: still ConPTY-aware, and reflow stays off without a build to prove it safe.
	assert.deepEqual(windowsPtyFor("win32", undefined), { backend: "conpty" });
	assert.equal(windowsPtyFor("darwin", "26.0.0"), undefined);
	assert.equal(windowsPtyFor("linux", "6.8.0"), undefined);
});

/** Swap a method on the stubbed terminal for one test, and put it back afterwards. */
function stubTerminal(t: TestContext, methods: Record<string, unknown>) {
	for (const [name, value] of Object.entries(methods)) {
		const original = Object.getOwnPropertyDescriptor(Terminal.prototype, name);
		Object.defineProperty(Terminal.prototype, name, { value, configurable: true, writable: true });
		t.after(() => {
			if (original) Object.defineProperty(Terminal.prototype, name, original);
			else Reflect.deleteProperty(Terminal.prototype, name);
		});
	}
}

type Built = { options: Record<string, unknown>; customKeyEventHandler?: (event: KeyboardEvent) => boolean };

test("终端面板把这些接上：windowsPty、按键处理、右键菜单", async (t) => {
	// The context menu places itself at a point with `new DOMRect`; provided in case the shared DOM
	// does not, and put back exactly as it was.
	const domRect = Object.getOwnPropertyDescriptor(globalThis, "DOMRect");
	Object.defineProperty(globalThis, "DOMRect", { value: window.DOMRect, configurable: true, writable: true });
	t.after(() => {
		if (domRect) Object.defineProperty(globalThis, "DOMRect", domRect);
		else Reflect.deleteProperty(globalThis, "DOMRect");
	});
	const css = Object.getOwnPropertyDescriptor(globalThis, "CSS");
	Object.defineProperty(globalThis, "CSS", { value: window.CSS, configurable: true });
	t.after(() => {
		if (css) Object.defineProperty(globalThis, "CSS", css);
		else Reflect.deleteProperty(globalThis, "CSS");
	});
	/** Every terminal the pane opened — one, if it built it once. */
	const built: Built[] = [];
	let selection = "http://localhost:5173";
	const pasted: string[] = [];
	let cleared = 0;
	stubTerminal(t, {
		open(this: Built) { built.push(this); },
		focus() {}, reset() {}, onData: () => ({ dispose() {} }), cols: 80, rows: 24,
		hasSelection: () => selection.length > 0,
		getSelection: () => selection,
		clearSelection: () => { cleared += 1; selection = ""; },
		paste: (text: string) => { pasted.push(text); },
	});
	const written: string[] = [];
	Reflect.set(window, "lyra", {
		platform: "win32",
		systemVersion: "10.0.22631",
		terminal: {
			listAll: async () => [{ id: "t1", title: "Shell" }],
			list: async () => [{ id: "t1", title: "Shell" }],
			attach: async (id: string) => ({ id, epoch: 1, replay: "" }),
			detach: () => {},
			onData: () => () => {},
			onExit: () => () => {},
		},
		clipboard: {
			write: async (text: string) => { written.push(text); },
			read: async () => "npm run dev",
		},
	});
	window.localStorage.clear();
	useTerminals.setState({ tabs: [{ id: "t1", title: "Shell" }], active: "", activeByScope: { scope: "t1" } });
	useApp.setState({ settings: null, workspace: null, meta: null, activeSessionId: "scope" });

	await withKeyboard("Win32", async () => {
		const view = await mount(h(SessionScope.Provider, { value: "scope" }, h(TerminalPane)));
		try {
			assert.equal(built.length, 1, "终端应当建出来一次");
			const terminal = built[0]!;
			assert.deepEqual(terminal.options.windowsPty, { backend: "conpty", buildNumber: 22631 });

			const handle = terminal.customKeyEventHandler;
			assert.ok(handle, "没有接管按键");
			// Selected: copied, cleared, and xterm never sees it — no ^C reaches the shell.
			assert.equal(handle(key("c", "KeyC", { ctrlKey: true })), false);
			assert.deepEqual(written, ["http://localhost:5173"]);
			assert.equal(cleared, 1);
			// Nothing selected now: ^C is the shell's again.
			assert.equal(handle(key("c", "KeyC", { ctrlKey: true })), true);
			assert.equal(handle(key("s", "KeyS", { ctrlKey: true, altKey: true })), false, "Ctrl+Alt+S 应交给应用");
			assert.equal(handle(key("l", "KeyL", { ctrlKey: true })), true, "Ctrl+L 仍是清屏");

			// Right-click: copy and paste, and the paste goes through xterm's own `paste`.
			selection = "error: port in use";
			await fire(view.find("[data-terminal-id]"), new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 20, clientY: 20 }));
			const items = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
			const copy = items.find((item) => item.textContent?.startsWith("复制"));
			const paste = items.find((item) => item.textContent?.startsWith("粘贴"));
			assert.ok(copy && paste, items.map((item) => item.textContent).join(" | "));
			assert.ok(paste.textContent?.includes("Ctrl+Shift+V"), paste.textContent ?? "");
			await click(copy);
			assert.deepEqual(written, ["http://localhost:5173", "error: port in use"]);

			await fire(view.find("[data-terminal-id]"), new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 20, clientY: 20 }));
			const again = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((item) => item.textContent?.startsWith("粘贴"));
			assert.ok(again);
			await click(again);
			await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
			assert.deepEqual(pasted, ["npm run dev"]);
		} finally {
			await view.unmount();
			Reflect.deleteProperty(window, "lyra");
		}
	});
});
