/* oxlint-disable no-console -- probe CLI that prints what the real window did */
/**
 * 一轮里那几种过程行，量一遍：它们是不是同一种东西。
 *
 * 「统一」不是形容词，是几个可以量的数：左边缘在不在一条线上、行高一不一样、**相邻两行的间距是不是
 * 只有一个值**。最后这一条是客户直接指出来的——间距 2px/10px 交替下来，眼睛会把大间隔当成分组边界，
 * 而那些边界并不存在。
 */

import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { startApp, type RunningApp } from "./app.ts";

const REAL_HOME = join(homedir(), ".lyra");
const PROMPT = [
	"一个 8x8 棋盘去掉对角两格，能不能用 31 张 1x2 骨牌铺满？先想清楚。",
	"想明白之后用 ls 看一下这个工程有哪些文件，把结论追加到 README.md。",
].join("\n");

async function seed(home: string): Promise<void> {
	await mkdir(home, { recursive: true });
	const cwd = join(home, "project");
	await mkdir(cwd, { recursive: true });
	await writeFile(join(cwd, "README.md"), "# 验收工程\n");
	await writeFile(join(cwd, "index.ts"), "export const version = '1.0.0'\n");
	const projectId = createHash("sha256").update(cwd).digest("hex").slice(0, 16);
	await mkdir(join(home, "sessions", projectId), { recursive: true });
	for (const file of ["credentials.json", "vault.key"]) {
		await copyFile(join(REAL_HOME, file), join(home, file)).catch(() => {
			throw new Error(`没找到 ~/.lyra/${file}——真实模型调用需要它`);
		});
	}
	const real = JSON.parse(await readFile(join(REAL_HOME, "settings.json"), "utf8"));
	await writeFile(
		join(home, "settings.json"),
		JSON.stringify({
			...real,
			permissionMode: "full",
			projects: [{ id: projectId, path: cwd, name: "验收工程", pinned: true, lastOpenedAt: Date.now() }],
			pinnedSessionIds: [],
			sync: { enabled: false },
		}),
	);
	await writeFile(join(home, "window.json"), JSON.stringify({ width: 1400, height: 900 }));
}

let app: RunningApp;
const results: Array<{ name: string; ok: boolean; detail: string }> = [];
function check(name: string, ok: boolean, detail: string) {
	results.push({ name, ok, detail });
	console.log(`${ok ? "✅" : "❌"} ${name}\n     ${detail.replace(/\n/g, "\n     ")}`);
}
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 从 Node 侧短轮询：页面里挂长 promise 会撞上 `app.evaluate` 自己的 40 秒超时。 */
async function settled(ms = 300000) {
	const end = Date.now() + ms;
	let started = false;
	let quiet = 0;
	while (Date.now() < end) {
		const turning = await app.evaluate<boolean>(`Boolean(document.querySelector('button[aria-label="停止"]'))`);
		if (turning) { started = true; quiet = 0; }
		else if (started && ++quiet > 12) return;
		await pause(250);
	}
}

interface Geometry {
	rows: Array<{ kind: string; left: number; height: number; iconLeft: number; iconSize: number }>;
	gaps: number[];
	between: string[];
	collapsedGap: number | null;
	iconStaysOnHover: boolean | null;
	chevronOnRight: boolean | null;
	titles: string[];
}

