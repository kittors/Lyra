/* oxlint-disable no-console -- probe CLI that prints what the real window did */
/**
 * The rows under a menu's divider sit on the same gutter as the rows above it.
 *
 * The project picker's two footer rows (新建项目 / 不在项目中工作) filled edge to edge on hover and
 * sat 6px left of the project rows above them: the popover's footer slot has no gutter, and the
 * list gets its 6px from `.ly-menu-scroll`. The model menu's footer row made up its own 4px instead.
 *
 * Measured from what is painted: each row's box against the card's box, the icon's x, and the
 * hovered row's fill. Screenshots are clipped to the menu and taken at 2x so the edges are legible.
 *
 *   node --experimental-strip-types e2e/menu-footer-inset-probe.ts [--before]
 */

import { mkdir, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { startApp, type RunningApp } from "./app.ts";
import { pause } from "./record.ts";

const PORT = 9434;
const OUT = join(homedir(), "Desktop", "Lyra菜单页脚测试");
const stamp = new Date().toLocaleString("sv-SE", { timeZone: "Asia/Shanghai" }).replace(/[: ]/g, "-").slice(0, 16);
const phase = process.argv.includes("--before") ? "before" : "after";

let app: RunningApp;
const results: { name: string; ok: boolean; detail: string }[] = [];
function check(name: string, ok: boolean, detail: string) {
	results.push({ name, ok, detail });
	console.log(`${ok ? "✅" : "❌"} ${name}\n     ${detail}`);
}

async function until(expression: string, ms = 20000) {
	const end = Date.now() + ms;
	while (Date.now() < end) {
		if (await app.evaluate<boolean>(`Boolean(${expression})`)) return;
		await pause(100);
	}
	throw new Error(`timed out waiting for: ${expression}`);
}

async function pointAt(selector: string) {
	await until(`document.querySelector(${JSON.stringify(selector)})?.checkVisibility()`);
	return app.evaluate<{ x: number; y: number }>(
		`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`,
	);
}

async function click(selector: string) {
	const point = await pointAt(selector);
	for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) {
		await app.send("Input.dispatchMouseEvent", { type, ...point, ...(type === "mouseMoved" ? {} : { button: "left", clickCount: 1 }) });
	}
}

/**
 * Hover a row: the real pointer goes there, and the row is also forced into `:hover` through the
 * DevTools protocol. The probe window sits at the screen's corner, and a real mouse moving over it
 * takes the hover away from the synthetic one — forcing the state keeps the measurement about the
 * stylesheet, not about where somebody's cursor happened to be.
 */
async function hover(selector: string) {
	await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...(await pointAt(selector)) });
	hoverSession ??= await mainWindowSession();
	await hoverSession.send("DOM.enable");
	await hoverSession.send("CSS.enable");
	const { root } = await hoverSession.send<{ root: { nodeId: number } }>("DOM.getDocument", { depth: 0 });
	const { nodeId } = await hoverSession.send<{ nodeId: number }>("DOM.querySelector", { nodeId: root.nodeId, selector });
	await hoverSession.send("CSS.forcePseudoState", { nodeId, forcedPseudoClasses: ["hover"] });
}

interface Session {
	send<T>(method: string, params?: Record<string, unknown>): Promise<T>;
	close(): void;
}

/**
 * A DevTools session that stays open. `app.send` opens a socket per call, and a forced `:hover`
 * lives only as long as the session that forced it — so the hover needs one of its own.
 */
let hoverSession: Session | undefined;

async function openSession(url: string): Promise<Session> {
	const socket = new WebSocket(url);
	await new Promise<void>((resolve, reject) => {
		socket.addEventListener("open", () => resolve(), { once: true });
		socket.addEventListener("error", () => reject(new Error("CDP socket error")), { once: true });
	});
	let next = 0;
	return {
		send: <T>(method: string, params: Record<string, unknown> = {}) =>
			new Promise<T>((resolve, reject) => {
				const id = ++next;
				const onMessage = (event: MessageEvent) => {
					const message = JSON.parse(String(event.data)) as { id?: number; error?: { message: string }; result?: unknown };
					if (message.id !== id) return;
					socket.removeEventListener("message", onMessage);
					if (message.error) reject(new Error(`${method}: ${message.error.message}`));
					else resolve(message.result as T);
				};
				socket.addEventListener("message", onMessage);
				socket.send(JSON.stringify({ id, method, params }));
			}),
		close: () => socket.close(),
	};
}

