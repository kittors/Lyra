/* oxlint-disable no-console -- probe CLI that prints what the real window did */
/**
 * 侧栏「项目行」的标题：静止时铺不铺满，悬停时怎么给按钮让位。跟会话行放在一起量。
 *
 * `node --experimental-strip-types e2e/project-head-hover-probe.ts [dir] [light|dark] [port] [sidebar-width]`
 *
 * 报上来的现象：项目名在一个固定位置就被截断化开，右边空着；鼠标放上去，开头的字被切掉、左边淡掉，
 * 右边离两颗悬停按钮还很远就化没了。同样长的会话行静止时铺满整行，悬停时字一直延伸到按钮跟前。
 * 这些只能在真窗口里问：位置要看文字那一格每一帧的 x，虚化要看浏览器算完的遮罩在每个 x 上给了多少 alpha。
 *
 * 每一行量三段，最后再量一段收起/展开：
 *   1. 静止：盒子、文字、图标、按钮条的位置，遮罩全实的区间，以及写给遮罩的那几个长度；
 *   2. 悬停：挂上逐帧记录再把指针移进去，记 96 帧（约 1.6 秒）：文字偏移、左右虚化、遮罩到哪儿为止；
 *   3. 离开：同样逐帧记 40 帧，看它回不回得去、中间有没有跳；
 *   4. 指针停在项目行上点一下收起、再点一下展开：计数挤进挤出，遮罩每一帧是不是都贴着按钮条。
 *
 * 读数全是「画出来的结果」：文字位置用 getBoundingClientRect（含 transform，滚动正是 transform），
 * 虚化用 computed mask 沿 x 轴插值，每帧画完之后才取样。写给遮罩的变量只是对账用的。
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { startApp } from "./app.ts";

const dir = process.argv[2] ?? "/tmp/lyra-project-head-hover";
const theme = process.argv[3] === "dark" ? "dark" : "light";
const port = Number(process.argv[4] ?? 9811);
/** 侧栏宽度：默认 272，最宽 420 也量一遍。 */
const sidebar = Number(process.argv[5] ?? 272);
const tag = `${theme}-${sidebar}`;

let failures = 0;
function check(label: string, passed: boolean, evidence: string): void {
	if (!passed) failures++;
	console.log(`${passed ? "✅" : "❌"} ${label}\n     ${evidence.replace(/\n/g, "\n     ")}`);
}

const usage = { input: 0, output: 0, total: 0, cacheRead: 0, cacheWrite: 0, cost: { input: 0, output: 0, total: 0, cacheRead: 0, cacheWrite: 0 } };

/** 一个项目：名字、下面几条会话、要不要收起。收起的那两个是为了量计数在的时候。 */
interface SeedProject {
	key: string;
	name: string;
	sessions: string[];
	collapsed?: boolean;
}

const PROJECTS: SeedProject[] = [
	{
		key: "bid",
		name: "智能投标对外公开项目",
		sessions: ["需要将所有的代码合并到 main 分支，然后解决冲突并推送到远端", "修复登录页样式", "整理接口文档"],
	},
	// 用户举的那个名字；底下放一条同名会话，同样的字、同样的宽，悬停时并排对照。
	{ key: "mgmt", name: "智能投标对外公开项目管理", sessions: ["智能投标对外公开项目管理", "补上单元测试"] },
	{ key: "long", name: "智能投标对外公开项目管理后台前端工程与运维监控平台", sessions: ["升级依赖"] },
	{ key: "short", name: "Lyra", sessions: ["侧栏悬停", "发版"] },
	{ key: "shut", name: "招投标文件智能审查平台", sessions: ["一", "二", "三", "四"], collapsed: true },
	{
		key: "shutlong",
		name: "政府采购电子招投标交易平台前端工程",
		sessions: Array.from({ length: 12 }, (_, i) => `第 ${i + 1} 条`),
		collapsed: true,
	},
];

const paths = new Map<string, string>();

