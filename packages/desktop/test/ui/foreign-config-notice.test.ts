/**
 * The once-per-project notice: one line saying whose configuration is in use, a 「查看」 that goes
 * where each place is actually shown, and a way to dismiss (15 §5).
 *
 * The first version was a table of paths under a sentence, with 看看它们 leading to the plugin
 * page. The rows read as files to click on and the button landed somewhere unrelated, so the
 * question the tests ask now is: does 「查看」 take you to the place it names?
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement as h } from "react";

import { describeLine, ForeignConfigBanner, summarize, targetFor } from "../../src/features/composer/ForeignConfigNotice.tsx";
import { click, mount } from "../helpers/mount.ts";

const LINES = [
	{ provider: "cursor", label: "Cursor", where: ".cursor/rules/", kind: "rule" as const, count: 6 },
	{ provider: "copilot", label: "GitHub Copilot", where: ".github/instructions/", kind: "rule" as const, count: 2 },
	{ provider: "claude", label: "Claude Code", where: "CLAUDE.md", kind: "context-file" as const, count: 1 },
];

test("one line: whose configuration is in use and how many places, never an offer to import", async () => {
	const view = await mount(h(ForeignConfigBanner, { lines: LINES, onLook: () => {}, onOk: () => {} }));
	const summary = view.find("[data-foreign-config-summary]");
	assert.equal(summary.textContent?.replace(/\s+/g, " ").trim(), "已在用 Cursor、GitHub Copilot、Claude Code 的配置", "whose it is, not where");
	assert.equal(view.find("[data-foreign-config-count]").textContent, "3 处");
	assert.ok(!/导入|import/i.test(view.text()), "a fact, not an offer");
	assert.equal(view.all("[role=menuitem]").length, 0, "the places are not on the line");
	await view.unmount();
});

test("one tool with several places is named once; a single place shows no count", async () => {
	const two = [
		{ provider: "cursor", label: "Cursor", where: ".cursor/rules/", kind: "rule" as const, count: 6 },
		{ provider: "cursor", label: "Cursor", where: ".cursor/skills/", kind: "skill" as const, count: 1 },
	];
	assert.deepEqual(summarize(two), { tools: "Cursor", places: 2 });
	const view = await mount(h(ForeignConfigBanner, { lines: [two[0]], onLook: () => {}, onOk: () => {} }));
	assert.equal(view.all("[data-foreign-config-count]").length, 0);
	await view.unmount();
});

test("查看 with one place goes straight there; with several it asks which", async () => {
	const looked: string[] = [];
	const one = await mount(h(ForeignConfigBanner, { lines: [LINES[2]], onLook: (line) => looked.push(line.where), onOk: () => {} }));
	await click(one.find("[data-foreign-config-look]"));
	assert.deepEqual(looked, ["CLAUDE.md"], "no menu for a single place");
	assert.equal(document.querySelectorAll("[role=menuitem]").length, 0);
	await one.unmount();

	const many = await mount(h(ForeignConfigBanner, { lines: LINES, onLook: (line) => looked.push(line.where), onOk: () => {} }));
	await click(many.find("[data-foreign-config-look]"));
	const items = [...document.querySelectorAll("[role=menuitem]")];
	// `textContent` runs the spans together; the row is the path, then what it holds and whose.
	assert.deepEqual(
		items.map((item) => item.textContent?.replace(/\s+/g, " ").trim()),
		[".cursor/rules/6 条规则 · Cursor", ".github/instructions/2 条规则 · GitHub Copilot", "CLAUDE.md项目上下文 · Claude Code"],
		"one row per place: the path, what it holds, whose",
	);
	await click(items[1]);
	assert.deepEqual(looked, ["CLAUDE.md", ".github/instructions/"], "the row that was clicked");
	assert.equal(document.querySelectorAll("[role=menuitem]").length, 0, "the menu closes on choosing");
	await many.unmount();
});

test("each kind of place has a page — rules to the rules tab, a context file to the file itself", () => {
	assert.deepEqual(targetFor(LINES[0]), { page: "plugins", tab: "rules", query: "Cursor" }, "that tool's rules, and the search box says so");
	assert.deepEqual(targetFor({ ...LINES[0], kind: "skill" }), { page: "plugins", tab: "skills" });
	assert.deepEqual(targetFor({ ...LINES[0], kind: "command" }), { page: "commands" });
	assert.deepEqual(targetFor({ ...LINES[0], kind: "agent" }), { page: "agents" });
	assert.deepEqual(targetFor(LINES[2]), { file: "CLAUDE.md" });
	assert.equal(describeLine(LINES[0]), "6 条规则");
	assert.equal(describeLine(LINES[2]), "项目上下文");
});

test("知道了 is the other button, and it does not look", async () => {
	let ok = 0;
	let looked = 0;
	const view = await mount(h(ForeignConfigBanner, { lines: LINES, onLook: () => looked++, onOk: () => ok++ }));
	await click(view.find("[data-foreign-config-ok]"));
	assert.deepEqual({ ok, looked }, { ok: 1, looked: 0 });
	await view.unmount();
});
