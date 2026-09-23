/**
 * 一个文件的用例共用一扇窗时，每条之后收的尾。
 *
 * 前一条留下的界面就是后一条的起点——这些文件是刻意这么写的，省下每条重开一个 Electron 的那几秒。
 * 代价是一条红了没收尾，它开着的弹窗连同遮罩盖住整扇窗，后面每一条的点击都落在遮罩上，报的却是
 * 「目标没有变得可见且稳定」，跟它们要测的东西毫无关系。windows-ui 上发版中心的 ✕ 被统一外壳拿掉
 * 之后，一条找不到按钮，就这样连带红了后面四条，而日志里看不出它们是被谁压住的。
 *
 * 所以每条之后：失败的先把现场拍下来、把还开着的弹窗和焦点记进诊断；然后不论成败，还开着的弹窗
 * 一层层按 Escape 关掉，等它真的从 DOM 里消失。通过的用例都自己关好了弹窗，对它们这是一次空查。
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { TestContext } from "node:test";
import type { RunningApp } from "./app.ts";

/**
 * 等正在退场的弹窗走完，再报还开着几层。
 *
 * 正在退场的（`ly-dialog-out`）不按 Escape：它已经答应关了，只差一次 `animationend`。那一下 Escape
 * 没有弹窗接，就会落到窗口别的快捷键上——设置页、全屏的面板都认 Escape。至少等两帧再看，让刚按下
 * 的那次 Escape 先把退场的样式挂上去。
 */
const SETTLED = `new Promise((resolve) => {
	const deadline = performance.now() + 3000;
	let frames = 0;
	const step = () => {
		const modals = [...document.querySelectorAll('[data-ly-modal]')];
		const leaving = modals.filter((modal) => modal.classList.contains('ly-dialog-out')).length;
		if (++frames > 2 && (!leaving || performance.now() > deadline)) resolve({ open: modals.length - leaving, leaving });
		else requestAnimationFrame(step);
	};
	requestAnimationFrame(step);
})`;

/** 还开着的弹窗，一层一层关掉。关不掉的留在诊断里，下一条的点击报错会说出是谁挡着它。 */
async function closeLeftoverDialogs(app: RunningApp, context: TestContext): Promise<void> {
	let state = await app.evaluate<{ open: number; leaving: number }>(SETTLED);
	for (let attempt = 0; state.open > 0 && attempt < 6; attempt++) {
		for (const type of ["keyDown", "keyUp"]) {
			await app.send("Input.dispatchKeyEvent", { type, key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
		}
		state = await app.evaluate<{ open: number; leaving: number }>(SETTLED);
	}
	if (state.open > 0 || state.leaving > 0) {
		context.diagnostic(`shared window: ${state.open} dialog(s) still open and ${state.leaving} still leaving after Escape`);
	}
}

let failures = 0;

/** `name` 进截图的文件名；同一个文件里红几条就留几张，带序号，中文用例名也不互相覆盖。 */
async function recordFailure(app: RunningApp, context: TestContext, name: string): Promise<void> {
	const directory = process.env.LYRA_E2E_ARTIFACTS;
	failures += 1;
	if (directory) {
		await mkdir(directory, { recursive: true });
		const slug = context.name.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").slice(0, 60).toLowerCase();
		const shot = await app.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
		await writeFile(join(directory, `${name}-failure-${failures}${slug ? `-${slug}` : ""}.png`), Buffer.from(shot.data, "base64"));
	}
	context.diagnostic(await app.evaluate<string>(`JSON.stringify({
		dialogs: [...document.querySelectorAll('[data-ly-modal]')].map((modal) => ({
			title: modal.querySelector('[data-dialog-title]')?.textContent?.trim() ?? null,
			leaving: modal.classList.contains('ly-dialog-out'),
		})),
		active: document.activeElement?.outerHTML.slice(0, 200) ?? null,
		body: document.body.innerText.slice(-1500),
	})`));
}

/**
 * `afterEach(async (context) => settleSharedWindow(app, context as TestContext, "文件名"))`。
 *
 * `passed` 是 Node 21.7 起就有的真字段，只是 `@types/node` 还没写进 `TestContext`。
 */
export async function settleSharedWindow(app: RunningApp | undefined, context: TestContext, name: string): Promise<void> {
	if (!app) return;
	if (!(context as TestContext & { passed?: boolean }).passed) {
		try {
			await recordFailure(app, context, name);
		} catch (error) {
			context.diagnostic(`shared window: could not record the failure: ${String(error)}`);
		}
	}
	try {
		await closeLeftoverDialogs(app, context);
	} catch (error) {
		context.diagnostic(`shared window: could not close leftover dialogs: ${String(error)}`);
	}
}
