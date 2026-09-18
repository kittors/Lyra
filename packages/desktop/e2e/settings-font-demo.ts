/* oxlint-disable no-console -- real-window verification prints measured evidence */
/**
 * 默认界面字体换成苹方 / 雅黑（豆包同款中西文同一套）。老的 Inter / Plex 默认栈要跟着迁过来。
 *
 * 用法：先 `pnpm --filter @lyra/desktop build`，再
 * `node --experimental-strip-types packages/desktop/e2e/settings-font-demo.ts`
 */

import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { startApp, type RunningApp } from "./app.ts";
import { encode, pause, startRecording, type Frame } from "./record.ts";

const out = process.argv[2] ?? join(homedir(), "Desktop", "Lyra默认字体测试");
const stamp = new Date().toLocaleString("sv-SE", { timeZone: "Asia/Shanghai" }).replace(/[: ]/g, "-").slice(0, 19);
const PORT = 9778;
const checks: { name: string; ok: boolean; measured: unknown }[] = [];
const check = (name: string, ok: boolean, measured: unknown) => {
	checks.push({ name, ok, measured });
	console.log(`${ok ? "PASS" : "FAIL"} ${name} ${JSON.stringify(measured)}`);
};

const OLD_DEFAULT =
	'"Inter Variable", -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif';

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
			thinking: "off",
			retryAttempts: 3,
			hooks: [],
			scheduledTasks: [],
			disabledPlugins: [],
			alwaysAllow: [],
			sync: { enabled: false, port: 4579, token: null },
			appearance: { uiFont: OLD_DEFAULT },
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
	async function hold(ms = 1000) {
		const end = Date.now() + ms;
		while (Date.now() < end) {
			const picture = await app!.send<{ data: string }>("Page.captureScreenshot", { format: "jpeg", quality: 82 });
			frames.push({ at: Date.now(), data: Buffer.from(picture.data, "base64") });
			await pause(Math.min(200, Math.max(0, end - Date.now())));
		}
	}

	const workspace = await app.evaluate<{
		uiFont: string;
		body: string;
		heading: string;
		loaded: boolean;
		latinFirst: string;
	}>(`(() => {
		const root = document.documentElement;
		const uiFont = getComputedStyle(root).getPropertyValue("--ly-ui-font");
		const heading = document.querySelector("h1, [class*='text-display']") ?? document.body;
		return {
			uiFont,
			body: getComputedStyle(document.body).fontFamily,
			heading: getComputedStyle(heading).fontFamily,
			loaded: document.fonts.check('13px "PingFang SC"'),
			latinFirst: (uiFont.match(/"([^"]+)"/) || [])[1] ?? "",
		};
	})()`);
	check(
		"old Inter default migrated to PingFang SC",
		workspace.uiFont.includes("PingFang SC") && workspace.latinFirst === "PingFang SC",
		workspace,
	);
	check("PingFang SC is available as the live face", workspace.loaded, workspace);
	check(
		"workspace text uses the PingFang stack",
		workspace.body.includes("PingFang SC") && workspace.heading.includes("PingFang SC"),
		{ body: workspace.body, heading: workspace.heading },
	);

	const type = await app.evaluate<{ size: string; smoothing: string; uiSize: string }>(`(() => {
		const body = getComputedStyle(document.body);
		return {
			size: body.fontSize,
			smoothing: body.webkitFontSmoothing,
			uiSize: getComputedStyle(document.documentElement).getPropertyValue("--ly-ui-size").trim(),
		};
	})()`);
	check(
		"default UI is 14px with macOS greyscale antialiasing",
		type.size === "14px" && type.uiSize === "14px" && type.smoothing === "antialiased",
		type,
	);
	await hold(1400);

	if (
		!(await app.evaluate(
			`Boolean([...document.querySelectorAll("nav button")].find((b) => /返回工作区/.test(b.textContent || "")))`,
		))
	) {
		await click(".ly-sidebar-foot button");
		await until(`Boolean(document.querySelector("nav button"))`);
		await pause(400);
	}
	await app.evaluate(`(() => {
		const nav = [...document.querySelectorAll("nav button")].find((b) => (b.textContent || "").trim() === "外观");
		if (nav) nav.click();
	})()`);
	await until(`Boolean([...document.querySelectorAll("h1")].find((h) => (h.textContent || "").includes("外观")))`);
	await pause(600);

	const appearance = await app.evaluate<{ field: string; heading: string }>(`(() => {
		const heading = [...document.querySelectorAll("h1")].find((h) => (h.textContent || "").includes("外观"));
		const field = [...document.querySelectorAll("input")].find((el) => /PingFang SC|IBM Plex Sans|Inter Variable/.test(el.value));
		return {
			field: field?.value ?? "",
			heading: heading ? getComputedStyle(heading).fontFamily : "",
		};
	})()`);
	check(
		"appearance field shows the new default stack",
		appearance.field.includes("PingFang SC") && !/Inter Variable|IBM Plex Sans/.test(appearance.field),
		appearance,
	);
	await hold(1600);
} catch (error) {
	check("verification script completed", false, String(error));
	throw error;
} finally {
	await stopRecording?.();
	await app?.stop();
	await mkdir(out, { recursive: true });
	const pass = checks.filter((item) => item.ok).length;
	const name = `${stamp}_默认字体_${pass}of${checks.length}`;
	await writeFile(join(out, `${name}.json`), JSON.stringify({ checks }, null, 2));
	if (frames.length) await encode(frames, join(out, `${name}.mp4`), 60);
	console.log(`Evidence: ${join(out, name)} (${frames.length} captured frames)`);
	if (checks.some((item) => !item.ok)) process.exitCode = 1;
}
