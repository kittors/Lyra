/**
 * The formatting sandbox, in both colour schemes.
 *
 * `node --experimental-strip-types e2e/format-sandbox-probe.ts [dir]`
 *
 * Runs the whole thing twice, dark and light, because every previous round of this work was
 * verified in one scheme and shipped broken in the other — the palettes differ, the surface
 * differs, and `light-dark()` resolves against a property that only one of them sets.
 *
 * What it checks, in order of what would be worst to get wrong:
 *
 *   - the box is a sandbox: type, format, change a setting, format again, restore.
 *   - it is drawn like the editor — same surface variables, same typography from 代码外观 — and
 *     changing 代码外观 changes it.
 *   - the header controls sit inside the box and never overlap each other or the code.
 *   - the code is genuinely coloured in both schemes, not white text with two accents.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { startApp } from "./app.ts";

const dir = process.argv[2] ?? "/tmp/lyra-sandbox";

async function seed(home: string): Promise<void> {
	await writeFile(join(home, "window.json"), JSON.stringify({ width: 1340, height: 980, x: 0, y: 0 }));
	await writeFile(
		join(home, "settings.json"),
		JSON.stringify({
			version: 1,
			providers: [],
			mcpServers: [],
			projects: [],
			defaultModelId: null,
			permissionMode: "auto",
			thinking: "medium",
			retryAttempts: 3,
			hooks: [],
			scheduledTasks: [],
			disabledPlugins: [],
			alwaysAllow: [],
			sync: { enabled: false, port: 4537, token: null },
			appearance: { theme: "dark" },
		}),
	);
}

const app = await startApp({ port: 9491, seed });
const settle = (ms = 600) => new Promise((resolve) => setTimeout(resolve, ms));

let failures = 0;
function check(label: string, passed: boolean, evidence: string): void {
	if (!passed) failures++;
	process.stdout.write(`  ${passed ? "✓" : "✗"} ${label}\n      ${evidence}\n`);
}
const shoot = async (name: string) => {
	const shot = await app.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
	await writeFile(join(dir, `${name}.png`), Buffer.from(shot.data, "base64"));
};

const openPage = (page: string) =>
	app.evaluate(`(async () => {
		const wait = (ms) => new Promise((r) => setTimeout(r, ms));
		if (![...document.querySelectorAll("button")].some((b) => b.textContent?.trim() === "返回工作区")) {
			document.querySelector("[data-ly-open-settings]")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
			await wait(1100);
		}
		[...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === ${JSON.stringify(page)})?.click();
		await wait(1200);
		return true;
	})()`);

const typeIn = (text: string) =>
	app.evaluate<boolean>(`(() => {
		const area = document.querySelector('textarea[aria-label*="试一段代码"]');
		if (!area) return false;
		const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
		setter.call(area, ${JSON.stringify(text)});
		area.dispatchEvent(new Event("input", { bubbles: true }));
		return true;
	})()`);

const press = (label: string) =>
	app.evaluate<boolean>(`(() => {
		const hit = [...document.querySelectorAll("button")].find((b) => (b.textContent || "").trim() === ${JSON.stringify(label)});
		if (!hit || hit.disabled) return false;
		hit.click();
		return true;
	})()`);

const boxText = () => app.evaluate<string>(`document.querySelector('textarea[aria-label*="试一段代码"]')?.value ?? ""`);

const pickLanguage = (name: string) =>
	app.evaluate<boolean>(`(async () => {
		const wait = (ms) => new Promise((r) => setTimeout(r, ms));
		const trigger = [...document.querySelectorAll("button")].find((b) => (b.textContent || "").includes("."));
		if (!trigger) return false;
		trigger.click();
		await wait(500);
		const input = document.querySelector('input[placeholder*="搜索"]');
		if (input) {
			const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
			setter.call(input, ${JSON.stringify(name)});
			input.dispatchEvent(new Event("input", { bubbles: true }));
			await wait(400);
		}
		const option = [...document.querySelectorAll('[role="menuitem"]')].find((b) => {
			const span = b.querySelector("span");
			return span && span.textContent.trim() === ${JSON.stringify(name)};
		});
		if (!option) { document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); return false; }
		option.click();
		await wait(600);
		return true;
	})()`);

/** Everything about how the box is drawn, in one read. */
interface Painted {
	surface: string;
	codeBg: string;
	fontSize: string;
	weight: string;
	tracking: string;
	family: string;
	colours: number;
	dominant: number;
	height: number;
	controlsInside: boolean;
	overlap: boolean;
	overCode: boolean;
}

