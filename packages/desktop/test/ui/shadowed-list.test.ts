/**
 * A same-name conflict, unfolded: the diff, and the switch that says where it wrote (16 §3.3).
 *
 * Mounted with nothing behind it — the page hands in the two calls — so what is checked is what
 * the row does with them: asks for the diff winner-first, shows the file the preference went to,
 * and asks the page to reload once the roles have swapped.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement as h } from "react";

import { ShadowedList } from "../../src/features/settings/ShadowedList.tsx";
import { click, mount } from "../helpers/mount.ts";

/** The painter the page would pass; here just the lines, so what is asserted is the row. */
const paint = (hunks: { lines: { type: string; text: string }[] }[]) =>
	h("pre", { "data-painted": true }, hunks.flatMap((hunk) => hunk.lines.map((line) => `${line.type}:${line.text}`)).join("\n"));

const ENTRY = { name: "pdf", path: "/home/me/.claude/skills/pdf/SKILL.md", by: "/repo/.lyra/skills/pdf/SKILL.md", byLabel: "Lyra" };

const flush = () => new Promise((r) => setTimeout(r, 0));

test("看差异 asks winner-first and draws the hunks", async () => {
	const asked: [string, string][] = [];
	const view = await mount(
		h(ShadowedList, {
			kind: "skill",
			entries: [ENTRY],
			diff: async (winner, loser) => {
				asked.push([winner, loser]);
				return { added: 1, removed: 1, hunks: [{ oldStart: 1, newStart: 1, lines: [{ type: "remove", text: "旧的一行" }, { type: "add", text: "新的一行" }] as never }] };
			},
			prefer: async () => ({ wroteTo: "" }),
			onChanged: () => {},
			renderDiff: paint as never,
		}),
	);
	assert.match(view.text(), /1 个同名技能被覆盖/);
	assert.equal(view.all("[data-shadowed-hunks]").length, 0, "folded until asked");

	await click(view.find("[data-shadowed-diff]"));
	await flush();
	await view.rerender(h(ShadowedList, { kind: "skill", entries: [ENTRY], diff: async () => ({ added: 0, removed: 0, hunks: [] }), prefer: async () => ({ wroteTo: "" }), onChanged: () => {}, renderDiff: paint as never }));
	assert.deepEqual(asked, [[ENTRY.by, ENTRY.path]], "winner first: the pluses are what switching would add");
	assert.ok(view.find("[data-shadowed-hunks]"));
	assert.match(view.text(), /\+1 −1/);
	assert.match(view.text(), /新的一行/);
	await view.unmount();
});

test("改用那个 writes the preference, says where, and asks the page to reload", async () => {
	const preferred: [string, string][] = [];
	let reloaded = 0;
	const view = await mount(
		h(ShadowedList, {
			kind: "rule",
			entries: [{ ...ENTRY, name: "no-force-push" }],
			diff: async () => ({ added: 0, removed: 0, hunks: [] }),
			prefer: async (name, path) => {
				preferred.push([name, path]);
				return { wroteTo: "/home/me/.lyra/settings.json" };
			},
			onChanged: () => void (reloaded += 1),
			renderDiff: paint as never,
		}),
	);
	await click(view.find("[data-shadowed-prefer]"));
	await flush();
	// The reload the page does after a switch: the roles have swapped, and this row is now the other file.
	const swapped = [{ name: "no-force-push", path: ENTRY.by, by: ENTRY.path, byLabel: "Claude Code" }];
	await view.rerender(h(ShadowedList, { kind: "rule", entries: swapped, diff: async () => ({ added: 0, removed: 0, hunks: [] }), prefer: async () => ({ wroteTo: "" }), onChanged: () => {}, renderDiff: paint as never }));

	assert.deepEqual(preferred, [["no-force-push", ENTRY.path]], "the loser's path is what should win");
	assert.equal(reloaded, 1);
	const wrote = view.find("[data-shadowed-wrote]").textContent ?? "";
	assert.match(wrote, /settings\.json/, "where it went, so it can be found — and it survives the reload that swaps the rows");
	assert.ok(wrote.includes(ENTRY.path), "and which file was chosen");
	assert.equal(view.all("[data-shadowed-prefer]").length, 1, "the row that replaced it can switch back");
	await view.unmount();
});

test("identical files say so instead of drawing an empty diff", async () => {
	const view = await mount(
		h(ShadowedList, { kind: "rule", entries: [ENTRY], diff: async () => ({ added: 0, removed: 0, hunks: [] }), prefer: async () => ({ wroteTo: "" }), onChanged: () => {}, renderDiff: paint as never }),
	);
	await click(view.find("[data-shadowed-diff]"));
	await flush();
	await view.rerender(h(ShadowedList, { kind: "rule", entries: [ENTRY], diff: async () => ({ added: 0, removed: 0, hunks: [] }), prefer: async () => ({ wroteTo: "" }), onChanged: () => {}, renderDiff: paint as never }));
	assert.match(view.text(), /一模一样/);
	await view.unmount();
});
