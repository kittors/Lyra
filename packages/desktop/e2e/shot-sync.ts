/* oxlint-disable no-console -- probe CLI that prints where it wrote each shot */
/**
 * Pictures of the pairing page, with the service actually running.
 *
 * `node e2e/shot-sync.ts <dir>` — the page is worth looking at rather than asserting on: whether a
 * QR code is legible, whether the address chips read as choosable, and whether the fallback is
 * findable without being in the way are all judgements about a picture.
 *
 * The service is started for real, so the addresses and the code are this machine's own. That is
 * the point — a mocked address would prove the layout and nothing about the thing being paired.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { startApp } from "./app.ts";

const dir = process.argv[2] ?? "/tmp/lyra-sync-shots";

async function seed(home: string): Promise<void> {
	await writeFile(join(home, "window.json"), JSON.stringify({ width: 1280, height: 900, x: 0, y: 0 }));
	await writeFile(
		join(home, "settings.json"),
		JSON.stringify({
			version: 1,
			providers: [],
			mcpServers: [],
			projects: [],
			defaultModelId: "",
			permissionMode: "auto",
			thinking: "medium",
			retryAttempts: 3,
			hooks: [],
			scheduledTasks: [],
			disabledPlugins: [],
			alwaysAllow: [],
			sync: { enabled: false, port: 4591, token: null },
			editor: { defaultOpenTarget: "Zed", showBottomPanel: true },
			appearance: { theme: process.env.LYRA_SHOT_THEME === "light" ? "light" : "dark" },
		}),
	);
}

const app = await startApp({ port: 9462, seed });
const settle = (ms = 900) => new Promise((resolve) => setTimeout(resolve, ms));
const shoot = async (name: string) => {
	const shot = await app.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
	await writeFile(join(dir, `${name}.png`), Buffer.from(shot.data, "base64"));
	console.log(`wrote ${join(dir, `${name}.png`)}`);
};
const clickText = (label: string) =>
	app.evaluate<boolean>(
		`(() => {
			const hit = [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === ${JSON.stringify(label)});
			hit?.click();
			return Boolean(hit);
		})()`,
	);

try {
	await mkdir(dir, { recursive: true });
	await settle(1500);

	await app.evaluate(`(() => {
		const hit = document.querySelector(".ly-sidebar-foot button");
		hit?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		return Boolean(hit);
	})()`);
	await settle(1000);
	await clickText("移动端同步");
	await settle(800);

	// Start the service for real, so the code below is a code this machine would hand out.
	// Through the toggle's own path — this is the call that used to fail with EADDRINUSE.
	await app.evaluate(`window.lyra.sync.start().then(() => true)`);
	const state = await app.evaluate(`window.lyra.sync.status().then((s) => JSON.stringify({ running: s.running, port: s.port }))`);
	console.log(`点「启用」之后: ${state}`);
	await settle(1600);
	await shoot("01-paired-ready");

	// The remote fields, which is where a relay or a public name is typed.
	await clickText("使用公网反代 / 中转服务器");
	await settle(700);
	await shoot("02-remote-fields");

	// With a relay filled in: the chip row gains an entry and the code changes shape.
	await app.evaluate(`window.lyra.settings.get().then((s) =>
		window.lyra.settings.save({ ...s, sync: { ...s.sync, relayUrl: "relay.example.com", publicUrl: "lyra.example.com" } })
	).then(() => true)`);
	await settle(1600);
	await shoot("03-with-relay");

	await clickText("无法扫描？查看手动连接信息与令牌");
	await settle(800);
	await shoot("04-manual-fallback");

	console.log(`\n共 5 张，目录 ${dir}`);
} finally {
	await app.stop();
}
