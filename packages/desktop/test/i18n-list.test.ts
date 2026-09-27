/**
 * Lists punctuated the way the interface language punctuates them.
 *
 * `formatList` reads the separator from `Intl.ListFormat` instead of a table, so these pin what it
 * reads for every language the app ships — and pin that no language gains a conjunction, which is
 * what `Intl.ListFormat` adds on its own the moment `format()` is called: 「和」 in Traditional Chinese,
 * 「및」 in Korean, "and" in English.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { formatList } from "../src/i18n/list.ts";
import type { ResolvedUiLocale } from "../src/i18n/messages/index.ts";
import { setActiveLocale } from "../src/i18n/translate.ts";

// A `Record` so that shipping an eighth language without deciding its separator is a type error here.
const THREE: Record<ResolvedUiLocale, string> = {
	"zh-CN": "a、b、c",
	"zh-TW": "a、b、c",
	ja: "a、b、c",
	en: "a, b, c",
	fr: "a, b, c",
	ru: "a, b, c",
	ko: "a, b, c",
};

test("each interface language joins a list with its own separator", () => {
	for (const [locale, joined] of Object.entries(THREE)) {
		assert.equal(formatList(["a", "b", "c"], locale as ResolvedUiLocale), joined, locale);
	}
});

test("a pair is joined like any other two items, with no conjunction", () => {
	assert.equal(formatList(["a", "b"], "en"), "a, b");
	assert.equal(formatList(["a", "b"], "ko"), "a, b");
	assert.equal(formatList(["a", "b"], "zh-TW"), "a、b");
});

test("one item stands alone and no items is empty", () => {
	assert.equal(formatList(["a"], "en"), "a");
	assert.equal(formatList([], "zh-CN"), "");
});

test("without a locale it follows the language the window is set to", () => {
	try {
		setActiveLocale("en");
		assert.equal(formatList(["a", "b"]), "a, b");
		setActiveLocale("ja");
		assert.equal(formatList(["a", "b"]), "a、b");
	} finally {
		setActiveLocale("zh-CN");
	}
	assert.equal(formatList(["a", "b"]), "a、b");
});