async function seed(home: string): Promise<void> {
	await writeFile(join(home, "window.json"), JSON.stringify({ width: 1200, height: 860, x: 40, y: 40 }));
	const projects: object[] = [];
	const metas: object[] = [];
	let n = 0;
	for (const project of PROJECTS) {
		const path = join(home, "work", project.key);
		paths.set(project.key, path);
		const id = createHash("sha256").update(path).digest("hex").slice(0, 16);
		await mkdir(path, { recursive: true });
		await mkdir(join(home, "sessions", id), { recursive: true });
		projects.push({ id, name: project.name, path, pinned: false, lastOpenedAt: 1 });
		for (const [at, title] of project.sessions.entries()) {
			n++;
			const sid = `${project.key}-${at}`;
			const messages = [
				{ role: "user", content: [{ type: "text", text: "问" }], timestamp: 1 },
				{ role: "assistant", content: [{ type: "text", text: "答" }], api: "anthropic-messages", provider: "test", model: "test", usage, stopReason: "stop", timestamp: 2 },
			];
			const meta = {
				id: sid,
				title,
				cwd: path,
				projectId: id,
				projectName: project.name,
				createdAt: 1_700_000_000_000 + (100 - n) * 1000,
				updatedAt: 1_700_000_000_000 + (100 - n) * 1000,
				modelId: "test",
				messageCount: messages.length,
				usage,
				seq: messages.length + 1,
			};
			metas.push(meta);
			// 外层 seq 从 1 起：写 0 的 meta 会被读掉，会话连侧栏都进不去。
			await writeFile(
				join(home, "sessions", id, `${sid}.jsonl`),
				[
					JSON.stringify({ seq: 1, ts: 1, type: "meta", meta: { ...meta, seq: 0 } }),
					...messages.map((message, i) => JSON.stringify({ seq: i + 2, ts: i + 2, type: "message", message })),
					JSON.stringify({ seq: messages.length + 2, ts: 3, type: "meta", meta }),
				].join("\n") + "\n",
			);
		}
	}
	await writeFile(join(home, "sessions", "index.json"), JSON.stringify(metas));
	await writeFile(
		join(home, "settings.json"),
		JSON.stringify({
			version: 1,
			providers: [],
			mcpServers: [],
			projects,
			defaultModelId: null,
			permissionMode: "auto",
			thinking: "medium",
			retryAttempts: 3,
			hooks: [],
			scheduledTasks: [],
			disabledPlugins: [],
			alwaysAllow: [],
			sync: { enabled: false, port: 4541, token: null },
			appearance: { theme },
		}),
	);
}

/**
 * 注进页面的量具，装一次、之后按名字调。
 *
 * 遮罩解析照抄 sidebar-title-scroll-probe（不 import 它：那个文件顶层就会把自己整套跑一遍）。
 * 解析完要数一遍色标，漏认一个就抛——漏掉的数据给的不是「量不到」，是一个看着合理的错数。
 */
