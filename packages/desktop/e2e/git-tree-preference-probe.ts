/* oxlint-disable no-console -- probe CLI that prints what the real window did */
/**
 * 点成树形之后，它还认不认得这件事。
 *
 * 单测能验「重新挂一次还在不在」，但那验的是组件。人遇到的是别的事：关掉 Git 面板再打开、切个
 * 分支、换个项目——这些在真窗口里才是同一件事，而在单测里只是一次 `mount`。所以这里把面板真的
 * 关掉再打开一次，看那个形状还在不在。
 *
 * 认按钮的标签而不是认图标：这一颗在两种形状之间换脸，平铺时它说「切换为树状视图」，树形时说
 * 「切换为扁平列表」——它说的是**按下去会变成什么**，所以它说什么，当前就不是什么。
 *
 * 用法：node --experimental-strip-types e2e/git-tree-preference-probe.ts [输出目录]
 */

import { homedir } from "node:os";
import { join } from "node:path";
import { startApp, type RunningApp } from "./app.ts";
import { seedFromReal } from "./session-switch-perf.ts";
import { encode, startRecording, type Frame } from "./record.ts";

const OUT_DIR = process.argv[2] ?? join(homedir(), "Desktop", "Lyra树形记忆测试");
const STAMP = new Date().toLocaleString("sv-SE", { timeZone: "Asia/Shanghai" }).replace(/[: ]/g, "-").slice(0, 16);
const PORT = 9753;

let app: RunningApp;
const checks: { ok: boolean; what: string; saw: string }[] = [];

function check(what: string, ok: boolean, saw: string): void {
	checks.push({ ok, what, saw });
	console.log(`   ${ok ? "✅" : "❌"} ${what}${ok ? "" : `  ——  ${saw}`}`);
}

const evaluate = <T>(expression: string): Promise<T> => app.evaluate<T>(expression);
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function until(expression: string, ms = 30000): Promise<void> {
	const end = Date.now() + ms;
	while (Date.now() < end) {
		if (await evaluate<boolean>(`Boolean(${expression})`)) return;
		await pause(250);
	}
	throw new Error(`等不到：${expression}`);
}

/** 真鼠标——`.click()` 在这个界面里打不开好几样东西。 */
async function clickAt(selector: string): Promise<boolean> {
	const at = await evaluate<{ x: number; y: number } | null>(`(() => {
		const el = document.querySelector(${JSON.stringify(selector)});
		if (!el) return null;
		const r = el.getBoundingClientRect();
		return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
	})()`);
	if (!at) return false;
	for (const type of ["mouseMoved", "mousePressed", "mouseReleased"] as const) {
		await app.send("Input.dispatchMouseEvent", {
			type, ...at,
			...(type === "mouseMoved" ? {} : { button: "left", clickCount: 1 }),
		});
	}
	return true;
}

/** 当前是平铺还是树，从那一颗按钮说什么反推出来。 */
async function shape(): Promise<"平铺" | "树形" | "找不到"> {
	const label = await evaluate<string | null>(`(() => {
		const b = [...document.querySelectorAll('button')].find((el) => /切换为树状视图|切换为扁平列表/.test(el.getAttribute('aria-label') || ''));
		return b ? b.getAttribute('aria-label') : null;
	})()`);
	if (!label) return "找不到";
	return label.includes("树状") ? "平铺" : "树形";
}

async function toggleShape(): Promise<boolean> {
	const at = await evaluate<{ x: number; y: number } | null>(`(() => {
		const b = [...document.querySelectorAll('button')].find((el) => /切换为树状视图|切换为扁平列表/.test(el.getAttribute('aria-label') || ''));
		if (!b) return null;
		const r = b.getBoundingClientRect();
		return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
	})()`);
	if (!at) return false;
	for (const type of ["mouseMoved", "mousePressed", "mouseReleased"] as const) {
		await app.send("Input.dispatchMouseEvent", {
			type, ...at,
			...(type === "mouseMoved" ? {} : { button: "left", clickCount: 1 }),
		});
	}
	await pause(900);
	return true;
}

/**
 * 等到改动列表真的画出来。
 *
 * 面板本身开得很快，里面那份改动要跑一趟 `git status` 加两次 diff 才到——中间那段时间面板是空
 * 的，切换视图那一颗还没有。按固定的 2.5 秒等，第一版就卡在这里：报「工作区干净，没有改动可
 * 列」，而那台机器上明明有改动。
 */
async function waitForPanel(): Promise<void> {
	await until(`document.querySelector('[data-dock-pane="review"]')`, 20000);
	await until(
		`[...document.querySelectorAll('button')].some((el) => /切换为树状视图|切换为扁平列表/.test(el.getAttribute('aria-label') || ''))`,
		20000,
	).catch(() => {});
	await pause(800);
}

/** Git 面板那一颗：认 `^Git `，侧边栏里带 "GitHub" 的会话标题会排在前面。 */
async function toggleGitPanel(): Promise<boolean> {
	return evaluate<boolean>(`(() => {
		const b = [...document.querySelectorAll('button')].find((el) => /^Git\\s/.test(el.getAttribute('aria-label') || ''));
		if (!b) return false;
		b.click();
		return true;
	})()`);
}

async function main(): Promise<void> {
	app = await startApp({ port: PORT, seed: seedFromReal });
	const frames: Frame[] = [];
	const stop = await startRecording(PORT, frames);
	try {
		await until(`document.querySelectorAll('[data-ly-row]').length > 0`, 40000);
		await clickAt("[data-ly-row]");
		await pause(2500);

		console.log("【一】打开 Git 面板，先看它现在是什么形状");
		await toggleGitPanel();
		await waitForPanel();
		const before = await shape();
		check("Git 面板里有改动可看", before !== "找不到", "找不到切换视图那一颗——多半是工作区干净，没有改动可列");
		if (before === "找不到") return;
		console.log(`   现在是：${before}`);

		console.log("\n【二】点成树形");
		await toggleShape();
		check("点完变成了树形", (await shape()) === "树形", `点完还是 ${await shape()}`);
		await pause(1400);

		console.log("\n【三】关掉 Git 面板，再打开 —— 这一步从前会把形状忘掉");
		await toggleGitPanel();
		await pause(1600);
		await toggleGitPanel();
		await waitForPanel();
		const after = await shape();
		check("重新打开之后还是树形", after === "树形", `变回了 ${after}`);
		await pause(1400);

		console.log("\n【四】再点回平铺，同样要记住");
		await toggleShape();
		check("点完变回了平铺", (await shape()) === "平铺", `点完还是 ${await shape()}`);
		await toggleGitPanel();
		await pause(1600);
		await toggleGitPanel();
		await waitForPanel();
		const last = await shape();
		check("重新打开之后还是平铺", last === "平铺", `变成了 ${last}`);
		await pause(1400);
	} finally {
		await stop();
		const passed = checks.filter((c) => c.ok).length;
		const out = join(OUT_DIR, `${STAMP}_树形记忆_${passed}of${checks.length}.mp4`);
		await app?.stop().catch(() => {});
		if (frames.length > 0) await encode(frames, out, 60, 1200);
		console.log(`\n${passed}/${checks.length} 项通过`);
		console.log(frames.length > 0 ? `视频：${out}` : "没有采到帧，视频没生成");
		if (passed !== checks.length) process.exitCode = 1;
	}
}

main().catch((error: unknown) => {
	console.error(error);
	process.exitCode = 1;
});
