/* oxlint-disable no-console -- real-window verification prints measured evidence */
/**
 * 「添加供应商 / 添加账号」不再是空描边盒子，而是带字的弹窗按钮。
 *
 * 用法：先 `pnpm --filter @lyra/desktop build`，再
 * `node --experimental-strip-types packages/desktop/e2e/settings-add-buttons-demo.ts`
 */

import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { startApp, type RunningApp } from "./app.ts";
import { encode, pause, startRecording, type Frame } from "./record.ts";

const out = process.argv[2] ?? join(homedir(), "Desktop", "Lyra添加按钮测试");
const stamp = new Date().toLocaleString("sv-SE", { timeZone: "Asia/Shanghai" }).replace(/[: ]/g, "-").slice(0, 19);
const PORT = 9773;
const checks: { name: string; ok: boolean; measured: unknown }[] = [];
const check = (name: string, ok: boolean, measured: unknown) => {
	checks.push({ name, ok, measured });
	console.log(`${ok ? "PASS" : "FAIL"} ${name} ${JSON.stringify(measured)}`);
};

async function seed(home: string): Promise<void> {
	const project = join(home, "proj");
	await mkdir(project, { recursive: true });
	await writeFile(join(project, "README.md"), "# proj\n");
	await writeFile(join(home, "window.json"), JSON.stringify({ width: 1280, height: 860, x: 40, y: 40 }));
	await writeFile(
		join(home, "settings.json"),
		JSON.stringify({
			version: 1,
			providers: [
				{
					id: "ds",
					name: "deepseek",
					api: "openai-responses",
					baseUrl: "https://api.deepseek.com",
					apiKey: "sk-test",
					enabled: true,
					models: [
						{
							id: "ds/flash",
							providerId: "ds",
							modelId: "deepseek-flash",
							name: "flash",
							contextWindow: 128000,
							maxOutputTokens: 4096,
							supportsImages: false,
							supportsTools: true,
							supportsThinking: false,
						},
					],
				},
			],
			mcpServers: [],
			projects: [{ id: "e2e", name: "proj", path: project, pinned: true, lastOpenedAt: 1 }],
			defaultModelId: "ds/flash",
			permissionMode: "auto",
			thinking: "off",
			retryAttempts: 3,
			hooks: [],
			scheduledTasks: [],
			disabledPlugins: [],
			alwaysAllow: [],
			sync: { enabled: false, port: 4579, token: null },
		}),
	);
}

let app: RunningApp | undefined;
let stopRecording: (() => Promise<void>) | undefined;
const frames: Frame[] = [];

try {
	app = await startApp({ port: PORT, seed });
	stopRecording = await startRecording(PORT, frames);
	await app.evaluate("document.fonts.ready");

	async function until(expression: string, ms = 20_000) {
		for (let i = 0; i < ms / 100; i++) {
			if (await app!.evaluate(`Boolean(${expression})`)) return;
			await pause(100);
		}
		throw new Error(`UI condition not reached: ${expression}`);
	}
	async function click(selector: string) {
		await until(`Boolean(document.querySelector(${JSON.stringify(selector)}))`);
		await app!.evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'nearest',behavior:'instant'})`);
		const at = await app!.evaluate<[number, number]>(
			`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return [r.x+r.width/2,r.y+r.height/2]})()`,
		);
		for (const type of ["mousePressed", "mouseReleased"]) {
			await app!.send("Input.dispatchMouseEvent", { type, x: at[0], y: at[1], button: "left", clickCount: 1 });
		}
	}
	async function openSettings(label: string) {
		if (!(await app!.evaluate(`Boolean([...document.querySelectorAll("nav button")].find((b) => /返回工作区/.test(b.textContent || "")))`))) {
			await click(".ly-sidebar-foot button");
			await until(`Boolean(document.querySelector("nav button"))`);
			await pause(400);
		}
		await app!.evaluate(`(() => {
			const nav = [...document.querySelectorAll("nav button")].find((b) => (b.textContent || "").trim() === ${JSON.stringify(label)});
			if (nav) nav.click();
		})()`);
		await pause(800);
	}
	async function hold(ms = 1000) {
		const end = Date.now() + ms;
		while (Date.now() < end) {
			const picture = await app!.send<{ data: string }>("Page.captureScreenshot", { format: "jpeg", quality: 82 });
			frames.push({ at: Date.now(), data: Buffer.from(picture.data, "base64") });
			await pause(Math.min(200, Math.max(0, end - Date.now())));
		}
	}
	async function measure(selector: string) {
		return app!.evaluate<{ text: string; pill: boolean; height: number; width: number }>(`(() => {
			const el = document.querySelector(${JSON.stringify(selector)});
			if (!el) return { text: "", pill: false, height: 0, width: 0 };
			const s = getComputedStyle(el);
			return {
				text: (el.textContent || "").replace(/\\s+/g, " ").trim(),
				pill: el.classList.contains("ly-dialog-action"),
				height: Math.round(el.getBoundingClientRect().height),
				width: Math.round(el.getBoundingClientRect().width),
			};
		})()`);
	}

	await openSettings("模型设置");
	await until(`Boolean(document.querySelector("[data-ly-add-provider]"))`);
	const provider = await measure("[data-ly-add-provider]");
	check("add provider is a labeled dialog pill", provider.pill && provider.text.includes("添加供应商") && provider.height === 34 && provider.width > 80, provider);
	const model = await measure("[data-ly-add-model]");
	check("add model is a labeled dialog pill", model.pill && model.text.includes("添加模型") && model.height === 34 && model.width > 70, model);
	await hold(1200);

	await openSettings("代码托管");
	await until(`Boolean(document.querySelector("[data-ly-add-forge]"))`);
	const forge = await measure("[data-ly-add-forge]");
	check("add forge account is a labeled dialog pill", forge.pill && forge.text.includes("添加账号") && forge.height === 34 && forge.width > 70, forge);
	await hold(1400);
} catch (error) {
	check("verification script completed", false, String(error));
	throw error;
} finally {
	await stopRecording?.();
	await app?.stop();
	await mkdir(out, { recursive: true });
	const pass = checks.filter((item) => item.ok).length;
	const name = `${stamp}_添加按钮_${pass}of${checks.length}`;
	await writeFile(join(out, `${name}.json`), JSON.stringify({ checks }, null, 2));
	if (frames.length) await encode(frames, join(out, `${name}.mp4`), 60);
	console.log(`Evidence: ${join(out, name)} (${frames.length} captured frames)`);
	if (checks.some((item) => !item.ok)) process.exitCode = 1;
}
