/* oxlint-disable no-console -- real-window verification prints measured evidence */
/**
 * 子智能体并发上限：1–8，框里不能出现负数。
 *
 * 用法：先 `pnpm --filter @lyra/desktop build`，再
 * `node --experimental-strip-types packages/desktop/e2e/settings-concurrency-demo.ts`
 */

import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { startApp, type RunningApp } from "./app.ts";
import { encode, pause, startRecording, type Frame } from "./record.ts";

const out = process.argv[2] ?? join(homedir(), "Desktop", "Lyra并发上限测试");
const stamp = new Date().toLocaleString("sv-SE", { timeZone: "Asia/Shanghai" }).replace(/[: ]/g, "-").slice(0, 19);
const PORT = 9775;
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
			providers: [],
			mcpServers: [],
			projects: [{ id: "e2e", name: "proj", path: project, pinned: true, lastOpenedAt: 1 }],
			defaultModelId: null,
			permissionMode: "auto",
			thinking: "medium",
			maxConcurrentSubAgents: 4,
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
		await app!.evaluate(
			`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'nearest',behavior:'instant'})`,
		);
		const at = await app!.evaluate<[number, number]>(
			`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return [r.x+r.width/2,r.y+r.height/2]})()`,
		);
		for (const type of ["mousePressed", "mouseReleased"]) {
			await app!.send("Input.dispatchMouseEvent", { type, x: at[0], y: at[1], button: "left", clickCount: 1 });
		}
	}
	async function openSettings(label: string) {
		if (
			!(await app!.evaluate(
				`Boolean([...document.querySelectorAll("nav button")].find((b) => /返回工作区/.test(b.textContent || "")))`,
			))
		) {
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
	async function readField() {
		return app!.evaluate<{ value: string; type: string; down: boolean; up: boolean }>(`(() => {
			const input = document.querySelector('[aria-label="最多同时运行的子智能体数量"]');
			const down = document.querySelector('[aria-label="最多同时运行的子智能体数量：减少"]');
			const up = document.querySelector('[aria-label="最多同时运行的子智能体数量：增加"]');
			return {
				value: input instanceof HTMLInputElement ? input.value : "",
				type: input instanceof HTMLInputElement ? input.type : "",
				down: down instanceof HTMLButtonElement ? !down.disabled : false,
				up: up instanceof HTMLButtonElement ? !up.disabled : false,
			};
		})()`);
	}

	await openSettings("子智能体调度");
	await until(`Boolean(document.querySelector("[data-ly-concurrency]"))`);
	const start = await readField();
	check("opens at 4 with a text field, not a native number spinner", start.value === "4" && start.type === "text", start);
	await hold(900);

	for (let i = 0; i < 6; i++) {
		await click('[aria-label="最多同时运行的子智能体数量：减少"]');
		await pause(180);
	}
	const floor = await readField();
	check("stepper stops at 1, never a negative", floor.value === "1" && floor.down === false, floor);
	await hold(1000);

	for (let i = 0; i < 12; i++) {
		await click('[aria-label="最多同时运行的子智能体数量：增加"]');
		await pause(160);
	}
	const ceiling = await readField();
	check("stepper stops at 8", ceiling.value === "8" && ceiling.up === false, ceiling);
	await hold(1000);

	await app.evaluate(`(() => {
		const input = document.querySelector('[aria-label="最多同时运行的子智能体数量"]');
		if (!(input instanceof HTMLInputElement)) return;
		const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
		setter?.call(input, "-12");
		input.dispatchEvent(new Event("input", { bubbles: true }));
	})()`);
	await pause(400);
	const typed = await readField();
	check("a minus does not enter", typed.value === "8", typed);
	await hold(1200);
} catch (error) {
	check("verification script completed", false, String(error));
	throw error;
} finally {
	await stopRecording?.();
	await app?.stop();
	await mkdir(out, { recursive: true });
	const pass = checks.filter((item) => item.ok).length;
	const name = `${stamp}_并发上限_${pass}of${checks.length}`;
	await writeFile(join(out, `${name}.json`), JSON.stringify({ checks }, null, 2));
	if (frames.length) await encode(frames, join(out, `${name}.mp4`), 60);
	console.log(`Evidence: ${join(out, name)} (${frames.length} captured frames)`);
	if (checks.some((item) => !item.ok)) process.exitCode = 1;
}