/** The main window's page target: marked through `app.evaluate`, then found by the mark. */
async function mainWindowSession(): Promise<Session> {
	await app.evaluate("window.__menuFooterProbe = true");
	const targets = (await fetch(`http://127.0.0.1:${PORT}/json/list`).then((r) => r.json())) as { type: string; webSocketDebuggerUrl?: string }[];
	for (const target of targets) {
		if (target.type !== "page" || !target.webSocketDebuggerUrl) continue;
		const session = await openSession(target.webSocketDebuggerUrl);
		const { result } = await session.send<{ result: { value?: unknown } }>("Runtime.evaluate", { expression: "window.__menuFooterProbe === true", returnByValue: true });
		if (result.value === true) return session;
		session.close();
	}
	throw new Error("the main window's page target was not found");
}

/** Mark the first visible element matching `selector` whose text is `text`. */
async function markText(selector: string, text: string, attribute: string) {
	await until(`[...document.querySelectorAll(${JSON.stringify(selector)})].some((e)=>e.checkVisibility()&&e.innerText.trim()===${JSON.stringify(text)})`);
	await app.evaluate(
		`(()=>{document.querySelector('[${attribute}]')?.removeAttribute('${attribute}');[...document.querySelectorAll(${JSON.stringify(selector)})].find((e)=>e.checkVisibility()&&e.innerText.trim()===${JSON.stringify(text)}).setAttribute('${attribute}','');})()`,
	);
}

interface Geometry {
	card: { left: number; right: number; bottom: number };
	list: { left: number; right: number; icon: number };
	footer: { left: number; right: number; icon: number; fill: string; radius: string };
	listRadius: string;
}

/** The open menu: its card, a list row, and the named footer row, as painted. */
function measure(footerText: string): Promise<Geometry> {
	return app.evaluate<Geometry>(`(() => {
		const card = [...document.querySelectorAll('[data-ly-popover]')].at(-1);
		const box = (el) => el.getBoundingClientRect();
		const rows = [...card.querySelectorAll('.ly-item')].filter((e) => e.checkVisibility());
		const footer = rows.find((e) => e.innerText.trim().startsWith(${JSON.stringify(footerText)}));
		const list = rows.find((e) => e !== footer && card.querySelector('.ly-menu-scroll')?.contains(e));
		const icon = (row) => { const svg = row.querySelector('svg'); return svg ? box(svg).left : NaN; };
		const c = box(card);
		return {
			card: { left: c.left, right: c.right, bottom: c.bottom },
			list: { left: box(list).left, right: box(list).right, icon: icon(list) },
			footer: { left: box(footer).left, right: box(footer).right, icon: icon(footer), fill: getComputedStyle(footer).backgroundColor, radius: getComputedStyle(footer).borderRadius },
			listRadius: getComputedStyle(list).borderRadius,
		};
	})()`);
}

async function shotMenu(name: string) {
	await pause(350);
	const clip = await app.evaluate<{ x: number; y: number; width: number; height: number }>(`(() => {
		const r = [...document.querySelectorAll('[data-ly-popover]')].at(-1).getBoundingClientRect();
		return { x: r.x - 16, y: r.y - 16, width: r.width + 32, height: r.height + 32 };
	})()`);
	const { data } = await app.send<{ data: string }>("Page.captureScreenshot", { format: "png", clip: { ...clip, scale: 2 } });
	const file = join(OUT, `${stamp}_${phase}_${name}.png`);
	await writeFile(file, Buffer.from(data, "base64"));
	console.log(`   📸 ${file}`);
}

const round = (n: number) => Math.round(n * 10) / 10;

