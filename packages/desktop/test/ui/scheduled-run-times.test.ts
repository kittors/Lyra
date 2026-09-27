/**
 * The "last run" and "next run" lines on a scheduled task's card.
 *
 * The label and the time used to be two strings laid side by side, with the colon at the end of the
 * label. That only reads right in Chinese, whose full-width colon carries its own spacing: the
 * English page said "Last run:9/26/2026", and French, Russian, Korean and Japanese were glued the
 * same way. Where the space goes is part of the sentence, so each catalogue now holds the whole line
 * with the time as a variable, and this looks at what the card actually prints.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement as h } from "react";
import { DEFAULT_SETTINGS, type ScheduledTask, type UiLocale } from "@lyra/core";

import { LayoutProvider } from "../../src/app/layout.tsx";
import { ScheduledView } from "../../src/features/scheduled/ScheduledView.tsx";
import { I18nProvider } from "../../src/i18n/index.ts";
import { MESSAGE_CATALOGS } from "../../src/i18n/messages/index.ts";
import { useApp } from "../../src/store/index.ts";
import { mount, type Mounted } from "../helpers/mount.ts";

const task = (patch: Partial<ScheduledTask> = {}): ScheduledTask => ({
	id: "nightly",
	name: "Nightly",
	cwd: "/repo",
	prompt: "Check the build",
	schedule: { kind: "daily", time: "09:00" },
	enabled: true,
	lastRunAt: new Date(2026, 8, 26, 14, 28).getTime(),
	...patch,
});

async function withCard(locale: UiLocale, scheduled: ScheduledTask, check: (view: Mounted) => void): Promise<void> {
	const previous = useApp.getState();
	Object.defineProperty(window, "lyra", { configurable: true, value: {} });
	useApp.setState({ settings: { ...DEFAULT_SETTINGS, scheduledTasks: [scheduled] }, saveSettings: async () => {} } as never);
	const view = await mount(h(LayoutProvider, { children: h(I18nProvider, { locale, children: h(ScheduledView) }) }));
	try {
		check(view);
	} finally {
		await view.unmount();
		useApp.setState(previous, true);
		Reflect.deleteProperty(window, "lyra");
	}
}

/** The one span on the card whose text starts with `label`. */
function line(view: Mounted, label: string): string {
	const found = view.all("span").map((span) => span.textContent ?? "").find((text) => text.startsWith(label));
	assert.ok(found, `no line starts with ${label}: ${view.text().slice(0, 400)}`);
	return found;
}

test("English puts a space between the label and the time", async () => {
	await withCard("en", task(), (view) => {
		assert.match(line(view, "Last run"), /^Last run: \d/);
		assert.match(line(view, "Next run"), /^Next run: \d/);
	});
});

test("a task that never ran says so as a sentence", async () => {
	await withCard("en", task({ lastRunAt: undefined }), (view) => {
		assert.equal(line(view, "Last run"), "Last run: Never");
	});
});

test("Chinese keeps the full-width colon and adds no space after it", async () => {
	await withCard("zh-CN", task(), (view) => {
		assert.match(line(view, "上次运行"), /^上次运行：\d/);
		assert.match(line(view, "下次运行"), /^下次运行：\d/);
	});
});

test("French keeps its space on both sides of the colon", async () => {
	await withCard("fr", task(), (view) => {
		assert.match(line(view, "Dernière exécution"), /^Dernière exécution : \d/);
		assert.match(line(view, "Prochaine exécution"), /^Prochaine exécution : \d/);
	});
});

test("every language leaves room before the time", () => {
	/*
	 * The mounted cases above cover three languages; this covers all seven, including any added later.
	 * Before the time comes either a space or a full-width colon, which brings its own.
	 */
	for (const [locale, catalog] of Object.entries(MESSAGE_CATALOGS)) {
		for (const key of ["scheduled.lastRun", "scheduled.nextRun"] as const) {
			assert.match(catalog[key], /[\s：]\{time\}$/, `${locale} ${key}: ${catalog[key]}`);
		}
	}
});
