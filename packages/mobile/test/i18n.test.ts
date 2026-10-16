import assert from "node:assert/strict";
import { test } from "node:test";
import { MOBILE_LOCALES, mobileTranslator, resolveMobileLocale } from "../src/i18n.ts";

test("mobile locale resolution follows BCP 47 language families", () => {
	assert.equal(resolveMobileLocale("zh-Hant-HK"), "zh-TW");
	assert.equal(resolveMobileLocale("zh_Hans_SG"), "zh-CN");
	assert.equal(resolveMobileLocale("fr-CA"), "fr");
	assert.equal(resolveMobileLocale("ko-KR"), "ko");
	assert.equal(resolveMobileLocale("es-MX"), "en");
});

test("every mobile locale exposes translated shell copy", () => {
	for (const locale of MOBILE_LOCALES) {
		const t = mobileTranslator(locale);
		assert.ok(t("home.title").trim().length > 0, locale);
		assert.ok(t("pair.connect").trim().length > 0, locale);
		assert.ok(t("desk.retry").trim().length > 0, locale);
	}
});

test("mobile translations preserve and interpolate variables", () => {
	const t = mobileTranslator("en-US");
	assert.equal(t("desk.response", { status: 503 }), "Desktop returned 503");
	assert.equal(t("pair.directFailed", { address: "192.168.1.8" }).includes("192.168.1.8"), true);
});

test("every language the phone speaks is declared to iOS, with its own permission prompts", async () => {
	// Undeclared, an iPhone in that language is handed the development region's: these screens and the
	// photo picker came up in English on a Chinese phone (`docs/architecture/mobile-packaging.md`).
	const { readFile } = await import("node:fs/promises");
	const app = JSON.parse(await readFile(new URL("../app.json", import.meta.url), "utf8")) as {
		expo: { locales: Record<string, { ios: Record<string, string> }>; ios: { infoPlist: Record<string, unknown> } };
	};
	const apple = (locale: string) => (locale === "zh-CN" ? "zh-Hans" : locale === "zh-TW" ? "zh-Hant" : locale);
	assert.deepEqual(Object.keys(app.expo.locales).sort(), MOBILE_LOCALES.map(apple).sort());
	for (const [language, strings] of Object.entries(app.expo.locales)) {
		assert.ok(strings.ios.NSCameraUsageDescription?.trim(), `${language} 的相机说明`);
		assert.ok(strings.ios.NSMicrophoneUsageDescription?.trim(), `${language} 的麦克风说明`);
	}
	assert.equal(app.expo.ios.infoPlist.CFBundleAllowMixedLocalizations, true);
});

test("the pairing screens' titles are in the phone's language too", () => {
	assert.equal(mobileTranslator("en-US")("pair.title"), "Connect to desktop");
	assert.equal(mobileTranslator("zh-Hans-CN")("pair.title"), "连接桌面端");
});
