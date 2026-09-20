/* oxlint-disable no-console -- probe CLI that prints what the real window did */
/**
 * 刚改过的两个地方，在真窗口里各走一遍，边验边录。
 *
 * 两件事都只有真窗口答得了：
 *
 * 一是 API Key 那只眼睛被输入的字盖住。这类「谁盖住谁」的问题，结构断言一条都看不见——DOM 里
 * 两个元素都在、类名也都对，错的是它们各自被画到了哪儿。所以这里量 `getBoundingClientRect`：
 * 输入区的右边缘要停在按钮的左边缘之前。顺带把外层的 `padding-right` 也打印出来——旧写法指望
 * 一条 `pr-10` 给按钮让位，而那条 padding 从未生效过，量出来的 16px 就是它的墓志铭。
 *
 * 二是提交弹窗里那个框。圆角、描边、内衬、以及底下那条本不该有的分隔线，全是画出来才算数的。
 *
 * 用法：node --experimental-strip-types e2e/secret-and-commit-probe.ts [输出目录]
 */

import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { startApp, type RunningApp } from "./app.ts";
import { seedFromReal } from "./session-switch-perf.ts";
import { driver, encode, pause, startRecording, type Frame } from "./record.ts";

/** 视频和截图都落在这里——见 AGENTS.md 的「验证要录一段视频，放到桌面上」。 */
const OUT_DIR = process.argv[2] ?? join(homedir(), "Desktop", "Lyra密钥框与提交框测试");
const STAMP = new Date().toLocaleString("sv-SE", { timeZone: "Asia/Shanghai" }).replace(/[: ]/g, "-").slice(0, 16);
const PORT = 9744;

let app: RunningApp;
const checks: { ok: boolean; what: string; saw: string }[] = [];

function check(what: string, ok: boolean, saw: string): void {
	checks.push({ ok, what, saw });
	console.log(`   ${ok ? "✅" : "❌"} ${what}  ——  ${saw}`);
}

type Box = { x: number; y: number; w: number; h: number; left: number; right: number; top: number; bottom: number };

/** 一个演示用的假 key，长到能铺满整条框——旧布局正是在这种长度下把眼睛埋掉的。 */
const DEMO_KEY = "sk-demo-4f8c1e07a93b5d62h4k8m1n7p3q9r5s2t6v0w8x4y7z1a3b5c9d2e6f8g0h4j7k";

async function seed(home: string): Promise<void> {
	await seedFromReal(home);
	// 窗口自己定尺寸和位置：录出来的画面大小可控，也别正好压在屏幕左上角人手边。
	await writeFile(join(home, "window.json"), JSON.stringify({ width: 1440, height: 940, x: 60, y: 60 }));
}

