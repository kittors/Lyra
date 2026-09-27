/**
 * Which form of a counting sentence a number picks, per language.
 *
 * The categories come from `Intl.PluralRules`, so the first half of each test pins what it answers
 * for the numbers that decide a language's rule; the second half reads a real catalogue entry
 * through `translateIn`, which is what both `translate` and `useI18n().t` call.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import type { PluralForms } from "../src/i18n/messages/index.ts";
import { pluralCategory, pluralForm } from "../src/i18n/plural.ts";
import { setActiveLocale, translate, translateIn } from "../src/i18n/translate.ts";

const categories = (locale: Parameters<typeof pluralCategory>[0], counts: number[]) =>
	counts.map((count) => pluralCategory(locale, count));

test("English: one is exactly 1, and 0 goes with the plural", () => {
	assert.deepEqual(categories("en", [1]), ["one"]);
	assert.deepEqual(categories("en", [0, 2, 5, 11, 21, 101, 1.5]), Array(7).fill("other"));

	assert.equal(translateIn("en", "archived.chatCount", { n: 1 }), "1 conversation");
	assert.equal(translateIn("en", "archived.chatCount", { n: 0 }), "0 conversations");
	assert.equal(translateIn("en", "archived.chatCount", { n: 2 }), "2 conversations");
	assert.equal(translateIn("en", "archived.messageCount", { n: 1 }), " · 1 message");
	assert.equal(translateIn("en", "cleanup.confirmSome", { n: 1 }), "Delete 1 conversation?");
	assert.equal(translateIn("en", "cleanup.confirmSome", { n: 21 }), "Delete 21 conversations?");
});

test("Russian: one, few and many by the last digits, other only for fractions", () => {
	assert.deepEqual(categories("ru", [1, 21, 31, 101, 1001]), Array(5).fill("one"));
	assert.deepEqual(categories("ru", [2, 3, 4, 22, 24, 102]), Array(6).fill("few"));
	// The teens are the trap: 11–14 end in 1–4 and still take many.
	assert.deepEqual(categories("ru", [0, 5, 11, 12, 14, 19, 20, 25, 100, 111, 112]), Array(11).fill("many"));
	assert.deepEqual(categories("ru", [1.5, 0.5]), ["other", "other"]);

	assert.equal(translateIn("ru", "cleanup.confirmSome", { n: 1 }), "Удалить 1 разговор?");
	assert.equal(translateIn("ru", "cleanup.confirmSome", { n: 3 }), "Удалить 3 разговора?");
	assert.equal(translateIn("ru", "cleanup.confirmSome", { n: 5 }), "Удалить 5 разговоров?");
	assert.equal(translateIn("ru", "cleanup.confirmSome", { n: 11 }), "Удалить 11 разговоров?");
	assert.equal(translateIn("ru", "cleanup.confirmSome", { n: 21 }), "Удалить 21 разговор?");
	assert.equal(translateIn("ru", "cleanup.confirmSome", { n: 22 }), "Удалить 22 разговора?");
});

test("French: 0 and 1 are both singular", () => {
	assert.deepEqual(categories("fr", [0, 1, 1.5]), ["one", "one", "one"]);
	assert.deepEqual(categories("fr", [2, 10, 21]), ["other", "other", "other"]);

	assert.equal(translateIn("fr", "archived.chatCount", { n: 0 }), "0 conversation");
	assert.equal(translateIn("fr", "archived.chatCount", { n: 1 }), "1 conversation");
	assert.equal(translateIn("fr", "archived.chatCount", { n: 2 }), "2 conversations");
	assert.equal(translateIn("fr", "workspace.archived", { n: 0 }), "0 conversation archivée");
});

test("Chinese, Japanese and Korean say the same sentence for every count", () => {
	for (const locale of ["zh-CN", "zh-TW", "ja", "ko"] as const) {
		assert.deepEqual(categories(locale, [0, 1, 2, 5, 21, 1.5]), Array(6).fill("other"), locale);
	}
	assert.equal(translateIn("zh-CN", "archived.chatCount", { n: 1 }), "1 个聊天");
	assert.equal(translateIn("zh-CN", "archived.chatCount", { n: 2 }), "2 个聊天");
	assert.equal(translateIn("zh-TW", "archived.chatCount", { n: 1 }), "1 個聊天");
	assert.equal(translateIn("ja", "archived.chatCount", { n: 1 }), "1 件の会話");
	assert.equal(translateIn("ko", "archived.chatCount", { n: 1 }), "대화 1개");
});

test("a count passed as digits still picks its form; a formatted one takes other", () => {
	const forms: PluralForms = { one: "{n} message", other: "{n} messages" };
	// `usage.messages` is called with `toLocaleString()`, so this is the path a real "1" takes.
	assert.equal(pluralForm("en", forms, "1"), "{n} message");
	assert.equal(pluralForm("en", forms, "2"), "{n} messages");
	assert.equal(pluralForm("en", forms, "1,234"), "{n} messages");
	assert.equal(pluralForm("en", forms, "1.2K"), "{n} messages");
	assert.equal(pluralForm("en", forms, undefined), "{n} messages");
	assert.equal(translateIn("en", "usage.messages", { n: "1" }), "1 message");
});

test("a category the entry leaves out falls back to other", () => {
	const forms: PluralForms = { one: "one", other: "other" };
	assert.equal(pluralForm("ru", forms, 5), "other");
	// French `many` begins at a million; no catalogue fills it in.
	assert.equal(pluralCategory("fr", 1_000_000), "many");
	assert.equal(pluralForm("fr", forms, 1_000_000), "other");
	assert.equal(pluralForm("en", "a plain string", 1), "a plain string");
});

test("translate picks the form for the language the window is set to", () => {
	try {
		setActiveLocale("en");
		assert.equal(translate("archived.chatCount", { n: 1 }), "1 conversation");
		setActiveLocale("ru");
		assert.equal(translate("cleanup.confirmSome", { n: 2 }), "Удалить 2 разговора?");
		setActiveLocale("fr");
		assert.equal(translate("hiccup.recoveredAfter", { n: 1 }), "Rétabli après 1 tentative");
	} finally {
		setActiveLocale("zh-CN");
	}
});
