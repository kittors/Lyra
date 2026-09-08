/**
 * 设置页里那些「没放正」的地方，量一遍；顺带验「输入框默认高度」真的管用。
 *
 * `node --experimental-strip-types e2e/settings-align-probe.ts [dir]`
 *
 * 三件事：
 *
 *   - 每一行的控件是不是落在那一行的中线上。带说明文字的行占两行高，控件贴着标题那一行时会整体
 *     偏上——一整张卡片摞起来，右边一列全体上浮。量的是左右两列各自的中心 y，差多少就是歪多少。
 *   - 座右铭输入框底下那行重复的预览是不是没了。输入框里已经写着同一句话。
 *   - 滑到 5 行，预览和真输入框是不是都跟着变高。预览要是只有自己变，那它就不是预览。
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { startApp } from "./app.ts";

const dir = process.argv[2] ?? "/tmp/lyra-settings-align";
const project = join(dir, "proj");

async function seed(home: string): Promise<void> {
	await mkdir(project, { recursive: true });
	await writeFile(join(project, "readme.md"), "# 项目\n");
	await writeFile(join(home, "window.json"), JSON.stringify({ width: 1400, height: 950, x: 0, y: 0 }));
	/* 一条记忆，好让个性化页真的画出那张卡片 —— 空列表验不了图标有没有放正。 */
	await writeFile(
		join(home, "memory.json"),
		JSON.stringify({
			version: 1,
			lastUpdatedAt: Date.now(),
			entries: [
				{
					id: "m1",
					content: "node 上喜欢的包管理工具是 pnpm",
					createdAt: Date.now() - 15 * 3600_000,
					updatedAt: Date.now() - 15 * 3600_000,
					source: "user",
				},
			],
		}),
	);
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
			retryAttempts: 3,
			hooks: [],
			scheduledTasks: [],
			disabledPlugins: [],
			alwaysAllow: [],
			sync: { enabled: false, port: 4527, token: null },
			appearance: { theme: "dark", sidebarMotto: "" },
			personalization: { customInstructions: "", enableMemory: true, sidebarMotto: "写点什么" },
		}),
	);
}

const app = await startApp({ port: 9714, seed });
const settle = (ms = 700) => new Promise((r) => setTimeout(r, ms));
/** `find` 是页面上的一句话；给了就先把它滚进视野再拍，否则拍到的永远是页首。 */
const shot = async (name: string, find?: string) => {
	if (find) {
		await app.evaluate(`(async () => {
			const wait = (ms) => new Promise((r) => setTimeout(r, ms));
			const hit = [...document.querySelectorAll("div, h2, span")].find((n) => n.childElementCount === 0 && (n.textContent || "").trim() === ${JSON.stringify(find)});
			hit?.scrollIntoView({ block: "center" });
			await wait(700);
			return Boolean(hit);
		})()`);
	}
	const result = await app.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
	await writeFile(join(dir, `${name}.png`), Buffer.from(result.data, "base64"));
};

let failures = 0;
function check(label: string, passed: boolean, evidence: string): void {
	if (!passed) failures++;
	process.stdout.write(`  ${passed ? "✓" : "✗"} ${label}\n      ${evidence}\n`);
}

/**
 * 打开设置，再跳到某一页。
 *
 * 「在不在设置页」不能拿 `nav button` 判断——工作区的侧边栏自己就是一个 `<nav>`，那个条件
 * 在哪一边都成立，于是设置根本没被点开，而后面每一项都报「没找到」。认「返回工作区」这个只有
 * 设置页才有的按钮。
 */
const openSettings = (page: string) =>
	app.evaluate<string>(`(async () => {
		const wait = (ms) => new Promise((r) => setTimeout(r, ms));
		const inSettings = () => [...document.querySelectorAll("button")].some((b) => (b.textContent || "").includes("返回工作区"));
		if (!inSettings()) {
			document.querySelector(".ly-sidebar-foot button")?.click();
			await wait(1200);
		}
		if (!inSettings()) return "设置没打开";
		const nav = [...document.querySelectorAll("nav button")].find((b) => (b.textContent || "").trim() === ${JSON.stringify(page)});
		if (!nav) return "找不到入口：" + ${JSON.stringify(page)};
		nav.click();
		await wait(1400);
		return "已打开";
	})()`);

/** 每一行的两列中心差多少。 */
const ROW_ALIGN = `(() => {
	const rows = [...document.querySelectorAll("[data-settings-row]")];
	const off = [];
	for (const row of rows) {
		// 掉成一列的窄布局不谈居中，跳过。
		if (getComputedStyle(row).flexDirection !== "row") continue;
		const [text, control] = row.children;
		if (!text || !control) continue;
		const t = text.getBoundingClientRect();
		const c = control.getBoundingClientRect();
		if (c.height === 0) continue;
		const delta = Math.round(Math.abs((t.top + t.height / 2) - (c.top + c.height / 2)));
		if (delta > 1) off.push({ title: (text.textContent || "").slice(0, 14), delta, textH: Math.round(t.height), ctrlH: Math.round(c.height) });
	}
	return { total: rows.length, off };
})()`;