async function main() {
	await mkdir(OUT, { recursive: true });
	app = await startApp({
		port: PORT,
		seed: async (home) => {
			const projects = ["智能投标对外公开项目", "AIBiding", "CliProxy", "Lyra", "quantum"].map((name, i) => ({
				path: join(home, "projects", name),
				name,
				pinned: false,
				lastOpenedAt: Date.now() - i * 1000,
			}));
			for (const project of projects) await mkdir(project.path, { recursive: true });
			await writeFile(join(home, "window.json"), JSON.stringify({ width: 1400, height: 900 }));
			await writeFile(
				join(home, "settings.json"),
				JSON.stringify({
					uiLocale: "zh-CN",
					permissionMode: "full",
					thinking: "high",
					mcpServers: [],
					hooks: [],
					sync: { enabled: false },
					appearance: { reduceMotion: "on", theme: "light" },
					projects,
					defaultModelId: "relay/gemini-3.8-flash-high",
					providers: [
						{
							id: "relay",
							name: "中转",
							api: "openai-chat-completions",
							baseUrl: "http://127.0.0.1:9/v1",
							apiKey: "probe-key",
							enabled: true,
							models: ["gemini-3.8-flash-high", "claude-sonnet-4-6"].map((modelId) => ({
								id: `relay/${modelId}`, providerId: "relay", modelId, name: modelId,
								contextWindow: 200000, maxOutputTokens: 8192, supportsThinking: true, supportsImages: false, supportsTools: true,
							})),
						},
					],
				}),
			);
		},
	});

	try {
		await app.evaluate("document.fonts.ready");
		await pause(800);

		console.log("① 项目选择菜单");
		// The chip reads the project's name, 「Chat」, or 「选择项目」 depending on how the window starts.
		const chipNames = JSON.stringify(["智能投标对外公开项目", "AIBiding", "CliProxy", "Lyra", "quantum", "Chat", "选择项目"]);
		await until(`[...document.querySelectorAll(".ly-composer-dock button")].some((b)=>b.checkVisibility()&&${chipNames}.includes(b.innerText.trim()))`);
		await app.evaluate(`[...document.querySelectorAll(".ly-composer-dock button")].find((b)=>b.checkVisibility()&&${chipNames}.includes(b.innerText.trim())).setAttribute("data-probe-chip","")`);
		await click("[data-probe-chip]");
		await until(`[...document.querySelectorAll('[data-ly-popover] .ly-item')].some((e)=>e.innerText.trim()==="不在项目中工作")`);
		await markText("[data-ly-popover] .ly-item", "不在项目中工作", "data-probe-without");
		await hover("[data-probe-without]");
		await pause(400);
		const picker = await measure("不在项目中工作");
		const listInset = round(picker.list.left - picker.card.left);
		const footerInset = round(picker.footer.left - picker.card.left);
		check("页脚两项与上面的项目行左边对齐", Math.abs(picker.footer.left - picker.list.left) < 0.5, `列表行离卡片左边 ${listInset}px，页脚行 ${footerInset}px`);
		check("页脚图标与项目图标在同一条竖线上", Math.abs(picker.footer.icon - picker.list.icon) < 0.5, `项目图标 x=${round(picker.list.icon)}，页脚图标 x=${round(picker.footer.icon)}`);
		check(
			"悬停的灰底四周和列表一样留边，不贴卡片",
			picker.footer.fill !== "rgba(0, 0, 0, 0)" && footerInset >= 6 && Math.abs(picker.card.right - picker.footer.right - (picker.card.right - picker.list.right)) < 0.5,
			`灰底离卡片左 ${footerInset}px、右 ${round(picker.card.right - picker.footer.right)}px（列表行：左 ${listInset}px、右 ${round(picker.card.right - picker.list.right)}px）；底色 ${picker.footer.fill}`,
		);
		check(
			"页脚行悬停灰底的圆角和列表行一样",
			picker.footer.radius === picker.listRadius,
			`列表行圆角 ${picker.listRadius}，页脚行 ${picker.footer.radius}`,
		);
		await shotMenu("01_项目菜单_悬停不在项目中工作");
		await app.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
		await app.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
		await pause(600);

		console.log("② 模型菜单");
		await markText(".ly-composer-dock button", "gemini-3.8-flash-high", "data-probe-model");
		await click("[data-probe-model]");
		await until(`[...document.querySelectorAll('[data-ly-popover] .ly-item')].some((e)=>e.innerText.includes("claude-sonnet-4-6"))`);
		const footerRow = await app.evaluate<string>(`(() => {
			const card = [...document.querySelectorAll('[data-ly-popover]')].at(-1);
			const rows = [...card.querySelectorAll('.ly-item')].filter((e) => e.checkVisibility() && !card.querySelector('.ly-menu-scroll')?.contains(e));
			return rows.at(-1)?.innerText.trim().split(String.fromCharCode(10))[0] ?? "";
		})()`);
		await app.evaluate(`(() => {
			document.querySelector('[data-probe-fast]')?.removeAttribute('data-probe-fast');
			const card = [...document.querySelectorAll('[data-ly-popover]')].at(-1);
			const rows = [...card.querySelectorAll('.ly-item')].filter((e) => e.checkVisibility() && !card.querySelector('.ly-menu-scroll')?.contains(e));
			rows.at(-1)?.setAttribute('data-probe-fast', '');
		})()`);
		await hover("[data-probe-fast]");
		await pause(400);
		const model = await measure(footerRow);
		const modelList = round(model.list.left - model.card.left);
		const modelFooter = round(model.footer.left - model.card.left);
		check("模型菜单页脚行与列表行左右留边一致", Math.abs(model.footer.left - model.list.left) < 0.5 && Math.abs(model.footer.right - model.list.right) < 0.5, `列表行离卡片左 ${modelList}px、页脚行 ${modelFooter}px；右边 ${round(model.card.right - model.list.right)} 对 ${round(model.card.right - model.footer.right)}`);
		await shotMenu("02_模型菜单_悬停页脚");
	} finally {
		const passed = results.filter((r) => r.ok).length;
		console.log(`\n${passed}/${results.length} 通过　（${phase}）`);
		hoverSession?.close();
		const home = app.home;
		await app.stop();
		await rm(home, { recursive: true, force: true });
		if (passed !== results.length) process.exitCode = 1;
	}
}

await main();