const INSTALL = [
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
	'  if (out.length !== colours) throw new Error("mask stops missed: " + css.slice(0, 300));',
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
	"const r1 = (v) => Math.round(v * 10) / 10;",
	/* 遮罩在盒子里的轮廓：从左数第一个可见/全实的 x，从右数最后一个全实/可见的 x。 */
	"const profile = (title) => {",
	"  const stops = maskStops(title);",
	"  const w = title.clientWidth;",
	"  let visibleFrom = null, solidFrom = null, solidTo = null, visibleTo = null;",
	"  for (let x = 0; x <= w; x += 0.5) {",
	"    const a = alphaAt(stops, x);",
	"    if (visibleFrom === null && a > 0.02) visibleFrom = x;",
	"    if (solidFrom === null && a >= 0.98) solidFrom = x;",
	"    if (a >= 0.98) solidTo = x;",
	"    if (a > 0.02) visibleTo = x;",
	"  }",
	"  return { stops, visibleFrom, solidFrom, solidTo, visibleTo };",
	"};",
	"const parts = (row) => {",
	"  const button = row.querySelector(':scope > button');",
	"  const title = row.querySelector('.ly-fade-tail');",
	"  const body = title.querySelector(':scope > span > span:not([data-ly-scroll-dup])');",
	"  const track = title.firstElementChild;",
	"  const lead = button.firstElementChild === title ? null : button.firstElementChild;",
	"  const count = row.hasAttribute('data-ly-project') ? button.lastElementChild : null;",
	"  const reveal = row.querySelector('[data-ly-hover-reveal]');",
	"  return { button, title, body, track, lead, count, reveal };",
	"};",
	"const txOf = (el) => {",
	"  const m = getComputedStyle(el).transform;",
	"  if (!m || m === 'none') return 0;",
	"  const v = m.match(/-?[\\d.]+(?:[eE][-+]?\\d+)?/g).map(Number);",
	"  return r1(v.length === 6 ? v[4] : v[12]);",
	"};",
	"window.__lyProbe = {",
	"  find(kind, key) {",
	"    const all = kind === 'project'",
	"      ? [...document.querySelectorAll('[data-ly-project]')].filter((el) => el.getAttribute('data-ly-project') === key)",
	"      : [...document.querySelectorAll('[data-ly-row]')].filter((el) => el.getAttribute('data-ly-row') === key);",
	"    return all.find((el) => el.getBoundingClientRect().height > 0) || null;",
	"  },",
	"  center(kind, key) {",
	"    const row = this.find(kind, key);",
	"    if (!row) return null;",
	"    const b = row.getBoundingClientRect();",
	/* 指针落在标题上而不是按钮条上：行宽的 40% 处，竖直居中。 */
	"    return { x: Math.round(b.left + b.width * 0.4), y: Math.round(b.top + b.height / 2), top: b.top, bottom: b.bottom, left: b.left, right: b.right };",
	"  },",
	"  shot(kind, key) {",
	"    const row = this.find(kind, key);",
	"    if (!row) return null;",
	"    const p = parts(row);",
	"    const rb = row.getBoundingClientRect();",
	"    const tb = p.title.getBoundingClientRect();",
	"    const bb = p.body.getBoundingClientRect();",
	"    const lb = p.lead ? p.lead.getBoundingClientRect() : null;",
	"    const cb = p.count ? p.count.getBoundingClientRect() : null;",
	"    const vb = p.reveal ? p.reveal.getBoundingClientRect() : null;",
	"    const cs = getComputedStyle(p.title);",
	"    const pr = profile(p.title);",
	"    const at = (x) => r1(alphaAt(pr.stops, Math.max(0, Math.min(x, p.title.clientWidth))));",
	"    return {",
	"      row: { left: r1(rb.left), right: r1(rb.right), width: r1(rb.width) },",
	"      lead: lb ? { left: r1(lb.left), right: r1(lb.right) } : null,",
	"      title: { left: r1(tb.left), right: r1(tb.right), width: r1(tb.width), client: p.title.clientWidth },",
	"      body: { left: r1(bb.left), right: r1(bb.right), width: r1(bb.width), offset: r1(bb.left - tb.left) },",
	"      count: cb ? { left: r1(cb.left), right: r1(cb.right), width: r1(cb.width), text: p.count.textContent, opacity: getComputedStyle(p.count).opacity } : null,",
	"      reveal: vb ? { left: r1(vb.left), right: r1(vb.right), width: r1(vb.width), opacity: getComputedStyle(p.reveal).opacity } : null,",
	"      gapLeadText: lb ? r1(bb.left - lb.right) : null,",
	"      titleRightToRowRight: r1(rb.right - tb.right),",
	"      revealLeftInTitle: vb ? r1(vb.left - tb.left) : null,",
	"      mask: { visibleFrom: pr.visibleFrom, solidFrom: pr.solidFrom, solidTo: pr.solidTo, visibleTo: pr.visibleTo },",
	"      alphaAtTextStart: at(bb.left - tb.left + 1),",
	"      alphaAtTextEnd: at(bb.right - tb.left - 1),",
	"      textGoneAt: r1(tb.left + Math.min(pr.visibleTo, bb.right - tb.left)),",
	"      textGoneToReveal: vb ? r1(vb.left - (tb.left + Math.min(pr.visibleTo, bb.right - tb.left))) : null,",
	"      vars: {",
	"        rowControls: getComputedStyle(row).getPropertyValue('--ly-row-controls').trim(),",
	"        left: cs.getPropertyValue('--ly-fade-left').trim(),",
	"        right: cs.getPropertyValue('--ly-fade-right').trim(),",
	/* 有效清除 = 宽度 × 露没露出来（0 到 1）；只看宽度会把静止时的常驻值当成已经清掉了。 */
	"        clear: r1((parseFloat(cs.getPropertyValue('--ly-fade-clear')) || 0) * (parseFloat(cs.getPropertyValue('--ly-fade-reveal') || '1') || 0)) + 'px',",
	"      },",
	"      fit: p.title.getAttribute('data-ly-scroll-fit'),",
	"      edge: p.title.classList.contains('ly-fade-edge'),",
	"      scrolls: cs.getPropertyValue('--ly-marquee').trim() !== '',",
	"      tx: txOf(p.track),",
	"      anims: p.track.getAnimations().map((a) => a.animationName + ':' + a.playState),",
	"      hovered: row.matches(':hover'),",
	"    };",
	"  },",
	/* 逐帧：锁住同一组节点，不每帧按选择器重查。 */
	"  track(kind, key, frames) {",
	"    const row = this.find(kind, key);",
	"    if (!row) return false;",
	"    const p = parts(row);",
	"    const log = [];",
	"    window.__lyTrack = log;",
	"    const t0 = performance.now();",
	/*
	 * 每帧画完再取样：rAF 回调在这一帧的布局和 ResizeObserver 之前跑，那时按钮条还没把新的让位写上，
	 * 读到的是「新盒子配旧让位」，并不是画出来的样子。从 rAF 里排一个 setTimeout(0)，它在这一帧
	 * 渲染完之后才跑。
	 */
	"    const sample = () => {",
	"      if (!p.title.isConnected) return;",
	"      const tb = p.title.getBoundingClientRect();",
	"      const bb = p.body.getBoundingClientRect();",
	"      const lb = p.lead ? p.lead.getBoundingClientRect() : null;",
	"      const cs = getComputedStyle(p.title);",
	"      const pr = profile(p.title);",
	"      log.push({",
	"        t: Math.round(performance.now() - t0),",
	"        offset: r1(bb.left - tb.left),",
	"        gapLeadText: lb ? r1(bb.left - lb.right) : null,",
	"        titleWidth: r1(tb.width),",
	"        left: cs.getPropertyValue('--ly-fade-left').trim(),",
	"        right: cs.getPropertyValue('--ly-fade-right').trim(),",
	"        clear: r1((parseFloat(cs.getPropertyValue('--ly-fade-clear')) || 0) * (parseFloat(cs.getPropertyValue('--ly-fade-reveal') || '1') || 0)) + 'px',",
	"        solidFrom: pr.solidFrom,",
	"        solidTo: pr.solidTo,",
	"        visibleTo: pr.visibleTo,",
	"        fit: p.title.getAttribute('data-ly-scroll-fit'),",
	"        count: p.count ? getComputedStyle(p.count).opacity : null,",
	"        reveal: p.reveal ? getComputedStyle(p.reveal).opacity : null,",
	"        rowControls: getComputedStyle(row).getPropertyValue('--ly-row-controls').trim(),",
	/* 字画到哪儿为止（遮罩可见的尽头和文字右缘取小的那个），减去按钮条左缘：正数是压进按钮底下了。 */
	"        endToStrip: p.reveal ? r1(tb.left + Math.min(pr.visibleTo, bb.right - tb.left) - p.reveal.getBoundingClientRect().left) : null,",
	"        expanded: p.button.getAttribute('aria-expanded'),",
	/* 遮罩可见的尽头减按钮条左缘：不管字滚到哪儿，这是「让到哪儿为止」。正数是遮罩把字放进了按钮底下。 */
	"        maskEndToStrip: p.reveal ? r1(tb.left + pr.visibleTo - p.reveal.getBoundingClientRect().left) : null,",
	"        hovered: row.matches(':hover'),",
	"      });",
	"    };",
	"    let n = 0;",
	"    const tick = () => {",
	"      setTimeout(sample, 0);",
	"      if (++n < frames) requestAnimationFrame(tick);",
	"    };",
	"    requestAnimationFrame(tick);",
	"    return true;",
	"  },",
	"  readTrack() { return window.__lyTrack || []; },",
	"};",
	"true",
].join("\n");

