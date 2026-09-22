/* oxlint-disable no-console -- 探针 CLI，输出就是它量到的东西 */
/**
 * 悬停信息卡压着谁，又被谁压着——在真窗口里逐个点位问出来。
 *
 * 用户截到的是：鼠标停在会话行的归档图标上，右边弹出的那张信息卡把图标自己的 tooltip 压住了
 *（卡 210，气泡 200，「归档会话」四个字比那一行宽出去几个像素，正好钻到卡底下）；另外右键菜单
 * 出来之后那张卡还会回来。
 *
 * 层级不能靠读 z-index 断言——`ly-glass-solid` 的底色是不是真不透明、祖先有没有别的 stacking
 * context，读常量都看不出来。这里问的是命中测试：把两张浮层的 `pointer-events` 临时打开（不影响
 * 绘制顺序），在重叠区正中问 `elementFromPoint`，谁答话谁就在上面。
 *
 * 【四】那一档的走法是这个探针最贵的一课，抄在这里省得下一个人再花一小时：**指针必须绕经内容区
 * 才回到会话行**。菜单是 portal 到 body 的，可在 React 树上它是那一行的后代——React 的
 * enter/leave 插件处理 `mouseover` 时，只要 `relatedTarget` 还是自己树里的节点就直接 return，
 * 指望配对的 `mouseout` 来补；而菜单在 `#root` 之外，那个 `mouseout` 根本到不了 React。于是从
 * 菜单直接挪回行上，一个 `onMouseEnter` 都不发，卡当然不弹——那不是「修好了」，是这条路走不到
 * 判断那一步。这个探针最初就这么绿了三轮。真人的手会先晃到别处，那一下 `relatedTarget` 落在
 * `#root` 里，enter 照常合成，卡也就照常压在菜单上。
 *
 * 用法：node --experimental-strip-types e2e/session-card-layer-probe.ts [输出目录]
 */

import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { startApp, type RunningApp } from "./app.ts";

const PORT = 9547;
const OUT_DIR = process.argv[2] ?? join(homedir(), "Desktop", "悬停卡层级测试");
const STAMP = new Date()
	.toLocaleString("sv-SE", { timeZone: "Asia/Shanghai" })
	.replace(/[: ]/g, "-")
	.slice(0, 16);

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

const TITLES = ["1000字小说创作", "分支合并同步与发版", "0.9.19发版与分支合并清理", "子代理检查项目并总结"];

const usage = {
	input: 12_000,
	output: 3_000,
	total: 29_100,
	cacheRead: 14_100,
	cacheWrite: 0,
	cost: { input: 0, output: 0, total: 0, cacheRead: 0, cacheWrite: 0 },
};

let app: RunningApp;
const checks: { ok: boolean; what: string; saw: string }[] = [];
function check(what: string, ok: boolean, saw: string) {
	checks.push({ ok, what, saw });
	console.log(`   ${ok ? "✅" : "❌"} ${what}${ok ? "" : `  —— 看到的是：${saw}`}`);
}

async function seed(home: string): Promise<void> {
	const repo = join(home, "CliProxy");
	await mkdir(repo, { recursive: true });
	await writeFile(join(repo, "readme.md"), "# CliProxy\n");
	const projectId = createHash("sha256").update(repo).digest("hex").slice(0, 16);
	await mkdir(join(home, "sessions", projectId), { recursive: true });
	await writeFile(join(home, "window.json"), JSON.stringify({ width: 1200, height: 860, x: 40, y: 40 }));
	await writeFile(
		join(home, "settings.json"),
		JSON.stringify({
			version: 1,
			providers: [],
			mcpServers: [],
			projects: [{ id: projectId, name: "CliProxy", path: repo, pinned: true, lastOpenedAt: Date.now() }],
			defaultModelId: null,
			permissionMode: "auto",
			thinking: "medium",
			retryAttempts: 3,
			hooks: [],
			scheduledTasks: [],
			disabledPlugins: [],
			alwaysAllow: [],
			sync: { enabled: false, port: 4547, token: null },
			appearance: { theme: "light" },
		}),
	);

	const metas: object[] = [];
	for (let i = 0; i < TITLES.length; i++) {
		const id = `card${String(i + 1).padStart(2, "0")}`;
		const messages = [
			{ role: "user", content: [{ type: "text", text: TITLES[i] }], timestamp: 1 },
			{
				role: "assistant",
				content: [{ type: "text", text: "好的。" }],
				api: "anthropic-messages",
				provider: "test",
				model: "test",
				usage,
				stopReason: "stop",
				timestamp: 2,
			},
		];
		const meta = {
			id,
			title: TITLES[i],
			cwd: repo,
			projectId,
			projectName: "CliProxy",
			createdAt: 1_700_000_000_000 + i * 1000,
			updatedAt: 1_700_000_000_000 + i * 1000,
			modelId: "test",
			messageCount: messages.length,
			usage,
			seq: messages.length + 1,
		};
		metas.push(meta);
		await writeFile(
			join(home, "sessions", projectId, `${id}.jsonl`),
			[
				JSON.stringify({ seq: 0, ts: 1, type: "meta", meta }),
				...messages.map((message, at) => JSON.stringify({ seq: at + 1, ts: at + 1, type: "message", message })),
				JSON.stringify({ seq: meta.seq, ts: 2, type: "meta", meta }),
			].join("\n") + "\n",
		);
	}
	await writeFile(join(home, "sessions", "index.json"), JSON.stringify(metas));
}

