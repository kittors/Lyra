/**
 * The diagnostics cards above the command and rule lists: what their headers count, which card a
 * line goes under, and that a rescan leaves every line on screen exactly once.
 *
 * Both pages keyed their rows by path and counted lines, and one file can have several lines. A
 * command whose `---` is never closed is still named after its file, and if another file already
 * has that name it is shadowed as well: two lines, one path. A rule with an over-long description and
 * a condition that does not compile gets two warnings on one path. React reports the repeated key on
 * the first render and doubles a row on a later one, and each header counted every line as a file.
 *
 * Neither header matched what was under it, either. A command with a misspelt `deliver` loads (as
 * `prompt`, and its line says so), yet it was counted as failing to load. A rule whose description
 * was cut short was counted as a rule that could not be read.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { act, createElement as h, type ReactElement } from "react";
import type { LyraApi } from "../../electron/ipc-types.ts";
import { CommandsSettings } from "../../src/features/settings/CommandsSettings.tsx";
import { RulesSettings } from "../../src/features/settings/RulesSettings.tsx";
import { useApp } from "../../src/store/index.ts";
import { click, mount, type Mounted } from "../helpers/mount.ts";

type CommandList = Awaited<ReturnType<LyraApi["commands"]["list"]>>;
type RuleList = Awaited<ReturnType<LyraApi["rules"]["list"]>>;
type SlashCommand = CommandList["commands"][number];
type RuleEntry = RuleList["rules"][number];

// The loaders' own sentences: each row has to keep saying its own one.
const UNCLOSED = "开头的 `---` 没有闭合，整个文件都被当成了正文。";
const SHADOWED = "命令“review”已由 /work/.lyra/commands/review.md 定义，这一个被遮蔽了。";
const BAD_NAME = "命令名只能是小写字母、数字和连字符，用冒号分组；当前是“Review_Diff”。";
const BAD_DELIVER = "`deliver` 只能是 prompt、steer、followUp；当前是“steering”，已按 prompt 处理。";
const BAD_YAML = "文件开头的 YAML 无法解析：Flow sequence in block collection must be sufficiently indented and end with a ]";
const RULE_YAML = "文件开头的 YAML 无法解析，这条规则未加载：Flow sequence in block collection must be sufficiently indented and end with a ]";
const LONG_DESCRIPTION = "description 超过 400 字符，已截断。";
const BAD_CONDITION = "condition 不是合法正则，已忽略：Invalid regular expression: /(unclosed/: Unterminated group";
const BAD_SCOPE = "scope 里无法识别的项 \"tools\"，已忽略。";

const commandList = (patch: Partial<CommandList>): CommandList => ({ commands: [], builtins: [], diagnostics: [], skills: [], ...patch });

const command = (name: string, path: string): SlashCommand => ({
	name,
	description: `${name} 是做什么的`,
	content: "……",
	path,
	scope: path.startsWith("/work/") ? "workspace" : "user",
	origin: path.includes("/.claude/") ? "claude" : "lyra",
});

const ruleList = (patch: Partial<RuleList>): RuleList => ({ rules: [], diagnostics: [], foreignUserSources: [], enabledForeignUserRules: [], ...patch });

const rule = (name: string, path: string, disabled = false): RuleEntry => ({
	name,
	description: `${name} 的说明`,
	path,
	sourceLabel: "项目",
	bucket: "book",
	disabled,
});

const error = (path: string, message: string) => ({ path, message, severity: "error" as const });
const warning = (path: string, message: string) => ({ path, message, severity: "warning" as const });

/** How many times `needle` appears on screen: a row doubled or dropped shows up here. */
const times = (view: Mounted, needle: string) => view.text().split(needle).length - 1;

/**
 * What the card whose header matches `heading` says: the header and the lines under it.
 *
 * The header is the innermost element saying it, and its card is what holds it and its rows. Read as
 * text, the way someone reading the page tells which lines a header is about.
 */
function card(view: Mounted, heading: RegExp): string {
	const header = view.all("div").findLast((element) => heading.test(element.textContent ?? ""));
	assert.ok(header, `no header matching ${heading}: ${view.text()}`);
	return (header.parentElement?.textContent ?? "").replace(/\s+/g, " ");
}