interface Box {
	left: number;
	right: number;
	width: number;
}

interface Shot {
	row: Box;
	lead: { left: number; right: number } | null;
	title: Box & { client: number };
	body: Box & { offset: number };
	count: (Box & { text: string; opacity: string }) | null;
	reveal: (Box & { opacity: string }) | null;
	gapLeadText: number | null;
	titleRightToRowRight: number;
	revealLeftInTitle: number | null;
	mask: { visibleFrom: number | null; solidFrom: number | null; solidTo: number | null; visibleTo: number | null };
	alphaAtTextStart: number;
	alphaAtTextEnd: number;
	textGoneAt: number;
	textGoneToReveal: number | null;
	vars: { rowControls: string; left: string; right: string; clear: string };
	fit: string | null;
	edge: boolean;
	scrolls: boolean;
	tx: number;
	anims: string[];
	hovered: boolean;
}

interface Frame {
	t: number;
	offset: number;
	gapLeadText: number | null;
	titleWidth: number;
	left: string;
	right: string;
	clear: string;
	solidFrom: number | null;
	solidTo: number | null;
	visibleTo: number | null;
	fit: string | null;
	count: string | null;
	reveal: string | null;
	rowControls: string;
	endToStrip: number | null;
	maskEndToStrip: number | null;
	expanded: string | null;
	hovered: boolean;
}

