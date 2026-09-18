/* oxlint-disable no-console -- real-window verification prints measured evidence */
/**
 * 中文句号必须落在全角格左下，不能像日文那样垂直居中。
 *
 * 用法：先 `pnpm --filter @lyra/desktop build`，再
 * `node --experimental-strip-types packages/desktop/e2e/cjk-period-demo.ts`
 */

import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { startApp, type RunningApp } from "./app.ts";
import { encode, pause, startRecording, type Frame } from "./record.ts";

const out = process.argv[2] ?? join(homedir(), "Desktop", "Lyra中文句号测试");
const stamp = new Date().toLocaleString("sv-SE", { timeZone: "Asia/Shanghai" }).replace(/[: ]/g, "-").slice(0, 19);
const PORT = 9784;
const SAMPLE = "81928900129338。";
const checks: { name: string; ok: boolean; measured: unknown }[] = [];
const check = (name: string, ok: boolean, measured: unknown) => {
	checks.push({ name, ok, measured });
	console.log(`${ok ? "PASS" : "FAIL"} ${name} ${JSON.stringify(measured)}`);
};

async function seed(home: string): Promise<void> {
	const project = join(home, "proj");
	await mkdir(project, { recursive: true });
	await writeFile(join(project, "README.md"), "# proj\n");
	await writeFile(join(home, "window.json"), JSON.stringify({ width: 1100, height: 720, x: 40, y: 40 }));
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
			uiLocale: "zh-CN",
			appearance: {
				theme: "light",
				// Custom on purpose: the old Inter default is migrated away. This keeps
				// `-apple-system` in the stack so the theft path is the one under test.
				uiFont: '"Inter Variable", -apple-system, BlinkMacSystemFont, "PingFang SC", "Comic Sans MS", sans-serif',
			},
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
	async function hold(ms = 1000) {
		const end = Date.now() + ms;
		while (Date.now() < end) {
			const picture = await app!.send<{ data: string }>("Page.captureScreenshot", { format: "jpeg", quality: 82 });
			frames.push({ at: Date.now(), data: Buffer.from(picture.data, "base64") });
			await pause(Math.min(200, Math.max(0, end - Date.now())));
		}
	}

	await until(`Boolean(document.querySelector("main textarea.ly-composer-text"))`);
	await app.evaluate(`document.fonts.ready`);
	await app.evaluate(`(() => {
		const field = document.querySelector("main textarea.ly-composer-text");
		const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
		setter.call(field, ${JSON.stringify(SAMPLE)});
		field.dispatchEvent(new Event("input", { bubbles: true }));
		field.focus();
	})()`);
	await hold(1400);
	const picture = await app.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
	await mkdir(out, { recursive: true });
	await writeFile(join(out, `${stamp}_composer.png`), Buffer.from(picture.data, "base64"));

	const workspace = await app.evaluate<{
		lang: string;
		family: string;
		punctFirst: boolean;
		hanFollows: boolean;
		periodFrac: number;
		pingFrac: number;
		hiraFrac: number;
		loaded: boolean;
	}>(`(() => {
		const field = document.querySelector("main textarea.ly-composer-text");
		const family = getComputedStyle(field).fontFamily;
		const size = getComputedStyle(field).fontSize;
		const ink = (font, text) => {
			const canvas = document.createElement("canvas");
			const scale = 8;
			const px = 16 * scale;
			canvas.width = 400 * scale;
			canvas.height = 48 * scale;
			const ctx = canvas.getContext("2d");
			ctx.fillStyle = "#000";
			ctx.font = font.replace(/\\d+(\\.\\d+)?px/, px + "px");
			ctx.textBaseline = "alphabetic";
			ctx.fillText(text, 16 * scale, 32 * scale);
			const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
			const cols = new Array(width).fill(0);
			const rows = [];
			for (let y = 0; y < height; y++) {
				let row = 0;
				for (let x = 0; x < width; x++) {
					if (data[(y * width + x) * 4 + 3] < 30) continue;
					cols[x]++;
					row++;
				}
				rows[y] = row;
			}
			const clusters = [];
			for (let x = 0; x < width; x++) {
				if (!cols[x]) continue;
				const start = x;
				while (x < width && cols[x]) x++;
				clusters.push([start, x - 1]);
			}
			if (clusters.length < 2) return { empty: true, frac: 1 };
			const last = clusters[clusters.length - 1];
			const digits = clusters.slice(0, -1);
			const d0 = digits[0][0];
			const d1 = digits[digits.length - 1][1];
			const ys = (x0, x1) => {
				let min = height, max = 0;
				for (let y = 0; y < height; y++) {
					for (let x = x0; x <= x1; x++) {
						if (data[(y * width + x) * 4 + 3] < 30) continue;
						if (y < min) min = y;
						if (y > max) max = y;
					}
				}
				return [min, max];
			};
			const [digitTop, digitBottom] = ys(d0, d1);
			const [periodTop, periodBottom] = ys(last[0], last[1]);
			const digitH = digitBottom - digitTop + 1;
			const center = (periodTop + periodBottom) / 2;
			return { frac: (center - digitTop) / digitH, digitH, periodTop, periodBottom, digitTop, digitBottom };
		};
		const live = ink(getComputedStyle(field).font, ${JSON.stringify(SAMPLE)});
		const ping = ink(size + ' "PingFang SC"', ${JSON.stringify(SAMPLE)});
		const hira = ink(size + ' "Hiragino Sans"', ${JSON.stringify(SAMPLE)});
		return {
			lang: document.documentElement.lang,
			family,
			punctFirst: /^["']?Lyra Punct/.test(family),
			hanFollows: /Lyra CJK/.test(family),
			periodFrac: live.frac,
			pingFrac: ping.frac,
			hiraFrac: hira.frac,
			loaded: document.fonts.check('15px "Lyra Punct"') && document.fonts.check('15px "PingFang SC"'),
		};
	})()`);

	check("html lang is zh-CN so Chinese locl can apply", workspace.lang === "zh-CN", workspace.lang);
	check("composer stack starts with Lyra Punct", workspace.punctFirst, workspace.family);
	check("Lyra CJK still follows for Han", workspace.hanFollows, workspace.family);
	check("punctuation face is loaded", workspace.loaded, workspace);
	/*
	 * 0.5 is a Japanese-style circle sitting in the middle of the digits. Chinese 句号 sits
	 * on the baseline, so the ink centre is in the lower half of the digit box. PingFang's
	 * own `。` is the reference; Hiragino is the face `-apple-system` used to steal.
	 */
	check(
		"period sits in the lower half of the digits, not mid-height",
		workspace.periodFrac >= 0.58,
		{ periodFrac: workspace.periodFrac, pingFrac: workspace.pingFrac, hiraFrac: workspace.hiraFrac },
	);
	check(
		"period is not the Japanese mid-box form",
		workspace.periodFrac >= 0.58 && Math.abs(workspace.periodFrac - 0.5) > 0.12,
		{ periodFrac: workspace.periodFrac, pingFrac: workspace.pingFrac, hiraFrac: workspace.hiraFrac },
	);

	await hold(800);
} finally {
	if (stopRecording) await stopRecording();
	await app?.stop();
}

const failed = checks.filter((row) => !row.ok).length;
const passed = checks.length - failed;
const dest = join(out, `${stamp}_中文句号左下_${passed}of${checks.length}.mp4`);
if (frames.length > 0) {
	await mkdir(out, { recursive: true });
	await encode(frames, dest);
	console.log(`wrote ${dest} (${frames.length} frames)`);
}
if (failed) {
	console.error(`FAILED ${failed}/${checks.length}`);
	process.exit(1);
}
console.log(`PASS ${passed}/${checks.length}`);