async function main() {
	app = await startApp({ port: 9416, seed });
	try {
		await app.evaluate(`(() => {
			const field = document.querySelector("main textarea");
			const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
			setter.call(field, ${JSON.stringify(PROMPT)});
			field.dispatchEvent(new Event("input", { bubbles: true }));
			field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
		})()`);

		// 流式中先量「思考行在不在写字」——只取 20 秒，别顶到 evaluate 的 40 秒上限。
		const sample = `(async () => {
			const wait = (ms) => new Promise((r) => setTimeout(r, ms));
			let changes = 0;
			let previous = window.__lyProbeLast ?? null;
			const end = Date.now() + 18000;
			while (Date.now() < end) {
				await wait(16);
				const el = document.querySelector('[data-ly-thinking] .ly-flow-summary span');
				const now = el?.textContent ?? null;
				if (now !== null && now !== previous) { changes++; previous = now; }
			}
			window.__lyProbeLast = previous;
			return changes;
		})()`;
		// 分两段：模型可能先闷头想半分钟才吐第一个字，一段 18 秒会整段扑空。
		let typed = 0;
		for (let n = 0; n < 3; n++) typed += await app.evaluate<number>(sample);

		await settled();
		await pause(1000);
		// 过程默认收起，先点开才量得到里面的行距。
		await app.evaluate(`(() => { document.querySelector('[data-ly-turn-process] .ly-flow-row')?.click(); })()`);
		await pause(700);

		const g = await app.evaluate<Geometry>(`(() => {
			const kindOf = (el) => el.closest('[data-ly-thinking]') ? 'think'
				: el.closest('[data-ly-run]') ? 'tools'
				: el.closest('[data-command-run]') ? 'command'
				: el.closest('[data-ly-turn-process]') ? 'fold' : 'other';
			const rows = [...document.querySelectorAll('.ly-flow-row')].map((el) => {
				const r = el.getBoundingClientRect();
				const li = el.querySelector('.ly-flow-lead')?.getBoundingClientRect();
				return { kind: kindOf(el), left: Math.round(r.left), height: Math.round(r.height), iconLeft: Math.round(li?.left ?? -1), iconSize: Math.round(li?.width ?? -1) };
			});

			/*
			 * 量**行盒之间**的距离，不是容器块的 margin。
			 *
			 * 眼睛看到的是两行字之间隔多远；容器 margin 只是其中一部分——容器里如果还有别的东西，
			 * margin 一样而视觉间距不一样。上一版量的是后者，所以报「统一」而屏幕上是参差的。
			 */
			const flowRows = [...document.querySelectorAll('[data-ly-turn-process] .ly-flow-row')];
			const gaps = [];
			const between = [];
			for (let i = 1; i < flowRows.length; i++) {
				const prev = flowRows[i - 1].getBoundingClientRect();
				const here = flowRows[i].getBoundingClientRect();
				gaps.push(Math.round(here.top - prev.bottom));
				between.push((flowRows[i - 1].closest('[data-ly-thinking],[data-ly-run]')?.parentElement?.className ?? '?').split(' ')[0]);
			}

			const fold = document.querySelector('[data-ly-turn-process] .ly-flow-row');
			let collapsedGap = null, iconStaysOnHover = null, chevronOnRight = null;
			if (fold) {
				const icon = fold.querySelector('.ly-flow-lead');
				const chev = fold.querySelector('.ly-flow-chevron');
				const before = icon ? Math.round(icon.getBoundingClientRect().width) : 0;
				fold.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
				iconStaysOnHover = Boolean(icon && Math.round(icon.getBoundingClientRect().width) === before && before > 0);
				const box = fold.getBoundingClientRect();
				chevronOnRight = Boolean(chev && chev.getBoundingClientRect().left > box.left + box.width / 2);
				fold.click();
				const proc = fold.closest('[data-ly-turn-process]');
				const answer = proc?.nextElementSibling;
				if (answer) collapsedGap = Math.round(answer.getBoundingClientRect().top - proc.getBoundingClientRect().bottom);
			}

			return {
				rows, gaps, between, collapsedGap, iconStaysOnHover, chevronOnRight,
				titles: [...document.querySelectorAll('.ly-flow-title')].map((el) => el.textContent ?? ''),
			};
		})()`);

		console.log(`\n过程行 ${g.rows.length} 条：`);
		for (const r of g.rows) console.log(`   ${r.kind.padEnd(8)} left=${r.left} 行高=${r.height} 图标盒 left=${r.iconLeft} 宽=${r.iconSize}`);
		console.log(`\n行与行的实际间距 ${JSON.stringify(g.gaps)}`);
		console.log(`各行的容器 ${JSON.stringify(g.between)}；收起后到回答 ${g.collapsedGap}px`);

		const flow = g.rows.filter((r) => r.kind === "think" || r.kind === "tools" || r.kind === "command");
		check("思考行在流式中持续地写字", typed > 20, `${typed} 次 / 20 秒`);
		check("过程行覆盖思考与工具两种", new Set(flow.map((r) => r.kind)).size >= 2, [...new Set(flow.map((r) => r.kind))].join("、"));
		check("所有行左边缘在一条线上", new Set(g.rows.map((r) => r.left)).size === 1, `left ${[...new Set(g.rows.map((r) => r.left))].join(", ")}`);
		check("所有行等高", new Set(g.rows.map((r) => r.height)).size === 1, `行高 ${[...new Set(g.rows.map((r) => r.height))].join(", ")}`);
		check("块内行距只有一个值", new Set(g.gaps).size <= 1, `取值 ${JSON.stringify([...new Set(g.gaps)])}`);
		check("收起后摘要紧跟回答", g.collapsedGap !== null && g.collapsedGap <= 12, `${g.collapsedGap}px`);
		check("悬停时前面的图标还在", g.iconStaysOnHover === true, String(g.iconStaysOnHover));
		check("展开箭头在行的右半边", g.chevronOnRight === true, String(g.chevronOnRight));
		check("思考行不再带「思考过程」标签", !g.titles.some((t) => t.includes("思考")), `标题取值 ${JSON.stringify(g.titles)}`);

		// 截图要对准过程行——长回答会把它们顶出视口，拍到的就只是正文。
		await app.evaluate(`(() => { document.querySelector('[data-ly-turn-process]')?.scrollIntoView({ block: 'start' }); })()`);
		await pause(500);
		const shot = await app.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
		await writeFile("/tmp/flow-row-after.png", Buffer.from(shot.data, "base64"));
		console.log("\n截图：/tmp/flow-row-after.png");
	} finally {
		const passed = results.filter((r) => r.ok).length;
		console.log(`\n${passed}/${results.length} 通过`);
		const home = app.home;
		await app.stop();
		await rm(home, { recursive: true, force: true });
		if (passed !== results.length) process.exitCode = 1;
	}
}

await main();
