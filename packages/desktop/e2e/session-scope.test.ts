/**
 * Two conversations, two settings.
 *
 * The unit tests prove the store writes to the right place and the core reads the right level.
 * What only exists once there is a main process is the rest of the chain: that the handler is
 * registered, that the preload forwards it, that the level survives being written to a log and
 * read back — and that the composer's label follows the conversation you are looking at rather
 * than the last one you touched.
 *
 * Every assertion reads the app's own state or its stored logs, never the test's idea of them.
 */

import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { startApp, type RunningApp } from "./app.ts";

let app: RunningApp;
let project: string;
let second: string;

async function seed(home: string): Promise<void> {
	const root = join(home, "project");
	const other = join(home, "other");
	await mkdir(root, { recursive: true });
	await mkdir(other, { recursive: true });
	await writeFile(join(home, "window.json"), JSON.stringify({ width: 1280, height: 900, x: 0, y: 0 }));
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
						{
							id: "relay/quick",
							providerId: "relay",
							modelId: "quick",
							name: "quick",
							contextWindow: 64000,
							maxOutputTokens: 4096,
							supportsThinking: false,
							supportsImages: false,
							supportsTools: true,
						},
					],
				},
			],
			mcpServers: [],
			projects: [
				{ id: "e2e", name: "project", path: root, pinned: true, lastOpenedAt: 2 },
				{ id: "e2e-2", name: "other", path: other, pinned: true, lastOpenedAt: 1 },
			],
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
	app = await startApp({ port: 9491, seed });
	project = join(app.home, "project");
	second = join(app.home, "other");
});

after(async () => {
	await app?.stop();
});

const UI = `
	const wait = (ms) => new Promise((r) => setTimeout(r, ms));
	const label = (el) => el.innerText.replace(/\\s+/g, " ").trim();
	const click = (el) => el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
	/*
	 * A conversation is opened the way a person opens one: by clicking its row.
	 *
	 * Deliberately not by reaching into the store. What is under test includes whether the label
	 * follows the click, and a test that sets the state itself would pass with the click broken.
	 */
	const openRow = async (id) => {
		const row = document.querySelector('[data-ly-row="' + id + '"]');
		if (!row) throw new Error("session row not found: " + id);
		// The row is a div wrapping the button that opens it; clicking the wrapper does nothing.
		const open = row.querySelector("button");
		if (!open) throw new Error("session row has no open button: " + id);
		click(open);
		await wait(900);
	};
	const composer = () => document.querySelector("textarea");
	/*
	 * A conversation the sidebar will actually list.
	 *
	 * A created session holds nothing until something is said in it, and the list only shows
	 * conversations that have a message — so the message is sent. The model is unreachable on
	 * purpose (port 1), which fails the turn immediately and leaves exactly what is needed: a
	 * stored conversation with one message in it, and a list that refreshed when the turn ended.
	 */
	const conversation = async () => {
		const made = await window.lyra.sessions.create(P, "relay/grok-4.6");
		await window.lyra.agent.prompt(made.meta.id, [{ type: "text", text: "hi" }]);
		await wait(1200);
		return made.meta.id;
	};
	/*
	 * Which project the window is in, read from what the app stored rather than from a chip.
	 *
	 * Opening a workspace stamps lastOpenedAt, so the most recently opened entry is the answer,
	 * and it is one that survives whatever the composer happens to be rendering. No backticks in
	 * here: this whole block is a template literal, and one would end it early.
	 */
	const currentProject = async () => {
		const settings = await window.lyra.settings.get();
		return [...settings.projects].sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)[0]?.name ?? null;
	};
`;

function ui<T>(body: string): Promise<T> {
	return app.evaluate<T>(`(async () => { ${UI} const P = ${JSON.stringify(project)}; const Q = ${JSON.stringify(second)}; ${body} })()`);
}

/** The composer's effort chip, which is what someone actually reads the level off. */
const EFFORT_LABEL = `
	const effort = () => {
		const b = [...document.querySelectorAll("button")].find((x) => (x.dataset.lyTip || "").startsWith("推理强度："));
		return b ? label(b) : null;
	};
`;

test("two conversations hold their own reasoning level, and the log agrees", async () => {
	const result = await ui<{ first: string | undefined; secondLevel: string | undefined; defaultLevel: string }>(`
		// Real sessions, made the way the app makes them.
		const a = await conversation();
		const b = await conversation();

		await window.lyra.agent.setThinking(a, "high");
		await window.lyra.agent.setThinking(b, "low");

		const listed = await window.lyra.sessions.list();
		const settings = await window.lyra.settings.get();
		return {
			first: listed.find((s) => s.id === a)?.thinking,
			secondLevel: listed.find((s) => s.id === b)?.thinking,
			defaultLevel: settings.thinking,
		};
	`);

	assert.equal(result.first, "high");
	assert.equal(result.secondLevel, "low", "the second conversation is not dragged along by the first");
	assert.equal(result.defaultLevel, "medium", "and neither of them moved the app default");
});

