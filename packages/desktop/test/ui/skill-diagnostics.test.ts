/**
 * The diagnostics cards above the skill and plugin lists: what their headers count, and what they
 * say the lines below them are about.
 *
 * A warning used to mean one thing, a description too short for the model to pick the skill, so the
 * header named that problem and counted lines. Neither holds any more: `allowed-tools` has warnings
 * of its own (a `Bash(git add *)` pattern granted as the whole tool, a name with no counterpart
 * here), and one skill can carry several at once — "3 skills have descriptions too short" could be a
 * single skill whose description is fine. Rows were keyed by path, which a file with two diagnostics
 * repeats; an unterminated frontmatter is two errors on one path.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { act, createElement as h, type ReactElement } from "react";
import { DEFAULT_SETTINGS } from "@lyra/core";
import type { LyraApi } from "../../electron/ipc-types.ts";
import { PluginsSettings } from "../../src/features/settings/PluginsSettings.tsx";
import { SkillsSettings } from "../../src/features/settings/SkillsSettings.tsx";
import { useApp } from "../../src/store/index.ts";
import { mount, type Mounted } from "../helpers/mount.ts";

type Scan = Awaited<ReturnType<LyraApi["plugins"]["list"]>>;

const scan = (patch: Partial<Scan>): Scan => ({
	plugins: [],
	mcpBundles: [],
	skills: [],
	skillDiagnostics: [],
	shadowedSkills: [],
	pluginDiagnostics: [],
	...patch,
});

// The loader's own sentences, trimmed: each row has to keep saying its own one.
const SHORT = "`description` 只有 8 个字符。模型靠它决定什么时候用这个技能。";
const SCOPED = "`allowed-tools` 里括号中的范围在 Lyra 不生效，`bash` 按整个工具放行：`Bash(git add *)`。";
const UNMATCHED = "`allowed-tools` 里对应不到 Lyra 工具的项不会放行任何调用：`NotebookEdit`。";
const UNCLOSED = "Frontmatter opens with `---` but is never closed, so the whole file is being treated as body text.";
const NO_DESCRIPTION = "`description` is required — it is how the model decides to use this skill.";

const warning = (path: string, message: string) => ({ path, message, severity: "warning" as const });
const error = (path: string, message: string) => ({ path, message });

/** How many times `needle` appears in what is on screen: a row doubled or dropped shows here. */
const times = (view: Mounted, needle: string) => view.text().split(needle).length - 1;

/**
 * Mount with `plugins.list` answering each scan in turn, and collect React's duplicate-key reports.
 *
 * A repeated key still renders both rows on the first pass; React says so on `console.error` and
 * only drops or doubles a row on a later update. Listening is what makes the first render a test of
 * the keys at all.
 */
async function render(element: ReactElement, ...scans: Scan[]) {
	let call = 0;
	Object.defineProperty(window, "lyra", {
		configurable: true,
		value: { plugins: { list: async () => scans[Math.min(call++, scans.length - 1)] } },
	});
	useApp.setState({ settings: { ...DEFAULT_SETTINGS }, workspace: null });
	// Each mount asks for its own scan rather than being handed one an earlier test left behind.
	useApp.getState().bumpExtensions();
	const duplicateKeys: string[] = [];
	const report = console.error;
	console.error = (...args: unknown[]) => {
		if (String(args[0]).includes("two children with the same key")) duplicateKeys.push(String(args[1]));
		else report(...args);
	};
	const view = await mount(element);
	return {
		view,
		duplicateKeys,
		/** What bumping the extensions does after an install: the page scans again. */
		rescan: () => act(async () => useApp.getState().bumpExtensions()),
		async done() {
			await view.unmount();
			console.error = report;
		},
	};
}