/** Answers each call with the next list, then keeps answering with the last. */
function answers<T>(lists: T[]): () => Promise<T> {
	let call = 0;
	return async () => lists[Math.min(call++, lists.length - 1)];
}

/**
 * Mount with this bridge, and collect React's duplicate-key reports while it is up.
 *
 * A repeated key still renders every row on the first pass: React says so on `console.error`, and
 * only drops or doubles a row on a later update. Listening is what makes the first render a test of
 * the keys at all.
 */
async function render(element: ReactElement, lyra: object) {
	Object.defineProperty(window, "lyra", { configurable: true, value: lyra });
	useApp.setState({ workspace: null });
	const duplicateKeys: string[] = [];
	const report = console.error;
	console.error = (...args: unknown[]) => {
		if (String(args[0]).includes("two children with the same key")) duplicateKeys.push(String(args[1]));
		else report(...args);
	};
	let view: Mounted;
	try {
		view = await mount(element);
	} catch (thrown) {
		console.error = report;
		throw thrown;
	}
	return {
		view,
		duplicateKeys,
		async done() {
			await view.unmount();
			console.error = report;
		},
	};
}

/** Let a re-read that a handler started come back and render. */
const settle = () => act(async () => new Promise<void>((resolve) => setTimeout(resolve, 0)));

test("a command is counted once however many lines it has, and one that loaded is not counted as failing", async () => {
	const focus = "/home/me/.lyra/commands/focus.md";
	const draft = "/home/me/.claude/commands/Review_Diff.md";
	const review = "/home/me/.claude/commands/review.md";
	const page = await render(h(CommandsSettings), {
		commands: {
			list: answers([
				commandList({
					commands: [command("focus", focus), command("review", "/work/.lyra/commands/review.md")],
					diagnostics: [
						{ path: focus, message: BAD_DELIVER },
						{ path: draft, message: BAD_NAME },
						// Never closed, so named after its file, and that name was taken by the project's.
						{ path: review, message: UNCLOSED },
						{ path: review, message: SHADOWED },
					],
				}),
			]),
		},
	});
	try {
		const failed = card(page.view, /个命令没能加载/);
		assert.match(failed, /^2 个命令没能加载/, `four lines about three files, one of which loaded: ${failed}`);
		for (const message of [BAD_NAME, UNCLOSED, SHADOWED]) assert.ok(failed.includes(message), message);
		assert.ok(!failed.includes(BAD_DELIVER), "the misspelt `deliver` loaded, as prompt");

		const loaded = card(page.view, /个命令需要留意/);
		assert.match(loaded, /^1 个命令需要留意/, loaded);
		assert.ok(loaded.includes(BAD_DELIVER), loaded);

		for (const message of [BAD_DELIVER, BAD_NAME, UNCLOSED, SHADOWED]) assert.equal(times(page.view, message), 1, message);
		assert.deepEqual(page.duplicateKeys, []);
	} finally {
		await page.done();
	}
});

test("coming back from the editor re-reads the commands, and a line that moved down is still there once", async () => {
	const draft = "/home/me/.claude/commands/Review_Diff.md";
	const review = "/home/me/.claude/commands/review.md";
	const before = [
		{ path: draft, message: BAD_NAME },
		{ path: review, message: UNCLOSED },
		{ path: review, message: SHADOWED },
	];
	// Written in the editor meanwhile: a project command, read first, whose YAML does not parse.
	const after = [{ path: "/work/.lyra/commands/ship.md", message: BAD_YAML }, ...before];
	const page = await render(h(CommandsSettings), {
		commands: { list: answers([commandList({ diagnostics: before }), commandList({ diagnostics: after })]) },
	});
	try {
		assert.equal(times(page.view, UNCLOSED), 1, page.view.text());
		// The page re-reads on focus, which is what coming back from the editor is.
		await act(async () => {
			window.dispatchEvent(new Event("focus"));
		});
		await settle();

		const text = page.view.text();
		for (const message of [BAD_YAML, BAD_NAME, UNCLOSED, SHADOWED]) assert.equal(times(page.view, message), 1, `${message}\n${text}`);
		const order = [BAD_YAML, BAD_NAME, UNCLOSED, SHADOWED].map((message) => text.indexOf(message));
		assert.deepEqual([...order].sort((a, b) => a - b), order, "in the order the scan gave them");
		assert.deepEqual(page.duplicateKeys, []);
		assert.match(card(page.view, /个命令没能加载/), /^3 个命令没能加载/, "and the header follows the new scan");
	} finally {
		await page.done();
	}
});

