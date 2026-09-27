import assert from "node:assert/strict";
import { test } from "node:test";
import { NATIVE_CATALOGS, nativeTranslator, resolveNativeLocale } from "../electron/i18n.ts";
import { trayMenu } from "../electron/tray-menu.ts";

/** The `{name}` slots a message fills in, so a translation cannot drop or rename one. */
const slots = (text: string) => [...new Set([...text.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]))].sort();

test("every native language pack has the same keys, all filled in, with the same slots", () => {
	/*
	 * The type makes a missing key a compile error, but `node --test` strips types rather than
	 * checking them, and neither the type nor the compiler looks inside the strings: a slot that a
	 * translation renamed would print as `{title}` in that language only.
	 */
	const source = NATIVE_CATALOGS["zh-CN"];
	for (const [locale, catalog] of Object.entries(NATIVE_CATALOGS)) {
		assert.deepEqual(Object.keys(catalog).sort(), Object.keys(source).sort(), `${locale} keys`);
		for (const [key, text] of Object.entries(catalog)) {
			assert.ok(text.trim(), `${locale} ${key} is empty`);
			assert.deepEqual(slots(text), slots(source[key as keyof typeof source]), `${locale} ${key}`);
		}
	}
});

test("native surfaces resolve system locale with the same Chinese region rules", () => {
	assert.equal(resolveNativeLocale("system", "zh-Hant-HK"), "zh-TW");
	assert.equal(resolveNativeLocale("system", "fr-CA"), "fr");
	assert.equal(resolveNativeLocale("system", "es-MX"), "en");
	assert.equal(resolveNativeLocale("ko", "en-US"), "ko");
});

test("native dialogs use the selected language", () => {
	assert.equal(nativeTranslator("en", "zh-CN")("dialog.projectDirectory"), "Choose project folder");
	assert.equal(nativeTranslator("ja", "zh-CN")("dialog.screenshotDirectory"), "スクリーンショットの保存先を選択");
});

test("tray menu labels use the selected language", () => {
	const menu = trayMenu({ windowVisible: false, recent: [], launchAtLogin: false, locale: "fr" });
	assert.equal(menu[0].type === "item" ? menu[0].label : "", "Ouvrir Lyra");
	const last = menu.at(-1);
	assert.equal(last?.type === "item" ? last.label : "", "Quitter Lyra");
});