/**
 * 谁画在上面——按命中测试问，不按 z-index 猜。
 *
 * 两张浮层都挂着 `pointer-events: none`，`elementFromPoint` 永远穿过它们，所以先把这一条
 * 临时改成 auto 再问，问完还回去。命中顺序和绘制顺序在 CSS 里是同一套规则，改
 * `pointer-events` 不动绘制，所以这样量到的就是屏幕上谁盖着谁。
 */
const WHO_IS_ON_TOP = `((aSel, bSel) => {
	const a = document.querySelector(aSel);
	const b = document.querySelector(bSel);
	if (!a || !b) return { both: false, a: Boolean(a), b: Boolean(b) };
	const ra = a.getBoundingClientRect();
	const rb = b.getBoundingClientRect();
	const left = Math.max(ra.left, rb.left);
	const right = Math.min(ra.right, rb.right);
	const top = Math.max(ra.top, rb.top);
	const bottom = Math.min(ra.bottom, rb.bottom);
	const overlaps = right > left && bottom > top;
	const result = {
		both: true,
		a: true,
		b: true,
		overlaps,
		overlap: overlaps ? { w: Math.round(right - left), h: Math.round(bottom - top) } : null,
		aRect: { l: Math.round(ra.left), t: Math.round(ra.top), r: Math.round(ra.right), b: Math.round(ra.bottom) },
		bRect: { l: Math.round(rb.left), t: Math.round(rb.top), r: Math.round(rb.right), b: Math.round(rb.bottom) },
		aZ: getComputedStyle(a).zIndex,
		bZ: getComputedStyle(b).zIndex,
		aBg: getComputedStyle(a).backgroundColor,
		top: null,
	};
	if (!overlaps) return result;
	const restore = [];
	for (const el of [a, b]) {
		restore.push([el, el.style.pointerEvents]);
		el.style.pointerEvents = "auto";
	}
	const x = (left + right) / 2;
	const y = (top + bottom) / 2;
	const hit = document.elementFromPoint(x, y);
	for (const [el, was] of restore) el.style.pointerEvents = was;
	result.top = hit ? (hit.closest(aSel) ? "a" : hit.closest(bSel) ? "b" : "其它:" + hit.tagName + "." + String(hit.className).slice(0, 40)) : "无";
	result.at = { x: Math.round(x), y: Math.round(y) };
	return result;
})`;

async function whoIsOnTop(a: string, b: string) {
	return app.evaluate<{
		both: boolean;
		a: boolean;
		b: boolean;
		overlaps?: boolean;
		overlap?: { w: number; h: number } | null;
		aRect?: { l: number; t: number; r: number; b: number };
		bRect?: { l: number; t: number; r: number; b: number };
		aZ?: string;
		bZ?: string;
		aBg?: string;
		top?: string | null;
		at?: { x: number; y: number };
	}>(`${WHO_IS_ON_TOP}(${JSON.stringify(a)}, ${JSON.stringify(b)})`);
}

