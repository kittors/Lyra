/* oxlint-disable no-console -- a picture-taker that says what it found and where it put the files */
/**
 * 「显示更早」那颗按钮上到底印着什么。
 *
 * 它一度只画一个箭头和一个 `60`，整句话藏在 tooltip 里。一个光秃秃的数字不解释自己——60 条
 * 什么？未读？剩余？加载？——而要读懂它得先把鼠标停上去等一秒。这件事只有在真窗口里才看得见：
 * 单测能断言 DOM 里有那几个字，断言不了那几个字是不是真的画出来了、放不放得下、会不会被截断。
 *
 * 跑的是一份真实的长会话（904 条消息），因为按钮只在转录超过一屏窗口时才出现，而那正是它最该
 * 说清楚自己的时候。两个分支都要看：剩余多于一页（「显示更早的 60 条（共 N 条）」），以及最后
 * 一页（「显示更早的 N 条」，不带那个会自我重复的括号）。
 *
 * 不是测试——`node e2e/show-earlier-probe.ts`——跑的是 `out/` 里的产物，所以改完代码要先
 * `pnpm build`。
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { projectIdFor } from "@lyra/core";
import { startApp } from "./app.ts";
import { frameGrabber } from "./record.ts";

const PORT = 9643;
/** 今天那场 recall 风暴的会话：904 条消息，足够把窗口撑满。 */
const SOURCE = join(homedir(), ".lyra/sessions/63ca3825cb82944e/aa5eb131-4b20-4e20-8036-6b39cfd77507.jsonl");
const SESSION_ID = "aa5eb131-4b20-4e20-8036-6b39cfd77507";
/** 侧边栏上那一行的字，用来找到它——选择器会随重构改名，标题不会。 */
const TITLE = "添加文件后布局异常排查";
const OUT = join(homedir(), ".lyra/scratch/show-earlier");

const app = await startApp({
	port: PORT,
	seed: async (home) => {
		const root = join(home, "project");
		await mkdir(root, { recursive: true });
		await writeFile(join(home, "window.json"), JSON.stringify({ x: 0, y: 0, width: 1440, height: 900 }));

		/*
		 * 真实日志，只改它说自己属于谁。
		 *
		 * `projectId` 是 cwd 的散列，而这次的 cwd 是个临时目录——照搬原来的 id，会话会挂在一个
		 * 这个 profile 里不存在的项目下，侧边栏根本不列它。
		 */
		const projectId = projectIdFor(root);
		await mkdir(join(home, "sessions", projectId), { recursive: true });
		const lines = (await readFile(SOURCE, "utf8")).split("\n").filter(Boolean);
		const rewritten = lines.map((line) => {
			const record = JSON.parse(line);
			if (record.type === "meta" && record.meta) {
				record.meta.cwd = root;
				record.meta.projectId = projectId;
			}
			return JSON.stringify(record);
		});
		await writeFile(join(home, "sessions", projectId, `${SESSION_ID}.jsonl`), `${rewritten.join("\n")}\n`);

		await writeFile(
			join(home, "settings.json"),
			JSON.stringify({
				version: 1,
				providers: [],
				mcpServers: [],
				projects: [{ path: root, name: "project", pinned: false, lastOpenedAt: Date.now() }],
				defaultModelId: null,
				permissionMode: "auto",
				thinking: "medium",
				retryAttempts: 3,
				hooks: [],
				scheduledTasks: [],
				disabledPlugins: [],
				pluginRegistries: [],
				skillRegistries: [],
				alwaysAllow: [],
				sync: { enabled: false, port: 4519, token: null },
			}),
		);
	},
});

const wire = await frameGrabber(PORT);
const settle = (ms: number) => new Promise((done) => setTimeout(done, ms));

