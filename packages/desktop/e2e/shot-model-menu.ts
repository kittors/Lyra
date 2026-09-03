/* oxlint-disable no-console -- a picture-taker that says where it put the file */
/**
 * A picture of the model picker, for looking at rather than asserting on.
 *
 * Not a test — `node e2e/shot-model-menu.ts` — and beside the tests because it boots the app the
 * same way they do. The assertions in `model-menu.test.ts` can say that no row reads 「视觉」 and
 * that a long name is set moving on hover; neither of them can say whether the result is a list
 * anybody can read. That is what this is for.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { startApp } from "./app.ts";

/** Real names, because the whole question is how much of a real name fits. */
const NAMES = [
	"claude-opus-4-20250514",
	"claude-sonnet-4-5-20250929",
	"gemini-3.7-flash-preview-11-2025",
	"deepseek-v4-flash-thinking",
	"command/deepseek-v4-terminus",
	"grok-4.6-fast-reasoning",
];

async function seed(home: string): Promise<void> {
	const project = join(home, "project");
	await mkdir(project, { recursive: true });
	await writeFile(join(home, "window.json"), JSON.stringify({ width: 1280, height: 900, x: 0, y: 0 }));
	await writeFile(
		join(home, "settings.json"),
		JSON.stringify({
			version: 1,
			providers: [
				{
					id: "relay",
					name: "Relay",
					baseUrl: "http://127.0.0.1:9",
					api: "anthropic-messages",
					apiKey: "not-a-key",
					enabled: true,
					models: NAMES.map((name, i) => ({
						id: `relay/${name}`,
						providerId: "relay",
						modelId: name,
						name,
						contextWindow: i % 3 === 1 ? 500000 : 200000,
						maxOutputTokens: 8192,
						supportsThinking: true,
						// Most models take images, which is what made the label near-constant furniture.
						supportsImages: i !== 4,
						supportsTools: true,
					})),
				},
			],
			mcpServers: [],
			projects: [{ id: "e2e", name: "project", path: project, pinned: true, lastOpenedAt: 1 }],
			defaultModelId: `relay/${NAMES[0]}`,
			favoriteModelIds: [`relay/${NAMES[0]}`, `relay/${NAMES[2]}`, `relay/${NAMES[1]}`],
			permissionMode: "full",
			thinking: "off",
			retryAttempts: 1,
			hooks: [],
			scheduledTasks: [],
			disabledPlugins: [],
			alwaysAllow: [],
			sync: { enabled: false, port: 4523, token: null },
		}),
	);
}

const out = process.argv[2] ?? "/tmp/lyra-model-menu.png";
const app = await startApp({ port: 9462, seed });

try {
	await new Promise((resolve) => setTimeout(resolve, 1200));
	await app.evaluate(`(() => {
		const chip = [...document.querySelectorAll('button[aria-haspopup="menu"]')].find((x) =>
			(x.dataset.lyTip || "").endsWith("上下文"),
		);
		chip.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
		return true;
	})()`);
	await new Promise((resolve) => setTimeout(resolve, 800));

	// Hover the longest row so the picture also shows the marquee lit.
	const at = await app.evaluate<{ x: number; y: number }>(`(() => {
		const row = document.querySelector('[data-model="relay/${NAMES[2]}"]');
		const rect = row.getBoundingClientRect();
		return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
	})()`);
	await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: at.x, y: at.y, buttons: 0 });
	await new Promise((resolve) => setTimeout(resolve, 900));

	const shot = await app.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
	await writeFile(out, Buffer.from(shot.data, "base64"));

	const rows = await app.evaluate<string[]>(
		`[...document.querySelectorAll("[data-model]")].map((r) => r.innerText.replace(/\\s+/g, " ").trim())`,
	);
	console.log(`wrote ${out}`);
	console.log(rows.join("\n"));
} finally {
	await app.stop();
}