async function shot(name: string): Promise<void> {
	const { data } = await app.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
	const out = join(OUT_DIR, `${STAMP}_${name}.png`);
	await writeFile(out, Buffer.from(data, "base64"));
	console.log(`   图：${out}`);
}

async function mouseTo(x: number, y: number): Promise<void> {
	await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
}

/** 一条会话行上的取点：标题中间、最后一个悬停图标的正中。 */
async function rowPoints(index: number) {
	return app.evaluate<{
		title: { x: number; y: number };
		icon: { x: number; y: number };
		row: { l: number; t: number; r: number; b: number };
		iconLabel: string;
	}>(
		`(() => {
			const rows = [...document.querySelectorAll(".ly-sidebar-fill [data-ly-row]")];
			const row = rows[${index}];
			if (!row) throw new Error("没有第 ${index + 1} 条会话行，只有 " + rows.length + " 条");
			const r = row.getBoundingClientRect();
			const icons = [...row.querySelectorAll("[data-ly-hover-reveal] button")];
			const last = icons.at(-1);
			const ir = last ? last.getBoundingClientRect() : r;
			return {
				title: { x: Math.round(r.left + 40), y: Math.round(r.top + r.height / 2) },
				icon: { x: Math.round(ir.left + ir.width / 2), y: Math.round(ir.top + ir.height / 2) },
				row: { l: Math.round(r.left), t: Math.round(r.top), r: Math.round(r.right), b: Math.round(r.bottom) },
				iconLabel: last ? (last.getAttribute("data-ly-tip") || "") : "没有图标",
			};
		})()`,
	);
}

const SNAPSHOT = `(() => {
	const card = document.querySelector("[data-ly-session-card]");
	const tip = document.querySelector(".ly-tooltip");
	const menu = document.querySelector('[role="menu"]');
	const modal = document.querySelector("[data-ly-modal]");
	const box = (el) => {
		if (!el) return null;
		const r = el.getBoundingClientRect();
		const cs = getComputedStyle(el);
		return { l: Math.round(r.left), t: Math.round(r.top), r: Math.round(r.right), b: Math.round(r.bottom), z: cs.zIndex, bg: cs.backgroundColor, hidden: el.hidden === true, text: (el.textContent || "").trim().slice(0, 30) };
	};
	return { card: box(card), tip: box(tip), menu: box(menu), modal: box(modal) };
})()`;

type Box = { l: number; t: number; r: number; b: number; z: string; bg: string; hidden: boolean; text: string } | null;

async function snapshot() {
	return app.evaluate<{ card: Box; tip: Box; menu: Box; modal: Box }>(SNAPSHOT);
}

