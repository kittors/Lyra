/**
 * Which languages get a leading zero on the hour: the ones that tell time on a 24-hour clock.
 *
 * Asked of `Intl` rather than listed, so this pins what the runtime answers for each language the
 * window can be in. A language added to the catalogues without an entry here fails the comparison,
 * which is the point — someone should look at how it reads before it ships.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { MESSAGE_CATALOGS, type ResolvedUiLocale } from "../src/i18n/messages/index.ts";
import { hourStyle } from "../src/lib/hour-style.ts";

test("the hour is padded on a 24-hour clock and left alone on a 12-hour one", () => {
	const locales = Object.keys(MESSAGE_CATALOGS) as ResolvedUiLocale[];
	assert.deepEqual(Object.fromEntries(locales.map((locale) => [locale, hourStyle(locale)])), {
		"zh-CN": "2-digit",
		"zh-TW": "numeric",
		en: "numeric",
		fr: "2-digit",
		ru: "2-digit",
		ko: "numeric",
		ja: "2-digit",
	});
});
