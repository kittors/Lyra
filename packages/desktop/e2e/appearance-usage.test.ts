/**
 * The three things you can only check by looking: how wide the conversation is drawn, what a tab's
 * menu does to the strip, and whether the usage page has numbers in it.
 *
 * Widths are measured off the real element rather than read back out of the setting that set them.
 * A setting that stores 960 and renders 640 is the failure this is for, and it is invisible to
 * every other kind of test.
 */

import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { startApp, type RunningApp } from "./app.ts";

let app: RunningApp;
let project: string;

/** One assistant reply, as the log stores it, so the usage page has something real to read. */
function replyRecord(seq: number, at: number, tokens: number): string {
	const message = {
		role: "assistant",
		content: [{ type: "text", text: "ok" }],
		api: "openai-responses",
		provider: "relay",
		model: "grok-4.6",
		usage: {
			input: tokens,
			output: Math.round(tokens / 10),
			cacheRead: 0,
			cacheWrite: 0,
			total: tokens,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.01 },
		},
		stopReason: "stop",
		timestamp: at,
	};
	return `${JSON.stringify({ seq, ts: at, type: "message", message })}\n`;
}

async function seed(home: string): Promise<void> {
	const root = join(home, "project");
	await mkdir(join(root, "src"), { recursive: true });
	await writeFile(join(root, "src", "one.ts"), "export const one = 1\n");
	await writeFile(join(root, "src", "two.ts"), "export const two = 2\n");
	await writeFile(join(root, "src", "three.ts"), "export const three = 3\n");
	await writeFile(join(home, "window.json"), JSON.stringify({ width: 1440, height: 900, x: 0, y: 0 }));

	/*
	 * A conversation log with usage in it, written straight to disk.
	 *
	 * The page reads the logs rather than any live state, so seeding one is the whole fixture —
	 * and it means the numbers asserted below are numbers this test put there.
	 */
	const projectId = "aaaaaaaaaaaaaaaa";
	await mkdir(join(home, "sessions", projectId), { recursive: true });
	const yesterday = Date.now() - 24 * 60 * 60 * 1000;
	const meta = {
		id: "seeded",
		title: "seeded",
		cwd: root,
		projectId,
		projectName: "project",
		createdAt: yesterday,
		updatedAt: Date.now(),
		modelId: "relay/grok-4.6",
		messageCount: 2,
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
		seq: 3,
	};
	await writeFile(
		join(home, "sessions", projectId, "seeded.jsonl"),
		`${JSON.stringify({ seq: 1, ts: yesterday, type: "meta", meta })}\n` +
			replyRecord(2, yesterday, 1000) +
			replyRecord(3, Date.now(), 2000),
	);

	await writeFile(
		join(home, "settings.json"),
		JSON.stringify({
			version: 1,
			providers: [
				{
					id: "relay",
					name: "Relay",
					baseUrl: "http://127.0.0.1:1/v1",
					api: "openai-responses",
					apiKey: "x",
					enabled: true,
					models: [
						{
							id: "relay/grok-4.6",
							providerId: "relay",
							modelId: "grok-4.6",
							name: "grok-4.6",
							contextWindow: 128000,
							maxOutputTokens: 8192,
							supportsThinking: true,
							supportsImages: false,
							supportsTools: true,
						},
					],
				},
				{
					id: "house",
					name: "House",
					baseUrl: "http://127.0.0.1:1/v1",
					api: "openai-responses",
					apiKey: "y",
					enabled: true,
					models: [
						{
							id: "house/grok-4.6",
							providerId: "house",
							modelId: "grok-4.6",
							name: "grok-4.6",
							contextWindow: 200000,
							maxOutputTokens: 8192,
							supportsThinking: true,
							supportsImages: true,
							supportsTools: true,
						},
					],
				},
			],
			mcpServers: [],
			projects: [{ id: "e2e", name: "project", path: root, pinned: true, lastOpenedAt: 1 }],
			defaultModelId: "relay/grok-4.6",
			permissionMode: "auto",
			thinking: "medium",
			retryAttempts: 1,
			hooks: [],
			scheduledTasks: [],
			disabledPlugins: [],
			alwaysAllow: [],
			sync: { enabled: false, port: 4517, token: null },
		}),
	);
}

before(async () => {
	app = await startApp({ port: 9493, seed });
	project = join(app.home, "project");
});

