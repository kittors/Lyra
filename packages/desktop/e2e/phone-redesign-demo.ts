/* oxlint-disable no-console -- probe CLI that prints what the phone did */
/**
 * The phone's own frame, walked through on the real phone renderer — checked as it goes, recorded.
 *
 * Covers what the component tests cannot: the status bar and the home indicator as the native shell
 * reports them (`shell-insets.ts`), real touches through `Input.dispatchTouchEvent`, the sheets'
 * entrances and the page pushes as they play, the left-edge swipe following the finger, and the
 * back button's layer count read the way the shell reads it. See ADR-0042.
 *
 * 用法：node --experimental-strip-types e2e/phone-redesign-demo.ts [输出目录]
 */

import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { insetScript } from "../../mobile/src/shell-insets.ts";
import { bootPhone, DEVICES } from "./phone-fixture.ts";
import { encode, frameGrabber, type Frame } from "./record.ts";

const OUT = process.argv[2] ?? join(homedir(), "Desktop", "Lyra手机界面测试");
const STAMP = new Date().toLocaleString("sv-SE", { timeZone: "Asia/Shanghai" }).replace(/[: ]/g, "-").slice(0, 16);
const SCREEN = DEVICES.android;
const PHONE_PORT = 9949;

const checks: { ok: boolean; what: string }[] = [];
function check(what: string, ok: boolean, saw: unknown = "") {
	checks.push({ ok, what });
	console.log(`   ${ok ? "✅" : "❌"} ${what}${ok ? "" : `  —— 看到的是：${JSON.stringify(saw)}`}`);
}
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** What Android's back button counts: the bridge's `layerDepth`, verbatim. */
const LAYERS = `(() => { let depth = 0; for (const el of document.querySelectorAll('[data-pane="drawer"]')) if (!el.hasAttribute("inert")) depth++; for (const el of document.querySelectorAll('[aria-modal="true"]')) if (!el.hasAttribute("inert") && !el.hasAttribute("data-pane")) depth++; return depth; })()`;

/** Every control on screen that a thumb could reach, and whether any of them is under the phone's chrome. */
const CHROME = `(() => {
	const style = getComputedStyle(document.documentElement);
	const top = parseFloat(style.getPropertyValue("--ly-safe-top")) || 0;
	const bottom = parseFloat(style.getPropertyValue("--ly-safe-bottom")) || 0;
	const under = [...document.querySelectorAll("button, textarea, input, [role=button]")]
		.filter((el) => el.checkVisibility({ visibilityProperty: true, opacityProperty: true }) && !el.closest("[inert]"))
		.map((el) => ({ el, r: el.getBoundingClientRect() }))
		.filter(({ r }) => r.width > 0 && r.height > 0 && r.right > 0 && r.left < innerWidth && r.bottom > 0 && r.top < innerHeight)
		// The bottom edge is the fixed chrome's to keep clear of; a page's content scrolls under the home indicator.
		.filter(({ el, r }) => r.top < top - 0.5 || (r.bottom > innerHeight - bottom + 0.5 && !el.closest(".ly-scroll-view")))
		.map(({ el, r }) => (el.getAttribute("aria-label") || el.textContent || el.tagName).trim().slice(0, 20) + "@" + Math.round(r.top));
	return { top, bottom, under };
})()`;

