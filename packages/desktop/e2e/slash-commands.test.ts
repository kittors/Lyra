/**
 * Typing a slash, in the real window.
 *
 * Everything here is about the composer's behaviour under the keyboard, which is the half of this
 * feature that cannot be checked any other way: the loader has unit tests, but "does the list open,
 * filter, move under the arrow keys, and put the right text in the field" is a claim about a
 * textarea, a floating panel and their event handling together.
 *
 * The command files are written into the profile before launch — one under `.lyra`, one under
 * `.claude` — because the compatibility claim is worth holding to the same standard as the rest:
 * a file somebody wrote for Claude Code has to show up here without being touched.
 */

import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { startApp, type RunningApp } from "./app.ts";

let app: RunningApp;
let project: string;

async function seed(home: string): Promise<void> {
	project = join(home, "project");
	await mkdir(project, { recursive: true });

	// Ours, at user level.
	await mkdir(join(home, "commands"), { recursive: true });
	await writeFile(
		join(home, "commands", "review-diff.md"),
		"---\ndescription: 审查当前改动\nargument-hint: <路径>\n---\n\n请审查 $ARGUMENTS 的改动。",
	);

	// A project-level one, in a directory that belongs to another program entirely.
	await mkdir(join(project, ".claude", "commands"), { recursive: true });
	await writeFile(join(project, ".claude", "commands", "ship-it.md"), "---\ndescription: 发布检查\n---\n跑一遍发布前检查。");

	// And a namespaced one, to prove the directory becomes part of the name.
	await mkdir(join(home, "commands", "git"), { recursive: true });
	await writeFile(join(home, "commands", "git", "sync.md"), "---\ndescription: 同步远端\n---\n拉取并变基。");

	await writeFile(join(home, "window.json"), JSON.stringify({ width: 1280, height: 900, x: 0, y: 0 }));
	await writeFile(
		join(home, "settings.json"),
		JSON.stringify({
			version: 1,
			providers: [],
			mcpServers: [],
			projects: [{ id: "e2e", name: "project", path: project, pinned: true, lastOpenedAt: 1 }],
			defaultModelId: null,
			permissionMode: "full",
			thinking: "off",
			retryAttempts: 1,
			hooks: [],
			scheduledTasks: [],
			disabledPlugins: [],
			alwaysAllow: [],
			sync: { enabled: false, port: 4525, token: null },
			/*
			 * The font stack exactly as the Appearance page writes it.
			 *
			 * Not the same as the stylesheet's `--font-sans`, and the difference is where a bug hid:
			 * that variable lists `Lyra CJK` and this does not. Seeding without these values leaves
			 * `--ly-ui-font` unset, the `var()` fallback runs, and the test exercises a path no real
			 * install is ever on.
			 */
			appearance: {
				theme: "dark",
				uiFont: '"Inter Variable", -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif',
				codeFont:
					'"JetBrains Mono Variable", ui-monospace, "SF Mono", SFMono-Regular, Menlo, "PingFang SC", monospace',
			},
		}),
	);
}

before(async () => {
	app = await startApp({ port: 9473, seed });
	await new Promise((r) => setTimeout(r, 800));
});

after(async () => {
	await app?.stop();
});

/** Native editing keeps focus, selection and React's caret tracking in the same event sequence. */
async function type(text: string): Promise<void> {
	await app.evaluate(`(() => {
		const field = document.querySelector("main textarea");
		field.focus();
		field.select();
		return true;
	})()`);
	await app.send("Input.insertText", { text });
	await new Promise((r) => setTimeout(r, 350));
}

/** One key, on the field itself, so the composer's own handler decides what it means. */
async function press(key: string): Promise<void> {
	const codes: Record<string, number> = { Enter: 13, Tab: 9, Escape: 27, ArrowUp: 38, ArrowDown: 40 };
	await app.send("Input.dispatchKeyEvent", { type: "keyDown", key, windowsVirtualKeyCode: codes[key] });
	await app.send("Input.dispatchKeyEvent", { type: "keyUp", key, windowsVirtualKeyCode: codes[key] });
	await new Promise((r) => setTimeout(r, 250));
}

const menu = () => app.evaluate<string[]>(`
	Array.from(document.querySelectorAll('[role="option"]')).map((row) => row.textContent ?? "")
`);

const value = () => app.evaluate<string>(`document.querySelector("main textarea")?.value ?? ""`);

/** The selected row carries its own description for pointer and keyboard users. */
const detail = () =>
	app.evaluate<string>(`document.querySelector('[role="option"][aria-selected="true"]')?.textContent ?? ""`);

test("a slash opens the list, and it holds commands from both conventions", async () => {
	await type("/");
	const rows = await menu();

	assert.ok(rows.length > 0, "the list opened");
	assert.ok(rows.some((row) => row.includes("review-diff")), `ours is there (${rows.join(" | ")})`);
	assert.ok(
		rows.some((row) => row.includes("ship-it")),
		"and so is the one written for Claude Code, untouched",
	);
	assert.ok(rows.some((row) => row.includes("git:sync")), "a nested file is namespaced by its directory");
	assert.ok(rows.some((row) => row.includes("compact")), "the built-ins are in the same list");
});