after(async () => {
	await app?.stop();
});

const UI = `
	const wait = (ms) => new Promise((r) => setTimeout(r, ms));
	const label = (el) => el.innerText.replace(/\\s+/g, " ").trim();
	const click = (el) => el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
	const item = (text) => [...document.querySelectorAll("[role=menuitem]")].find((i) => label(i).startsWith(text));
	const openMenu = (el) => {
		const b = el.getBoundingClientRect();
		el.dispatchEvent(new MouseEvent("contextmenu", {
			bubbles: true, cancelable: true, button: 2,
			clientX: Math.round(b.left + 8), clientY: Math.round(b.top + 8),
		}));
	};
	/*
	 * The width the conversation column is actually drawn at.
	 *
	 * Measured off the composer, which is part of that column and is on screen whether or not a
	 * conversation is open — the transcript itself only exists once there is one to draw.
	 */
	const measure = () => {
		const box = document.querySelector("textarea")?.closest('[class*="max-w-[var(--ly-content)]"]');
		return box ? Math.round(box.getBoundingClientRect().width) : null;
	};
	const declared = () => getComputedStyle(document.documentElement).getPropertyValue("--ly-content").trim();
	const patchAppearance = async (patch) => {
		const settings = await window.lyra.settings.get();
		await window.lyra.settings.save({ ...settings, appearance: { ...settings.appearance, ...patch } });
		await wait(420);
	};
`;

function ui<T>(body: string): Promise<T> {
	return app.evaluate<T>(`(async () => { ${UI} const P = ${JSON.stringify(project)}; ${body} })()`);
}

test("the conversation is drawn at the width the setting asks for", async () => {
	const widths = await ui<{ standard: number; wide: number; extra: number; custom: number; fill: number; fillVar: string; window: number }>(`
		await patchAppearance({ contentWidth: 640 });
		const standard = measure();
		await patchAppearance({ contentWidth: 800 });
		const wide = measure();
		await patchAppearance({ contentWidth: 960 });
		const extra = measure();
		await patchAppearance({ contentWidth: 870 });
		const custom = measure();
		await patchAppearance({ contentWidth: 0 });
		const fill = measure();
		const fillVar = declared();
		await patchAppearance({ contentWidth: 640 });
		return { standard, wide, extra, custom, fill, fillVar, window: window.innerWidth };
	`);

	assert.equal(widths.standard, 640, "the default is what the app has always rendered at");
	assert.equal(widths.wide, 800);
	assert.equal(widths.extra, 960);
	assert.equal(widths.custom, 870, "a number typed into the field is used as typed");
	assert.equal(widths.fillVar, "100%", "「铺满」 lifts the ceiling rather than picking a big number");
	assert.ok(
		widths.fill > widths.extra && widths.fill <= widths.window,
		`and the column really is wider: ${widths.fill} in a ${widths.window}px window`,
	);
});

test("a width from a hand-edited settings file is clamped rather than obeyed", async () => {
	const widths = await ui<{ tiny: number; huge: number }>(`
		await patchAppearance({ contentWidth: 40 });
		const tiny = measure();
		await patchAppearance({ contentWidth: 99999 });
		const huge = measure();
		await patchAppearance({ contentWidth: 640 });
		return { tiny, huge };
	`);

	assert.equal(widths.tiny, 560, "clamped to the floor, not drawn as a 40px column");
	// The ceiling is 1600, wider than this window, so what is measured is the window's own limit.
	assert.ok(widths.huge > 640 && widths.huge <= 1440, `bounded by the window: ${widths.huge}`);
});