async function main() {
	await mkdir(OUT_DIR, { recursive: true });
	app = await startApp({ port: PORT, seed });

	try {
		// 等侧边栏里的会话行画出来
		for (let i = 0; i < 60; i++) {
			if (await app.evaluate<boolean>('Boolean(document.querySelector(".ly-sidebar-fill [data-ly-row]"))')) break;
			await pause(500);
		}
		// 欢迎页：点「新对话」，让右边出现那一排建议卡片
		await app.evaluate(
			`(() => {
				document.activeElement instanceof HTMLElement && document.activeElement.blur();
				const neu = [...document.querySelectorAll("button")].find((el) => (el.textContent || "").includes("新对话"));
				if (neu) neu.setAttribute("data-ly-new-chat", "");
			})()`,
		);
		const hasNew = await app.evaluate<boolean>('Boolean(document.querySelector("[data-ly-new-chat]"))');
		if (hasNew) {
			const at = await app.evaluate<{ x: number; y: number }>(
				`(() => { const r = document.querySelector("[data-ly-new-chat]").getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; })()`,
			);
			for (const type of ["mouseMoved", "mousePressed", "mouseReleased"] as const) {
				await app.send("Input.dispatchMouseEvent", {
					type,
					...at,
					...(type === "mouseMoved" ? {} : { button: "left", clickCount: 1 }),
				});
			}
			await pause(900);
		}
		await mouseTo(700, 700);
		await pause(800);

		const heroCards = await app.evaluate<number>(
			'document.querySelectorAll(\'[data-ly-chat-surface="empty"] button.group\').length',
		);
		check("欢迎页那排建议卡片在场", heroCards >= 2, `${heroCards} 张`);

		console.log("\n【一】鼠标停在会话行标题上：信息卡跟欢迎页的建议卡片谁在上面");
		const first = await rowPoints(0);
		console.log(`   第一行 ${JSON.stringify(first.row)}，最后一个图标是「${first.iconLabel}」`);
		await mouseTo(first.title.x, first.title.y);
		await pause(900);
		let s = await snapshot();
		console.log(`   信息卡 ${JSON.stringify(s.card)}`);
		check("信息卡出来了", Boolean(s.card), s.card ? "" : "没有 [data-ly-session-card]");
		const vsHero = await whoIsOnTop("[data-ly-session-card]", '[data-ly-chat-surface="empty"] button.group');
		console.log(`   跟建议卡片比：${JSON.stringify(vsHero)}`);
		if (vsHero.overlaps) {
			check("信息卡压在建议卡片上面", vsHero.top === "a", `上面那个是 ${vsHero.top}（卡 z=${vsHero.aZ} 建议卡 z=${vsHero.bZ}）`);
		} else {
			console.log("   两者不重叠，这一档量不出层级");
		}
		await shot("1-悬停行-信息卡对建议卡片");

		console.log("\n【二】鼠标挪到行尾的图标上：图标自己的 tooltip 跟信息卡谁在上面");
		await mouseTo(first.icon.x, first.icon.y);
		await pause(1000);
		s = await snapshot();
		console.log(`   tooltip ${JSON.stringify(s.tip)}`);
		console.log(`   信息卡 ${JSON.stringify(s.card)}`);
		check("图标的 tooltip 画出来了", Boolean(s.tip) && !s.tip?.hidden, s.tip ? `hidden=${s.tip.hidden}` : "没有 .ly-tooltip");
		const vsTip = await whoIsOnTop(".ly-tooltip", "[data-ly-session-card]");
		console.log(`   tooltip 对信息卡：${JSON.stringify(vsTip)}`);
		if (vsTip.overlaps) {
			check("tooltip 压在信息卡上面", vsTip.top === "a", `上面那个是 ${vsTip.top}（tooltip z=${vsTip.aZ} 卡 z=${vsTip.bZ}）`);
		} else {
			console.log("   这个窗宽下两者不重叠");
		}
		await shot("2-悬停图标-tooltip对信息卡");

		console.log("\n【三】右键这一行：菜单出来，信息卡必须让开");
		// 真鼠标右键，不是页面里派发的合成事件——按下那一下同时会走 onPointerDown，那条路
		// 上有 dismiss、拖拽和重排，合成 contextmenu 一条都碰不到。
		await app.evaluate("(() => { window.__dismissWhy = []; })()");
		await app.send("Input.dispatchMouseEvent", { type: "mousePressed", x: first.title.x, y: first.title.y, button: "right", buttons: 2, clickCount: 1 });
		await app.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: first.title.x, y: first.title.y, button: "right", buttons: 0, clickCount: 1 });
		await pause(700);
		s = await snapshot();
		console.log(`   菜单 ${JSON.stringify(s.menu)}`);
		console.log(`   信息卡 ${JSON.stringify(s.card)}`);
		check("右键后菜单开出来了", Boolean(s.menu), s.menu ? "" : "没有 [role=menu]");
		check("右键后信息卡消失", !s.card, s.card ? `还在 ${JSON.stringify(s.card)}` : "");
		await shot("3-右键菜单-信息卡该消失");

		console.log("\n【四】菜单还开着，鼠标扫回行上没被菜单盖住的那一段：信息卡不该再冒出来压住菜单");
		const menuBox = s.menu;
		if (menuBox) {
			/*
			 * 经内容区绕回来，不是直接从菜单挪回行上。
			 *
			 * 菜单是 portal 到 body 的，但在 React 树上它是这一行的后代——于是从菜单直接挪回行
			 * 上时，React 的 enter/leave 插件认为指针没跨出这棵子树，一个 mouseenter 都不发，
			 * 卡也就不弹。那不是「菜单把它挡住了」，是这条路根本走不到判断那一步。真人的手会
			 * 先晃到别处：那一下 relatedTarget 落在 #root 里，enter 照常合成。
			 */
			await mouseTo(700, 200);
			await pause(300);
			// 行 0 的上沿在菜单上边之上，那一条是露着的，指针在那里既在行内又不在菜单上。
			const strip = { x: first.row.l + 60, y: Math.min(first.row.t + 4, menuBox.t - 6) };
			console.log(`   落点 ${JSON.stringify(strip)}（行 t=${first.row.t}，菜单 t=${menuBox.t}）`);
			// 落点到底压在谁身上，行有没有真的收到指针——绿而不弹可能只是指针根本没进去。
			const landing = await app.evaluate<{ hit: string; inRow: boolean; inMenu: boolean }>(
				`(() => {
					const el = document.elementFromPoint(${strip.x}, ${strip.y});
					return {
						hit: el ? el.tagName + "." + String(el.className).slice(0, 50) : "无",
						inRow: Boolean(el && el.closest("[data-ly-row]")),
						inMenu: Boolean(el && el.closest('[role="menu"]')),
					};
				})()`,
			);
			console.log(`   落点压着：${JSON.stringify(landing)}`);
			check("落点确实落在会话行上、且不在菜单上", landing.inRow && !landing.inMenu, JSON.stringify(landing));
			await app.evaluate(
				`(() => {
					const row = document.querySelectorAll(".ly-sidebar-fill [data-ly-row]")[0];
					window.__probeOver = 0;
					window.__probeOut = 0;
					row.addEventListener("mouseover", () => { window.__probeOver++; });
					row.addEventListener("mouseout", () => { window.__probeOut++; });
					window.__enter = 0;
					window.__leave = 0;
					row.addEventListener("mouseenter", () => { window.__enter++; });
					row.addEventListener("mouseleave", () => { window.__leave++; });
					// 卡是被谁劝退的：这三个是 useSessionCard 自己挂的撤退开关。
					window.__why = { scroll: 0, wheel: 0, blur: 0, mounted: 0 };
					window.addEventListener("scroll", () => { window.__why.scroll++; }, true);
					window.addEventListener("wheel", () => { window.__why.wheel++; }, true);
					window.addEventListener("blur", () => { window.__why.blur++; });
					new MutationObserver((records) => {
						for (const r of records) for (const n of r.addedNodes) {
							if (n instanceof HTMLElement && n.matches("[data-ly-session-card]")) window.__why.mounted++;
						}
					}).observe(document.body, { childList: true });
					window.__moves = [];
					const name = (el) => el ? el.tagName + "." + String(el.className || "").slice(0, 22) : "null";
					document.addEventListener("mouseover", (e) => {
						window.__moves.push({ t: name(e.target), r: name(e.relatedTarget), buttons: e.buttons });
					}, true);
					// 那个 420ms 的等待：到底有没有被排上、有没有跑、跑的时候有没有炸。
					window.__timers = [];
					const orig = window.setTimeout.bind(window);
					window.setTimeout = function (fn, ms) {
						const rest = Array.prototype.slice.call(arguments, 2);
						if (ms === 420 && typeof fn === "function") {
							const stack = String(new Error().stack || "").split(String.fromCharCode(10)).slice(1, 4).join(" | ").slice(0, 200);
							const rec = { stack: stack, ran: false, err: null };
							window.__timers.push(rec);
							return orig.apply(null, [function () {
								rec.ran = true;
								try { return fn.apply(this, arguments); }
								catch (e) { rec.err = String((e && e.message) || e); throw e; }
							}, ms].concat(rest));
						}
						return orig.apply(null, [fn, ms].concat(rest));
					};
				})()`,
			);
			await mouseTo(strip.x, strip.y);
			await pause(1400);
			const events = await app.evaluate<{ over: number; out: number }>(
				"({ over: window.__probeOver || 0, out: window.__probeOut || 0 })",
			);
			const why = await app.evaluate<{ scroll: number; wheel: number; blur: number; mounted: number }>("window.__why");
			const moves = await app.evaluate<{ t: string; r: string; buttons: number }[]>("window.__moves || []");
			const enter = await app.evaluate<{ enter: number; leave: number }>("({ enter: window.__enter || 0, leave: window.__leave || 0 })");
			const timers = await app.evaluate<{ stack: string; ran: boolean; err: string | null }[]>("window.__timers || []");
			console.log(`   行的原生 mouseenter/leave：${JSON.stringify(enter)}`);
			console.log(`   420ms 等待：${JSON.stringify(timers, null, 1)}`);
			console.log(`   行收到的指针事件：${JSON.stringify(events)}`);
			console.log(`   期间的撤退开关与挂载次数：${JSON.stringify(why)}`);
			console.log(`   mouseover 明细：${JSON.stringify(moves)}`);
			check("指针真的又进了一次那一行（不然这一档说明不了任何事）", events.over > 0, JSON.stringify(events));
			s = await snapshot();
			console.log(`   菜单 ${JSON.stringify(s.menu)}`);
			console.log(`   信息卡 ${JSON.stringify(s.card)}`);
			check("菜单开着时悬停会话行不弹信息卡", !s.card, s.card ? `又弹出来了 ${JSON.stringify(s.card)}` : "");
			if (s.card && s.menu) {
				const vsMenu = await whoIsOnTop("[data-ly-session-card]", '[role="menu"]');
				console.log(`   信息卡对菜单：${JSON.stringify(vsMenu)}`);
				if (vsMenu.overlaps) check("信息卡没压住菜单", vsMenu.top === "b", `上面那个是 ${vsMenu.top}`);
			}
			// 同一份信号也管 tooltip：从前它靠 querySelector 找 `.fixed.z-[60][role=menu]`，
			// 那串 class 只有弹出层带着，对话框一概不算。
			await mouseTo(first.icon.x, first.icon.y);
			await pause(1000);
			s = await snapshot();
			console.log(`   tooltip ${JSON.stringify(s.tip)}`);
			check("菜单开着时悬停图标也不冒 tooltip", !s.tip || s.tip.hidden, `tooltip 还在：${JSON.stringify(s.tip)}`);
			await shot("4-菜单开着悬停会话行");
		}

		// 关掉菜单
		await app.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
		await app.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
		await mouseTo(700, 700);
		await pause(700);

		/*
		 * 对照：菜单关掉，同一个落点再走一遍。
		 *
		 * 上一档「没弹卡」有两种解释——菜单把它压住了，或者那个落点本来就弹不出来。少了这一半，
		 * 绿也说明不了任何事。
		 */
		console.log("\n【四·对照】菜单关掉，同一个落点再来一次：这一次必须弹得出来");
		if (menuBox) {
			const strip = { x: first.row.l + 60, y: Math.min(first.row.t + 4, menuBox.t - 6) };
			await mouseTo(strip.x, strip.y);
			await pause(1400);
			s = await snapshot();
			console.log(`   信息卡 ${JSON.stringify(s.card)}`);
			check("同一落点在没有菜单时能弹出信息卡", Boolean(s.card), "连没菜单时都不弹，上一档的绿是假的");
			// tooltip 的另一半对照：菜单一关，它得回来，不能被抑制永久卡住。
			await mouseTo(first.icon.x, first.icon.y);
			await pause(1000);
			s = await snapshot();
			check("菜单关掉后 tooltip 能照常出来", Boolean(s.tip) && !s.tip?.hidden, `tooltip ${JSON.stringify(s.tip)}`);
			await mouseTo(700, 700);
			await pause(400);
		}

		/*
		 * 【五】真的模态对话框（`Overlay`，scrim + z 80），不是长得像对话框的弹出层。
		 *
		 * 走项目菜单的「移除」，因为那是这套界面里最短的一条 Confirm 路径。中间有一步很值钱：
		 * 点下「移除」之后菜单自己关掉，只剩对话框——抑制是按个数记的，所以菜单那一笔销账不能
		 * 把对话框那一笔一起销掉。要是当初用布尔值，这一步过后卡就又能弹了。
		 */
		console.log("\n【五】项目菜单 →「移除」的确认框：对话框开着时不该有悬停浮层");
		await app.evaluate(
			`(() => {
				const head = document.querySelector(".ly-sidebar-fill [data-ly-project-row], .ly-sidebar-fill [data-ly-project]") ||
					[...document.querySelectorAll(".ly-sidebar-fill [data-ly-hover-row]")].find((el) => !el.hasAttribute("data-ly-row"));
				if (!head) throw new Error("侧边栏里找不到项目行");
				const r = head.getBoundingClientRect();
				head.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: Math.round(r.left + 40), clientY: Math.round(r.top + r.height / 2), button: 2 }));
			})()`,
		);
		await pause(600);
		const removed = await app.evaluate<{ clicked: boolean; items: string }>(
			`(() => {
				const rows = [...document.querySelectorAll('[role="menu"] button, [role="menu"] [role="menuitem"]')];
				const item = rows.find((el) => (el.textContent || "").trim() === "移除");
				if (item) item.click();
				return { clicked: Boolean(item), items: rows.map((el) => (el.textContent || "").trim()).join("/") };
			})()`,
		);
		console.log(`   项目菜单里有：${removed.items}`);
		await pause(800);
		if (removed.clicked) {
			s = await snapshot();
			console.log(`   对话框 ${JSON.stringify(s.modal)}`);
			console.log(`   菜单（应已关掉）${JSON.stringify(s.menu)}`);
			check("确认框开出来了", Boolean(s.modal), "没有 [data-ly-modal]，这一档问不出东西");
			check("菜单已经关掉，只剩对话框", !s.menu, `菜单还在 ${JSON.stringify(s.menu)}`);

			// 绕内容区再回到会话行：这是唯一能让 React 合成出 mouseenter 的走法。
			await mouseTo(700, 200);
			await pause(300);
			await mouseTo(first.title.x, first.title.y);
			await pause(1400);
			s = await snapshot();
			const landed = await app.evaluate<string>(
				`(() => {
					const el = document.elementFromPoint(${first.title.x}, ${first.title.y});
					return el ? el.tagName + "." + String(el.className).slice(0, 40) : "无";
				})()`,
			);
			console.log(`   落点压着：${landed}`);
			console.log(`   信息卡 ${JSON.stringify(s.card)}`);
			check("对话框开着时不弹信息卡（菜单那一笔销账没连带销掉它）", !s.card, `弹出来了 ${JSON.stringify(s.card)}`);
			await shot("5-对话框开着");

			// 取消掉，别真把项目移除了；然后确认抑制是真的还回去了。
			await app.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
			await app.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
			await pause(700);
			const stillThere = await app.evaluate<boolean>(
				'Boolean(document.querySelector(".ly-sidebar-fill [data-ly-row]"))',
			);
			check("确认框被取消，项目和会话都还在", stillThere, "会话行没了，说明这一档把项目真移除了");
			await mouseTo(700, 200);
			await pause(300);
			await mouseTo(first.title.x, first.title.y);
			await pause(1400);
			s = await snapshot();
			check("对话框关掉后信息卡能照常弹出", Boolean(s.card), "抑制没还回去，卡再也不出来了");

			/*
			 * 【五·乙】对话框自己的 tooltip 必须还能用。
			 *
			 * 这一档是防我自己。把模态接成「开着就一直压」看起来更彻底，代价是它自己那些 tooltip
			 * 全哑了——`ReleaseModal` 光自己就有九处。所以模态只清一次场，不占账；这里量的就是
			 * 那个区别有没有真的落到屏幕上。
			 */
			console.log("\n【五·乙】对话框里的 tooltip 不该被连坐");
			await mouseTo(700, 700);
			await pause(400);
			await app.evaluate(
				`(() => {
					const head = document.querySelector(".ly-sidebar-fill [data-ly-project-row], .ly-sidebar-fill [data-ly-project]") ||
						[...document.querySelectorAll(".ly-sidebar-fill [data-ly-hover-row]")].find((el) => !el.hasAttribute("data-ly-row"));
					const r = head.getBoundingClientRect();
					head.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: Math.round(r.left + 40), clientY: Math.round(r.top + r.height / 2), button: 2 }));
				})()`,
			);
			await pause(600);
			await app.evaluate(
				`(() => {
					const item = [...document.querySelectorAll('[role="menu"] button, [role="menu"] [role="menuitem"]')].find((el) => (el.textContent || "").trim() === "编辑项目");
					if (item) item.click();
					return Boolean(item);
				})()`,
			);
			await pause(900);
			const tipTarget = await app.evaluate<{ x: number; y: number; tip: string } | null>(
				`(() => {
					const modal = document.querySelector("[data-ly-modal]");
					if (!modal) return null;
					const el = modal.querySelector("[data-ly-tip]");
					if (!el) return null;
					const r = el.getBoundingClientRect();
					return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), tip: el.getAttribute("data-ly-tip") };
				})()`,
			);
			if (tipTarget) {
				console.log(`   对话框里挑中的提示是「${tipTarget.tip}」`);
				await mouseTo(tipTarget.x, tipTarget.y);
				await pause(1100);
				s = await snapshot();
				console.log(`   tooltip ${JSON.stringify(s.tip)}`);
				check(
					"对话框开着时，它自己的 tooltip 照常显示",
					Boolean(s.tip) && !s.tip?.hidden,
					`模态把自己的提示也压掉了：${JSON.stringify(s.tip)}`,
				);
				await shot("5乙-对话框自己的tooltip");
			} else {
				check("编辑项目对话框里找得到带提示的控件", false, "没有 [data-ly-modal] 或里面没有 data-ly-tip");
			}
			await app.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
			await app.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
			await pause(600);
		} else {
			check("项目菜单里找得到「移除」", false, removed.items || "菜单没开出来");
			await app.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
			await app.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
		}
		await mouseTo(700, 700);
		await pause(700);

		/*
		 * 【六】窄窗口：侧边栏变成抽屉。
		 *
		 * 这一档是回归，不是新功能。抽屉自己是个 `fixed z-30` 的 aside、带 role=dialog，但不走
		 * `Overlay`——所以它不该登记抑制。要是哪天有人「顺手」把抽屉也接到那套信号上，抽屉一开
		 * 卡就再也不出来了，而抽屉恰恰是这个宽度下唯一能悬停会话行的地方。
		 */
		console.log("\n【六】窗口窄到侧边栏变抽屉：卡还得能出来（抽屉不是模态，不该被抑制）");
		await app.send("Emulation.setDeviceMetricsOverride", { width: 700, height: 820, deviceScaleFactor: 0, mobile: false });
		await pause(900);
		const opened = await app.evaluate<{ compact: boolean; clicked: boolean; label: string }>(
			`(() => {
				const btn = [...document.querySelectorAll("button[aria-label]")].find((el) => /侧边栏/.test(el.getAttribute("aria-label") || ""));
				const label = btn ? btn.getAttribute("aria-label") : "没找到";
				const drawer = document.querySelector('[data-pane="drawer"]');
				if (btn && /显示/.test(label)) btn.click();
				return { compact: Boolean(drawer), clicked: Boolean(btn && /显示/.test(label)), label: label };
			})()`,
		);
		console.log(`   抽屉形态：${JSON.stringify(opened)}`);
		check("这个宽度下侧边栏确实变成了抽屉", opened.compact, `没有 [data-pane="drawer"]，按钮是「${opened.label}」`);
		await pause(900);
		const drawerRow = await rowPoints(0).catch(() => null);
		if (drawerRow) {
			console.log(`   抽屉里第一行 ${JSON.stringify(drawerRow.row)}，最后一个图标「${drawerRow.iconLabel}」`);
			await mouseTo(600, 700);
			await pause(300);
			await mouseTo(drawerRow.icon.x, drawerRow.icon.y);
			await pause(1200);
			s = await snapshot();
			console.log(`   信息卡 ${JSON.stringify(s.card)}`);
			console.log(`   tooltip ${JSON.stringify(s.tip)}`);
			check("抽屉形态下信息卡照样出来", Boolean(s.card), "抽屉一开卡就没了——抑制被接到不该接的地方");
			const narrowVsTip = await whoIsOnTop(".ly-tooltip", "[data-ly-session-card]");
			console.log(`   tooltip 对信息卡：${JSON.stringify(narrowVsTip)}`);
			if (narrowVsTip.overlaps) {
				check("这个宽度下 tooltip 也压在信息卡上面", narrowVsTip.top === "a", `上面那个是 ${narrowVsTip.top}`);
			} else {
				console.log("   这个摆位下两者不重叠");
			}
			await shot("6-抽屉形态");
		} else {
			check("抽屉里找得到会话行", false, "抽屉打开后没有 [data-ly-row]");
		}
		await app.send("Emulation.clearDeviceMetricsOverride");
		await pause(600);
	} finally {
		const passed = checks.filter((c) => c.ok).length;
		console.log(`\n${passed}/${checks.length} 项通过`);
		for (const c of checks) if (!c.ok) console.log(`   ❌ ${c.what} —— ${c.saw}`);
		await app.stop();
		if (passed !== checks.length) process.exitCode = 1;
	}
}

await main();
