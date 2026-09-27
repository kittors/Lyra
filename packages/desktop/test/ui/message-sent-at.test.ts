/**
 * When a message was sent, in the language the window is set to.
 *
 * The row under every message formatted its time with a hard-coded "zh-CN", so an English window
 * said 「9月26日 14:28」 under each message. On a phone that row is always out — there is no hover
 * to hide it behind — which put it in every screenshot of the English interface.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement as h, memo } from "react";
import type { UiLocale } from "@lyra/core";

import { MessageActions } from "../../src/features/conversation/MessageActions.tsx";
import { I18nProvider } from "../../src/i18n/index.ts";
import { mount } from "../helpers/mount.ts";

// This year, so the row leaves the year out — the common case.
const YEAR = new Date().getFullYear();
const SENT = new Date(YEAR, 8, 26, 14, 28, 5).getTime();
// Always a past year when the suite runs, so the year has to be printed.
const LAST_YEAR = new Date(2025, 11, 3, 9, 5).getTime();

async function row(locale: UiLocale, timestamp: number) {
	return mount(h(I18nProvider, { locale, children: h(MessageActions, { timestamp, text: "hello" }) }));
}

test("English reads the time the way English does", async () => {
	const view = await row("en", SENT);
	try {
		assert.equal(view.text(), "Sep 26, 2:28 PM");
		// The full timestamp on hover follows the same language, down to the seconds.
		assert.equal(view.find("[data-ly-tip]").getAttribute("data-ly-tip"), `09/26/${YEAR}, 2:28:05 PM`);
	} finally {
		await view.unmount();
	}
});

test("Chinese keeps the look it always had", async () => {
	const view = await row("zh-CN", SENT);
	try {
		assert.equal(view.text(), "9月26日 14:28");
		assert.equal(view.find("[data-ly-tip]").getAttribute("data-ly-tip"), `${YEAR}/09/26 14:28:05`);
	} finally {
		await view.unmount();
	}
});

test("an older message carries its year in either language", async () => {
	for (const [locale, expected] of [
		["en", "Dec 3, 2025, 9:05 AM"],
		["zh-CN", "2025年12月3日 09:05"],
		["ja", "2025年12月3日 09:05"],
		["fr", "3 déc. 2025, 09:05"],
	] as const) {
		const view = await row(locale, LAST_YEAR);
		try {
			assert.equal(view.text(), expected, locale);
		} finally {
			await view.unmount();
		}
	}
});

test("switching language rewrites messages already on screen", async () => {
	/*
	 * `MessageRow` is memoised, so a row already in the transcript does not re-render because its
	 * parent did. The stand-in here is memoised the same way: the only thing that can reach through
	 * it when the language changes is a context the row itself subscribes to.
	 */
	const Transcript = memo(function Transcript() {
		return h(MessageActions, { timestamp: SENT, text: "hello" });
	});
	const view = await mount(h(I18nProvider, { locale: "zh-CN", children: h(Transcript) }));
	try {
		assert.equal(view.text(), "9月26日 14:28");
		await view.rerender(h(I18nProvider, { locale: "en", children: h(Transcript) }));
		assert.equal(view.text(), "Sep 26, 2:28 PM");
	} finally {
		await view.unmount();
	}
});