const readBox = `(() => {
	const area = document.querySelector('textarea[aria-label*="试一段代码"]');
	const box = area && area.closest(".ly-scroll-host");
	const scroller = box && box.querySelector(".ly-scroll");
	if (!box || !scroller) return null;
	const root = getComputedStyle(document.documentElement);
	const own = getComputedStyle(area);
	const weight = new Map();
	let total = 0;
	for (const span of scroller.querySelectorAll("span")) {
		const text = (span.textContent || "").replace(/\\s/g, "");
		if (!text) continue;
		const colour = getComputedStyle(span).color;
		weight.set(colour, (weight.get(colour) || 0) + text.length);
		total += text.length;
	}
	const sorted = [...weight.entries()].sort((a, b) => b[1] - a[1]);
	const buttons = [...box.querySelectorAll("button")];
	const hit = (a, b) => !(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom);
	const boxes = buttons.map((b) => b.getBoundingClientRect());
	let overlap = false;
	for (let i = 0; i < boxes.length; i++)
		for (let j = i + 1; j < boxes.length; j++) if (hit(boxes[i], boxes[j])) overlap = true;
	const code = scroller.getBoundingClientRect();
	return {
		surface: getComputedStyle(box).backgroundColor,
		codeBg: root.getPropertyValue("--ly-code-bg").trim(),
		fontSize: own.fontSize,
		weight: own.fontWeight,
		tracking: own.letterSpacing,
		family: own.fontFamily.split(",")[0],
		colours: weight.size,
		dominant: total ? sorted[0][1] / total : 1,
		height: Math.round(code.height),
		controlsInside: buttons.length >= 2,
		overlap,
		overCode: boxes.some((b) => hit(b, code)),
	};
})()`;

function hexToRgb(hex: string): string {
	const n = Number.parseInt(hex.replace("#", ""), 16);
	return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}

