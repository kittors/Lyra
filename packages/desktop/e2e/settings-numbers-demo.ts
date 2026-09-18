/* oxlint-disable no-console -- real-window verification prints measured evidence */
/**
 * 设置里的数字框：能一位一位地打，非法字符进不去，加减停在上下限。
 *
 * 用法：先 `pnpm --filter @lyra/desktop build`，再
 * `node --experimental-strip-types packages/desktop/e2e/settings-numbers-demo.ts`
 */

import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { startApp, type RunningApp } from "./app.ts";
import { encode, pause, startRecording, type Frame } from "./record.ts";

const out = process.argv[2] ?? join(homedir(), "Desktop", "Lyra设置数字框测试");
const stamp = new Date().toLocaleString("sv-SE", { timeZone: "Asia/Shanghai" }).replace(/[: ]/g, "-").slice(0, 19);
const PORT = 9788;
const checks: { name: string; ok: boolean; measured: unknown }[] = [];
const check = (name: string, ok: boolean, measured: unknown) => {
	checks.push({ name, ok, measured });
	console.log(`${ok ? "PASS" : "FAIL"} ${name} ${JSON.stringify(measured)}`);
};

async function seed(home: string): Promise<void> {
	const project = join(home, "proj");
	await mkdir(project, { recursive: true });
	await writeFile(join(project, "README.md"), "# proj\n");
	await writeFile(join(home, "window.json"), JSON.stringify({ width: 1280, height: 900, x: 40, y: 40 }));
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
			appearance: {
				uiFontSize: 14,
				codeFontSize: 12,
				contentWidth: 640,
				codeFontWeight: 400,
				codeLineHeight: 1.6,
				codeLetterSpacing: 0,
			},
			formatting: { tabWidth: 2, printWidth: 120 },
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
		await pause(700);
	}
	async function hold(ms = 900) {
		const end = Date.now() + ms;
		while (Date.now() < end) {
			const picture = await app!.send<{ data: string }>("Page.captureScreenshot", { format: "jpeg", quality: 82 });
			frames.push({ at: Date.now(), data: Buffer.from(picture.data, "base64") });
			await pause(Math.min(200, Math.max(0, end - Date.now())));
		}
	}
	async function readNumber(name: string) {
		return app!.evaluate<{ value: string; visible: boolean; up: boolean; down: boolean }>(
			`(() => {
				const root = document.querySelector(${JSON.stringify(`[data-ly-number="${name}"]`)});
				const input = root?.querySelector("input");
				const buttons = [...(root?.querySelectorAll("button") ?? [])];
				const style = input ? getComputedStyle(input) : null;
				return {
					value: input instanceof HTMLInputElement ? input.value : "",
					visible: Boolean(input && style && parseFloat(style.width) >= 18 && style.visibility !== "hidden"),
					up: buttons[0] instanceof HTMLButtonElement ? !buttons[0].disabled : false,
					down: buttons[1] instanceof HTMLButtonElement ? !buttons[1].disabled : false,
				};
			})()`,
		);
	}
	async function focusNumber(name: string) {
		await until(`Boolean(document.querySelector(${JSON.stringify(`[data-ly-number="${name}"] input`)}))`);
		await app!.evaluate(`(() => {
			const input = document.querySelector(${JSON.stringify(`[data-ly-number="${name}"] input`)});
			if (!(input instanceof HTMLInputElement)) return;
			input.scrollIntoView({ block: "center", behavior: "instant" });
			input.focus();
			input.select();
		})()`);
	}

	await openSettings("外观");
	await until(`Boolean(document.querySelector('[data-ly-number="uiFontSize"]'))`);
	const uiStart = await readNumber("uiFontSize");
	check("UI font size shows its digits", uiStart.value === "14" && uiStart.visible, uiStart);
	await hold(800);

	await focusNumber("uiFontSize");
	await app.send("Input.insertText", { text: "1" });
	await pause(200);
	const typedOne = await readNumber("uiFontSize");
	check("typing 1 into a min-11 field stays 1", typedOne.value === "1", typedOne);
	await app.send("Input.insertText", { text: "6" });
	await pause(200);
	const typedSixteen = await readNumber("uiFontSize");
	check("1 then 6 becomes 16", typedSixteen.value === "16", typedSixteen);
	await app.send("Input.insertText", { text: "-" });
	await pause(160);
	const noMinus = await readNumber("uiFontSize");
	check("a minus does not enter a font size", noMinus.value === "16", noMinus);
	await hold(900);

	await focusNumber("uiFontSize");
	await app.evaluate(`document.querySelector('[data-ly-number="uiFontSize"] input')?.select()`);
	await app.send("Input.insertText", { text: "9" });
	await pause(200);
	const refusedNine = await readNumber("uiFontSize");
	check("9 cannot grow into 11–20 so it does not enter", refusedNine.value === "16", refusedNine);

	for (let i = 0; i < 6; i++) {
		await click('[data-ly-number="uiFontSize"] button:first-of-type');
		await pause(120);
	}
	const ceiling = await readNumber("uiFontSize");
	check("plus stops at 20", ceiling.value === "20" && ceiling.up === false, ceiling);
	await hold(800);

	const codePlace = await app.evaluate<{ inCode: boolean; inPrefs: boolean }>(`(() => {
		const field = document.querySelector('[data-ly-number="codeFontSize"]');
		return {
			inCode: Boolean(field?.closest("[data-ly-code-appearance]")),
			inPrefs: Boolean(field) && !field.closest("[data-ly-code-appearance]"),
		};
	})()`);
	check("code font size sits in the code appearance card", codePlace.inCode && !codePlace.inPrefs, codePlace);

	await focusNumber("codeFontSize");
	await app.send("Input.insertText", { text: "1" });
	await pause(160);
	const codeOne = await readNumber("codeFontSize");
	check("code size accepts 1 on the way to 16", codeOne.value === "1", codeOne);
	await app.send("Input.insertText", { text: "6" });
	await pause(160);
	const codeSixteen = await readNumber("codeFontSize");
	check("code size becomes 16", codeSixteen.value === "16", codeSixteen);
	await hold(800);

	await focusNumber("codeLetterSpacing");
	await app.send("Input.insertText", { text: "-" });
	await pause(160);
	const trackingMinus = await readNumber("codeLetterSpacing");
	check("tracking accepts a minus because its floor is below zero", trackingMinus.value === "-", trackingMinus);
	await app.send("Input.insertText", { text: "0.05" });
	await pause(200);
	const tracking = await readNumber("codeLetterSpacing");
	check("tracking keeps -0.05", tracking.value === "-0.05", tracking);
	await hold(900);

	await openSettings("代码格式化");
	await until(`Boolean(document.querySelector('[data-ly-number="printWidth"]'))`);
	await focusNumber("printWidth");
	await app.send("Input.insertText", { text: "1" });
	await pause(160);
	const printOne = await readNumber("printWidth");
	check("print width keeps 1 on the way to 120", printOne.value === "1", printOne);
	await app.send("Input.insertText", { text: "20" });
	await pause(200);
	const printWidth = await readNumber("printWidth");
	check("print width becomes 120", printWidth.value === "120", printWidth);
	await hold(1100);
} catch (error) {
	check("verification script completed", false, String(error));
	throw error;
} finally {
	await stopRecording?.();
	await app?.stop();
	await mkdir(out, { recursive: true });
	const pass = checks.filter((item) => item.ok).length;
	const name = `${stamp}_设置数字框_${pass}of${checks.length}`;
	await writeFile(join(out, `${name}.json`), JSON.stringify({ checks }, null, 2));
	if (frames.length) await encode(frames, join(out, `${name}.mp4`), 60);
	console.log(`Evidence: ${join(out, name)} (${frames.length} captured frames)`);
	if (checks.some((item) => !item.ok)) process.exitCode = 1;
}
