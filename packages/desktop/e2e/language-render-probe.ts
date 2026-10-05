/**
 * All 52 languages, rendered — and judged on what is actually painted.
 *
 * `node --experimental-strip-types e2e/language-render-probe.ts [dir] [theme]`
 *
 * The unit test upstream of this counts *token kinds*, which is the right check for "did the
 * grammar load" and the wrong one for "does it look highlighted". A sample can resolve to five
 * kinds and still render flat, because kinds are looked up in a palette and a palette can map
 * several of them to colours nobody can tell apart. What matters on screen is:
 *
 *   - how many distinct colours were painted,
 *   - whether one colour swallows the sample — 90% in a single colour is a flat wall with a
 *     couple of accents, whatever the token count says,
 *   - whether the comment, the thing most worth reading, came out as its own colour.
 *
 * Measured in a real window, through the real picker, against the theme actually in force.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { startApp } from "./app.ts";

const dir = process.argv[2] ?? "/tmp/lyra-langs";
/** Which code theme to judge under. The defaults are what a fresh install gets. */
const themeName = process.argv[3] ?? "";

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
			sync: { enabled: false, port: 4535, token: null },
			appearance: { theme: process.env.LYRA_LIGHT ? "light" : "dark" },
		}),
	);
}

const app = await startApp({ port: 9489, seed });
const settle = (ms = 500) => new Promise((resolve) => setTimeout(resolve, ms));

interface Rendered {
	colours: number;
	/** Share of visible characters drawn in the single most common colour. */
	dominant: number;
	comment: boolean;
	sample: string;
}

try {
	await mkdir(dir, { recursive: true });
	await settle(2400);

	await app.evaluate(`(async () => {
		const wait = (ms) => new Promise((r) => setTimeout(r, ms));
		document.querySelector("[data-ly-open-settings]")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		await wait(1100);
		[...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "代码格式化")?.click();
		await wait(1200);
		return true;
	})()`);
	await settle(1200);

	if (themeName) {
		await app.evaluate(`(async () => {
			const wait = (ms) => new Promise((r) => setTimeout(r, ms));
			document.querySelector("[data-ly-open-settings]")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
			await wait(400);
			[...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "外观")?.click();
			await wait(900);
			const trigger = [...document.querySelectorAll("button")].find((b) => (b.textContent || "").trim() === "Lyra 默认");
			trigger?.click();
			await wait(400);
			[...document.querySelectorAll('[role="menuitem"]')].find((b) => (b.textContent || "").trim() === ${JSON.stringify(themeName)})?.click();
			await wait(700);
			[...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "代码格式化")?.click();
			await wait(1000);
			return true;
		})()`);
		await settle(1200);
	}

	/** Every language in the picker, in order. */
	const names = await app.evaluate<string[]>(`(async () => {
		const wait = (ms) => new Promise((r) => setTimeout(r, ms));
		const trigger = [...document.querySelectorAll("button")].find((b) => (b.textContent || "").includes("."));
		trigger?.click();
		await wait(600);
		const list = [...document.querySelectorAll('[role="menuitem"]')].map((b) => {
			const label = b.querySelector("span");
			return label ? label.textContent.trim() : "";
		});
		document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
		await wait(300);
		return list.filter(Boolean);
	})()`);

	process.stdout.write(`选择器里有 ${names.length} 种语言${themeName ? `，主题：${themeName}` : "，主题：Lyra 默认"}\n\n`);

	/** Switch to one language and measure what got painted. */
	const measure = async (label: string): Promise<Rendered | null> => {
		const picked = await app.evaluate<boolean>(`(async () => {
			const wait = (ms) => new Promise((r) => setTimeout(r, ms));
			const trigger = [...document.querySelectorAll("button")].find((b) => (b.textContent || "").includes("."));
			if (!trigger) return false;
			trigger.click();
			await wait(400);
			const option = [...document.querySelectorAll('[role="menuitem"]')].find((b) => {
				const span = b.querySelector("span");
				return span && span.textContent.trim() === ${JSON.stringify(label)};
			});
			if (!option) { document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); return false; }
			option.click();
			await wait(500);
			return true;
		})()`);
		if (!picked) return null;
		await settle(420);

		return app.evaluate<Rendered>(`(() => {
			const box = [...document.querySelectorAll("div")].find((d) => d.style.height === "236px");
			if (!box) return { colours: 0, dominant: 1, comment: false, sample: "无" };
			const base = getComputedStyle(box).color;
			const weight = new Map();
			let total = 0;
			for (const span of box.querySelectorAll("span")) {
				const text = (span.textContent || "").replace(/\\s/g, "");
				if (!text) continue;
				const colour = getComputedStyle(span).color;
				weight.set(colour, (weight.get(colour) || 0) + text.length);
				total += text.length;
			}
			const sorted = [...weight.entries()].sort((a, b) => b[1] - a[1]);
			return {
				colours: weight.size,
				dominant: total ? sorted[0][1] / total : 1,
				// A comment is the run that starts with one of the usual markers; whether it got a
				// colour of its own is the single best proxy for "this looks highlighted".
				comment: [...box.querySelectorAll("span")].some((s) => {
					const t = (s.textContent || "").trim();
					return /^(#|\\/\\/|--|;|%|\\/\\*|<!--)/.test(t) && getComputedStyle(s).color !== base;
				}),
				sample: (box.textContent || "").slice(0, 26).replace(/\\s+/g, " "),
			};
		})()`);
	};

	const rows: Array<[string, Rendered]> = [];
	for (const label of names) {
		const result = await measure(label);
		if (result) rows.push([label, result]);
	}

	rows.sort((a, b) => a[1].colours - b[1].colours || b[1].dominant - a[1].dominant);
	process.stdout.write("语言".padEnd(22) + "画出的颜色  最大占比  注释着色\n");
	let poor = 0;
	for (const [label, r] of rows) {
		const flat = r.colours < 4 || r.dominant > 0.82;
		if (flat) poor++;
		process.stdout.write(
			`${flat ? "⚠️ " : "   "}${label.padEnd(22)} ${String(r.colours).padStart(6)} 种 ${String(Math.round(r.dominant * 100)).padStart(7)}%  ${r.comment ? "有" : "—"}\n`,
		);
	}
	process.stdout.write(`\n看起来偏平的：${poor} / ${rows.length}\n`);

	await writeFile(join(dir, `report${themeName ? "-" + themeName.replace(/\s+/g, "-") : ""}.json`), JSON.stringify(rows, null, 2));
} finally {
	await app.stop();
}