test("skill warnings are counted by skill, under a header that does not name one problem", async () => {
	const commit = "/home/me/.claude/skills/commit/SKILL.md";
	const review = "/home/me/.claude/skills/review/SKILL.md";
	const page = await render(
		h(SkillsSettings),
		scan({ skillDiagnostics: [warning(commit, SHORT), warning(commit, SCOPED), warning(commit, UNMATCHED), warning(review, SCOPED)] }),
	);
	try {
		const text = page.view.text();
		assert.match(text, /2 个技能需要留意/, `four lines about two skills: ${text}`);
		assert.doesNotMatch(text, /描述太短/, "three of the four lines are not about the description");
		assert.doesNotMatch(text, /未能加载/, "every one of them loaded");
		assert.equal(times(page.view, SHORT), 1);
		assert.equal(times(page.view, UNMATCHED), 1);
		assert.equal(times(page.view, SCOPED), 2, "the same sentence about two skills is two rows");
		assert.deepEqual(page.duplicateKeys, []);
	} finally {
		await page.done();
	}
});

test("the failed-to-load header counts skills that did not load, and nothing else", async () => {
	const broken = "/work/.lyra/skills/broken/SKILL.md";
	const short = "/work/.lyra/skills/short/SKILL.md";
	const page = await render(
		h(SkillsSettings),
		scan({ skillDiagnostics: [error(broken, UNCLOSED), error(broken, NO_DESCRIPTION), warning(short, SHORT)] }),
	);
	try {
		const text = page.view.text();
		assert.match(text, /1 个技能未能加载/, `the cause and its consequence are one skill: ${text}`);
		assert.match(text, /1 个技能需要留意/, "and the warning stays out of that count");
		assert.equal(times(page.view, UNCLOSED), 1);
		assert.equal(times(page.view, NO_DESCRIPTION), 1);
		assert.deepEqual(page.duplicateKeys, []);
	} finally {
		await page.done();
	}
});

test("a rescan that reorders the rows neither doubles nor drops one", async () => {
	const commit = "/home/me/.claude/skills/commit/SKILL.md";
	const review = "/home/me/.claude/skills/review/SKILL.md";
	const page = await render(
		h(SkillsSettings),
		scan({ skillDiagnostics: [warning(commit, SHORT), warning(commit, SCOPED), warning(review, UNMATCHED)] }),
		scan({ skillDiagnostics: [warning(review, UNMATCHED), warning(commit, SHORT), warning(commit, SCOPED)] }),
	);
	try {
		await page.rescan();
		assert.equal(times(page.view, SHORT), 1, page.view.text());
		assert.equal(times(page.view, SCOPED), 1, page.view.text());
		assert.equal(times(page.view, UNMATCHED), 1, page.view.text());
		assert.deepEqual(page.duplicateKeys, []);
	} finally {
		await page.done();
	}
});

test("plugin skill warnings are counted by skill; plugin problems are still counted one by one", async () => {
	const skills = "/home/me/.lyra/plugins/waza/skills";
	const page = await render(
		h(PluginsSettings),
		scan({
			pluginDiagnostics: [
				warning(`${skills}/think/SKILL.md`, SHORT),
				warning(`${skills}/think/SKILL.md`, SCOPED),
				warning(`${skills}/check/SKILL.md`, UNMATCHED),
				error(`${skills}/broken/SKILL.md`, UNCLOSED),
				error(`${skills}/broken/SKILL.md`, NO_DESCRIPTION),
			],
		}),
	);
	try {
		const text = page.view.text();
		assert.match(text, /2 个插件技能需要留意/, `three lines about two skills: ${text}`);
		assert.doesNotMatch(text, /描述太短/);
		// A problem is its own thing to fix, so two on one file are two problems.
		assert.match(text, /2 个插件问题/);
		for (const message of [SHORT, SCOPED, UNMATCHED, UNCLOSED, NO_DESCRIPTION]) assert.equal(times(page.view, message), 1, message);
		assert.deepEqual(page.duplicateKeys, []);
	} finally {
		await page.done();
	}
});
