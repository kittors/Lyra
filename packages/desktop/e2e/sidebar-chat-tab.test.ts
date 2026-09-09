/**
 * 「聊天」 as a statement about what you are doing, not only about what you are looking at.
 *
 * The two halves of the sidebar list the same conversations two ways, and switching between them
 * is normally just a way of looking. On a window with nothing open it is more than that: it is the
 * only thing said so far about what happens next, and the composer used to ignore it — 「聊天」 over
 * an empty list still asked which project to pick, and 新对话 from there opened a directory picker
 * on a fresh install with no project to pick.
 *
 * The other half of the rule is what must *not* happen: a conversation that exists is never taken
 * out of its project by a glance at the recent list.
 *
 * Everything here goes through the interface — clicking the strip, reading the chip above the
 * composer — because the claim is about what the window says and does, not about which fields the
 * store happens to hold.
 */

import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { startApp, type RunningApp } from "./app.ts";

let app: RunningApp;
let project: string;

before(async () => {
	app = await startApp({
		port: 9731,
		seed: async (home) => {
			project = join(home, "demo-project");
			await mkdir(project, { recursive: true });
			await writeFile(join(project, "readme.md"), "# demo\n");
			await writeFile(join(home, "window.json"), JSON.stringify({ width: 1280, height: 900, x: 0, y: 0 }));
			await writeFile(
				join(home, "settings.json"),
				JSON.stringify({
					version: 1,
					providers: [],
					mcpServers: [],
					// Known to the app, but not opened: the window still starts with no project.
					projects: [{ path: project, name: "demo-project", pinned: false, lastOpenedAt: 1 }],
					defaultModelId: null,
					permissionMode: "auto",
					thinking: "medium",
					retryAttempts: 3,
					hooks: [],
					scheduledTasks: [],
					disabledPlugins: [],
					pluginRegistries: [],
					skillRegistries: [],
					alwaysAllow: [],
					sync: { enabled: false, port: 4517, token: null },
					appearance: { theme: "dark" },
				}),
			);
		},
	});
	await settle(600);
});

after(async () => {
	await app?.stop();
});

const settle = (ms = 700) => new Promise((resolve) => setTimeout(resolve, ms));

/** What the chip above the composer says: a project's name, 「Chat」, or 「选择项目」. */
const chip = () =>
	app.evaluate<string>(
		`(() => {
			const marks = [...document.querySelectorAll("button")];
			const hit = marks.find((b) => b.querySelector("svg") && /^(选择项目|Chat|demo-project)$/.test(b.textContent?.trim() ?? ""));
			return hit?.textContent?.trim() ?? "";
		})()`,
	);

const clickTab = (tab: "projects" | "chats") =>
	app.evaluate<boolean>(
		`(() => {
			const hit = document.querySelector('[data-ly-tab="${tab}"]');
			hit?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
			return Boolean(hit);
		})()`,
	);

/**
 * A window that has never opened a project, which is what a fresh install is.
 *
 * Its own app, because the ordinary one restores the last project at boot and there is no way back
 * to "never had one" from inside a running window. This is the exact case that was reported: an
 * empty 「聊天」 list, and a composer still asking which project to pick.
 */
test("a fresh install in 「聊天」 is a chat, not a request to pick a project", async () => {
	const fresh = await startApp({
		port: 9458,
		seed: async (home) => {
			await writeFile(join(home, "window.json"), JSON.stringify({ width: 1280, height: 900, x: 0, y: 0 }));
		},
	});
	try {
		await settle(800);
		const read = () =>
			fresh.evaluate<string>(
				`(() => {
					const hit = [...document.querySelectorAll("button")].find((b) => /^(选择项目|Chat)$/.test(b.textContent?.trim() ?? ""));
					return hit?.textContent?.trim() ?? "";
				})()`,
			);
		assert.equal(await read(), "选择项目");

		const switched = await fresh.evaluate<boolean>(
			`(() => {
				const hit = document.querySelector('[data-ly-tab="chats"]');
				hit?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
				return Boolean(hit);
			})()`,
		);
		assert.ok(switched, "the strip has a 聊天 tab");
		await settle();

		assert.equal(await read(), "Chat");

		/*
		 * And back, which is the other half of the same claim.
		 *
		 * 「项目」 is about working in one, so a window with none chosen belongs at 「选择项目」 —
		 * the unfinished step — rather than staying in a chat. Nothing is invented: this is the
		 * state a fresh install starts in.
		 */
		await fresh.evaluate<boolean>(
			`(() => {
				const hit = document.querySelector('[data-ly-tab="projects"]');
				hit?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
				return Boolean(hit);
			})()`,
		);
		await settle();
		assert.equal(await read(), "选择项目");
	} finally {
		await fresh.stop();
	}
});

test("a project is remembered by 「聊天」 and handed back by 「项目」", async () => {
	// This window restored its project at boot, which is the ordinary case.
	assert.equal(await chip(), "demo-project");

	assert.ok(await clickTab("chats"));
	await settle();
	assert.equal(await chip(), "Chat", "「聊天」 takes a blank window out of the project");

	assert.ok(await clickTab("projects"));
	await settle(1000);
	assert.equal(await chip(), "demo-project", "and 「项目」 hands the same one back");
});

test("a conversation with something in it is never moved by a glance at the other list", async () => {
	// Type into the composer and send it. Nothing answers — there is no model configured — but the
	// message lands in the transcript, which is what makes this conversation one that exists.
	await app.evaluate<boolean>(
		`(() => {
			const field = document.querySelector("textarea");
			if (!field) return false;
			const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
			setter?.call(field, "记一笔");
			field.dispatchEvent(new Event("input", { bubbles: true }));
			field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
			return true;
		})()`,
	);
	await settle(1200);

	const before = await chip();
	assert.equal(before, "demo-project");

	assert.ok(await clickTab("chats"));
	await settle();

	assert.equal(await chip(), "demo-project", "the project stayed, because a conversation was open in it");
});
