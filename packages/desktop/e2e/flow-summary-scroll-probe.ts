/* oxlint-disable no-console -- probe CLI that prints what the real window did */
/**
 * 转录里那几条过程行：装不下的那一句，收尾是省略号还是虚化加悬停自读。
 *
 * `node --experimental-strip-types e2e/flow-summary-scroll-probe.ts [dir]`
 *
 * 客户拿截图圈的就是这一行：一句推理被剁在「…」上。那三个点报告了「这里被截了」，却不说截掉的是
 * 什么——而想知道的恰恰是那半句。侧边栏的标题早就是另一种做法（两头化开、鼠标放上去自己读出来），
 * 转录里这几条过程行没有跟上。
 *
 * 量的是画出来的结果：
 *   1. 静止时摘要的收尾——遮罩在不在、右边那道虚化有多深，以及尾字处的 alpha 是不是真的在淡；
 *   2. 悬停之后逐帧记文字的 x，位移超过 1px 才算在读；
 *   3. 装得下的那一句（工具行常常很短）悬停必须纹丝不动，不然一列行全在抖。
 *
 * 每个读数自带一句「我当时悬着没有」：合成的 `mouseMoved` 会被真实鼠标顶掉，对不上的读数不算数。
 */

import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { startApp } from "./app.ts";

const dir = process.argv[2] ?? "/tmp/lyra-flow-summary";

let failures = 0;
function check(label: string, passed: boolean, evidence: string): void {
	if (!passed) failures++;
	console.log(`${passed ? "✅" : "❌"} ${label}\n     ${evidence.replace(/\n/g, "\n     ")}`);
}

const usage = { input: 0, output: 0, total: 0, cacheRead: 0, cacheWrite: 0, cost: { input: 0, output: 0, total: 0, cacheRead: 0, cacheWrite: 0 } };

/** 客户截图里那一句的形状：长到必然装不下，第一行就是收起时显示的那句。 */
const LONG = "Reviewing the instruction, the task is to perform an operation after merging all code to the main branch, which requires checking the working tree first.";

async function seed(home: string): Promise<void> {
	await writeFile(join(home, "window.json"), JSON.stringify({ width: 1200, height: 860, x: 40, y: 40 }));
	const path = join(home, "proj");
	const id = createHash("sha256").update(path).digest("hex").slice(0, 16);
	await mkdir(path, { recursive: true });
	await mkdir(join(home, "sessions", id), { recursive: true });

	await writeFile(
		join(home, "settings.json"),
		JSON.stringify({
			version: 1,
			providers: [],
			mcpServers: [],
			projects: [{ id, name: "验收工程", path, pinned: true, lastOpenedAt: 1 }],
			defaultModelId: null,
			permissionMode: "auto",
			thinking: "medium",
			retryAttempts: 3,
			hooks: [],
			scheduledTasks: [],
			disabledPlugins: [],
			alwaysAllow: [],
			sync: { enabled: false, port: 4541, token: null },
			appearance: { theme: "light" },
		}),
	);

	const at = 1_700_000_000_000;
	const messages = [
		{ role: "user", content: [{ type: "text", text: "把所有分支合并到 main。" }], timestamp: at },
		{
			role: "assistant",
			content: [
				{ type: "thinking", thinking: `${LONG}\n第二句用来占位，收起时不显示它。` },
				{ type: "toolCall", id: "t1", name: "read", arguments: { path: "README.md" }, argumentsText: '{"path":"README.md"}' },
			],
			api: "anthropic-messages",
			provider: "test",
			model: "test",
			usage,
			stopReason: "toolUse",
			timestamp: at,
		},
		{ role: "toolResult", toolCallId: "t1", toolName: "read", isError: false, content: [{ type: "text", text: "# 验收工程" }], timestamp: at },
		{
			role: "assistant",
			content: [{ type: "text", text: "合并完成。" }],
			api: "anthropic-messages",
			provider: "test",
			model: "test",
			usage,
			stopReason: "stop",
			timestamp: at,
		},
	];
	const meta = {
		id: "s01",
		title: "分支合并",
		cwd: path,
		projectId: id,
		projectName: "验收工程",
		createdAt: at,
		updatedAt: at,
		modelId: "test",
		messageCount: messages.length,
		usage,
		seq: messages.length + 1,
	};
	await writeFile(
		join(home, "sessions", id, "s01.jsonl"),
		[
			JSON.stringify({ seq: 0, ts: 1, type: "meta", meta }),
			...messages.map((message, n) => JSON.stringify({ seq: n + 1, ts: n + 1, type: "message", message })),
			JSON.stringify({ seq: meta.seq, ts: 9, type: "meta", meta }),
		].join("\n") + "\n",
	);
	await writeFile(join(home, "sessions", "index.json"), JSON.stringify([meta]));
}

