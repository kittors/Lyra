/**
 * 设置 → 关于里选的检查间隔，重启之后还算数。
 *
 * 从前后台检查一启动就按默认的 6 小时排上，再也不看设置：选了 24 小时，这次运行里有效，重启就悄悄
 * 回到 6 小时，而下拉框一直显示着存下来的 24。这里量的是真正排上的那个定时器。
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement as h } from "react";
import { DEFAULT_SETTINGS } from "@lyra/core";

import { useUpdate } from "../../src/features/update/store.ts";
import { mount } from "../helpers/mount.ts";

const HOUR = 60 * 60 * 1000;

test("启动时按存下来的间隔排后台检查，而不是一律 6 小时", async () => {
	Object.defineProperty(window, "lyra", {
		configurable: true,
		value: {
			settings: { get: async () => ({ ...DEFAULT_SETTINGS, updateCheckIntervalHours: 24 }) },
			updates: { check: async () => null, state: async () => ({ kind: "idle" }), onProgress: () => () => {} },
		},
	});
	const scheduled: number[] = [];
	const timers: number[] = [];
	const original = window.setInterval;
	window.setInterval = ((_handler: TimerHandler, ms?: number) => {
		scheduled.push(ms ?? 0);
		const id = original(() => {}, 1_000_000);
		timers.push(id);
		return id;
	}) as typeof window.setInterval;

	function Probe() {
		useUpdate();
		return null;
	}
	const view = await mount(h(Probe));
	try {
		for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
		assert.equal(scheduled.at(-1), 24 * HOUR, `最后排上的是 ${(scheduled.at(-1) ?? 0) / HOUR} 小时`);
	} finally {
		await view.unmount();
		window.setInterval = original;
		for (const id of timers) window.clearInterval(id);
	}
});
