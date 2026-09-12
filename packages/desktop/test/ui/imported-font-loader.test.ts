import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import type { ImportedFontData } from "../../shared/custom-fonts.ts";
import {
	importedUiFontStack,
	loadImportedFont,
	loadSelectedFonts,
} from "../../src/features/settings/imported-fonts.ts";

function font(hex: string, name = "Test Sans"): ImportedFontData {
	const id = hex.repeat(64);
	return {
		id,
		name,
		family: `Lyra Imported ${id}`,
		format: "woff2",
		size: 2048,
		data: "data:font/woff2;base64,d09GMg==",
	};
}

function stubFontFace(t: TestContext, shouldFail: () => boolean) {
	const previousFace = Object.getOwnPropertyDescriptor(globalThis, "FontFace");
	const previousFonts = Object.getOwnPropertyDescriptor(document, "fonts");
	let loads = 0;
	let adds = 0;

	class TestFontFace {
		status = "unloaded";

		async load() {
			loads++;
			if (shouldFail()) throw new Error("browser rejected font");
			this.status = "loaded";
			return this;
		}
	}

	Object.defineProperty(globalThis, "FontFace", { configurable: true, value: TestFontFace });
	Object.defineProperty(document, "fonts", {
		configurable: true,
		value: { add: () => { adds++; } },
	});
	t.after(() => {
		if (previousFace) Object.defineProperty(globalThis, "FontFace", previousFace);
		else Reflect.deleteProperty(globalThis, "FontFace");
		if (previousFonts) Object.defineProperty(document, "fonts", previousFonts);
		else Reflect.deleteProperty(document, "fonts");
	});
	return { loads: () => loads, adds: () => adds };
}

function stubFontsBridge(t: TestContext, host: "desktop" | "mobile", read: (id: string) => Promise<ImportedFontData>) {
	const previous = Object.getOwnPropertyDescriptor(window, "lyra");
	Object.defineProperty(window, "lyra", {
		configurable: true,
		value: { host, fonts: { read } },
	});
	t.after(() => {
		if (previous) Object.defineProperty(window, "lyra", previous);
		else Reflect.deleteProperty(window, "lyra");
	});
}

test("a saved imported selection is read and registered again on startup", async (t) => {
	const selected = font("a", "Restart Sans");
	const reads: string[] = [];
	const faces = stubFontFace(t, () => false);
	stubFontsBridge(t, "desktop", async (id) => {
		reads.push(id);
		return selected;
	});

	await loadSelectedFonts(importedUiFontStack(selected.family), "ui-monospace, monospace");

	assert.deepEqual(reads, [selected.id]);
	assert.equal(faces.loads(), 1);
	assert.equal(faces.adds(), 1);
	assert.equal(document.documentElement.style.getPropertyValue("--ly-imported-ui-font"), `"${selected.family}"`);
});

test("the phone path never reaches the local fonts bridge", async (t) => {
	let reads = 0;
	stubFontsBridge(t, "mobile", async () => {
		reads++;
		return font("b");
	});

	await loadSelectedFonts(importedUiFontStack(font("b").family), importedUiFontStack(font("b").family));

	assert.equal(reads, 0);
	assert.equal(document.documentElement.style.getPropertyValue("--ly-imported-ui-font"), "");
});

test("a rejected face surfaces the browser error and can be retried", async (t) => {
	const selected = font("c", "Broken Sans");
	let failing = true;
	const faces = stubFontFace(t, () => failing);

	await assert.rejects(loadImportedFont(selected), /Broken Sans.*browser rejected font/u);
	failing = false;
	await loadImportedFont(selected);

	assert.equal(faces.loads(), 2);
	assert.equal(faces.adds(), 1);
});

test("concurrent requests for one imported file share one FontFace load", async (t) => {
	const selected = font("d", "Concurrent Sans");
	const faces = stubFontFace(t, () => false);

	await Promise.all([loadImportedFont(selected), loadImportedFont(selected)]);

	assert.equal(faces.loads(), 1);
	assert.equal(faces.adds(), 1);
});
