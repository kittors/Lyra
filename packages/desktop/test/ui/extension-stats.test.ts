/**
 * The extensions page: every event it asked for, with count and p95; the breaker; the last error.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement as h } from "react";

import type { ExtensionStats } from "@lyra/core";
import { ExtensionStatsList, formatMs } from "../../src/features/settings/ExtensionHostSettings.tsx";
import { mount } from "../helpers/mount.ts";

const PROBE: ExtensionStats = {
	name: "probe",
	version: "0.1.0",
	description: "看着每次工具调用",
	dir: "/repo/.lyra/extensions/probe",
	events: ["tool_call", "turn_end"],
	intercepts: true,
	state: "running",
	failures: 1,
	perEvent: [
		{ event: "tool_call", calls: 12, errors: 1, timeouts: 0, p95Ms: 7.4 },
		{ event: "turn_end", calls: 0, errors: 0, timeouts: 0, p95Ms: null },
	],
	lastError: { event: "tool_call", message: "boom", at: 0 },
};

test("one row per subscribed event, including the one never delivered", async () => {
	const view = await mount(h(ExtensionStatsList, { live: true, extensions: [PROBE], diagnostics: [] }));
	assert.equal(view.find("[data-extension-stats]").dataset.extensionStats, "live");
	const rows = view.all<HTMLTableRowElement>("[data-extension-event]");
	assert.deepEqual(
		rows.map((row) => [row.dataset.extensionEvent, ...[...row.querySelectorAll("td")].slice(1).map((td) => td.textContent)]),
		[
			["tool_call", "12", "1", "0", "7.4 ms"],
			["turn_end", "0", "0", "0", "—"],
		],
		"「0 次」 beside an event it asked for is the finding; a missing row would hide it",
	);
	assert.match(view.text(), /运行中/);
	assert.match(view.text(), /可拦截/);
	assert.match(view.find("[data-extension-last-error]").textContent ?? "", /tool_call — boom/);
	assert.match(view.find("[data-extension-failures]").textContent ?? "", /已失败 1 次/);
	await view.unmount();
});

test("a tripped extension says so, and an idle page says the numbers are not from a session", async () => {
	const view = await mount(
		h(ExtensionStatsList, {
			live: false,
			extensions: [{ ...PROBE, state: "tripped", failures: 3 }],
			diagnostics: [{ extension: "probe", message: "连续 3 次出错或超时，这个会话里不再调用它。", severity: "warning" }],
		}),
	);
	assert.match(view.text(), /已熔断/);
	assert.match(view.text(), /现在没有打开的会话/);
	assert.equal(view.all("[data-extension-diagnostic]").length, 1);
	await view.unmount();
});

test("nothing installed is said in words that tell you where to put one", async () => {
	const view = await mount(h(ExtensionStatsList, { live: true, extensions: [], diagnostics: [] }));
	assert.match(view.text(), /\.lyra\/extensions\//);
	await view.unmount();
});

test("milliseconds read at every scale", () => {
	assert.equal(formatMs(0.42), "0.4 ms");
	assert.equal(formatMs(12.6), "13 ms");
	assert.equal(formatMs(1830), "1.8 s");
});
