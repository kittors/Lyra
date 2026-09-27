import assert from "node:assert/strict";
import { test } from "node:test";
import { NATIVE_CATALOGS, nativeText, nativeTranslator, resolveNativeLocale, setInterfaceLocaleSource, type NativeLocale } from "../electron/i18n.ts";
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

test("main-process text follows the interface language, asked again for every message", () => {
	/*
	 * The scheduler, the file operations and the code-host and update clients have no settings of
	 * their own to ask, so they write through `nativeText`. What it must not do is settle on one
	 * language: the setting changes while the app runs, and the very next message has to follow it.
	 */
	let language: NativeLocale = "en";
	setInterfaceLocaleSource(() => language);
	try {
		assert.equal(nativeText("files.exists", { name: "notes.md" }), "“notes.md” already exists");
		language = "ja";
		assert.equal(nativeText("files.exists", { name: "notes.md" }), "「notes.md」はすでにあります");
		language = "fr";
		assert.equal(nativeText("scheduled.failed", { name: "Revue", reason: "boom" }), "La tâche planifiée « Revue » a échoué : boom");
	} finally {
		setInterfaceLocaleSource(() => "zh-CN");
	}
});

test("each language joins a reason on with its own punctuation, not with Chinese", () => {
	/*
	 * Punctuation is what is left once every word is translated: while this text was a template
	 * literal, 「：」 and 「（）」 sat between the words of every language. Chinese and Japanese keep
	 * the full-width marks; everyone else gets their own, and French its space before a colon.
	 */
	const fullWidth = new Set(["zh-CN", "zh-TW", "ja"]);
	for (const [locale, catalog] of Object.entries(NATIVE_CATALOGS)) {
		for (const [key, text] of Object.entries(catalog)) {
			if (fullWidth.has(locale)) {
				assert.doesNotMatch(text, /\}\s*:|:\s*\{|\(\{|\}\)/, `${locale} ${key} puts a half-width mark beside a slot: ${text}`);
			} else {
				assert.doesNotMatch(text, /[：（），、。；！？]/, `${locale} ${key} carries Chinese punctuation: ${text}`);
			}
		}
	}

	const joined = (locale: NativeLocale) => nativeTranslator(locale, "en")("forge.withDetail", { message: "M", detail: "D" });
	assert.deepEqual(
		(["zh-CN", "zh-TW", "ja", "en", "ru", "ko", "fr"] as const).map(joined),
		["M：D", "M：D", "M：D", "M: D", "M: D", "M: D", "M : D"],
	);
	assert.equal(nativeTranslator("zh-CN", "en")("forge.serverError", { status: 502 }), "对方服务出错了（502）");
	assert.equal(nativeTranslator("en", "en")("forge.serverError", { status: 502 }), "The host's service ran into an error (502)");
	assert.equal(nativeTranslator("ko", "en")("forge.serverError", { status: 502 }), "상대 서비스에서 오류가 났습니다 (502)");
});
