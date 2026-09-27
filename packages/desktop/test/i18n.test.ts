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

/** Every sentence an entry can put on screen: the entry itself, or each of its plural forms. */
const forms = (entry: (typeof MESSAGE_CATALOGS)["en"][MessageKey]): string[] =>
	typeof entry === "string" ? [entry] : Object.values(entry);

test("every translation keeps the {slots} of its Chinese source", () => {
	// A renamed or dropped slot shows up as a literal `{name}`, or as a missing value, in that one
	// language only — and the types never look inside the strings. A plural form is a sentence of its
	// own, so each one is held to the source: "{n} conversation" as well as "{n} conversations".
	const slots = (text: string) => [...new Set([...text.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]))].sort();
	// The source never has plural forms: its only category is `other` (see `MessageCatalog`).
	const source = MESSAGE_CATALOGS["zh-CN"] as Record<MessageKey, string>;
	for (const [locale, catalog] of Object.entries(MESSAGE_CATALOGS)) {
		for (const [key, entry] of Object.entries(catalog)) {
			for (const text of forms(entry)) {
				assert.deepEqual(slots(text), slots(source[key as MessageKey]), `${locale} ${key}: ${text}`);
			}
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
		for (const [key, entry] of Object.entries(catalog)) {
			for (const text of forms(entry)) assert.doesNotMatch(text, /&(#\d+|#x[\da-f]+|[a-z]+);/i, `${locale} ${key}`);
		}
	}
});

test("plural forms cover every category their language counts with, and nothing else", () => {
	/*
	 * Neither mistake fails on its own. A Russian entry without `few` sends 2–4 to `other`, which is
	 * the word for 1.5 and the wrong one for 3; an English `few` is never picked by any number. Each
	 * reads fine in whichever language its author checked, so both are caught here.
	 *
	 * "Counts with" is what whole numbers up to 1000 select. French `many` (1 000 000 and up) is left
	 * optional: nothing in the interface counts that high, and `other` stands in for it.
	 */
	for (const [locale, catalog] of Object.entries(MESSAGE_CATALOGS)) {
		const rules = new Intl.PluralRules(locale);
		const known = new Set<string>(rules.resolvedOptions().pluralCategories);
		const counted = new Set<string>(Array.from({ length: 1001 }, (_, n) => rules.select(n)));
		for (const [key, entry] of Object.entries(catalog)) {
			if (typeof entry === "string") continue;
			const given = Object.keys(entry);
			assert.ok(counted.size > 1, `${locale} ${key}: ${locale} says every count the same way — write one string`);
			for (const category of given) assert.ok(known.has(category), `${locale} ${key}: ${locale} has no "${category}"`);
			for (const category of counted) assert.ok(given.includes(category), `${locale} ${key}: no "${category}" form`);
		}
	}
});

test("an English sentence that counts something has a form for one", () => {
	/*
	 * The archive read "1 conversations": a count sentence written as one plain string. In English
	 * that shape is `{n}` followed, a word or two later, by a plural — so a plain string of that shape
	 * is a missing `one`. The two exceptions each say why they are not.
	 */
	const exempt: Record<string, string> = {
		"ruleTry.intro": "n is RECENT_LIMIT, which is 20",
		"ruleTry.noHits": "\"matches\" is the verb: nothing in the last n matches",
	};
	const plain = Object.entries(MESSAGE_CATALOGS.en).filter(
		([key, entry]) => typeof entry === "string" && !(key in exempt) && /\{n\} (?:[a-z-]+ )?[a-z-]+s\b/i.test(entry),
	);
	assert.deepEqual(plain.map(([key, entry]) => `${key}: ${entry}`), []);
});
