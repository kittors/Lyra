/* oxlint-disable no-console -- probe CLI that prints what the real window did */
/**
 * 摸底：跑那 16 个场景之前，先把每个动作的入口找出来。
 *
 * 场景矩阵在 `docs/architecture/split-window-conflicts.md`。要跑它们得先能驱动：拖面板靠哪个
 * 把手、调大小拖哪条分隔线、弹出和收回的按钮长什么样、关掉分屏里一屏点哪、开新窗口在哪。
 *
 * 一次摸完再写精确探针，比一边猜选择器一边跑要省好几轮——前面已经为「按文案找按钮」和
 * 「菜单项藏在子菜单里」各返工过一次。
 *
 * 用法：node --experimental-strip-types e2e/split-entries-probe.ts
 */

import { startApp, type RunningApp } from "./app.ts";
import { seedFromReal } from "./session-switch-perf.ts";

const PORT = 9710;
let app: RunningApp;

function evaluate<T>(expression: string): Promise<T> {
	return app.evaluate<T>(expression);
}

async function until(expression: string, ms = 30000): Promise<void> {
	await evaluate(
		`new Promise((resolve,reject)=>{const end=performance.now()+${ms};function tick(){if(${expression})resolve();else if(performance.now()>end)reject(Error(${JSON.stringify(expression)}));else requestAnimationFrame(tick)}tick()})`,
	);
}

/** 把一类元素连同它的标识属性印出来，用来挑选择器。 */
async function inventory(label: string, selector: string, attrs: string[]): Promise<void> {
	const rows = await evaluate<string[]>(`(() => {
		const want = ${JSON.stringify(attrs)};
		return [...document.querySelectorAll(${JSON.stringify(selector)})].slice(0, 20).map((el) => {
			const bits = [el.tagName.toLowerCase()];
			for (const a of want) { const v = el.getAttribute(a); if (v !== null) bits.push(a + "=" + JSON.stringify(v.slice(0, 26))); }
			const text = (el.innerText || "").trim().replace(/\\s+/g, " ").slice(0, 18);
			if (text) bits.push("text=" + JSON.stringify(text));
			const r = el.getBoundingClientRect();
			bits.push(Math.round(r.width) + "x" + Math.round(r.height));
			return bits.join(" ");
		});
	})()`);
	console.log(`\n### ${label}  (${selector})`);
	console.log(rows.length ? rows.map((r) => "  " + r).join("\n") : "  （没有）");
}

async function openFirstRow(): Promise<void> {
	const at = await evaluate<{ x: number; y: number } | null>(`(() => {
		const row = document.querySelector('[data-ly-row]');
		if (!row) return null;
		row.scrollIntoView({ block: 'center' });
		const r = row.getBoundingClientRect();
		return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
	})()`);
	if (!at) return;
	for (const type of ["mousePressed", "mouseReleased"] as const) {
		await app.send("Input.dispatchMouseEvent", { type, x: at.x, y: at.y, button: "left", clickCount: 1 });
	}
	await until(`document.querySelector('[data-dock-pane="conversation"]') !== null`, 20000).catch(() => {});
	await new Promise((r) => setTimeout(r, 900));
}

/** 右键第 n 行 →「打开方式」→ 点某一项。 */
async function rowMenu(index: number, item: string): Promise<string> {
	return evaluate<string>(`(async () => {
		const row = document.querySelectorAll('[data-ly-row]')[${index}];
		if (!row) return 'no row';
		const r = row.getBoundingClientRect();
		row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: Math.round(r.left + 40), clientY: Math.round(r.top + r.height / 2) }));
		await new Promise((res) => setTimeout(res, 400));
		const open = [...document.querySelectorAll('[role="menuitem"], [data-ly-popover] button')].find((el) => /打开方式/.test(el.innerText || ''));
		if (!open) return 'no submenu';
		open.click();
		await new Promise((res) => setTimeout(res, 400));
		const hit = [...document.querySelectorAll('[role="menuitem"], [data-ly-popover] button')].find((el) => (el.innerText || '').trim() === ${JSON.stringify(item)});
		if (!hit) return 'no item: ' + ${JSON.stringify(item)};
		hit.click();
		return 'clicked';
	})()`);
}

async function main(): Promise<void> {
	app = await startApp({ port: PORT, seed: seedFromReal });
	try {
		await until(`document.querySelectorAll('[data-ly-row]').length > 0`, 40000);
		await new Promise((r) => setTimeout(r, 600));
		await openFirstRow();

		console.log("=========== 单屏 ===========");
		await inventory("dock 面板", "[data-dock-pane]", ["data-dock-pane"]);
		await inventory("拖动把手", "[data-dock-grip]", ["data-dock-grip"]);
		await inventory("分隔线", "[data-dock-splitter], [data-ly-splitter], [role='separator']", ["data-dock-splitter", "data-ly-splitter", "aria-orientation"]);
		await inventory("面板头上的按钮", "[data-dock-pane] header button, [data-dock-pane] [data-pane-header] button", ["aria-label", "data-ly-tip"]);

		// 开一个浏览器面板，看它的头部有什么控件（弹出、关闭、最大化）
		await evaluate(`(() => {
			const b = [...document.querySelectorAll('button')].find((el) => /浏览器/.test(el.getAttribute('aria-label') || ''));
			if (b) b.click();
			return true;
		})()`);
		await new Promise((r) => setTimeout(r, 1000));
		console.log("\n=========== 开了浏览器面板 ===========");
		await inventory("dock 面板", "[data-dock-pane]", ["data-dock-pane"]);
		await inventory("拖动把手", "[data-dock-grip]", ["data-dock-grip"]);
		await inventory("分隔线", "[data-dock-splitter], [data-ly-splitter], [role='separator']", ["data-dock-splitter", "data-ly-splitter", "aria-orientation"]);
		await inventory("浏览器面板里的按钮", "[data-dock-pane='browser'] button", ["aria-label", "data-ly-tip"]);

		// 分屏
		console.log(`\n分屏：${await rowMenu(1, "分屏")}`);
		await new Promise((r) => setTimeout(r, 1500));
		console.log("\n=========== 分屏之后 ===========");
		await inventory("分屏 tile", "[data-ly-split-pane]", ["data-ly-split-pane", "data-focused"]);
		await inventory("tile 标题栏的按钮", "[data-ly-split-pane] header button", ["aria-label", "data-ly-tip"]);
		await inventory("分隔线", "[data-dock-splitter], [data-ly-splitter], [role='separator']", ["data-dock-splitter", "data-ly-splitter", "aria-orientation"]);
		await inventory("拖动把手", "[data-dock-grip]", ["data-dock-grip"]);

		// 新窗口
		console.log(`\n新窗口：${await rowMenu(2, "新窗口")}`);
		await new Promise((r) => setTimeout(r, 2000));
		const windows = await evaluate<number>(`1`);
		void windows;
		console.log("（新窗口是另一个渲染进程，这个探针看不到它的 DOM；数量要问主进程）");
	} finally {
		await app?.stop().catch(() => {});
	}
}

main().catch(async (error) => {
	console.error(error);
	await app?.stop().catch(() => {});
	process.exitCode = 1;
});