try {
	await mkdir(dir, { recursive: true });
	await settle(2600);

	/* ── 个性化：座右铭的重复预览、记忆卡片的图标 ── */
	process.stdout.write(`\n个性化\n`);
	process.stdout.write(`  ${await openSettings("个性化")}\n`);
	await settle(900);

	const motto = await app.evaluate<{ found: boolean; input: string; extra: string[] }>(`(() => {
		const label = [...document.querySelectorAll("h2")].find((h) => h.textContent?.includes("座右铭"));
		const card = label?.nextElementSibling;
		const input = card?.querySelector("input");
		if (!card || !input) return { found: false, input: "", extra: [] };
		// 卡片里除了输入框那一行之外，还剩下什么文字——之前剩的正是同一句话。
		const extra = [...card.children].slice(1).map((n) => (n.textContent || "").trim()).filter(Boolean);
		return { found: true, input: input.value, extra };
	})()`);
	check(
		"座右铭输入框底下不再重复一遍",
		motto.found && motto.extra.length === 0,
		motto.found ? `输入框里是 ${JSON.stringify(motto.input)}，底下还剩 ${JSON.stringify(motto.extra)}` : "没找到座右铭卡片",
	);

	const memory = await app.evaluate<{ found: boolean; iconDelta: number; trashDelta: number }>(`(() => {
		const meta = document.querySelector("[data-memory-meta]");
		const card = meta?.closest("[class*='rounded-xl']");
		if (!card) return { found: false, iconDelta: -1, trashDelta: -1 };
		const icon = card.querySelector("svg");
		const trash = card.querySelector("button svg");
		const body = meta.parentElement;
		if (!icon || !trash || !body) return { found: false, iconDelta: -1, trashDelta: -1 };
		const mid = (el) => { const r = el.getBoundingClientRect(); return r.top + r.height / 2; };
		return { found: true, iconDelta: Math.round(Math.abs(mid(icon) - mid(body))), trashDelta: Math.round(Math.abs(mid(trash) - mid(body))) };
	})()`);
	check(
		"记忆卡片左边的图标跟正文同一条中线",
		memory.found && memory.iconDelta <= 1,
		memory.found ? `图标偏 ${memory.iconDelta}px，右边的删除按钮偏 ${memory.trashDelta}px` : "没找到记忆卡片",
	);

	const personalRows = await app.evaluate<{ total: number; off: { title: string; delta: number }[] }>(ROW_ALIGN);
	check(
		"个性化页每一行的控件都在中线上",
		personalRows.off.length === 0,
		`${personalRows.total} 行，歪的 ${personalRows.off.length} 行 ${JSON.stringify(personalRows.off)}`,
	);
	await shot("personalization", "node 上喜欢的包管理工具是 pnpm");

	/* ── 外观：整页的行对齐，以及输入框默认高度 ── */
	process.stdout.write(`\n外观\n`);
	process.stdout.write(`  ${await openSettings("外观")}\n`);
	await settle(1200);

	const appearanceRows = await app.evaluate<{ total: number; off: { title: string; delta: number }[] }>(ROW_ALIGN);
	check(
		"外观页每一行的控件都在中线上",
		appearanceRows.off.length === 0,
		`${appearanceRows.total} 行，歪的 ${appearanceRows.off.length} 行 ${JSON.stringify(appearanceRows.off)}`,
	);

	/* 滑到 5 行。走 input[type=range] 自己的 setter，React 才认这次变化。 */
	const slid = await app.evaluate<{ ok: boolean; before: number; after: number }>(`(async () => {
		const wait = (ms) => new Promise((r) => setTimeout(r, ms));
		const range = [...document.querySelectorAll('input[type=range]')].find((r) => r.getAttribute("aria-label") === "输入框默认高度");
		const preview = () => {
			const el = document.querySelector(".ly-composer-text");
			return el ? Math.round(el.getBoundingClientRect().height) : -1;
		};
		if (!range) return { ok: false, before: -1, after: -1 };
		const before = preview();
		const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
		setter.call(range, "5");
		range.dispatchEvent(new Event("input", { bubbles: true }));
		range.dispatchEvent(new Event("change", { bubbles: true }));
		await wait(900);
		return { ok: true, before, after: preview() };
	})()`);
	check(
		"滑到 5 行，设置页里的预览跟着变高",
		slid.ok && slid.after > slid.before && slid.before > 0,
		slid.ok ? `预览 ${slid.before}px → ${slid.after}px` : "没找到「输入框默认高度」的滑条",
	);
	await shot("appearance", "输入框默认高度");

	/* ── 回工作区，看真的那个输入框 ── */
	const real = await app.evaluate<{ ok: boolean; height: number; lines: number }>(`(async () => {
		const wait = (ms) => new Promise((r) => setTimeout(r, ms));
		[...document.querySelectorAll("button")].find((b) => (b.textContent || "").includes("返回工作区"))?.click();
		await wait(1600);
		const field = document.querySelector("textarea.ly-composer-text");
		if (!field) return { ok: false, height: -1, lines: -1 };
		const line = Number.parseFloat(getComputedStyle(field).fontSize) * 1.625;
		const inner = field.getBoundingClientRect().height - 24;
		return { ok: true, height: Math.round(field.getBoundingClientRect().height), lines: Math.round((inner / line) * 10) / 10 };
	})()`);
	check(
		"真的那个输入框也变成了 5 行高",
		real.ok && Math.abs(real.lines - 5) < 0.3,
		real.ok ? `高 ${real.height}px，合 ${real.lines} 行` : "回不到工作区，或者没找到输入框",
	);
	await shot("composer");

	process.stdout.write(`\n${failures === 0 ? "全过" : `${failures} 项没过`}\n`);
} finally {
	await app.stop();
}