test("a tab's menu closes the ones it says it will", async () => {
	const outcome = await ui<{ opened: string[]; afterRight: string[]; afterOthers: string[]; rightDisabled: boolean }>(`
		// Open the files pane from the dock's panel menu.
		const panelButton = [...document.querySelectorAll("button")].find((b) => (b.dataset.lyTip || "").includes("面板"));
		if (panelButton) { click(panelButton); await wait(300); }
		const filesRow = [...document.querySelectorAll("[role=menuitem]")].find((i) => label(i).startsWith("文件"));
		if (filesRow) { click(filesRow); await wait(700); }

		const tree = () => [...document.querySelectorAll("[role=treeitem]")];
		const open = async (suffix) => {
			const row = tree().find((r) => (r.getAttribute("data-path") || "").endsWith(suffix));
			if (!row) throw new Error("tree row not found: " + suffix + " of " + tree().length);
			click(row.querySelector("button") ?? row);
			await wait(450);
		};
		const src = tree().find((r) => (r.getAttribute("data-path") || "").endsWith("/src"));
		if (src) { click(src.querySelector("button") ?? src); await wait(450); }

		await open("one.ts");
		await open("two.ts");
		await open("three.ts");

		const tabs = () => [...document.querySelectorAll("[data-file-tab]")].map((t) => t.getAttribute("data-file-tab").split("/").pop());
		const opened = tabs();

		// Right-click the first tab and close everything to its right.
		const first = document.querySelectorAll("[data-file-tab]")[0];
		openMenu(first);
		await wait(300);
		const rightRow = item("关闭右侧");
		const rightDisabled = rightRow ? rightRow.hasAttribute("disabled") || rightRow.getAttribute("aria-disabled") === "true" : true;
		click(rightRow);
		await wait(400);
		const afterRight = tabs();

		// Then reopen two and close the others from the second tab's menu.
		await open("two.ts");
		await open("three.ts");
		const second = document.querySelectorAll("[data-file-tab]")[1];
		openMenu(second);
		await wait(300);
		click(item("关闭其他"));
		await wait(400);
		return { opened, afterRight, afterOthers: tabs(), rightDisabled };
	`);

	assert.deepEqual(outcome.opened, ["one.ts", "two.ts", "three.ts"], "three files open, three tabs");
	assert.equal(outcome.rightDisabled, false, "with tabs to the right, the row is live");
	/*
	 * 这两条以前期望的是空数组，注释写着「the strip is gone below two tabs」。
	 *
	 * 也就是说，它读到的空不是「标签关光了」，而是「标签行不画了」——剩一个标签时整条行会消失，
	 * 于是数 `[data-file-tab]` 数出来是零。测试因此对两个不同的结果给出同一个答案：关掉右边的两个
	 * 和关掉全部三个，在它眼里一模一样。屏幕上也一模一样，这正是当初被当成 bug 报上来的东西。
	 *
	 * 行现在留着了，这两条也就能问出它们本来想问的：关闭右侧留下了哪个，关闭其他又留下了哪个。
	 */
	assert.deepEqual(outcome.afterRight, ["one.ts"], "关闭右侧 closes what is to the right, and leaves the one you asked from");
	assert.deepEqual(outcome.afterOthers, ["two.ts"], "关闭其他 leaves exactly the tab it was asked from");
});

test("the usage page reports what is in the logs", async () => {
	const page = await ui<{ tiles: string[]; hasBars: boolean; models: string[]; heading: string | null }>(`
		// Settings → 使用统计, the way it is reached.
		const gear = [...document.querySelectorAll("button")].find((b) => label(b).includes("Relay") || label(b).includes("个模型"));
		if (gear) { click(gear); await wait(500); }
		const nav = [...document.querySelectorAll("button")].find((b) => label(b) === "使用统计");
		if (!nav) throw new Error("使用统计 nav item not found");
		click(nav);
		// The first scan reads every log; give it room.
		await wait(2500);

		const tiles = [...document.querySelectorAll("div")]
			.filter((d) => d.className.includes("rounded-[12px]") && d.className.includes("border-line"))
			.map((d) => label(d));
		const bars = document.querySelectorAll("[data-ly-tip*='token']").length;
		const models = [...document.querySelectorAll("div")]
			.filter((d) => label(d).includes("Relay") && label(d).includes("%"))
			.map((d) => label(d));
		const headings = [...document.querySelectorAll("h1")].map(label).filter(Boolean);
		return { tiles, hasBars: bars > 0, models, heading: headings.join(" / ") || null };
	`);

	assert.equal(page.heading, "使用统计");
	const joined = page.tiles.join(" | ");
	assert.match(joined, /tokens 用量/, "the token tile is there");
	assert.match(joined, /当前连续天数/, "and the streak tile");
	// 3000 input + 300 output across the two seeded replies.
	assert.match(joined, /3,300|3\.3k/, `the seeded 3,300 tokens are reported: ${joined}`);
	assert.ok(page.hasBars, "the daily chart drew bars with numbers on them");
	assert.ok(page.models.some((m) => m.includes("grok-4.6")), `the model ranking names the model: ${page.models.join(" / ")}`);
});
