/**
 * Dates on screen, in the language the window is set to — and still in it after a switch.
 *
 * Five components formatted with a hard-coded "zh-CN": the archive, the index page, the card over a
 * conversation row, the time over a message, and the exact time behind an age. An English window
 * read 「2026年9月26日 14:28」 in the archive, 「14:28」 on the card, and so on down the list.
 *
 * The last two sit inside memoised rows, so they are also switched while mounted: a row that does
 * not re-render with its parent keeps the language it was drawn in, unless the part showing the
 * date subscribes to the language itself. The stand-ins below are memoised the same way.
 *
 * Every Chinese expectation here is what the code printed before the fix.
 */

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { act, createElement as h, memo } from "react";
import type { Message, SessionMeta } from "@lyra/core";

import { MessageRow } from "../../src/features/conversation/rows.tsx";
import { ArchivedSettings } from "../../src/features/settings/ArchivedSettings.tsx";
import { IndexSettings } from "../../src/features/settings/IndexSettings.tsx";
import { SessionCard } from "../../src/features/sidebar/SessionCard.tsx";
import { I18nProvider } from "../../src/i18n/index.ts";
import { useApp } from "../../src/store/index.ts";
import { TimeAgo } from "../../src/ui/primitives/TimeAgo.tsx";
import { mount } from "../helpers/mount.ts";

const AFTERNOON = new Date(2026, 8, 26, 14, 28, 5).getTime();
// A past year whenever the suite runs, so neither 今天 nor 昨天 can stand in for the date.
const LAST_YEAR = new Date(2025, 11, 3, 9, 5).getTime();
const DAY = 86_400_000;

const usage = { input: 0, output: 0, total: 0, cacheRead: 0, cacheWrite: 0, cost: { input: 0, output: 0, total: 0, cacheRead: 0, cacheWrite: 0 } };
const meta = (over: Partial<SessionMeta> = {}): SessionMeta => ({
	id: "a", title: "Refactor", cwd: "/work/lyra", projectId: "lyra", projectName: "lyra",
	createdAt: 1, updatedAt: AFTERNOON, modelId: "", messageCount: 12, seq: 2, usage, ...over,
});

afterEach(() => {
	useApp.setState({ sessions: [], workspace: null });
	Reflect.deleteProperty(window, "lyra");
});

test("an archived conversation is dated in the window's language", async () => {
	useApp.setState({ sessions: [meta({ archived: true })] });
	for (const [locale, expected] of [
		["en", "September 26, 2026 at 2:28 PM · 12 messages"],
		["zh-CN", "2026年9月26日 14:28 · 12 条消息"],
	] as const) {
		const view = await mount(h(I18nProvider, { locale, children: h(ArchivedSettings) }));
		try {
			// The line under the title; the title itself is the first child.
			assert.equal(view.find("[data-ly-archive-row] button > span:last-child").textContent, expected, locale);
		} finally {
			await view.unmount();
		}
	}
});

test("when the index was last built, in the window's language", async () => {
	const stats = { exists: true, builtAt: AFTERNOON, files: 3, symbols: 40, bytes: 2048 };
	Object.defineProperty(window, "lyra", {
		configurable: true,
		value: { index: { stats: async () => stats, search: async () => [] } },
	});
	useApp.setState({ workspace: { path: "/work/lyra", name: "lyra", isGitRepo: false, branch: null } });
	for (const [locale, label, expected] of [
		["en", "Last built", "9/26/2026, 2:28:05 PM"],
		["zh-CN", "上次构建", "2026/9/26 14:28:05"],
	] as const) {
		const view = await mount(h(I18nProvider, { locale, children: h(IndexSettings) }));
		try {
			// The figures arrive from the main process after the first render.
			await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
			const row = view.all("[data-settings-row]").find((each) => each.firstElementChild?.textContent === label);
			assert.equal(row?.lastElementChild?.textContent, expected, locale);
		} finally {
			await view.unmount();
		}
	}
});

test("the card over a conversation row dates it in the window's language", async (t) => {
	const now = new Date(2026, 8, 26, 14, 58).getTime();
	t.mock.timers.enable({ apis: ["Date"], now });
	const anchor = new DOMRect(0, 0, 240, 28);
	for (const [locale, updatedAt, expected] of [
		["en", now - 30 * 60_000, "2:28 PM"],
		["zh-CN", now - 30 * 60_000, "14:28"],
		["en", now - DAY, "yesterday"],
		// English and Chinese both write 8/17; French is where a Chinese date shows.
		["fr", now - 40 * DAY, "17/08"],
		["zh-CN", now - 40 * DAY, "8/17"],
	] as const) {
		const view = await mount(h(I18nProvider, { locale, children: h(SessionCard, { session: meta({ updatedAt }), anchor }) }));
		try {
			// Portalled to <body>, beside the title.
			const when = document.body.querySelector("[data-ly-session-card] p + span");
			assert.equal(when?.textContent, expected, `${locale}, ${(now - updatedAt) / 60_000} minutes ago`);
		} finally {
			await view.unmount();
		}
	}
});

test("the time over a message follows a language switch through the memoised row", async () => {
	const message: Message = { role: "user", content: [{ type: "text", text: "hello" }], timestamp: LAST_YEAR };
	const Transcript = memo(function Transcript() {
		return h(MessageRow, { message, index: 0, upTo: 1, showTime: true });
	});
	const view = await mount(h(I18nProvider, { locale: "zh-CN", children: h(Transcript) }));
	try {
		assert.equal(view.find(".ly-conversation-time").textContent, "2025年12月3日 9:05");
		await view.rerender(h(I18nProvider, { locale: "en", children: h(Transcript) }));
		assert.equal(view.find(".ly-conversation-time").textContent, "December 3, 2025 9:05 AM");
	} finally {
		await view.unmount();
	}
});

test("the exact time behind an age follows a language switch through the memoised row", async () => {
	const iso = new Date(LAST_YEAR).toISOString();
	const List = memo(function List() {
		return h(TimeAgo, { iso });
	});
	const view = await mount(h(I18nProvider, { locale: "zh-CN", children: h(List) }));
	try {
		assert.equal(view.find("[data-ly-tip]").getAttribute("data-ly-tip"), "2025/12/03 09:05");
		await view.rerender(h(I18nProvider, { locale: "en", children: h(List) }));
		assert.equal(view.find("[data-ly-tip]").getAttribute("data-ly-tip"), "12/03/2025, 9:05 AM");
	} finally {
		await view.unmount();
	}
});