async function main(): Promise<void> {
	app = await startApp({ port: PORT, seed });
	const ui = driver(app);
	const evaluate = <T,>(expression: string): Promise<T> => app.evaluate<T>(expression);
	const frames: Frame[] = [];
	const stop = await startRecording(PORT, frames);

	/** 拍一张，落在和视频同一个目录里。截图回答「长什么样」，终端的数回答「量出来是多少」。 */
	let shotIndex = 0;
	async function shot(name: string): Promise<void> {
		const file = join(OUT_DIR, `${STAMP}_${String(++shotIndex).padStart(2, "0")}_${name}.png`);
		const { data } = await app.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
		await writeFile(file, Buffer.from(data, "base64"));
		console.log(`   📷 ${file}`);
	}

	/** 往当前焦点里真打字，一段一段来——录像里看得见它长出来。 */
	async function typeText(text: string, chunk = 6): Promise<void> {
		for (let i = 0; i < text.length; i += chunk) {
			await app.send("Input.insertText", { text: text.slice(i, i + chunk) });
			await pause(34);
		}
	}

	try {
		await mkdir(OUT_DIR, { recursive: true });
		await ui.until(`document.querySelectorAll('[data-ly-row]').length > 0`, 60000);
		await pause(2200);

		// ------------------------------------------------------------------
		console.log("\n【一】API Key：那只眼睛要站在字的旁边，不是被字压住");
		// ------------------------------------------------------------------
		await ui.click(".ly-sidebar-foot button");
		await pause(1400);
		const toModels = await evaluate<boolean>(`(() => {
			const nav = [...document.querySelectorAll("nav button")].find((b) => /模型设置|Models/.test((b.innerText || "").trim()));
			if (!nav) return false;
			nav.click();
			return true;
		})()`);
		check("进得了模型设置", toModels, toModels ? "点了侧栏那一项" : "侧栏里没有这一项");
		await ui.until(`document.querySelector('[data-ly-secret-input]')`, 20000);
		await pause(1500);

		// 真的打一把长 key 进去：这条框在被填满之前，两种写法看上去没有区别。
		await ui.click('[data-ly-secret-input]');
		await pause(500);
		await typeText(DEMO_KEY);
		await pause(1100);
		await shot("API_Key_满框的圆点旁边站着眼睛");

		const key = await evaluate<{ field: Box; input: Box; eye: Box; padRight: string; gap: number } | null>(`(() => {
			const eye = document.querySelector('[data-ly-secret-toggle]');
			const input = document.querySelector('[data-ly-secret-input]');
			const field = eye && eye.closest('[data-ly-field]');
			if (!eye || !input || !field) return null;
			const box = (el) => {
				const r = el.getBoundingClientRect();
				return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), bottom: Math.round(r.bottom) };
			};
			const f = box(field), i = box(input), e = box(eye);
			return { field: f, input: i, eye: e, padRight: getComputedStyle(field).paddingRight, gap: e.left - i.right };
		})()`);
		if (!key) {
			check("找得到那一行的三个盒子", false, "找不到输入框或按钮");
		} else {
			check(
				"输入的字停在眼睛左边（不再压住它）",
				key.input.right <= key.eye.left,
				`输入区右边缘 ${key.input.right}px，按钮左边缘 ${key.eye.left}px，中间空 ${key.gap}px`,
			);
			check(
				"眼睛整颗都在框里",
				key.eye.right <= key.field.right && key.eye.left >= key.field.left && key.eye.top >= key.field.top && key.eye.bottom <= key.field.bottom,
				`按钮 ${key.eye.left}–${key.eye.right}px，框 ${key.field.left}–${key.field.right}px`,
			);
			console.log(`   ℹ️  外层实际的 padding-right 是 ${key.padRight}——旧写法指望的那条 pr-10（40px）从来没生效过`);
		}

		// 点一下：从圆点变成看得见的字，再点回去。按钮能点中，本身就是它没被盖住的证据。
		await ui.hover("[data-ly-secret-toggle]");
		await pause(700);
		await ui.click("[data-ly-secret-toggle]");
		await pause(1200);
		const shown = await evaluate<string>(`(() => {
			const el = document.querySelector('[data-ly-secret-input]');
			return el ? el.type : "(没找到)";
		})()`);
		check("点得中，且真的切成明文", shown === "text", `点完之后 input.type = ${shown}`);
		await shot("API_Key_点开之后是明文");
		await pause(1400);
		await ui.click("[data-ly-secret-toggle]");
		await pause(1200);

		// 收工：别把这把演示 key 留在设置里。
		await evaluate(`(() => {
			const el = document.querySelector('[data-ly-secret-input]');
			if (!el) return;
			const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
			setter.call(el, "");
			el.dispatchEvent(new Event("input", { bubbles: true }));
		})()`);
		await pause(600);
		const back = await evaluate<boolean>(`(() => {
			const b = [...document.querySelectorAll("button")].find((el) => /返回工作区|Back to/.test((el.innerText || "").trim()));
			if (!b) return false;
			b.click();
			return true;
		})()`);
		check("回得到工作区", back, back ? "点了左上角那一行" : "找不到返回按钮");
		await pause(2000);

		// ------------------------------------------------------------------
		console.log("\n【二】提交弹窗：一个圆角框，底下不再横一条线");
		// ------------------------------------------------------------------
		const row = await evaluate<boolean>(`(() => {
			const el = document.querySelector('[data-ly-row]');
			if (!el) return false;
			el.scrollIntoView({ block: "center" });
			return true;
		})()`);
		if (row) await ui.click("[data-ly-row]");
		await pause(2600);

		// Git 面板：认 `^Git `，别认 `Git`——侧边栏里带 "GitHub" 的会话标题会排在前面。
		const opened = await evaluate<boolean>(`(() => {
			const b = [...document.querySelectorAll("button")].find((el) => /^Git\\s/.test(el.getAttribute("aria-label") || ""));
			if (!b) return false;
			b.click();
			return true;
		})()`);
		check("打开 Git 面板", opened, opened ? "点了工具条" : "找不到那颗按钮");
		await ui.until(`document.querySelector('[data-dock-pane="review"]')`, 20000);
		await pause(2000);

		/*
		 * 先把面板切回「改动」那一栏。
		 *
		 * 提交入口只长在 `view === "changes"` 里（见 GitPanel 的那段 `{view === "changes" && ...}`），
		 * 而面板记得上一次停在哪儿——跑第二遍时它停在「历史」，探针于是报「找不到提交入口」，
		 * 看上去像入口没了。
		 */
		await evaluate(`(() => {
			const pane = document.querySelector('[data-dock-pane="review"]');
			if (!pane) return;
			const tab = [...pane.querySelectorAll("button")].find((b) => /^(改动|Changes)/.test((b.innerText || "").trim()));
			if (tab) tab.click();
		})()`);
		await pause(1800);

		/*
		 * 等它出现，等不到才报——切完视图那一下 git status 还在读，此刻去查必然是空的。
		 * 第一版就是这么写的，当场报了一条「找不到提交入口」，而两秒后它好好地在那儿。
		 */
		await ui
			.until(`document.querySelector('[data-ly-sync="push"]')`, 25000)
			.then(() => check("找得到提交入口", true, "改动那一栏里的同步区"))
			.catch(async () => {
				const seen = await evaluate<string>(`(() => {
					const pane = document.querySelector('[data-dock-pane="review"]');
					if (!pane) return "(没有 review 面板)";
					return [...pane.querySelectorAll("button")].map((b) => (b.innerText || b.getAttribute("aria-label") || "").trim()).filter(Boolean).join(" / ");
				})()`);
				check("找得到提交入口", false, `面板里只有：${seen}`);
			});
		await ui.click('[data-ly-sync="push"]');
		await ui.until(`document.querySelector('[data-ly-commit-dialog]')`, 15000).catch(() => {});
		await pause(1600);

		const dialog = await evaluate<{
			radius: string;
			border: string;
			padX: string;
			padY: string;
			actionsBorderTop: string;
			shadow: string;
			fieldBox: Box;
			langBox: Box | null;
			hasRule: boolean;
		} | null>(`(() => {
			const field = document.querySelector('[data-ly-commit-field]');
			const text = document.querySelector('[data-ly-commit-message]');
			const dialog = document.querySelector('[data-ly-commit-dialog]');
			if (!field || !text || !dialog) return null;
			const box = (el) => {
				const r = el.getBoundingClientRect();
				return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), bottom: Math.round(r.bottom) };
			};
			const fs = getComputedStyle(field);
			const ts = getComputedStyle(text);
			const rows = [...dialog.querySelectorAll("div")].filter((d) => d.querySelector("button kbd"));
			const actions = rows[rows.length - 1];
			const lang = [...field.querySelectorAll("button")][0];
			// 弹窗里还剩没剩下别的横线：凡是画了上/下边框的块，都算一条。
			const hasRule = [...dialog.querySelectorAll("div")].some((d) => {
				const s = getComputedStyle(d);
				return (parseFloat(s.borderTopWidth) > 0 || parseFloat(s.borderBottomWidth) > 0) && d.getBoundingClientRect().width > 200 && !d.hasAttribute("data-ly-commit-field");
			});
			return {
				radius: fs.borderTopLeftRadius,
				border: fs.borderTopWidth + " " + fs.borderTopStyle,
				padX: ts.paddingLeft,
				padY: ts.paddingTop,
				actionsBorderTop: actions ? getComputedStyle(actions).borderTopWidth : "(没找到动作区)",
				shadow: fs.boxShadow,
				fieldBox: box(field),
				langBox: lang ? box(lang) : null,
				hasRule: hasRule,
			};
		})()`);

		if (!dialog) {
			check("提交弹窗画出来了", false, "找不到弹窗或里面的框");
		} else {
			check("提交信息包在一个圆角框里", dialog.radius === "18px" && dialog.border.startsWith("1px"), `圆角 ${dialog.radius}，描边 ${dialog.border}`);
			/*
			 * 框不带阴影：弹窗自己已经浮着了，里面再浮一层，整个框会从卡片上鼓出来。
			 * 主输入框那两层阴影是它跟页面之间的距离，搬进浮层就没有对应的东西了。
			 */
			check("框没有阴影（不从弹窗里鼓出来）", dialog.shadow === "none", `box-shadow = ${dialog.shadow}`);
			check("框里的字有内衬（和聊天输入框同一组数）", dialog.padX === "16px" && dialog.padY === "12px", `左右 ${dialog.padX}，上下 ${dialog.padY}`);
			check("动作那三行上面没有分隔线", dialog.actionsBorderTop === "0px", `border-top = ${dialog.actionsBorderTop}`);
			check("弹窗里再没有别的横线", !dialog.hasRule, dialog.hasRule ? "还有一条宽过 200px 的横线" : "一条都没有");
			check(
				"语言那颗小按钮落在框里面",
				Boolean(dialog.langBox) &&
					dialog.langBox!.left >= dialog.fieldBox.left &&
					dialog.langBox!.right <= dialog.fieldBox.right &&
					dialog.langBox!.bottom <= dialog.fieldBox.bottom,
				dialog.langBox ? `按钮 ${dialog.langBox.top}–${dialog.langBox.bottom}px，框 ${dialog.fieldBox.top}–${dialog.fieldBox.bottom}px` : "（没找到那颗按钮）",
			);
		}

		await shot("提交弹窗_空框_语言按钮在框里");

		// 聚焦：描边该跟着加深，和聊天输入框是同一段 CSS。
		const before = await evaluate<string>(`getComputedStyle(document.querySelector('[data-ly-commit-field]')).borderTopColor`);
		await ui.click("[data-ly-commit-message]");
		await pause(900);
		const after = await evaluate<string>(`getComputedStyle(document.querySelector('[data-ly-commit-field]')).borderTopColor`);
		check("打字时描边会加深（focus-within）", before !== after, `${before} → ${after}`);

		/*
		 * 打字之前先把框清空。
		 *
		 * 这个窗口跑起来是抢焦点的，而跑完一趟要三分钟——人在这期间碰一下键盘，那个字符就落进了
		 * 这个框里。上一趟录出来的图，提交信息开头平白多了一个半角逗号，看上去像是产品在乱加字符。
		 */
		await evaluate(`(() => {
			const el = document.querySelector('[data-ly-commit-message]');
			if (!el) return;
			const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
			setter.call(el, "");
			el.dispatchEvent(new Event("input", { bubbles: true }));
		})()`);
		await pause(400);

		// 真打一句，让录像看得见它在框里怎么走行。
		const heightBefore = await evaluate<number>(`Math.round(document.querySelector('[data-ly-commit-field]').getBoundingClientRect().height)`);
		await typeText("fix(desktop): 密钥框让出位置，提交框画成圆角", 4);
		await pause(1800);

		/*
		 * 打了字之后，语言那颗按钮还得在，框也不该矮一截。
		 *
		 * 从前它挂在「这一次会自动生成」上：第一个字落下去整行就消失，框跟着缩——人正打着字，
		 * 脚下的东西动了，而且看上去像是那个功能被删掉了。
		 */
		const afterTyping = await evaluate<{ lang: boolean; height: number }>(`(() => ({
			lang: Boolean(document.querySelector('[data-ly-commit-language]')),
			height: Math.round(document.querySelector('[data-ly-commit-field]').getBoundingClientRect().height),
		}))()`);
		check("打了字，语言切换还在", afterTyping.lang, afterTyping.lang ? "按钮还在框里" : "它不见了");
		check("打字不会让框矮一截", afterTyping.height === heightBefore, `空框 ${heightBefore}px → 有字 ${afterTyping.height}px`);
		await shot("提交弹窗_打了字_语言按钮还在");

		// 收回：留一个空框给下一次，别把这句话真的提交了。
		await evaluate(`(() => {
			const el = document.querySelector('[data-ly-commit-message]');
			if (!el) return;
			const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
			setter.call(el, "");
			el.dispatchEvent(new Event("input", { bubbles: true }));
		})()`);
		await pause(1500);
		await evaluate(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`);
		await pause(1200);
	} finally {
		await stop();
		const passed = checks.filter((c) => c.ok).length;
		const out = join(OUT_DIR, `${STAMP}_密钥框与提交框_${passed}of${checks.length}.mp4`);
		await app?.stop().catch(() => {});
		if (frames.length > 0) await encode(frames, out, 60, 1200);
		console.log(`\n${passed}/${checks.length} 项通过`);
		console.log(frames.length > 0 ? `视频：${out}` : "没有采到帧，视频没生成");
		console.log(`截图：${shotIndex} 张，和视频同一个目录`);
		if (passed !== checks.length) process.exitCode = 1;
	}
}

main().catch((error: unknown) => {
	console.error(error);
	process.exitCode = 1;
});
