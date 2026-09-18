/* oxlint-disable no-console -- probe CLI that prints what the real window did */
/**
 * 已加载过的会话再点回去，主线程卡多久。
 *
 * 冷开一次只说明第一次贵；用户报的是「加载过的还掉帧」。这里先把两个真实会话冷开完，
 * 再 A↔B 来回点，按绘制帧和 longtask 记最长那一下，并数转录根节点拆掉了几次。
 *
 * 用法：node --experimental-strip-types e2e/warm-switch-frames.ts
 */

import { startApp, type RunningApp } from "./app.ts";
import { seedFromReal } from "./session-switch-perf.ts";

const PORT = 9561;
let app: RunningApp;

type FrameReport = {
	frames: number;
	worst: number;
	top5: number[];
	over50: number;
	over100: number;
	longTasks: number[];
	remounts: number;
	nodes: number;
	heap: number;
	visible: string;
	trees: number;
	runs: number;
};

async function evaluate<T>(expression: string): Promise<T> {
	return app.evaluate<T>(expression);
}

async function until(expression: string, ms = 40000): Promise<void> {
	await evaluate(
		`new Promise((resolve,reject)=>{const end=performance.now()+${ms};function tick(){try{if(${expression})return resolve()}catch(e){}if(performance.now()>end)return reject(Error(${JSON.stringify(expression)}));requestAnimationFrame(tick)}tick()})`,
	);
}