const app = await startApp({ port: 9564, seed });
const settle = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** 同一份 x 轴遮罩解析，和侧边栏那支探针问的是同一个数。 */
const MASK_X = [
	'const NUM = "-?\\\\d*\\\\.?\\\\d+(?:[eE][-+]?\\\\d+)?";',
	'const STOP = new RegExp("(rgba?\\\\([^)]*\\\\))\\\\s+(?:calc\\\\(100% - (" + NUM + ")px\\\\)|(" + NUM + ")%|(" + NUM + ")px)", "g");',
	"const maskStops = (el) => {",
	"  const style = getComputedStyle(el);",
	'  const css = style.maskImage && style.maskImage !== "none" ? style.maskImage : style.webkitMaskImage;',
	'  if (!css || css === "none") return null;',
	"  const w = el.clientWidth;",
	"  const out = [];",
	"  STOP.lastIndex = 0;",
	"  let hit;",
	"  while ((hit = STOP.exec(css))) {",
	"    const parts = hit[1].match(/-?[\\d.]+(?:[eE][-+]?\\d+)?/g).map(Number);",
	"    const at = hit[2] !== undefined ? w - Number(hit[2]) : hit[3] !== undefined ? (w * Number(hit[3])) / 100 : Number(hit[4]);",
	"    out.push({ alpha: parts.length > 3 ? parts[3] : 1, at });",
	"  }",
	'  const colours = (css.match(/rgba?\\(/g) || []).length;',
	'  if (out.length !== colours) throw new Error("遮罩色标漏了：" + css.slice(0, 300));',
	"  return out.sort((a, b) => a.at - b.at);",
	"};",
	"const alphaAt = (stops, x) => {",
	"  if (!stops || stops.length === 0) return 1;",
	"  if (x <= stops[0].at) return stops[0].alpha;",
	"  for (let i = 0; i < stops.length - 1; i++) {",
	"    const lo = stops[i], hi = stops[i + 1];",
	"    if (lo.at === hi.at) continue;",
	"    if (x >= lo.at && x <= hi.at) return lo.alpha + (hi.alpha - lo.alpha) * ((x - lo.at) / (hi.at - lo.at));",
	"  }",
	"  return stops[stops.length - 1].alpha;",
	"};",
].join("\n");

interface Shot {
	/** 摘要盒子有多宽。 */
	box: number;
	/** 那一句字有多宽。 */
	text: number;
	/** 装不下的那一截。 */
	over: number;
	/** 收尾有没有遮罩——没有就说明还在靠省略号。 */
	masked: boolean;
	/** 右边那道虚化的深度，写给遮罩的值。 */
	fadeRight: string;
	/** 遮罩在盒子右边缘处的 alpha。虚化在做事的话它接近 0。 */
	alphaAtEdge: number;
	/** 摘要里还有没有 `ScrollText` 的壳。 */
	shell: boolean;
	/** 量这一下的时候指针在不在这一行上。 */
	hovered: boolean;
}

