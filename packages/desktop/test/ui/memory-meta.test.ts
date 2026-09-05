/**
 * The line under a memory: where it came from, when, and when it last reached the model (12 §7).
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement as h } from "react";

import { MemoryMeta } from "../../src/features/settings/MemoryMeta.tsx";
import { mount } from "../helpers/mount.ts";

const NOW = Date.parse("2026-09-05T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

test("a memory that has reached the model says when", async () => {
	const view = await mount(h(MemoryMeta, { source: "user", createdAt: NOW - 3 * DAY, lastInjectedAt: NOW - 2 * 60 * 60 * 1000, now: NOW }));
	assert.equal(view.find("[data-memory-source]").textContent, "手动添加");
	assert.match(view.text(), /3 天前写下/);
	assert.equal(view.find("[data-memory-injected]").dataset.memoryInjected, "at");
	assert.match(view.find("[data-memory-injected]").textContent ?? "", /最后注入 2 小时前/);
	await view.unmount();
});

test("one that never has says so, in words — absence is the finding", async () => {
	const view = await mount(h(MemoryMeta, { source: "learn", createdAt: NOW - 40 * DAY, now: NOW }));
	assert.equal(view.find("[data-memory-source]").textContent, "learn 工具");
	assert.equal(view.find("[data-memory-injected]").dataset.memoryInjected, "never");
	assert.match(view.text(), /还没进过提示词/);
	await view.unmount();
});

test("every source has a word, and none of them is the raw key", async () => {
	for (const source of ["user", "auto", "session", "learn", "extracted"] as const) {
		const view = await mount(h(MemoryMeta, { source, createdAt: NOW, now: NOW }));
		const word = view.find("[data-memory-source]").textContent ?? "";
		assert.ok(word.length > 0 && word !== source, `${source} → ${word}`);
		await view.unmount();
	}
});