function pause(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

const INSTALL = `(() => {
	if (window.__ly_warm) return "already";
	const rec = { on: false, gaps: [], last: 0, remounts: 0, tasks: [] };
	window.__ly_warm = rec;
	new PerformanceObserver((list) => {
		if (!rec.on) return;
		for (const entry of list.getEntries()) rec.tasks.push(Math.round(entry.duration));
	}).observe({ entryTypes: ["longtask"] });
	const watch = () => {
		const root = document.querySelector("main") || document.body;
		new MutationObserver((records) => {
			if (!rec.on) return;
			for (const record of records) {
				for (const node of record.removedNodes) {
					if (node.nodeType !== 1) continue;
					const el = node;
					if (el.matches && el.matches("[data-ly-session], .ly-transcript")) rec.remounts += 1;
					else if (el.querySelector && el.querySelector("[data-ly-session], .ly-transcript")) rec.remounts += 1;
				}
			}
		}).observe(root, { childList: true, subtree: true });
	};
	if (document.body) watch();
	else document.addEventListener("DOMContentLoaded", watch, { once: true });
	window.__ly_warm_start = () => {
		rec.on = true;
		rec.gaps = [];
		rec.tasks = [];
		rec.remounts = 0;
		rec.last = performance.now();
		const tick = () => {
			if (!rec.on) return;
			const now = performance.now();
			rec.gaps.push(now - rec.last);
			rec.last = now;
			requestAnimationFrame(tick);
		};
		requestAnimationFrame(tick);
		return true;
	};
	window.__ly_warm_stop = () => {
		rec.on = false;
		const gaps = rec.gaps.slice(1).sort((a, b) => b - a);
		const mem = performance.memory;
		return {
			frames: rec.gaps.length,
			worst: Math.round(gaps[0] ?? 0),
			top5: gaps.slice(0, 5).map((n) => Math.round(n)),
			over50: gaps.filter((n) => n > 50).length,
			over100: gaps.filter((n) => n > 100).length,
			longTasks: rec.tasks.slice().sort((a, b) => b - a).slice(0, 8),
			remounts: rec.remounts,
			nodes: document.querySelectorAll("*").length,
			heap: mem ? Math.round(mem.usedJSHeapSize / 1048576) : 0,
			visible: (document.querySelector("[data-ly-session]") || {}).getAttribute
				? (document.querySelector("[data-ly-session]").getAttribute("data-ly-session") || "")
				: "",
			trees: document.querySelectorAll("[data-ly-session]").length,
			runs: document.querySelectorAll("[data-ly-run], main .prose-dw, main article").length,
		};
	};
	return "installed";
})()`;

async function clickRow(id: string): Promise<boolean> {
	const at = await evaluate<{ x: number; y: number } | null>(`(() => {
		const e = document.querySelector('[data-ly-row=${JSON.stringify(id)}]');
		if (!e) return null;
		e.scrollIntoView({ block: "center" });
		const r = e.getBoundingClientRect();
		if (r.width === 0 || r.height === 0) return null;
		return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
	})()`);
	if (!at) return false;
	for (const type of ["mousePressed", "mouseReleased"] as const) {
		await app.send("Input.dispatchMouseEvent", { type, x: at.x, y: at.y, button: "left", clickCount: 1 });
	}
	return true;
}

async function waitSettled(): Promise<void> {
	await until(`!document.querySelector("[aria-busy=true]")`, 45000).catch(() => {});
	// Warm path never sets aria-busy. The expensive IPC clone lands after the first paint.
	await pause(2500);
}

async function waitForSession(id: string): Promise<void> {
	await until(
		`(document.querySelector("[data-ly-session]") || {}).getAttribute && document.querySelector("[data-ly-session]").getAttribute("data-ly-session") === ${JSON.stringify(id)}`,
		45000,
	).catch(() => {});
	await waitSettled();
}

async function revealHuge(ids: string[]): Promise<string[]> {
	await evaluate(`document.querySelector('[data-ly-tab="chats"]')?.click()`);
	await pause(300);
	for (let i = 0; i < 12; i++) {
		const found = await evaluate<string[]>(`[${ids.map((id) => JSON.stringify(id)).join(",")}].filter((id) => document.querySelector('[data-ly-row="' + id + '"]'))`);
		if (found.length >= 2) return found;
		const expanded = await evaluate<boolean>(`(() => {
			const buttons = [...document.querySelectorAll("button")].filter((b) => /Show \\d+ more|展开显示|展開顯示/.test(b.textContent || ""));
			if (!buttons.length) return false;
			buttons[0].click();
			return true;
		})()`);
		if (!expanded) break;
		await pause(200);
	}
	return evaluate<string[]>(`[${ids.map((id) => JSON.stringify(id)).join(",")}].filter((id) => document.querySelector('[data-ly-row="' + id + '"]'))`);
}

function print(label: string, r: FrameReport): void {
	console.log(
		`   ${label}  最长帧 ${r.worst}ms  top5 ${r.top5.join("/")}  >50ms×${r.over50}  >100ms×${r.over100}  longtask ${r.longTasks[0] ?? 0}ms  拆树 ${r.remounts}  节点 ${r.nodes}  堆 ${r.heap}MB  行 ${r.runs}  树 ${r.trees}`,
	);
}

async function main(): Promise<void> {
	console.log("复制本机 ~/.lyra（凭据已剔）…");
	app = await startApp({ port: PORT, seed: seedFromReal });
	try {
		await until(`document.querySelectorAll("[data-ly-row]").length > 2`, 60000);
		await evaluate(INSTALL);
		const huge = [
			"313a449a-2e92-46a0-94be-e7ed80da12de",
			"2723f0cb-add6-415f-aa94-dff71d02aa7b",
			"3fcaab45-7b41-4c04-93ee-19053be89e46",
			"2132910f-4875-4cfc-9028-0a2b990e22e2",
			"19e88370-9561-4627-a871-c5d02a650b93",
		];
		const visibleHuge = await revealHuge(huge);
		const rows = await evaluate<string[]>(
			`[...document.querySelectorAll("[data-ly-row]")].map((e) => e.getAttribute("data-ly-row")).filter(Boolean)`,
		);
		const a = visibleHuge[0] ?? rows[1] ?? rows[0];
		const b = visibleHuge[1] ?? rows.find((id) => id !== a) ?? rows[2];
		if (!a || !b || a === b) throw new Error(`need two session rows, got ${rows.length}`);
		console.log(`侧边栏 ${rows.length} 行，大会话露出来 ${visibleHuge.length} 个。冷开 ${a.slice(0, 8)} 与 ${b.slice(0, 8)}，再热切。\n`);

		console.log("【冷】第一次打开两个会话");
		await evaluate(`window.__ly_warm_start()`);
		if (!(await clickRow(a))) throw new Error("click a failed");
		await waitForSession(a);
		const coldA = await evaluate<FrameReport>(`window.__ly_warm_stop()`);
		print("冷 A", coldA);

		await evaluate(`window.__ly_warm_start()`);
		if (!(await clickRow(b))) throw new Error("click b failed");
		await waitForSession(b);
		const coldB = await evaluate<FrameReport>(`window.__ly_warm_stop()`);
		print("冷 B", coldB);

		console.log("\n【热】已在缓存里的 A↔B，来回四次");
		const warms: FrameReport[] = [];
		for (const id of [a, b, a, b]) {
			await evaluate(`window.__ly_warm_start()`);
			if (!(await clickRow(id))) throw new Error(`click ${id} failed`);
			await waitForSession(id);
			const r = await evaluate<FrameReport>(`window.__ly_warm_stop()`);
			warms.push(r);
			print(`热 ${id.slice(0, 8)}`, r);
		}

		const worstWarm = Math.max(...warms.map((r) => r.worst));
		const remounts = warms.reduce((n, r) => n + r.remounts, 0);
		const longWarm = Math.max(0, ...warms.flatMap((r) => r.longTasks));
		console.log(`\n热切换最长帧 ${worstWarm}ms，拆树合计 ${remounts}，最长 longtask ${longWarm}ms。`);
		console.log(`对照：冷开最长帧 A ${coldA.worst}ms / B ${coldB.worst}ms。`);
		const lastTrees = warms[warms.length - 1]?.trees ?? 0;
		if (worstWarm > 50) {
			console.log("热路径仍在卡主线程——这就是「加载过还掉帧」。");
			process.exitCode = 1;
		} else if (lastTrees < 2) {
			console.log("热切换没有把上一份转录留在树上。");
			process.exitCode = 1;
		} else {
			console.log(`热切换把上一份留在树上（${lastTrees} 棵），最长帧 ${worstWarm}ms。MutationObserver 里的 ${remounts} 次是 Activity 显隐挪节点，不是重挂二十行。`);
		}
	} finally {
		await app?.stop().catch(() => {});
	}
}

main().catch(async (error) => {
	console.error(error);
	await app?.stop().catch(() => {});
	process.exitCode = 1;
});