async function main() {
	await mkdir(OUT, { recursive: true });
	const booted = await bootPhone({ desktopPort: 9945, phonePort: PHONE_PORT, syncPort: 4813, token: "phone-redesign-demo-token", theme: "dark" });
	const frames: Frame[] = [];
	// An object rather than a `let`: the loop below reads it while the steps after it change it.
	const recording = { on: true };
	let g: Awaited<ReturnType<typeof frameGrabber>> | undefined;
	try {
		await appendFile(join(booted.desktop.home, `phone-${PHONE_PORT}.cjs`), `\n${insetScript(SCREEN.insets)}\n`);
		await booted.phone.evaluate("location.reload()").catch(() => {});
		for (let i = 0; i < 300; i++) {
			if (await booted.phone.evaluate<boolean>("!!document.querySelector('.ly-shell') && !!document.querySelector('main textarea')").catch(() => false)) break;
			await sleep(100);
		}
		g = await frameGrabber(PHONE_PORT);
		const grab = g;
		await grab.send("Emulation.setDeviceMetricsOverride", { width: SCREEN.width, height: SCREEN.height, deviceScaleFactor: 2, mobile: true });
		await grab.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
		await sleep(800);

		// Frames for the video, each taken when it is drawn — `captureScreenshot` draws one even when covered.
		const recorder = (async () => {
			while (recording.on) {
				const data = await grab.shot().catch(() => null);
				if (data) frames.push({ at: Date.now(), data });
			}
		})();

		const evaluate = <T,>(expression: string) => grab.evaluate<T>(expression);
		const point = async (selector: string, index = 0) => {
			const p = await evaluate<{ x: number; y: number } | null>(`(() => { const el = [...document.querySelectorAll(${JSON.stringify(selector)})].filter((e) => { if (!e.checkVisibility({ visibilityProperty: true }) || e.closest("[inert]")) return false; const r = e.getBoundingClientRect(); const x = r.x + r.width / 2, y = r.y + r.height / 2; return x >= 0 && y >= 0 && x <= innerWidth && y <= innerHeight; })[${index}]; if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
			if (!p) throw new Error(`nothing to tap: ${selector} [${index}]`);
			return p;
		};
		const tap = async (selector: string, index = 0) => {
			const p = await point(selector, index);
			await grab.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [p] });
			await sleep(70);
			await grab.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
		};
		const swipe = async (from: { x: number; y: number }, to: { x: number; y: number }, steps = 18, gap = 18) => {
			await grab.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [from] });
			for (let i = 1; i <= steps; i++) {
				await sleep(gap);
				await grab.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps }] });
			}
			await sleep(gap);
			await grab.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
		};
		const back = () => evaluate("window.__lyraBack()");
		const layers = () => evaluate<number>(LAYERS);
		const shot = async (name: string) => {
			await sleep(750);
			const { data } = await grab.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
			await writeFile(join(OUT, `${STAMP}_${name}.png`), Buffer.from(data, "base64"));
		};
		const clear = async (where: string) => {
			const chrome = await evaluate<{ top: number; bottom: number; under: string[] }>(CHROME);
			check(`${where}：没有控件压在状态栏（${chrome.top}pt）或底部横条（${chrome.bottom}pt）下面`, chrome.under.length === 0, chrome.under);
		};

		console.log("\n1. 新对话");
		await sleep(900);
		const bar = await evaluate<string[]>(`[...document.querySelectorAll("[data-ly-phone-bar] button")].map((b) => b.getAttribute("aria-label"))`);
		check("顶栏：左边开会话列表，新对话本身不再有「新对话」按钮", JSON.stringify(bar) === JSON.stringify(["打开会话列表"]), bar);
		const starts = await evaluate<number>(`document.querySelectorAll(".ly-phone-hero .ly-phone-start").length`);
		check("四个起点两两一排，和问题在一组里", starts === 4, starts);
		// The queue's button waits in an inert slot of no width until a turn is running.
		const row = await evaluate<string[]>(`[...document.querySelector(".ly-composer-bar").querySelectorAll("button")].filter((b) => b.checkVisibility() && !b.closest("[inert]") && getComputedStyle(b).opacity !== "0" && b.getBoundingClientRect().width > 0).map((b) => (b.getAttribute("aria-label") || "").split(" · ")[0])`);
		check("输入框一行三样：附件、模型、发送", JSON.stringify(row) === JSON.stringify(["添加附件文件或图片", "选择模型", "发送"]), row);
		const framed = await evaluate<string>(`getComputedStyle(document.querySelector(".ly-dock-card")).borderTopWidth`);
		check("整屏没有桌面窗口的那圈描边", framed === "0px", framed);
		await clear("新对话");
		await shot("01_新对话");

		console.log("\n2. 模型的弹层");
		await tap("main textarea");
		await grab.send("Input.insertText", { text: "帮我看下手机上的顶栏为什么压在状态栏下面" });
		await sleep(600);
		await tap('button[aria-label^="选择模型"]');
		await sleep(700);
		check("从底边升起，算一层", (await layers()) === 1 && (await evaluate<boolean>(`!!document.querySelector(".ly-menu-sheet[aria-modal=true]")`)));
		await tap(".ly-phone-option", 3);
		await sleep(500);
		const effort = await evaluate<string>(`document.querySelector(".ly-phone-option[aria-checked=true]")?.textContent ?? ""`);
		check("推理强度一排选项，点「高」就是高", effort === "高", effort);
		const sheetText = await evaluate<string>(`document.querySelector(".ly-menu-sheet")?.textContent ?? ""`);
		check("没有通往手机上不存在的那一页的入口（管理供应商与模型）", !sheetText.includes("管理供应商与模型"), sheetText.slice(-40));
		await shot("02_模型弹层");
		const permission = await evaluate<number>(`[...document.querySelectorAll("[role=menuitem]")].filter((e) => e.checkVisibility()).findIndex((e) => e.textContent.includes("权限模式"))`);
		await tap("[role=menuitem]", permission);
		await sleep(800);
		check("权限模式叠一层在上面", (await layers()) === 2, await layers());
		await shot("03_权限叠层");
		await back();
		await sleep(600);
		check("返回键关掉上面那一层", (await layers()) === 1, await layers());
		await swipe({ x: 200, y: 560 }, { x: 205, y: 860 }, 12, 16);
		await sleep(700);
		check("往下拉，弹层收起", (await layers()) === 0, await layers());

		console.log("\n3. 发出去，回复");
		await tap('button[aria-label="发送"]');
		await sleep(3500);
		const title = await evaluate<string>(`document.querySelector("[data-ly-phone-bar] .ly-phone-bar-label")?.textContent ?? ""`);
		check("有了名字，顶栏中间是它，点它是会话的弹层", title.length > 0, title);
		await clear("会话");
		await shot("04_会话");

		console.log("\n4. 会话的弹层，进一个面板");
		await tap(".ly-phone-bar-title");
		await sleep(800);
		const tiles = await evaluate<string[]>(`[...document.querySelectorAll(".ly-phone-panel-label")].map((e) => e.textContent)`);
		check("面板在第一排，带着名字", tiles.includes("任务") && tiles.includes("侧边聊天"), tiles);
		const strip = await evaluate<{ fit: boolean; lines: number }>(`(() => { const r = document.querySelector(".ly-phone-panels"); const lines = Math.max(...[...r.querySelectorAll(".ly-phone-panel-label")].map((l) => Math.round(l.getBoundingClientRect().height / parseFloat(getComputedStyle(l).lineHeight)))); return { fit: r.scrollWidth <= r.clientWidth, lines }; })()`);
		check("六个面板一排放下，没有一个藏在右边，名字都是一行", tiles.length === 6 && strip.fit && strip.lines === 1, { tiles, ...strip });
		await shot("05_会话弹层");
		await tap(".ly-phone-panel", tiles.indexOf("任务"));
		await sleep(900);
		const front = await evaluate<string>(`[...document.querySelectorAll(".ly-dock-pane")].filter((p) => !p.hasAttribute("inert")).map((p) => p.dataset.pane).join(",")`);
		check("任务推进来，占满这一屏", front === "tasks", front);
		check("推进来的一页算一层", (await layers()) === 1, await layers());
		await clear("任务页");
		await shot("06_任务页");

		console.log("\n5. 从左边缘右滑回去");
		await swipe({ x: 6, y: 420 }, { x: 70, y: 424 }, 10, 40);
		await sleep(700);
		check("拖一点就松手：留在这一页", (await evaluate<string>(`[...document.querySelectorAll(".ly-dock-pane")].filter((p) => !p.hasAttribute("inert")).map((p) => p.dataset.pane).join(",")`)) === "tasks");
		await swipe({ x: 6, y: 420 }, { x: 330, y: 426 }, 18, 22);
		await sleep(800);
		const after = await evaluate<string>(`[...document.querySelectorAll(".ly-dock-pane")].filter((p) => !p.hasAttribute("inert")).map((p) => p.dataset.pane).join(",")`);
		check("拖过去：回到会话，抽屉没被拉出来", after === "conversation" && (await layers()) === 0, after);

		console.log("\n6. 抽屉与设置");
		await swipe({ x: 6, y: 420 }, { x: 300, y: 426 }, 14, 20);
		await sleep(700);
		check("在会话上右滑：拉出抽屉", (await layers()) === 1);
		await shot("07_抽屉");
		await tap('button[aria-label="设置"]');
		await sleep(1000);
		check("设置：大标题下的一张列表", (await evaluate<string>(`document.querySelector(".ly-phone-large-title")?.textContent ?? ""`)) === "设置");
		await clear("设置");
		await shot("08_设置");
		await tap(".ly-phone-group-row", 1);
		await sleep(900);
		check("推入一页，左上「‹ 设置」", (await evaluate<string>(`document.querySelector(".ly-phone-back")?.textContent ?? ""`)) === "设置");
		await clear("设置页");
		await shot("09_设置页");
		await swipe({ x: 6, y: 500 }, { x: 330, y: 506 }, 18, 22);
		await sleep(800);
		check("右滑退回列表", (await evaluate<boolean>(`!document.querySelector("[data-ly-phone-page]")`)) && (await layers()) === 1);
		await back();
		await sleep(900);
		check("返回键：回到会话，一层不剩", (await layers()) === 0 && (await evaluate<boolean>(`!!document.querySelector("main textarea")`)));
		await sleep(800);

		console.log("\n7. 从设置列表右滑回会话");
		await tap('button[aria-label="打开会话列表"]');
		await sleep(800);
		await tap('button[aria-label="设置"]');
		await sleep(1000);
		await grab.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: 6, y: 500 }] });
		for (let i = 1; i <= 10; i++) {
			await sleep(22);
			await grab.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: 6 + 15 * i, y: 502 }] });
		}
		await sleep(400);
		const midway = await evaluate<{ under: string; moved: string }>(`({ under: getComputedStyle(document.querySelector("[data-ly-under-settings]")).visibility, moved: document.querySelector("[data-ly-settings]").style.translate })`);
		check("拖到一半：设置跟着手指走，底下露出的是会话", midway.under === "visible" && midway.moved !== "", midway);
		await shot("10_设置滑回途中");
		for (let i = 1; i <= 8; i++) {
			await sleep(22);
			await grab.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: 156 + 22 * i, y: 504 }] });
		}
		await grab.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
		await sleep(900);
		check("松手：回到会话，一层不剩", (await layers()) === 0 && (await evaluate<boolean>(`!!document.querySelector("main textarea") && !document.querySelector("[data-ly-under-settings]")`)));
		await sleep(800);

		recording.on = false;
		await recorder;
	} finally {
		recording.on = false;
		g?.close();
		await booted.stop();
	}
	const passed = checks.filter((c) => c.ok).length;
	const video = join(OUT, `${STAMP}_手机界面改版_${passed}of${checks.length}.mp4`);
	await encode(frames, video, 30);
	console.log(`\n${passed}/${checks.length} 通过 · ${frames.length} 帧 · ${video}`);
	if (passed !== checks.length) process.exitCode = 1;
}

main().then(
	() => process.exit(process.exitCode ?? 0),
	(error: unknown) => {
		console.error(error);
		process.exit(1);
	},
);