const settle = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** 要量的行。项目行按名字找，会话行按 id 找。 */
const TARGETS: Array<{ label: string; kind: "project" | "session"; key: string }> = [
	{ label: "项目·智能投标对外公开项目", kind: "project", key: "智能投标对外公开项目" },
	{ label: "项目·智能投标对外公开项目管理", kind: "project", key: "智能投标对外公开项目管理" },
	{ label: "项目·超长名", kind: "project", key: "智能投标对外公开项目管理后台前端工程与运维监控平台" },
	{ label: "项目·短名 Lyra", kind: "project", key: "Lyra" },
	{ label: "项目·收起（计数 4）", kind: "project", key: "招投标文件智能审查平台" },
	{ label: "项目·收起长名（计数 12）", kind: "project", key: "政府采购电子招投标交易平台前端工程" },
	{ label: "会话·长标题", kind: "session", key: "bid-0" },
	{ label: "会话·同名（项目管理）", kind: "session", key: "mgmt-0" },
	{ label: "会话·短标题", kind: "session", key: "bid-1" },
];

const app = await startApp({ port, seed });

async function move(x: number, y: number): Promise<void> {
	await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "none", buttons: 0 });
}

/** 列表外、主区空白处——离开用。 */
const AWAY = { x: 760, y: 520 };

/**
 * 拍整窗再裁出这一行附近，不用 `clip`。
 *
 * 带 `clip` + `scale` 的 `Page.captureScreenshot` 拍到的是动画起点：同一时刻逐帧读数说文字已经左移
 * 60 多像素、右端清掉了 48px，截图里却是一整行没动过的字。整窗截图和读数对得上，所以一律拍整窗，
 * 裁剪交给 sips（系统自带）。窗口 devicePixelRatio 是 2，坐标乘 2。
 */
async function snap(file: string, where: { top: number; bottom: number; right: number }): Promise<void> {
	const shot = await app.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
	const whole = `${file}.whole.png`;
	await writeFile(whole, Buffer.from(shot.data, "base64"));
	const y = Math.max(0, Math.round((where.top - 30) * 2));
	const h = Math.round((where.bottom - where.top + 60) * 2);
	const w = Math.round((where.right + 30) * 2);
	execFileSync("sips", ["-c", String(h), String(w), "--cropOffset", String(y), "0", whole, "--out", file], { stdio: "ignore" });
	await rm(whole, { force: true });
}

