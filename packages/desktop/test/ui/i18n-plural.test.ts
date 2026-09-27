/**
 * Counting sentences on screen, in the singular when there is one of something.
 *
 * The English archive said "1 conversations" over a project with one archived conversation, and a
 * row for a one-message conversation would have said "· 1 messages". These mount the real settings
 * page the way the window does — inside `I18nProvider` — and read what it drew.
 *
 * The row's date is left out of the assertions on purpose: it is formatted separately, and this file
 * is about the count after it.
 */

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { act, createElement as h } from "react";
import type { SessionMeta } from "@lyra/core";

import { ArchivedSettings } from "../../src/features/settings/ArchivedSettings.tsx";
import { I18nProvider, useI18n, type MessageKey } from "../../src/i18n/index.ts";
import { MESSAGE_CATALOGS } from "../../src/i18n/messages/index.ts";
import { zhCN } from "../../src/i18n/messages/zh-CN.ts";
import { translate } from "../../src/i18n/translate.ts";
import { useApp } from "../../src/store/index.ts";
import { mount } from "../helpers/mount.ts";

const usage = { input: 0, output: 0, total: 0, cacheRead: 0, cacheWrite: 0, cost: { input: 0, output: 0, total: 0, cacheRead: 0, cacheWrite: 0 } };
const archived = (over: Partial<SessionMeta>): SessionMeta => ({
	id: "a", title: "Refactor", cwd: "/work/lyra", projectId: "lyra", projectName: "lyra",
	createdAt: 1, updatedAt: 2, modelId: "", messageCount: 1, seq: 2, usage, archived: true, ...over,
});

afterEach(() => {
	useApp.setState({ sessions: [] });
});

test("the English archive counts one conversation and one message in the singular", async () => {
	useApp.setState({ sessions: [archived({ id: "a", messageCount: 1 })] });
	const view = await mount(h(I18nProvider, { locale: "en", children: h(ArchivedSettings) }));
	try {
		const toggle = view.find("[data-ly-archive-toggle]");
		assert.equal(toggle.lastElementChild?.textContent, "1 conversation");
		assert.equal(toggle.getAttribute("aria-label"), "lyra, 1 conversation");
		assert.equal(view.find("[data-ly-delete-all-archived]").getAttribute("data-ly-tip"), "Delete 1 archived conversation");
		assert.ok(view.find("[data-ly-archive-row] button > span:last-child").textContent?.endsWith(" · 1 message"));

		// A second one, and the same places go plural.
		await act(async () => {
			useApp.setState({ sessions: [archived({ id: "a", messageCount: 1 }), archived({ id: "b", messageCount: 12, updatedAt: 3 })] });
		});
		assert.equal(toggle.lastElementChild?.textContent, "2 conversations");
		assert.equal(toggle.getAttribute("aria-label"), "lyra, 2 conversations");
		const rows = view.all("[data-ly-archive-row] button > span:last-child").map((line) => line.textContent ?? "");
		assert.deepEqual(rows.map((line) => line.slice(line.indexOf(" · "))), [" · 12 messages", " · 1 message"]);
	} finally {
		await view.unmount();
	}
});

test("the same archive in French and Russian takes those languages' forms", async () => {
	useApp.setState({ sessions: [archived({ id: "a", messageCount: 1 })] });
	for (const [locale, tip] of [
		["fr", "Supprimer 1 conversation archivée"],
		// 1 takes the singular in Russian too — and so would 21.
		["ru", "Удалить 1 архивную беседу"],
	] as const) {
		const view = await mount(h(I18nProvider, { locale, children: h(ArchivedSettings) }));
		try {
			assert.equal(view.find("[data-ly-delete-all-archived]").getAttribute("data-ly-tip"), tip, locale);
		} finally {
			await view.unmount();
		}
	}
});

test("t() and translate() give the same sentence for every count, in every language", async () => {
	/*
	 * Both go through `translateIn`; this is what keeps it that way. A copy of the lookup in the hook
	 * would pass every English test above and still say "1 conversations" in the store's notices.
	 */
	const counted = (Object.keys(zhCN) as MessageKey[]).filter((key) => zhCN[key].includes("{n}"));
	const counts = [0, 1, 2, 3, 5, 11, 21, 22, 1.5];
	function Probe() {
		const { t } = useI18n();
		return h("pre", null, JSON.stringify(counted.flatMap((key) => counts.map((n) => t(key, { n })))));
	}
	for (const locale of Object.keys(MESSAGE_CATALOGS) as (keyof typeof MESSAGE_CATALOGS)[]) {
		const view = await mount(h(I18nProvider, { locale, children: h(Probe) }));
		try {
			// The provider has told `translate` the language by now; see `setActiveLocale`.
			const told = counted.flatMap((key) => counts.map((n) => translate(key, { n })));
			assert.deepEqual(JSON.parse(view.find("pre").textContent ?? "[]"), told, locale);
		} finally {
			await view.unmount();
		}
	}
});
