/* oxlint-disable no-console -- probe CLI that prints what the real window did */
/**
 * 下拉菜单弹出来的那几帧，它自己动不动。
 *
 * 一个菜单该做的是「出现在它该在的地方，然后淡进来」。跳动是它先落在一处、量完自己再挪到
 * 另一处——位置是算出来的，而算之前得先知道自己多大，于是第一帧画在默认位置，第二帧才归位。
 * 人眼看见的就是闪一下。
 *
 * 判据：逐帧记菜单的左上角和尺寸。
 *
 *   - 位置在进场动画之外还变过 → 先落错地方再挪（要修的那种）
 *   - 尺寸在第一帧之后还变过 → 内容后到，把菜单撑开了（也要修）
 *   - 只有 opacity / transform 在动 → 正常进场
 *
 * 位移要和进场动画区分开：进场那几 px 走的是 transform，不改 `getBoundingClientRect` 之外的
 * 布局；这里同时读 `offsetTop/offsetLeft`（不含 transform），两条对照就分得开。
 *
 * 用法：node --experimental-strip-types e2e/menu-jump-probe.ts
 */

import { startApp, type RunningApp } from "./app.ts";
import { seedFromReal } from "./session-switch-perf.ts";

const PORT = 9705;
let app: RunningApp;

function evaluate<T>(expression: string): Promise<T> {
	return app.evaluate<T>(expression);
}

async function until(expression: string, ms = 30000): Promise<void> {
	await evaluate(
		`new Promise((resolve,reject)=>{const end=performance.now()+${ms};function tick(){if(${expression})resolve();else if(performance.now()>end)reject(Error(${JSON.stringify(expression)}));else requestAnimationFrame(tick)}tick()})`,
	);
}

/*
 * 菜单是点开之后才出现的，所以不能先抓元素——每帧找当前最上面那一层浮层。
 *
 * 同时记 `offsetTop/Left`（布局位置，不含 transform）和 `getBoundingClientRect`（画出来的
 * 位置，含 transform）。前者变过就是真的挪了窝，后者单独变是进场动画在走。
 */
const TRACK = `(() => {
	const out = { frames: [], done: false };
	window.__menu = out;
	const pick = () => {
		const all = [...document.querySelectorAll('[role="menu"], [role="listbox"], [data-ly-popover], [data-radix-popper-content-wrapper]')];
		return all.length ? all[all.length - 1] : null;
	};
	const tick = () => {
		const el = pick();
		if (el) {
			const r = el.getBoundingClientRect();
			out.frames.push({
				ot: el.offsetTop, ol: el.offsetLeft,
				/*
				 * 尺寸用 offsetWidth/Height，不用 getBoundingClientRect。
				 *
				 * 后者含 transform，而菜单是 scale(0.95) 缩放进场的——量出来是一条
				 * 258→265→269→271→272 的缓动曲线，看着像「菜单自己长大了 14px」，其实屏幕上
				 * 正在播的就是进场动画。布局尺寸从头到尾没变过。
				 */
				w: el.offsetWidth, h: el.offsetHeight,
				pw: Math.round(r.width), ph: Math.round(r.height),
				x: Math.round(r.left * 10) / 10, y: Math.round(r.top * 10) / 10,
			});
		}
		if (!out.done) requestAnimationFrame(tick);
	};
	requestAnimationFrame(tick);
	return true;
})()`;

interface Frame { ot: number; ol: number; w: number; h: number; pw: number; ph: number; x: number; y: number }

function spread(values: number[]): number {
	if (values.length < 2) return 0;
	return Math.max(...values) - Math.min(...values);
}