test("typing filters, and reaches into the middle of a name", async () => {
	await type("/w-diff");
	const rows = await menu();
	assert.equal(rows.length, 1, `only one command contains "w-diff" (${rows.join(" | ")})`);
	assert.ok(rows[0].includes("review-diff"));
	assert.ok(rows[0].includes("审查当前改动"), "the description shares the command row");


	assert.match(await detail(), /审查当前改动/, "the selected row carries its own description");
});

test("the description follows the highlight", async () => {
	await type("/c");
	const before = await detail();
	await press("ArrowDown");
	const after = await detail();
	assert.notEqual(before, after, `moving the highlight changes the line below (${before} → ${after})`);
});

test("a namespaced command is reachable by its last segment", async () => {
	await type("/sync");
	const rows = await menu();
	assert.ok(
		rows.some((row) => row.includes("git:sync")),
		`typing the segment finds it (${rows.join(" | ")})`,
	);
});

test("Enter picks the highlighted command instead of sending the message", async () => {
	await type("/w-diff");
	await press("Enter");

	assert.equal(await value(), "/review-diff ", "the name is in the field, with room for arguments");
	assert.deepEqual(await menu(), [], "and the list is closed, because the name is settled");
});

test("the arrow keys move the highlight", async () => {
	await type("/");
	const rows = await menu();
	assert.ok(rows.length >= 2, "enough to move between");

	const first = await app.evaluate<number>(
		`Array.from(document.querySelectorAll('[role="option"]')).findIndex((r) => r.getAttribute("aria-selected") === "true")`,
	);
	await press("ArrowDown");
	const second = await app.evaluate<number>(
		`Array.from(document.querySelectorAll('[role="option"]')).findIndex((r) => r.getAttribute("aria-selected") === "true")`,
	);
	assert.equal(first, 0, "it starts at the top");
	assert.equal(second, 1, "and Down moves it");
});

test("Escape closes the list without touching what was typed", async () => {
	await type("/rev");
	assert.ok((await menu()).length > 0, "open");

	await press("Escape");
	assert.deepEqual(await menu(), [], "closed");
	assert.equal(await value(), "/rev", "and the text is still there — a slash is also how paths start");
});

test("a slash inside a word is ordinary text; a slash starting one offers commands", async () => {
	/*
	 * The line between the two is whether the slash begins a word.
	 *
	 * Prose is full of slashes that are not commands — paths, dates, and/or — and every one of them
	 * has a character immediately before it. A slash reached for after a space is somebody starting
	 * to type a command, whether or not they had already written a sentence first.
	 */
	await type("看看 src/main.ts");
	assert.deepEqual(await menu(), [], "no list for a path");

	await type("请在 2026/08/26 之前完成");
	assert.deepEqual(await menu(), [], "nor for a date");

	// The shape somebody actually hits: typing along, then reaching for a command.
	await type("阿斯加德夸克圣诞节卡上 /com");
	assert.ok((await menu()).length > 0, "a slash after a space does open the list");

	await type("");
});

test("picking mid-sentence replaces the slash-word and leaves the sentence alone", async () => {
	await type("啊手机壳打卡就是的 /comp");
	await press("Enter");
	assert.equal(await value(), "啊手机壳打卡就是的 /compact ", "the sentence survives being offered a completion");
	await type("");
});

test("a space after the name closes the list, because the name is settled", async () => {
	await type("/compact");
	assert.ok((await menu()).length > 0, "still choosing");
	await type("/compact ");
	assert.deepEqual(await menu(), [], "now typing arguments, not choosing a command");
	await type("");
});

test("CJK punctuation is drawn by the CJK face, whatever font is configured", async () => {
	/*
	 * `，` sat at mid-height instead of at the bottom-left of its box, but only after a latin run:
	 * 「…128930， 123」 rendered it floating, 「…克拉斯，123」 did not.
	 *
	 * The cause is which face claims U+FF0C. Inter declares a latin-only `unicode-range` so it
	 * passes, and the next entry in the configured stack is `-apple-system` — a western face that
	 * does carry CJK punctuation and sets it the Japanese way, a circle at mid-height. `Lyra Punct`
	 * (and behind it `Lyra CJK`) have to lead, or that western face wins.
	 *
	 * Asserted on the resolved stack rather than on pixels: the rule is "the punctuation face is
	 * consulted first", and that is a fact about the cascade, not about a screenshot.
	 */
	const family = await app.evaluate<string>(`getComputedStyle(document.body).fontFamily`);
	assert.match(family, /^["']?Lyra Punct/, `the punctuation face leads the stack (${family})`);
	assert.match(family, /Lyra CJK/, `Han still follows (${family})`);
});
