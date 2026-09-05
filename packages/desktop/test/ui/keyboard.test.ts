import assert from "node:assert/strict";
import { test } from "node:test";
import { acceleratorLabel, recordAccelerator, shortcutLabel } from "../../src/ui/keyboard.ts";

test("Windows shortcut labels name keys on its keyboard, preserving ordinary copy", () => {
	for (const [input, expected] of [
		["隐藏侧边栏 ⌘B", "隐藏侧边栏 Ctrl+B"], ["Git ⌘⇧R", "Git Ctrl+Shift+R"],
		["⌥⌘P", "Ctrl+Alt+P"], ["终端 ⌃`", "终端 Ctrl+`"], ["⌘⌫", "Ctrl+Backspace"],
		["或 ⌥ 加方向键", "或 Alt 加方向键"], ["128K", "128K"],
	]) {
		assert.equal(shortcutLabel(input, "Win32"), expected);
		assert.equal(shortcutLabel(input, "MacIntel"), input);
	}
	assert.equal(acceleratorLabel("CommandOrControl+Shift+S", "Win32"), "Ctrl+Shift+S");
	assert.equal(acceleratorLabel("Control+Alt+S", "MacIntel"), "⌃ ⌥ S");
	assert.equal(acceleratorLabel("Super+S", "Win32"), "Win+S");
});

test("recording keeps Control distinct from Command and the Windows key", () => {
	const control = new KeyboardEvent("keydown", { key: "s", code: "KeyS", ctrlKey: true });
	const meta = new KeyboardEvent("keydown", { key: "s", code: "KeyS", metaKey: true });
	assert.equal(recordAccelerator(control, "Win32"), "CommandOrControl+S");
	assert.equal(recordAccelerator(control, "MacIntel"), "Control+S");
	assert.equal(recordAccelerator(meta, "Win32"), "Super+S");
	assert.equal(recordAccelerator(meta, "MacIntel"), "CommandOrControl+S");
});

test("Option-modified letters retain their key, while AltGr and IME cannot record commands", () => {
	const option = new KeyboardEvent("keydown", { key: "ß", code: "KeyS", altKey: true, metaKey: true });
	// happy-dom maps AltGraph to Alt; Chromium exposes the separate modifier state.
	Object.defineProperty(option, "getModifierState", { value: () => false });
	assert.equal(recordAccelerator(option, "MacIntel"), "CommandOrControl+Alt+S");
	const altGr = new KeyboardEvent("keydown", { key: "ś", code: "KeyS", altKey: true, ctrlKey: true });
	Object.defineProperty(altGr, "getModifierState", { value: (key: string) => key === "AltGraph" });
	assert.equal(recordAccelerator(altGr, "Win32"), null);
	assert.equal(recordAccelerator(new KeyboardEvent("keydown", { key: "Process", isComposing: true }), "Win32"), null);
});
