/**
 * The once-per-project notice: a fact with numbers, and two buttons that do what they say (15 §5).
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement as h } from "react";

import { describeLine, ForeignConfigBanner } from "../../src/features/composer/ForeignConfigNotice.tsx";
import { click, mount } from "../helpers/mount.ts";

const LINES = [
	{ provider: "cursor", label: "Cursor", where: ".cursor/rules/", kind: "rule" as const, count: 6 },
	{ provider: "copilot", label: "GitHub Copilot", where: ".github/instructions/", kind: "rule" as const, count: 2 },
	{ provider: "codex", label: "Codex / Agents 标准", where: "AGENTS.md", kind: "context-file" as const, count: 1 },
];

test("says 已经在用, lists each place with its count, and never asks to import", async () => {
	const view = await mount(h(ForeignConfigBanner, { lines: LINES, onLook: () => {}, onOk: () => {} }));
	assert.match(view.text(), /Lyra 已经在用/);
	assert.ok(!/导入|import/i.test(view.text()), "a fact, not an offer");
	const rows = view.all("[data-foreign-config-line]").map((li) => li.textContent?.replace(/\s+/g, " ").trim());
	assert.deepEqual(rows, [".cursor/rules/6 条规则Cursor", ".github/instructions/2 条规则GitHub Copilot", "AGENTS.md项目上下文Codex / Agents 标准"]);
	await view.unmount();
});

test("the two buttons do what they say", async () => {
	let looked = 0;
	let acknowledged = 0;
	const view = await mount(h(ForeignConfigBanner, { lines: LINES, onLook: () => void (looked += 1), onOk: () => void (acknowledged += 1) }));
	await click(view.find("[data-foreign-config-look]"));
	await click(view.find("[data-foreign-config-ok]"));
	assert.deepEqual([looked, acknowledged], [1, 1]);
	await view.unmount();
});

test("every kind has words", () => {
	assert.equal(describeLine({ provider: "x", label: "x", where: "x/", kind: "skill", count: 3 }), "3 个技能");
	assert.equal(describeLine({ provider: "x", label: "x", where: "x/", kind: "command", count: 1 }), "1 个命令");
	assert.equal(describeLine({ provider: "x", label: "x", where: "x/", kind: "agent", count: 2 }), "2 个子 Agent 定义");
});