const SHOT = (sel: string) =>
	`(() => {
	${MASK_X}
	const row = document.querySelector('${sel}');
	if (!row) return null;
	const summary = row.querySelector(".ly-flow-summary");
	if (!summary) return null;
	const fit = summary.querySelector("[data-ly-scroll-fit], .ly-fade-edge");
	const held = fit || summary;
	// 要的是包着字的那一层，不是它外面的轨道：只写 span 的父子关系会先撞上轨道，量出来「字宽 = 盒宽」。
	const body = summary.querySelector("[data-ly-scroll-fit] > span > span:not([data-ly-scroll-dup])") || summary.firstElementChild;
	const hb = body ? body.getBoundingClientRect() : summary.getBoundingClientRect();
	const cs = getComputedStyle(held);
	const stops = maskStops(held);
	return {
		box: Math.round(held.clientWidth * 10) / 10,
		text: Math.round(hb.width * 10) / 10,
		over: Math.round(Math.max(0, hb.width - held.clientWidth) * 10) / 10,
		masked: stops !== null && stops.length > 0,
		fadeRight: cs.getPropertyValue("--ly-fade-right").trim() || "0",
		alphaAtEdge: Math.round(alphaAt(stops, held.clientWidth) * 100) / 100,
		shell: summary.querySelector("[data-ly-scroll-fit]") !== null,
		hovered: row.matches(":hover"),
	};
})()`;

const TRACK_START = (sel: string) =>
	`(() => {
	const row = document.querySelector('${sel}');
	const body = row && row.querySelector(".ly-flow-summary span > span:not([data-ly-scroll-dup])");
	if (!body) return false;
	window.__lyTrack = { xs: [] };
	const tick = () => {
		window.__lyTrack.xs.push(Math.round(body.getBoundingClientRect().left * 10) / 10);
		if (window.__lyTrack.xs.length < 90) requestAnimationFrame(tick);
	};
	requestAnimationFrame(tick);
	return true;
})()`;

const TRACK_READ = `(() => {
	const xs = (window.__lyTrack && window.__lyTrack.xs) || [];
	return { xs, span: xs.length ? Math.max(...xs) - Math.min(...xs) : 0, frames: xs.length };
})()`;

async function hover(x: number, y: number): Promise<void> {
	await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "none", buttons: 0 });
}

/** 点开会话要用真实鼠标：`evaluate` 里的 `.click()` 打不开会话行。 */
async function click(x: number, y: number): Promise<void> {
	await hover(x, y);
	await app.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1 });
	await app.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount: 1 });
}

async function centre(sel: string): Promise<{ x: number; y: number } | null> {
	return app.evaluate<{ x: number; y: number } | null>(
		`(() => { const e = document.querySelector('${sel}'); if (!e) return null; const b = e.getBoundingClientRect(); if (b.width < 1) return null; return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) }; })()`,
	);
}

/** 悬停一行，逐帧量它的摘要动没动。 */
async function read(sel: string): Promise<{ rest: Shot; hot: Shot; span: number } | null> {
	await hover(700, 760);
	await settle(300);
	const rest = await app.evaluate<Shot | null>(SHOT(sel));
	const spot = await centre(sel);
	if (!rest || !spot) return null;
	await hover(spot.x, spot.y);
	await settle(120);
	// 合成事件会被真实鼠标顶掉，多发一下把悬停态按住。
	await hover(spot.x + 1, spot.y);
	await settle(640);
	await app.evaluate<boolean>(TRACK_START(sel));
	await settle(1100);
	const track = await app.evaluate<{ span: number; frames: number }>(TRACK_READ);
	const hot = await app.evaluate<Shot>(SHOT(sel));
	return { rest, hot, span: track.span };
}

