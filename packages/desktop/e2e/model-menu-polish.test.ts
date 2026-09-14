/** Real-window checks for the bounded, persistent model picker. */

import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { startApp, type RunningApp } from "./app.ts";

let app: RunningApp;

function models(providerId: string, count: number, prefix: string) {
	return Array.from({ length: count }, (_, index) => ({
		id: `${providerId}/${prefix}-${index}`,
		providerId,
		modelId: `${prefix}-${index}`,
		name: `${prefix}-${index}`,
		contextWindow: 200_000,
		maxOutputTokens: 8_192,
		supportsThinking: true,
		supportsImages: index % 2 === 0,
		supportsTools: true,
	}));
}

async function seed(home: string): Promise<void> {
	const root = join(home, "project");
	await mkdir(root, { recursive: true });
	await writeFile(join(home, "window.json"), JSON.stringify({ width: 1440, height: 900, x: 0, y: 0 }));
	await writeFile(join(home, "settings.json"), JSON.stringify({
		version: 1,
		providers: [
			{ id: "relay", name: "Relay", baseUrl: "http://127.0.0.1:1/v1", api: "openai-responses", apiKey: "x", enabled: true, models: models("relay", 12, "gemini-3") },
			{ id: "house", name: "deerGpt", baseUrl: "http://127.0.0.1:1/v1", api: "openai-responses", apiKey: "y", enabled: true, models: models("house", 6, "claude") },
		],
		mcpServers: [],
		projects: [{ id: "e2e", name: "project", path: root, pinned: true, lastOpenedAt: 1 }],
		defaultModelId: "relay/gemini-3-0",
		permissionMode: "auto",
		thinking: "medium",
		retryAttempts: 1,
		hooks: [],
		scheduledTasks: [],
		disabledPlugins: [],
		alwaysAllow: [],
		sync: { enabled: false, port: 4517, token: null },
	}));
}

before(async () => {
	app = await startApp({ port: 9498, seed });
});

after(async () => {
	await app?.stop();
});

const UI = `
	const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
	const label = (element) => element.innerText.replace(/\\s+/g, " ").trim();
	const click = (element) => element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
	const menu = () => document.querySelector('[role="menu"][aria-label="选择模型"]'); // not the trigger; it uses the same label
	const openModelMenu = async () => {
		if (menu()) return menu();
		const chip = [...document.querySelectorAll('button[aria-haspopup="menu"]')].find((element) =>
			(element.dataset.lyTip || "").endsWith("上下文"),
		);
		if (!chip) throw new Error("no model chip");
		click(chip);
		await wait(500);
		if (!menu()) throw new Error("model menu did not open");
		return menu();
	};
	const rows = () => [...menu().querySelectorAll("[data-model]")].map((row) => label(row));
`;

function ui<T>(body: string): Promise<T> {
	return app.evaluate<T>(`(async () => { ${UI} ${body} })()`);
}

test("the model menu folds a provider away and remembers it", async () => {
	const folded = await ui<{ before: number; after: number; count: string; reopened: number }>(`
		await openModelMenu();
		const before = rows().length;
		const head = [...menu().querySelectorAll("button[aria-expanded]")].find((button) => label(button).startsWith("Relay"));
		if (!head) throw new Error("no foldable Relay heading");
		click(head);
		await wait(300);
		const after = rows().length;
		const count = label(head);
		document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
		await wait(300);
		await openModelMenu();
		return { before, after, count, reopened: rows().length };
	`);

	assert.equal(folded.before, 18);
	assert.equal(folded.after, 6);
	assert.match(folded.count, /Relay 12/);
	assert.equal(folded.reopened, 6);
});

test("starring a model pins it to the top and persists", async () => {
	const starred = await ui<{ first: string; stored: string[]; afterUnstar: string[] }>(`
		await openModelMenu();
		const head = [...menu().querySelectorAll("button[aria-expanded]")].find((button) => label(button).startsWith("Relay"));
		if (head && head.getAttribute("aria-expanded") === "false") { click(head); await wait(300); }
		const star = [...menu().querySelectorAll("button")].find((button) => button.getAttribute("aria-label") === "收藏 claude-3");
		if (!star) throw new Error("no star button for claude-3");
		click(star);
		await wait(500);
		const settings = await window.lyra.settings.get();
		const first = rows()[0] || "";
		const lit = menu().querySelector('button[aria-pressed="true"]');
		click(lit);
		await wait(500);
		const after = await window.lyra.settings.get();
		return { first, stored: settings.favoriteModelIds || [], afterUnstar: after.favoriteModelIds || [] };
	`);

	assert.deepEqual(starred.stored, ["house/claude-3"]);
	assert.match(starred.first, /claude-3/);
	assert.deepEqual(starred.afterUnstar, []);
});

test("the model menu has a fixed ceiling and internal scrolling", async () => {
	const box = await ui<{ height: number; scrollable: boolean; searchVisible: boolean; footerVisible: boolean }>(`
		await openModelMenu();
		const surface = menu();
		const rect = surface.getBoundingClientRect();
		const scroller = [...surface.querySelectorAll("*")].find((element) => element.scrollHeight > element.clientHeight + 4);
		const search = surface.querySelector("input");
		const footer = [...surface.querySelectorAll('[role=menuitem]')].find((row) => label(row).startsWith("管理供应商与模型"));
		return {
			height: Math.round(rect.height),
			scrollable: Boolean(scroller),
			searchVisible: Boolean(search) && search.getBoundingClientRect().height > 0,
			footerVisible: Boolean(footer) && footer.getBoundingClientRect().height > 0,
		};
	`);

	assert.ok(box.height <= 420, JSON.stringify(box));
	assert.ok(box.scrollable);
	assert.ok(box.searchVisible);
	assert.ok(box.footerVisible);
});