try {
	await mkdir(dir, { recursive: true });
	await settle(2500);

	// 两个收起的项目：写进记忆里的那份再重载，走的是真实的「上次收起的还收着」。
	const shut = PROJECTS.filter((p) => p.collapsed).map((p) => paths.get(p.key));
	await app.evaluate(
		`localStorage.setItem("ly-collapsed-projects", ${JSON.stringify(JSON.stringify(shut))}); localStorage.setItem("dw:sidebar-width", "${sidebar}"); location.reload(); true`,
	);
	await settle(4000);
	await app.evaluate<boolean>(INSTALL);

	const rows = await app.evaluate<number>("document.querySelectorAll('[data-ly-project]').length");
	check("侧栏把每个项目都画出来了", rows >= PROJECTS.length, `${rows} 个项目行，要 ${PROJECTS.length} 个`);

	type Entry = { label: string; kind: string; rest: Shot; hot: Shot; after: Shot; enter: Frame[]; leave: Frame[] };

	/** 量一行：静止、进入（逐帧）、离开（逐帧），外加三张截图。 */
	async function measure(target: (typeof TARGETS)[number]): Promise<Entry | null> {
		const where = await app.evaluate<{ x: number; y: number; top: number; bottom: number; left: number; right: number } | null>(
			`window.__lyProbe.center(${JSON.stringify(target.kind)}, ${JSON.stringify(target.key)})`,
		);
		if (!where) return null;
		await move(AWAY.x, AWAY.y);
		await settle(500);
		const rest = await app.evaluate<Shot>(`window.__lyProbe.shot(${JSON.stringify(target.kind)}, ${JSON.stringify(target.key)})`);
		const name = `${tag}-${target.kind === "project" ? "项目" : "会话"}-${target.key.slice(0, 13)}`;
		await snap(join(dir, `${name}-1静止.png`), where);

		// 先挂记录再进去：进去那一帧就要在记录里。
		await app.evaluate<boolean>(`window.__lyProbe.track(${JSON.stringify(target.kind)}, ${JSON.stringify(target.key)}, 96)`);
		await move(where.x, where.y);
		await settle(120);
		// 合成事件会被真实鼠标顶掉，再按一下把悬停态按住。
		await move(where.x + 1, where.y);
		// 刚悬停：按钮已经淡进来、遮罩的右端已经变了，跑马灯还在 300ms 的延迟里。
		await settle(110);
		await snap(join(dir, `${name}-2悬停230ms.png`), where);
		await settle(1300);
		const enter = await app.evaluate<Frame[]>("window.__lyProbe.readTrack()");
		const hot = await app.evaluate<Shot>(`window.__lyProbe.shot(${JSON.stringify(target.kind)}, ${JSON.stringify(target.key)})`);
		await snap(join(dir, `${name}-3悬停1.6s.png`), where);

		await app.evaluate<boolean>(`window.__lyProbe.track(${JSON.stringify(target.kind)}, ${JSON.stringify(target.key)}, 40)`);
		await move(AWAY.x, AWAY.y);
		await settle(900);
		const leave = await app.evaluate<Frame[]>("window.__lyProbe.readTrack()");
		const after = await app.evaluate<Shot>(`window.__lyProbe.shot(${JSON.stringify(target.kind)}, ${JSON.stringify(target.key)})`);
		return { label: target.label, kind: target.kind, rest, hot, after, enter, leave };
	}

	const report: Entry[] = [];
	for (const target of TARGETS) {
		/*
		 * 悬停被真实鼠标抢走的那一轮不算，重量这一行，最多三次。
		 *
		 * 窗口开在桌面左上角，人在旁边用电脑时指针随时会划过它。判据是进入 200ms 之后的每一帧都悬着、
		 * 离开后的读数不悬着——中途丢过一次悬停，跑马灯就重新起步，逐帧曲线会是两段拼起来的。
		 */
		let entry: Entry | null = null;
		for (let attempt = 1; attempt <= 3; attempt++) {
			entry = await measure(target);
			if (!entry) break;
			const held = entry.hot.hovered && entry.enter.filter((f) => f.t > 200).every((f) => f.hovered) && !entry.rest.hovered && !entry.after.hovered;
			if (held) break;
			console.log(`   ⚠️ ${target.label} 第 ${attempt} 轮悬停被真实鼠标打断，${attempt < 3 ? "重量" : "放弃"}`);
		}
		if (!entry) {
			check(`找到 ${target.label}`, false, "没找到这一行");
			continue;
		}
		report.push(entry);
	}

	// 一张整窗，留着肉眼对账：指针停在用户举的那个项目名上 1.6 秒。
	const mgmt = await app.evaluate<{ x: number; y: number; top: number; bottom: number; right: number }>(`window.__lyProbe.center("project", "智能投标对外公开项目管理")`);
	await move(mgmt.x, mgmt.y);
	await settle(1600);
	const whole = await app.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
	await writeFile(join(dir, `${tag}-整窗-悬停项目行.png`), Buffer.from(whole.data, "base64"));

	/*
	 * 指针停在行上点一下收起、再点一下展开，逐帧记。
	 *
	 * 收起时计数挤进来，标题变窄；行和按钮条的尺寸都没变，所以按钮条得自己看着标题重量，量完还要叫
	 * ScrollText 用新的让位重判。每一帧问的都是：字画到哪儿为止，离按钮条左缘多远。
	 */
	async function click(x: number, y: number): Promise<void> {
		await app.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1 });
		await app.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount: 1 });
	}
	const toggles: Array<{ label: string; frames: Frame[]; last: Shot }> = [];
	for (const label of ["收起", "展开"]) {
		await move(mgmt.x, mgmt.y);
		await settle(700);
		await app.evaluate<boolean>(`window.__lyProbe.track("project", "智能投标对外公开项目管理", 48)`);
		await settle(50);
		await click(mgmt.x, mgmt.y);
		await settle(900);
		const frames = await app.evaluate<Frame[]>("window.__lyProbe.readTrack()");
		const last = await app.evaluate<Shot>(`window.__lyProbe.shot("project", "智能投标对外公开项目管理")`);
		await snap(join(dir, `${tag}-项目-智能投标对外公开项目管理-4点${label}后.png`), mgmt);
		toggles.push({ label, frames, last });
	}
	await move(AWAY.x, AWAY.y);
	await writeFile(join(dir, `${tag}-report.json`), JSON.stringify({ report, toggles }, null, 2));

	const fmt = (v: unknown) => String(v ?? "-");
	console.log(`\n[${tag}] 静止 → 悬停 1.6s 后`);
	console.log("行                          盒宽   文字宽  盒右→行右  图标→字(静/悬)  字偏移(悬)  左虚化(悬)  行控件  清除(悬)  全实到/按钮左(悬)  字消失→按钮(静/悬)  按钮α  判定");
	for (const r of report) {
		console.log(
			`${r.label.padEnd(24)}  ${fmt(r.rest.title.width).padStart(6)}  ${fmt(r.rest.body.width).padStart(6)}  ${fmt(r.rest.titleRightToRowRight).padStart(8)}  ` +
				`${fmt(r.rest.gapLeadText)}/${fmt(r.hot.gapLeadText)}`.padStart(14) +
				`  ${fmt(r.hot.body.offset).padStart(9)}  ${fmt(r.hot.vars.left).padStart(9)}  ${fmt(r.hot.vars.rowControls).padStart(6)}  ${fmt(r.hot.vars.clear).padStart(7)}  ` +
				`${fmt(r.hot.mask.solidTo)}/${fmt(r.hot.revealLeftInTitle)}`.padStart(16) +
				`  ${fmt(r.rest.textGoneToReveal)}/${fmt(r.hot.textGoneToReveal)}`.padStart(18) +
				`  ${fmt(r.hot.reveal?.opacity).padStart(5)}  ${fmt(r.hot.fit)}${r.hot.hovered ? "" : "(没悬着)"}`,
		);
	}

	console.log(`\n[${tag}] 逐帧（悬停进入，每 6 帧取一帧）：t  字偏移  左虚化  右虚化  清除  全实起  全实到  计数α  按钮α  字尾→按钮`);
	for (const r of report) {
		console.log(`  ${r.label}`);
		for (const [i, f] of r.enter.entries()) {
			if (i % 6 !== 0 && i !== r.enter.length - 1) continue;
			console.log(
				`    ${String(f.t).padStart(5)}ms  ${fmt(f.offset).padStart(6)}  ${f.left.padStart(8)}  ${f.right.padStart(8)}  ${f.clear.padStart(8)}  ${fmt(f.solidFrom).padStart(5)}  ${fmt(f.solidTo).padStart(6)}  ${fmt(f.count).padStart(5)}  ${fmt(f.reveal).padStart(5)}  ${fmt(f.endToStrip).padStart(6)}${f.hovered ? "" : "  (没悬着)"}`,
			);
		}
	}

	console.log(`\n[${tag}] 指针停在行上点收起/展开，逐帧：t  展开  盒宽  行控件  清除  判定  字尾→按钮  遮罩尽头→按钮  字偏移`);
	for (const g of toggles) {
		console.log(`  点${g.label}`);
		for (const [i, f] of g.frames.entries()) {
			if (i % 2 !== 0 && i !== g.frames.length - 1 && i > 16) continue;
			console.log(
				`    ${String(f.t).padStart(5)}ms  ${fmt(f.expanded).padStart(5)}  ${fmt(f.titleWidth).padStart(6)}  ${f.rowControls.padStart(6)}  ${f.clear.padStart(9)}  ${fmt(f.fit).padStart(5)}  ${fmt(f.endToStrip).padStart(6)}  ${fmt(f.maskEndToStrip).padStart(8)}  ${fmt(f.offset).padStart(6)}${f.hovered ? "" : "  (没悬着)"}`,
			);
		}
	}

	/*
	 * 判据。项目行对齐会话行：
	 *   静. 没有计数时标题铺满整行，右边只剩按钮的 pr-2；有计数时标题一直延伸到计数跟前（gap-2.5）；
	 *   a. 装得下、没被按钮压住的标题，悬停全程不位移；
	 *   b. 同上，悬停时左边不虚化、文字末端 alpha 仍是 1；
	 *   c. 被按钮压住或本来就溢出的，字化到按钮跟前才没：消失点到按钮左缘 0 到 4px，不压进按钮底下；
	 *   d. 进出过程中盒宽不变（不抖）；
	 *   e. 悬停按钮真的出来了（不透明度 1）。
	 */
	const valid = report.filter((r) => r.hot.hovered);
	check("每一行都量到了悬停态", valid.length === report.length, `${valid.length}/${report.length}`);

	for (const r of valid) {
		if (r.kind === "project") {
			if (!r.rest.count || r.rest.count.width < 0.5) {
				check(`${r.label}：静止时标题铺满整行`, r.rest.titleRightToRowRight <= 8.5, `标题盒右缘离行右缘 ${r.rest.titleRightToRowRight}px（会话行是 6）`);
			} else {
				const gap = Math.round((r.rest.count.left - r.rest.title.right) * 10) / 10;
				check(`${r.label}：静止时标题一直延伸到计数跟前`, gap <= 10.5, `标题盒右缘到计数左缘 ${gap}px，计数「${r.rest.count.text}」宽 ${r.rest.count.width}px`);
			}
		}
		check(`${r.label}：悬停按钮出来了`, Number(r.hot.reveal?.opacity ?? 0) >= 0.99, `按钮条不透明度 ${r.hot.reveal?.opacity}`);
		const fits = r.rest.body.width <= r.rest.title.client + 1;
		const covered = r.hot.revealLeftInTitle !== null && r.rest.body.offset + r.rest.body.width > r.hot.revealLeftInTitle + 0.5;
		if (fits && !covered) {
			const moved = r.enter.filter((f) => Math.abs(f.offset) > 0.5);
			check(
				`${r.label}：装得下、没被按钮压住，悬停全程不位移`,
				moved.length === 0,
				moved.length === 0 ? `${r.enter.length} 帧偏移都是 0` : `${moved.length} 帧有位移，最远 ${Math.min(...moved.map((f) => f.offset))}px（从 ${moved[0]?.t}ms 起）`,
			);
			const blurred = r.enter.filter((f) => (f.solidFrom ?? 0) > 0.5);
			check(
				`${r.label}：悬停时左边不虚化`,
				blurred.length === 0,
				blurred.length === 0 ? "每一帧全实都从 0 起" : `${blurred.length} 帧左边有虚化，最深到 ${Math.max(...blurred.map((f) => f.solidFrom ?? 0))}px`,
			);
			check(
				`${r.label}：悬停时文字末端完好`,
				r.hot.alphaAtTextEnd >= 0.98,
				`末端 alpha ${r.hot.alphaAtTextEnd}（静止 ${r.rest.alphaAtTextEnd}）`,
			);
		}
		if (!fits || covered) {
			/*
			 * 看遮罩在哪儿化没，不看字尾：跑马灯起步之后字尾在动，1.6 秒时它可能已经滚到左半边了。
			 * 遮罩的可见尽头才是「让到哪儿为止」，它要贴着按钮条左缘，差 0 到 4px。
			 */
			const gap = r.hot.revealLeftInTitle !== null && r.hot.mask.visibleTo !== null ? Math.round((r.hot.revealLeftInTitle - r.hot.mask.visibleTo) * 10) / 10 : 99;
			const early = r.enter.filter((f) => f.t > 200 && f.t < 290).map((f) => f.endToStrip);
			check(
				`${r.label}：悬停时字化到按钮跟前才没`,
				gap >= -0.5 && gap <= 4,
				`遮罩尽头到按钮左缘 ${gap}px；跑马灯起步前（200–290ms）字尾到按钮左缘 ${[...new Set(early)].join(", ")}px；判定 ${r.hot.fit}`,
			);
		}
		const widths = new Set([...r.enter, ...r.leave].map((f) => f.titleWidth));
		check(`${r.label}：进出过程中盒宽不变`, widths.size === 1, `盒宽出现过 ${[...widths].join(", ")}`);
		const back = Math.abs(r.after.body.offset - r.rest.body.offset) <= 0.5 && r.after.mask.solidFrom === r.rest.mask.solidFrom && r.after.mask.solidTo === r.rest.mask.solidTo;
		check(`${r.label}：离开后回到静止的样子`, back, `偏移 ${r.rest.body.offset}→${r.after.body.offset}，全实 ${r.rest.mask.solidFrom}-${r.rest.mask.solidTo} → ${r.after.mask.solidFrom}-${r.after.mask.solidTo}`);
	}

	for (const g of toggles) {
		const held = g.frames.filter((f) => f.t > 60).every((f) => f.hovered) && g.last.hovered;
		if (!held) {
			console.log(`   ⚠️ 点${g.label}那一轮悬停被真实鼠标打断，读数不算数`);
			continue;
		}
		// 从 aria-expanded 翻过来的那一帧算起：点击在第几帧落地取决于 CDP 的往返，不能按时间猜。
		const flip = g.frames.findIndex((f) => f.expanded !== g.frames[0]?.expanded);
		const after = flip >= 0 ? g.frames.slice(flip) : [];
		if (flip < 0) check(`点${g.label}真的切过去了`, false, "逐帧记录里 aria-expanded 一直没变");
		const off = after.filter((f) => f.maskEndToStrip === null || f.maskEndToStrip < -4 || f.maskEndToStrip > 0.5);
		check(
			`点${g.label}时（指针在行上），遮罩每一帧都贴着按钮条`,
			off.length === 0,
			off.length === 0
				? `${after.length} 帧遮罩尽头都在按钮左缘 0 到 4px 内；行控件 ${g.last.vars.rowControls}，判定 ${g.last.fit ?? "不滚"}`
				: `${off.length} 帧跑开了：${off.map((f) => `${f.t}ms ${f.maskEndToStrip}px`).join("，")}`,
		);
	}

	console.log(`\n截图与报告：${dir}`);
	console.log(failures === 0 ? "\n全部通过" : `\n${failures} 条不通过`);
} finally {
	await app.stop();
}

process.exit(failures === 0 ? 0 : 1);