async function openAndWatch(find: string, label: string): Promise<void> {
	const at = await evaluate<{ x: number; y: number } | null>(`(() => { ${find} })()`);
	if (!at) {
		console.log(`\n### ${label}\n  找不到这个入口`);
		return;
	}
	await evaluate(TRACK);
	await new Promise((r) => setTimeout(r, 80));
	for (const type of ["mousePressed", "mouseReleased"] as const) {
		await app.send("Input.dispatchMouseEvent", { type, x: at.x, y: at.y, button: "left", clickCount: 1 });
	}
	await new Promise((r) => setTimeout(r, 900));
	await evaluate(`(() => { if (window.__menu) window.__menu.done = true; return true; })()`);
	const shot = await evaluate<{ frames: Frame[] }>(`(() => ({ frames: window.__menu.frames }))()`);
	const f = shot.frames;
	if (!f.length) {
		console.log(`\n### ${label}\n  没弹出菜单（或者选择器认不出它）`);
		return;
	}
	const movedLayout = Math.max(spread(f.map((v) => v.ot)), spread(f.map((v) => v.ol)));
	const movedPainted = Math.max(spread(f.map((v) => v.x)), spread(f.map((v) => v.y)));
	const resized = Math.max(spread(f.map((v) => v.w)), spread(f.map((v) => v.h)));
	console.log(`\n### ${label}`);
	console.log(`  记了 ${f.length} 帧，布局尺寸 ${f[0]?.w}×${f[0]?.h} → ${f[f.length - 1]?.w}×${f[f.length - 1]?.h}（画出来 ${f[0]?.pw}×${f[0]?.ph} → ${f[f.length - 1]?.pw}×${f[f.length - 1]?.ph}，含缩放进场）`);
	console.log(`  布局位置动了 ${movedLayout}px（不含 transform）`);
	console.log(`  画出来动了   ${movedPainted.toFixed(1)}px（含进场动画）`);
	console.log(`  尺寸动了     ${resized}px`);
	const bad: string[] = [];
	if (movedLayout > 2) bad.push(`先落在一处又挪了 ${movedLayout}px`);
	if (resized > 2) bad.push(`布局尺寸变了 ${resized}px——内容后到把菜单撑开了`);
	console.log(`  判定：${bad.length ? `❌ ${bad.join("；")}` : "✅ 一次定位，只有进场在动"}`);
	/*
	 * 尺寸是在第几帧变的——这一条决定要不要修。
	 *
	 * 变在第 1→2 帧之间，那多半是 React 两次 render 都落在同一次绘制之前，屏幕上从来没出现过
	 * 小的那一版，人眼看不见。变在更后面才是真跳。别把没画出来的中间态当 bug 修。
	 */
	const first = f[0];
	if (first) {
		const at = f.findIndex((v) => v.w !== first.w || v.h !== first.h);
		console.log(`  尺寸第 ${at < 0 ? "-" : at} 帧才变（${f.slice(0, 5).map((v) => v.w + "x" + v.h).join(" → ")}）`);
	}
	// 关掉，免得挡住下一个
	await app.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
	await app.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
	await new Promise((r) => setTimeout(r, 400));
}

/*
 * 按 aria-label 认，不按显示的字。
 *
 * 模型那颗按钮上写的是「选择模型」，不是模型名；而转录正文里到处都是模型名——按文字找会点到
 * 一条消息里去，然后探针报「没弹出菜单」，听起来像菜单坏了。
 */
const BY_LABEL = (re: string) => `
	const dock = document.querySelector('[data-dock-pane="conversation"]') || document;
	const b = [...dock.querySelectorAll('button')].find((el) => new RegExp(${JSON.stringify(re)}).test(el.getAttribute('aria-label') || ''));
	if (!b) return null;
	const r = b.getBoundingClientRect();
	if (r.width === 0) return null;
	return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
`;

async function main(): Promise<void> {
	app = await startApp({ port: PORT, seed: seedFromReal });
	try {
		await until(`document.querySelectorAll('[data-ly-row]').length > 0`, 40000);
		const row = await evaluate<{ x: number; y: number } | null>(`(() => {
			const r0 = document.querySelector('[data-ly-row]');
			if (!r0) return null;
			const r = r0.getBoundingClientRect();
			return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
		})()`);
		if (row) {
			for (const type of ["mousePressed", "mouseReleased"] as const) {
				await app.send("Input.dispatchMouseEvent", { type, x: row.x, y: row.y, button: "left", clickCount: 1 });
			}
			await new Promise((r) => setTimeout(r, 1200));
		}

		// 输入框上那一排：模型、思考档位、访问权限。都是点一下弹一层的。
		await openAndWatch(BY_LABEL("选择模型|Choose model|Select model"), "模型选择器");
		await openAndWatch(BY_LABEL("推理强度|思考|Reasoning|Thinking"), "思考档位");
		await openAndWatch(BY_LABEL("完全访问|只读|Full access|Read only"), "访问权限");
		await openAndWatch(BY_LABEL("添加附件|Attach"), "附件菜单");
	} finally {
		await app?.stop().catch(() => {});
	}
}

main().catch(async (error) => {
	console.error(error);
	await app?.stop().catch(() => {});
	process.exitCode = 1;
});