test("rule warnings are counted by rule under a header of their own, and unreadable counts what could not be read", async () => {
	const broken = "/work/.lyra/rules/broken.md";
	const noisy = "/work/.lyra/rules/noisy.md";
	const scoped = "/work/.agents/rules/scoped.md";
	const page = await render(h(RulesSettings), {
		rules: {
			list: answers([
				ruleList({
					rules: [rule("noisy", noisy), rule("scoped", scoped)],
					diagnostics: [
						error(broken, RULE_YAML),
						warning(noisy, LONG_DESCRIPTION),
						warning(noisy, BAD_CONDITION),
						warning(scoped, BAD_SCOPE),
					],
				}),
			]),
		},
	});
	try {
		const unreadable = card(page.view, /条规则没能读进来/);
		assert.match(unreadable, /^1 条规则没能读进来/, `one line of four is about a file that could not be read: ${unreadable}`);
		assert.ok(unreadable.includes(RULE_YAML), unreadable);
		for (const message of [LONG_DESCRIPTION, BAD_CONDITION, BAD_SCOPE]) assert.ok(!unreadable.includes(message), message);

		const warned = card(page.view, /条规则需要留意/);
		assert.match(warned, /^2 条规则需要留意/, `three warnings about two rules: ${warned}`);
		for (const message of [LONG_DESCRIPTION, BAD_CONDITION, BAD_SCOPE]) assert.ok(warned.includes(message), message);

		for (const message of [RULE_YAML, LONG_DESCRIPTION, BAD_CONDITION, BAD_SCOPE]) assert.equal(times(page.view, message), 1, message);
		assert.deepEqual(page.duplicateKeys, []);
	} finally {
		await page.done();
	}
});

test("switching a rule off re-reads the page, and lines that come back in another order are each there once", async () => {
	const broken = "/work/.lyra/rules/broken.md";
	const noisy = "/work/.lyra/rules/noisy.md";
	const scoped = "/work/.agents/rules/scoped.md";
	/*
	 * Nothing on disk changed between the two reads. The registry runs its sources side by side and
	 * collects their lines as each one finishes, so `.agents/` can come back before `.lyra/` one time
	 * and after it the next.
	 */
	const lyra = [error(broken, RULE_YAML), warning(noisy, LONG_DESCRIPTION), warning(noisy, BAD_CONDITION)];
	const agents = [warning(scoped, BAD_SCOPE)];
	const disabled: string[] = [];
	const page = await render(h(RulesSettings), {
		rules: {
			list: answers([
				ruleList({ rules: [rule("noisy", noisy)], diagnostics: [...lyra, ...agents] }),
				ruleList({ rules: [rule("noisy", noisy, true)], diagnostics: [...agents, ...lyra] }),
			]),
			setDisabled: async (name: string, off: boolean) => {
				if (off) disabled.push(name);
			},
		},
	});
	try {
		assert.equal(times(page.view, LONG_DESCRIPTION), 1, page.view.text());
		await click(page.view.find('[role="switch"]'));
		await settle();
		assert.deepEqual(disabled, ["noisy"], "the switch was the rule's");

		const text = page.view.text();
		for (const message of [RULE_YAML, LONG_DESCRIPTION, BAD_CONDITION, BAD_SCOPE]) assert.equal(times(page.view, message), 1, `${message}\n${text}`);
		assert.match(card(page.view, /条规则没能读进来/), /^1 条规则没能读进来/);
		assert.match(card(page.view, /条规则需要留意/), /^2 条规则需要留意/);
		assert.deepEqual(page.duplicateKeys, []);
	} finally {
		await page.done();
	}
});