try {
	await mkdir(OUT, { recursive: true });
	await settle(2500);

	/*
	 * 用真实鼠标点开会话行。
	 *
	 * `evaluate` 里的 `.click()` 打不开它——那颗按钮的打开走的是指针事件，合成的 click 不带
	 * 它要的那几样东西。这条是踩出来的。
	 */
	const row = await wire.evaluate<{ x: number; y: number } | null>(
		`(() => {
			const title = ${JSON.stringify(TITLE)};
			// 标题文字落在哪个元素上——取最深的那个，祖先们的 textContent 也都包含它。
			const all = [...document.querySelectorAll('*')].filter((e) => (e.textContent || '').trim() === title);
			const el = all[all.length - 1];
			if (!el) return null;
			const hit = el.closest('button, [role="button"], a, li') || el;
			const r = hit.getBoundingClientRect();
			if (r.width === 0) return null;
			return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
		})()`,
	);
	if (row) {
		for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) {
			await wire.send("Input.dispatchMouseEvent", {
				type,
				x: row.x,
				y: row.y,
				...(type === "mouseMoved" ? {} : { button: "left", clickCount: 1 }),
			});
		}
		await settle(1800);
	}
	console.log(row ? `点开会话行 @ ${row.x},${row.y}` : "没找到会话行选择器——下面读到的可能是空态");

	/*
	 * 滚到转录顶部：那颗按钮长在最上面。
	 *
	 * 会话打开时停在最新一条，而「显示更早」在另一头——不滚上去，它的 rect 在视口外，读得到
	 * 数值却截不进图，而这次要看的正是它画出来的样子。
	 */
	const scrolled = await wire.evaluate<boolean>(
		`(() => {
			const el = document.querySelector('.ly-transcript');
			const scroller = el && el.closest('[class*="overflow"], [style*="overflow"]') || el?.parentElement;
			if (!scroller) return false;
			scroller.scrollTop = 0;
			return true;
		})()`,
	);
	await settle(1200);
	console.log(scrolled ? "已滚到转录顶部" : "没找到可滚动的转录容器");

	/** 那颗按钮此刻画着什么：文字、尺寸、有没有 tooltip。 */
	const read = () =>
		wire.evaluate<{
			found: boolean;
			text: string;
			tip: string | null;
			ariaLabel: string | null;
			width: number;
			height: number;
			clipped: boolean;
			y: number;
		}>(
			`(() => {
				const buttons = [...document.querySelectorAll('button')];
				const el = buttons.find((b) => b.querySelector('svg') && /条|Show|条）|earlier/.test(b.textContent || ''))
					|| buttons.find((b) => /^\\s*\\d+\\s*$/.test(b.textContent || '') && b.querySelector('svg'));
				if (!el) return { found: false, text: '', tip: null, ariaLabel: null, width: 0, height: 0, clipped: false, y: 0 };
				const r = el.getBoundingClientRect();
				const span = el.querySelector('span');
				return {
					found: true,
					text: (el.textContent || '').trim(),
					tip: el.getAttribute('data-ly-tip'),
					ariaLabel: el.getAttribute('aria-label'),
					width: Math.round(r.width),
					height: Math.round(r.height),
					clipped: span ? span.scrollWidth > span.clientWidth + 1 : false,
					y: Math.round(r.y),
				};
			})()`,
		);

	const first = await read();
	console.log("\n=== 第一屏（剩余多于一页）===");
	console.log(JSON.stringify(first, null, 1));

	const shot = async (name: string) => {
		await writeFile(join(OUT, name), await wire.shot());
		console.log(`截图 → ${join(OUT, name)}`);
	};
	await shot("01-more-than-one-page.png");

	/*
	 * 一路点到最后一页，去看另一个分支。
	 *
	 * 「显示更早的 60 条（共 60 条）」是同一件事说两遍，而读到括号的人会以为里面有新消息。
	 */
	let last = first;
	for (let i = 0; i < 12; i++) {
		const spot = await wire.evaluate<{ x: number; y: number } | null>(
			`(() => {
				const buttons = [...document.querySelectorAll('button')];
				const el = buttons.find((b) => b.querySelector('svg') && /条|Show|earlier/.test(b.textContent || ''));
				if (!el) return null;
				const r = el.getBoundingClientRect();
				if (r.y < 0 || r.y > innerHeight) return null;
				return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
			})()`,
		);
		if (!spot) break;
		for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) {
			await wire.send("Input.dispatchMouseEvent", {
				type,
				x: spot.x,
				y: spot.y,
				...(type === "mouseMoved" ? {} : { button: "left", clickCount: 1 }),
			});
		}
		await settle(700);
		const now = await read();
		if (!now.found) break;
		last = now;
		if (!/（共|\(|in all/.test(now.text)) break;
	}

	console.log("\n=== 最后一页（剩余不足一页）===");
	console.log(JSON.stringify(last, null, 1));
	await shot("02-last-page.png");

	console.log("\n=== 判定 ===");
	const verdict = [
		[first.found, "按钮画出来了"],
		[!/^\d+$/.test(first.text), `按钮上不是光秃秃一个数字（实际：${JSON.stringify(first.text)}）`],
		[first.tip === null, "没有 tooltip 兜底"],
		[first.ariaLabel === null, "没有和可见文字打架的 aria-label"],
		[!first.clipped, "文字没有被截断"],
		[!/（共|in all|\(sur|전체|全 /.test(last.text), `最后一页不带自我重复的括号（实际：${JSON.stringify(last.text)}）`],
	] as const;
	for (const [ok, what] of verdict) console.log(`${ok ? "✅" : "❌"} ${what}`);
	console.log(verdict.every(([ok]) => ok) ? "\n全部通过" : "\n有未通过项");
} finally {
	wire.close();
	await app.stop();
}
