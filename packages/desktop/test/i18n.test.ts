import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveUiLocale } from "../src/i18n/locales.ts";
import { MESSAGE_CATALOGS, type MessageKey } from "../src/i18n/messages/index.ts";

test("system languages resolve by BCP 47 family, including traditional Chinese regions", () => {
	assert.equal(resolveUiLocale("system", ["zh-Hant-HK"]), "zh-TW");
	assert.equal(resolveUiLocale("system", ["zh-CN"]), "zh-CN");
	assert.equal(resolveUiLocale("system", ["fr-CA"]), "fr");
	assert.equal(resolveUiLocale("system", ["ko-KR"]), "ko");
	assert.equal(resolveUiLocale("system", ["es-MX", "ja-JP"]), "ja");
	assert.equal(resolveUiLocale("system", ["es-MX"]), "en");
});

test("an explicit interface language is stable regardless of the operating system", () => {
	assert.equal(resolveUiLocale("ru", ["en-US"]), "ru");
	assert.equal(resolveUiLocale("zh-TW", ["zh-CN"]), "zh-TW");
});

test("all bundled language packs cover the same interface keys", () => {
	const source = Object.keys(MESSAGE_CATALOGS["zh-CN"]).sort();
	for (const [locale, catalog] of Object.entries(MESSAGE_CATALOGS)) {
		assert.deepEqual(Object.keys(catalog).sort(), source, `${locale} 缺少界面文案`);
	}
});

test("every translation keeps the {slots} of its Chinese source", () => {
	// A renamed or dropped slot shows up as a literal `{name}`, or as a missing value, in that one
	// language only — and the types never look inside the strings.
	const slots = (text: string) => [...new Set([...text.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]))].sort();
	const source = MESSAGE_CATALOGS["zh-CN"];
	for (const [locale, catalog] of Object.entries(MESSAGE_CATALOGS)) {
		for (const [key, text] of Object.entries(catalog)) {
			assert.deepEqual(slots(text), slots(source[key as MessageKey]), `${locale} ${key}`);
		}
	}
});

test("full access has one name per language, wherever the interface says it", () => {
	/*
	 * The composer chip said 「完全访问」 while the menu it opens and the settings row said
	 * 「完整访问权限」. The chip's wording is the name: the other places either are it or contain it.
	 */
	for (const [locale, catalog] of Object.entries(MESSAGE_CATALOGS)) {
		const name = catalog["composer.permissionFull"];
		assert.equal(catalog["general.fullAccess"], name, `${locale}: the settings row`);
		for (const key of ["permission.confirmTitle", "question.fullAccessNote"] as const) {
			const text = catalog[key];
			assert.ok(text.toLocaleLowerCase(locale).includes(name.toLocaleLowerCase(locale)), `${locale} ${key}: ${text}`);
		}
	}
});

test("no message spells a character as an HTML reference", () => {
	/*
	 * 文案是当文本塞进界面的，React 不解 HTML 实体：`&#10;` 就是屏幕上的五个字符。个性化页那个
	 * 输入框的示例规则七种语言都这么写过换行，占位符里于是整段挤成一行、夹着一串 `&#10;`。
	 * 要换行就写 `\n`——原生 textarea 的占位符认它。
	 */
	for (const [locale, catalog] of Object.entries(MESSAGE_CATALOGS)) {
		for (const [key, text] of Object.entries(catalog)) {
			assert.doesNotMatch(text, /&(#\d+|#x[\da-f]+|[a-z]+);/i, `${locale} ${key}`);
		}
	}
});