async function round(scheme: "深色" | "浅色"): Promise<void> {
	process.stdout.write(`\n══════ ${scheme} ══════\n`);
	await openPage("代码格式化");
	await settle(1000);

	/* ---------- 沙盒 ---------- */
	check("代码区能直接输入", await typeIn("const a={b:1,c:2};function f(x){return x}"), "已输入");
	await settle(700);
	check("格式化按钮可按", await press("格式化"), "已点击");
	await settle(1200);
	const formatted = await boxText();
	check("格式化改写了内容", formatted.includes("const a = { b: 1, c: 2 }"), JSON.stringify(formatted.split("\n")[0].slice(0, 44)));

	await app.evaluate(`(() => {
		[...document.querySelectorAll("button")].find((b) => (b.textContent || "").trim() === "单引号")?.click();
		return true;
	})()`);
	await settle(900);
	await typeIn('const s = "引号";');
	await settle(500);
	await press("格式化");
	await settle(1100);
	check("改配置后再格式化，结果跟着变", (await boxText()).includes("'引号'"), JSON.stringify((await boxText()).slice(0, 30)));
	// Put it back, so the second round starts from the same place.
	await app.evaluate(`(() => {
		[...document.querySelectorAll("button")].find((b) => (b.textContent || "").trim() === "双引号")?.click();
		return true;
	})()`);
	await settle(700);

	check("还原可按", await press("还原"), "已点击");
	await settle(800);
	check("还原放回了示例", (await boxText()).includes("findUser"), JSON.stringify((await boxText()).slice(0, 30)));

	/* ---------- 画成什么样 ---------- */
	const painted = await app.evaluate<Painted | null>(readBox);
	if (!painted) {
		check("能读到预览框", false, "找不到");
		return;
	}
	process.stdout.write(
		`      表面 ${painted.surface} · 字号 ${painted.fontSize} · 字重 ${painted.weight} · 颜色 ${painted.colours} 种（最大 ${Math.round(painted.dominant * 100)}%）\n`,
	);
	check("预览的表面就是编辑器的表面", painted.surface === hexToRgb(painted.codeBg), `${painted.surface} vs ${painted.codeBg}`);
	check("代码区高度固定", painted.height === 260, `${painted.height}px`);
	check("控件都在框内", painted.controlsInside, `${painted.controlsInside ? "在" : "不在"}`);
	check("控件互不重叠", !painted.overlap, painted.overlap ? "重叠了" : "不重叠");
	check("控件没压住代码", !painted.overCode, painted.overCode ? "压住了" : "没压住");
	check("代码是有颜色的，不是一片白", painted.colours >= 5 && painted.dominant < 0.6, `${painted.colours} 种，最大占比 ${Math.round(painted.dominant * 100)}%`);

	/* ---------- 跟着代码外观走 ---------- */
	await openPage("外观");
	await settle(900);
	const setNumber = (label: string, value: number) =>
		app.evaluate<boolean>(`(() => {
			const input = document.querySelector('input[aria-label=${JSON.stringify(label)}]');
			if (!input) return false;
			Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, ${JSON.stringify(String(value))});
			input.dispatchEvent(new Event("input", { bubbles: true }));
			return true;
		})()`);
	await setNumber("代码字体大小", 17);
	await settle(400);
	await setNumber("字重", 600);
	await settle(400);
	await setNumber("字距", 0.05);
	await settle(900);
	await openPage("代码格式化");
	await settle(1200);

	const after = await app.evaluate<Painted | null>(readBox);
	check(
		"改了代码外观，预览跟着变",
		Boolean(after && after.fontSize !== painted.fontSize && after.weight !== painted.weight && after.tracking !== painted.tracking),
		`${painted.fontSize}/${painted.weight}/${painted.tracking} → ${after?.fontSize}/${after?.weight}/${after?.tracking}`,
	);
	check("代码区高度没有被字号撑开", after?.height === 260, `${after?.height}px`);

	// Put the typography back for the next round.
	await openPage("外观");
	await settle(800);
	await setNumber("代码字体大小", 12);
	await settle(300);
	await setNumber("字重", 400);
	await settle(300);
	await setNumber("字距", 0);
	await settle(700);
	await openPage("代码格式化");
	await settle(1000);

	/* ---------- 几种代表性语言，在这个配色下 ---------- */
	for (const language of ["Go", "Python", "YAML", "nginx"]) {
		if (!(await pickLanguage(language))) {
			check(`切到 ${language}`, false, "切不过去");
			continue;
		}
		await settle(700);
		const one = await app.evaluate<Painted | null>(readBox);
		check(
			`${language} 有实打实的着色`,
			Boolean(one && one.colours >= 4 && one.dominant < 0.7),
			one ? `${one.colours} 种，最大占比 ${Math.round(one.dominant * 100)}%` : "读不到",
		);
	}
	await pickLanguage("TypeScript");
	await settle(700);
	await shoot(scheme === "深色" ? "01-dark" : "02-light");
}

try {
	await mkdir(dir, { recursive: true });
	await settle(2400);

	await round("深色");

	// Switch the whole app to light and do it all again.
	await openPage("外观");
	await settle(900);
	await app.evaluate(`(() => {
		[...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "浅色")?.click();
		return true;
	})()`);
	await settle(1600);
	await round("浅色");

	process.stdout.write(`\n截图：${dir}\n`);
} finally {
	await app.stop();
}

process.exit(failures === 0 ? 0 : 1);
