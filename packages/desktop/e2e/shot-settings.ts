/**
 * Screenshots of the settings pages, for looking at rather than asserting on.
 *
 * `node e2e/shot-settings.ts <dir>` — writes one PNG per page named after it. Seeds a provider
 * with a few models so 模型设置 has something to lay out, which is the page whose spacing is being
 * judged.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { startApp } from "./app.ts";

const dir = process.argv[2] ?? "/tmp/lyra-settings";

const models = ["command/deepseek-v4-flash", "gemini-3.7-flash-high", "deepseek-v4-flash:0731", "kimi-k3", "grok-4.6", "claude-opus-5", "gpt-6-mini", "qwen4-max"].map((modelId) => ({
	id: `relay/${modelId}`,
	providerId: "relay",
	modelId,
	name: modelId,
	contextWindow: 200000,
	maxOutputTokens: 16384,
	supportsThinking: true,
	supportsImages: true,
	supportsTools: true,
}));

async function seed(home: string): Promise<void> {
	await writeFile(join(home, "window.json"), JSON.stringify({ width: 1180, height: 820, x: 0, y: 0 }));
	await writeFile(
		join(home, "settings.json"),
		JSON.stringify({
			version: 1,
			providers: [
				{
					id: "relay",
					name: "Relay",
					baseUrl: "https://relay.example.com",
					api: "openai-responses",
					apiKey: "sk-not-a-real-key-0000000000000000",
					enabled: true,
					models,
				},
				{ id: "second", name: "蹬得飞快", baseUrl: "https://relay.example.com/v1", api: "openai-responses", apiKey: "sk-x", enabled: true, models: [] },
			],
			mcpServers: [],
			projects: [],
			defaultModelId: "relay/gemini-3.7-flash-high",
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
			editor: { defaultOpenTarget: "Zed", showBottomPanel: true },
			appearance: { theme: process.env.LYRA_SHOT_THEME === "light" ? "light" : "dark" },
		}),
	);
}

const app = await startApp({ port: 9461, seed });
const shoot = async (name: string) => {
	const shot = await app.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
	await writeFile(join(dir, `${name}.png`), Buffer.from(shot.data, "base64"));
	process.stdout.write(`wrote ${join(dir, `${name}.png`)}\n`);
};
const click = (label: string) =>
	app.evaluate<boolean>(
		`(() => {
			const hit = [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === ${JSON.stringify(label)});
			hit?.click();
			return Boolean(hit);
		})()`,
	);
const settle = (ms = 900) => new Promise((resolve) => setTimeout(resolve, ms));

try {
	await mkdir(dir, { recursive: true });
	await settle(1500);
	await shoot("00-workspace");

	// Into settings, which the sidebar's bottom row opens.
	await app.evaluate(`(() => {
		// The bottom row of the sidebar, which is the way in to settings.
		const hit = document.querySelector("[data-ly-open-settings]");
		hit?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		return Boolean(hit);
	})()`);
	await settle(1200);
	await click("常规");
	await settle(900);
	await shoot("01-general");

	// The open-with picker, open, which is the list this machine actually has.
	await app.evaluate(`(() => {
		const rows = [...document.querySelectorAll("div")].filter((el) => el.textContent?.trim().startsWith("默认文件打开目标"));
		const row = rows[rows.length - 1];
		const button = row?.querySelector("button");
		button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		return Boolean(button);
	})()`);
	await settle(700);
	await shoot("01b-open-with");
	await app.evaluate(`(() => { document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); return true; })()`);
	await settle(400);

	await click("模型设置");
	await settle(1200);
	await shoot("02-models");

	/*
	 * Scrolled to the end, which is the only place the bottom gap can be seen.
	 *
	 * A scroll container's `padding-bottom` is part of its scrollable area — unless something
	 * inside it is `height: 100%`, which pins that child to the visible height and lets its own
	 * overflowing content run past the padding entirely. Then the last row ends flush against the
	 * card's edge. `gapAtEnd` is that distance, and it should be the padding.
	 */
	const measured = await app.evaluate<{ gapAtEnd: number; padding: string } | null>(`(() => {
		const view = [...document.querySelectorAll(".ly-scroll-view")].pop();
		if (!view) return null;
		view.scrollTop = view.scrollHeight;
		const style = getComputedStyle(view);
		const last = view.querySelector("[data-settings-end]") ?? view.lastElementChild?.lastElementChild;
		const box = last?.getBoundingClientRect();
		const host = view.getBoundingClientRect();
		return { gapAtEnd: box ? Math.round(host.bottom - box.bottom) : -1, padding: style.paddingBottom };
	})()`);
	process.stdout.write(`bottom gap: ${JSON.stringify(measured)}\n`);
	await settle(400);
	await shoot("03-models-end");
} finally {
	await app.stop();
}