try {
	await mkdir(dir, { recursive: true });
	await settle(3500);

	const rowAt = await centre('[data-ly-row="s01"]');
	if (!rowAt) throw new Error("侧边栏里没有那条会话");
	await click(rowAt.x, rowAt.y);
	await settle(2200);

	/*
	 * 一轮的过程默认是收起的：屏幕上只有「调用工具 1 个」那一行，思考和工具都在它下面。
	 *
	 * 客户截图里那一轮是摊开的，所以这里先把它点开——不点开根本没有思考行可量，第一版探针就是
	 * 在这里空手而归的。
	 */
	const fold = await centre("[data-ly-turn-process] > .ly-flow-row[data-expandable]");
	if (fold) {
		await click(fold.x, fold.y);
		await settle(900);
	}

	const thinking = await read("[data-ly-thinking] .ly-flow-row");
	if (!thinking) {
		const seen = await app.evaluate<string>(
			'(() => {' +
				'const rows = [...document.querySelectorAll(".ly-flow-row")].map((e) => e.className + " | " + (e.textContent || "").slice(0, 40));' +
				'return JSON.stringify({ thinking: document.querySelectorAll("[data-ly-thinking]").length, flow: rows, ' +
				'transcript: (document.body.innerText || "").slice(0, 300) }, null, 1);' +
			'})()',
		);
		throw new Error(`转录里没找到思考行，页面上是：\n${seen}`);
	}
	const tool = await read("[data-ly-turn-process] .ly-flow-row:not([data-ly-thinking] *)");

	console.log("\n            盒宽   字宽    超出   遮罩   右虚化  边缘alpha  滚动位移  悬着");
	const line = (name: string, s: { rest: Shot; hot: Shot; span: number }) =>
		console.log(
			`${name.padEnd(10)}  ${String(s.rest.box).padStart(5)}  ${String(s.rest.text).padStart(6)}  ` +
				`${String(s.rest.over).padStart(5)}  ${(s.rest.masked ? "有" : "无").padStart(4)}  ` +
				`${s.rest.fadeRight.padStart(6)}  ${String(s.rest.alphaAtEdge).padStart(8)}  ` +
				`${String(Math.round(s.span * 10) / 10).padStart(8)}  ${s.hot.hovered ? "是" : "否"}`,
		);
	line("思考行", thinking);
	if (tool) line("工具行", tool);

	check("每一行都量到了悬停态", thinking.hot.hovered && (!tool || tool.hot.hovered), "合成悬停没被真实鼠标顶掉");

	check(
		"装不下的那一句，收尾是虚化不是省略号",
		thinking.rest.over > 1 && thinking.rest.masked && thinking.rest.fadeRight !== "0px" && thinking.rest.alphaAtEdge < 0.1,
		`超出 ${thinking.rest.over}px，遮罩${thinking.rest.masked ? "在" : "不在"}，右虚化 ${thinking.rest.fadeRight}，` +
			`右边缘 alpha ${thinking.rest.alphaAtEdge}`,
	);

	check(
		"鼠标放上去，那一句自己读出来",
		thinking.hot.hovered && thinking.span > 1,
		`逐帧量到的位移 ${Math.round(thinking.span * 10) / 10}px`,
	);

	if (tool) {
		check(
			"装得下的那一句，悬停纹丝不动",
			tool.rest.over <= 1 ? tool.span <= 1 : true,
			tool.rest.over <= 1 ? `超出 ${tool.rest.over}px，位移 ${Math.round(tool.span * 10) / 10}px` : `这一行本来就装不下（超出 ${tool.rest.over}px），不适用`,
		);
	}

	const spot = await centre("[data-ly-thinking] .ly-flow-row");
	if (spot) {
		await hover(spot.x, spot.y);
		await settle(900);
		const shot = await app.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
		await writeFile(join(dir, "hover-思考行.png"), Buffer.from(shot.data, "base64"));
		console.log(`\n截图：${join(dir, "hover-思考行.png")}`);
	}

	console.log(failures === 0 ? "\n全部通过" : `\n${failures} 条不通过`);
} finally {
	await app.stop();
}

process.exit(failures === 0 ? 0 : 1);
