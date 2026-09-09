import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { act, createElement as h } from "react";
import { DEFAULT_SETTINGS, type Settings } from "@lyra/core";
import type { ImportedFont, ImportedFontData } from "../../shared/custom-fonts.ts";
import { ImportedFontsSettings } from "../../src/features/settings/ImportedFontsSettings.tsx";
import {
	DEFAULT_UI_FONT_STACK,
	importedUiFontStack,
} from "../../src/features/settings/imported-fonts.ts";
import { CODE_DEFAULTS } from "../../src/features/settings/code-defaults.ts";
import { useApp } from "../../src/store/index.ts";
import { click, mount, type Mounted } from "../helpers/mount.ts";

function font(hex: string, name = "Preview Sans"): ImportedFontData {
	const id = hex.repeat(64);
	return {
		id,
		name,
		family: `Lyra Imported ${id}`,
		format: "otf",
		size: 4096,
		data: "data:font/otf;base64,T1RUTw==",
	};
}

function stubStore(t: TestContext, settings: Settings) {
	const previous = useApp.getState();
	const saved: Settings[] = [];
	useApp.setState({
		settings,
		saveSettings: async (next) => {
			saved.push(next);
			useApp.setState({ settings: next });
		},
	});
	t.after(() => useApp.setState({
		settings: previous.settings,
		saveSettings: previous.saveSettings,
		notices: previous.notices,
	}));
	return saved;
}

function stubBridge(
	t: TestContext,
	options: {
		list?: () => Promise<ImportedFont[]>;
		importFont?: () => Promise<ImportedFontData | null>;
		read?: (id: string) => Promise<ImportedFontData>;
	},
) {
	const previous = Object.getOwnPropertyDescriptor(window, "lyra");
	Object.defineProperty(window, "lyra", {
		configurable: true,
		value: {
			host: "desktop",
			fonts: {
				list: options.list ?? (async () => []),
				import: options.importFont ?? (async () => null),
				read: options.read ?? (async () => { throw new Error("unexpected font read"); }),
			},
		},
	});
	t.after(() => {
		if (previous) Object.defineProperty(window, "lyra", previous);
		else Reflect.deleteProperty(window, "lyra");
	});
}

function rejectFontFaces(t: TestContext) {
	const previous = Object.getOwnPropertyDescriptor(globalThis, "FontFace");
	class RejectedFontFace {
		async load() {
			throw new Error("invalid outlines");
		}
	}
	Object.defineProperty(globalThis, "FontFace", { configurable: true, value: RejectedFontFace });
	t.after(() => {
		if (previous) Object.defineProperty(globalThis, "FontFace", previous);
		else Reflect.deleteProperty(globalThis, "FontFace");
	});
}

async function settle() {
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 0));
	});
}

function button(view: Mounted, label: string): HTMLButtonElement {
	const found = view.all<HTMLButtonElement>("button").find((candidate) => candidate.textContent?.includes(label));
	assert.ok(found, `no button containing ${label}`);
	return found;
}

test("cancelling the native picker leaves the current font selection unchanged", async (t) => {
	const saved = stubStore(t, DEFAULT_SETTINGS);
	let imports = 0;
	stubBridge(t, {
		importFont: async () => {
			imports++;
			return null;
		},
	});
	const view = await mount(h(ImportedFontsSettings));
	t.after(() => view.unmount());
	await settle();

	await click(button(view, "导入字体"));
	await settle();

	assert.equal(imports, 1);
	assert.equal(saved.length, 0);
	assert.equal(view.all('[role="alert"]').length, 0);
});

test("a browser font rejection is visible and never changes settings", async (t) => {
	const broken = font("e", "Broken Preview");
	const saved = stubStore(t, DEFAULT_SETTINGS);
	stubBridge(t, { importFont: async () => broken });
	rejectFontFaces(t);
	const view = await mount(h(ImportedFontsSettings));
	t.after(() => view.unmount());
	await settle();

	await click(button(view, "导入字体"));
	await settle();

	assert.match(view.find('[role="alert"]').textContent ?? "", /字体导入失败.*invalid outlines/u);
	assert.equal(saved.length, 0);
	assert.equal(button(view, "应用为 UI 字体").disabled, true);
});

test("restore defaults changes only the two font stacks", async (t) => {
	const selected = font("f", "Reset Sans");
	const settings: Settings = {
		...DEFAULT_SETTINGS,
		appearance: {
			...DEFAULT_SETTINGS.appearance,
			theme: "light",
			accent: "#FF3366",
			uiFont: importedUiFontStack(selected.family),
			codeFont: `"${selected.family}", monospace`,
		},
	};
	const saved = stubStore(t, settings);
	stubBridge(t, { list: async () => [selected] });
	const view = await mount(h(ImportedFontsSettings));
	t.after(() => view.unmount());
	await settle();

	await click(button(view, "只恢复默认字体"));
	await settle();

	assert.equal(saved.length, 1);
	assert.equal(saved[0]?.appearance.uiFont, DEFAULT_UI_FONT_STACK);
	assert.equal(saved[0]?.appearance.codeFont, CODE_DEFAULTS.codeFont);
	assert.equal(saved[0]?.appearance.theme, "light");
	assert.equal(saved[0]?.appearance.accent, "#FF3366");
});