test("the composer shows the level of the conversation on screen", async () => {
	const seen = await ui<{ opened: string | null; switched: string | null; blank: string | null }>(`
		${EFFORT_LABEL}
		const made = await conversation();
		const other = await conversation();
		await window.lyra.agent.setThinking(made, "high");
		await window.lyra.agent.setThinking(other, "off");

		await openRow(made);
		const opened = effort();

		await openRow(other);
		const switched = effort();

		// 「新对话」 in the sidebar, which is how a blank one is actually started.
		const fresh = [...document.querySelectorAll("button")].find((b) => label(b).startsWith("新对话"));
		if (!fresh) throw new Error("新对话 button not found");
		click(fresh);
		await wait(400);
		return { opened, switched, blank: effort() };
	`);

	assert.equal(seen.opened, "高", "the conversation set to high says 高");
	assert.equal(seen.switched, "关闭", "switching conversations moves the label with it");
	assert.equal(seen.blank, "中", "a new conversation starts on the app default");
});

test("a model change finishing late cannot replace a new conversation's default", async () => {
	const outcome = await ui<{ chip: string | null; appDefault: string | null }>(`
		const made = await conversation();
		await openRow(made);

		const modelChip = () => [...document.querySelectorAll('button[aria-haspopup="menu"]')].find((x) =>
			(x.dataset.lyTip || "").endsWith("上下文"),
		);
		const chip = modelChip();
		if (!chip) throw new Error("model chip not found");
		click(chip);
		await wait(200);

		const quick = document.querySelector('[data-model="relay/quick"] button[role="menuitem"]');
		if (!quick) throw new Error("quick model row not found");
		// Do not wait for the IPC write: this is the click sequence that used to leak the old meta.
		click(quick);
		const fresh = [...document.querySelectorAll("button")].find((b) => label(b).startsWith("新对话"));
		if (!fresh) throw new Error("新对话 button not found");
		click(fresh);
		await wait(500);

		const settings = await window.lyra.settings.get();
		return { chip: modelChip()?.dataset.lyTip ?? null, appDefault: settings.defaultModelId };
	`);

	assert.match(String(outcome.chip), /grok-4\.6/, "the blank conversation visibly returns to the default model");
	assert.equal(outcome.appDefault, "relay/grok-4.6", "the old conversation did not change the app default");
});

test("changing the level from the menu writes to the conversation, not to the settings", async () => {
	const outcome = await ui<{ level: string | undefined; appDefault: string; label: string | null }>(`
		${EFFORT_LABEL}
		const made = await conversation();
		await openRow(made);

		// Open the effort menu from the composer, and drag its slider to the top.
		const chip = [...document.querySelectorAll("button")].find((x) => (x.dataset.lyTip || "").startsWith("推理强度："));
		click(chip);
		await wait(200);
		const slider = document.querySelector('input[type=range][aria-label="推理强度"]');
		if (!slider) throw new Error("推理强度 slider not found");
		const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
		setter.call(slider, String(Number(slider.max)));
		// React listens for the input event on a range, not for change.
		slider.dispatchEvent(new Event("input", { bubbles: true }));
		await wait(320);

		const listed = await window.lyra.sessions.list();
		const settings = await window.lyra.settings.get();
		return {
			level: listed.find((s) => s.id === made)?.thinking,
			appDefault: settings.thinking,
			label: effort(),
		};
	`);

	assert.ok(outcome.level && outcome.level !== "medium", `the conversation moved off the default, got ${outcome.level}`);
	assert.equal(outcome.appDefault, "medium", "the app default is untouched by a conversation-level change");
	assert.ok(outcome.label && outcome.label !== "中", "and the chip reports the new level");
});

test("the model chip and menu say which provider a model comes from", async () => {
	const outcome = await ui<{ chip: string | null; grouped: boolean; ambiguous: boolean }>(`
		const made = await conversation();
		await openRow(made);

		// The model chip, and what its menu says about where the model comes from.
		// The model chip, not the context meter beside it: only one of them opens a menu.
		const chipButton = [...document.querySelectorAll('button[aria-haspopup="menu"]')].find((x) =>
			(x.dataset.lyTip || "").endsWith("上下文"),
		);
		const chip = chipButton ? chipButton.dataset.lyTip : null;
		if (chipButton) click(chipButton);
		await wait(250);
		const menuText = [...document.querySelectorAll("[role=menu], [role=dialog]")].map((m) => label(m)).join(" ");
		document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
		return { chip, grouped: menuText.includes("Relay"), ambiguous: menuText.includes("grok-4.6") };
	`);

	assert.match(String(outcome.chip), /^Relay · grok-4\.6 · 128K 上下文$/, "the tooltip names the house, the model and the window");
	assert.ok(outcome.grouped, "the menu groups models under the provider they come from");
	assert.ok(outcome.ambiguous, "and still lists the model itself");
});

test("a project's own new-conversation button opens a blank one in that project", async () => {
	const outcome = await ui<{ before: string | null; after: string | null; selected: number; empty: boolean }>(`
		// Open a conversation in the first project, so switching is part of what is tested.
		const made = await conversation();
		await openRow(made);
		const before = await currentProject();

		const button = [...document.querySelectorAll("button")].find(
			(b) => (b.getAttribute("aria-label") || "").includes("在「other」里新建会话"),
		);
		if (!button) throw new Error("new-session button not found on the project row");
		click(button);
		await wait(900);

		return {
			before,
			after: await currentProject(),
			// Nothing highlighted in the list: the window is on a conversation that does not exist yet.
			selected: document.querySelectorAll('[data-ly-row] [aria-current="page"]').length,
			empty: (composer()?.value ?? "") === "",
		};
	`);

	assert.equal(outcome.before, "project", "started in the first project");
	assert.equal(outcome.after, "other", "the button switched the window to the project it belongs to");
	assert.equal(outcome.selected, 0, "and left a blank conversation, not the last one that was open");
	assert.ok(outcome.empty, "with an empty composer");
});
