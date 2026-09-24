/* oxlint-disable no-console -- probe CLI that prints what the real window did */
/**
 * 侧边栏会话标题的两件事：悬停会不会自读，以及尾巴被削掉多少。
 *
 * `node --experimental-strip-types e2e/sidebar-title-scroll-probe.ts [dir]`
 *
 * 报上来的现象有两条，看着不相干：长标题悬停不滚了；短标题——短到根本不需要滚的那种——悬停时
 * 尾巴少一截。两条都只能在真窗口里问，因为两条的答案都在「算完之后画出来的东西」里：滚没滚要看
 * 文字的 x 每一帧有没有动，削没削要看遮罩在**文字末端那个 x** 上的 alpha 是多少。写给遮罩的那
 * 几个自定义属性各自都对，合起来仍然可以把最后三个字抹平。
 *
 * 所以这里量三件：
 *   1. 悬停之后逐帧记 body span 的 left，位移超过 1px 才算在滚；
 *   2. 遮罩沿 x 轴插值，取文字右边缘处的 alpha，1 是完好，0 是没了；
 *   3. 标题长度做成阶梯（1..26 个等宽汉字），临界点必然落在里面——「刚好不溢出但伸进图标区」
 *      的那几行，正是客户截图里的那一行。
 */

import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { startApp } from "./app.ts";

const dir = process.argv[2] ?? "/tmp/lyra-title-scroll";

let failures = 0;
function check(label: string, passed: boolean, evidence: string): void {
	if (!passed) failures++;
	console.log(`${passed ? "✅" : "❌"} ${label}\n     ${evidence.replace(/\n/g, "\n     ")}`);
}

const usage = { input: 0, output: 0, total: 0, cacheRead: 0, cacheWrite: 0, cost: { input: 0, output: 0, total: 0, cacheRead: 0, cacheWrite: 0 } };

/**
 * 五个字数，三类情形，一次问完。
 *
 * 侧边栏每个项目默认只摊开五行，多造的会被「显示更多」收起来——第一版造了 26 行，量到的全是最长
 * 的那五条，临界区一条没碰上。实测每个汉字约 14px、盒宽 216、图标条左边缘在 169：
 *
 *   11 字（154px）  没碰到图标，一个像素都不该动它
 *   13/14/15 字     伸到图标底下了，但远没溢出——客户截图里的那一行就在这一档
 *   18 字（252px）  真溢出，该滚
 */
const LENGTHS = [11, 13, 14, 15, 18];

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

	const metas: object[] = [];
	for (const n of LENGTHS) {
		const sid = `s${String(n).padStart(2, "0")}`;
		const messages = [
			{ role: "user", content: [{ type: "text", text: "问" }], timestamp: 1 },
			{ role: "assistant", content: [{ type: "text", text: "答" }], api: "anthropic-messages", provider: "test", model: "test", usage, stopReason: "stop", timestamp: 2 },
		];
		const meta = {
			id: sid,
			title: "字".repeat(n),
			cwd: path,
			projectId: id,
			projectName: "验收工程",
			createdAt: 1_700_000_000_000 + n * 1000,
			updatedAt: 1_700_000_000_000 + (40 - n) * 1000,
			modelId: "test",
			messageCount: messages.length,
			usage,
			seq: messages.length + 1,
		};
		metas.push(meta);
		await writeFile(
			join(home, "sessions", id, `${sid}.jsonl`),
			[
				JSON.stringify({ seq: 0, ts: 1, type: "meta", meta }),
				...messages.map((message, at) => JSON.stringify({ seq: at + 1, ts: at + 1, type: "message", message })),
				JSON.stringify({ seq: meta.seq, ts: 2, type: "meta", meta }),
			].join("\n") + "\n",
		);
	}
	await writeFile(join(home, "sessions", "index.json"), JSON.stringify(metas));
}

const app = await startApp({ port: 9563, seed });
const settle = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 遮罩沿 x 轴插值，注进页面里跑。
 *
 * 问的是输出不是输入：`--ly-fade-clear` 写了多少不重要，重要的是文字最后一个字所在的那个 x 上，
 * 浏览器算完的遮罩给了多少 alpha。computed 里顶上那几个 stop 已经是 px，底下那几个还留着
 * `calc(100% - ...)`，按 clientWidth 代进去——两种形状都得认。
 */
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

/** 一行在某个状态下，画出来的样子。 */
interface Shot {
	/** 标题盒子的宽度，也就是文字最多能占多少。 */
	box: number;
	/** 文字自己有多宽。比 box 大就是溢出。 */
	text: number;
	/** 文字右边缘在盒子里的位置，越界时大于 box。 */
	textRight: number;
	/** 遮罩在文字右边缘处的 alpha。1 是完好，0 是被抹平。 */
	alphaAtText: number;
	/** 最右的那个还全实的 x——文字画过这里就开始淡，画不到这里就一点事没有。 */
	solidTo: number;
	/** 图标条左边缘在盒子坐标系里的位置。文字没越过它就不该让位。 */
	controlsLeft: number;
	/** 写给遮罩的那三个长度，出了事好对账。 */
	vars: { left: string; right: string; clear: string; controls: string };
	/** 这一行有没有 marquee 需要的那两个变量（只有判定为读不全才会写）。 */
	scrolls: boolean;
	/**
	 * 量这一下的时候，指针到底在不在这一行上。
	 *
	 * 探针发的是合成的 `mouseMoved`，而真实的鼠标一动就把悬停态抢回去——窗口开在桌面左上角，
	 * 人在旁边用电脑的时候，量到的「没滚」和「没让位」全是假的。所以每个读数自带一句「我当时
	 * 悬着没有」，对不上就重跑，不许当结论。
	 */
	hovered: boolean;
}

const SHOT = (sid: string) =>
	`(() => {
	${MASK_X}
	const row = document.querySelector('[data-ly-row="${sid}"]');
	if (!row) return null;
	const title = row.querySelector(".ly-fade-tail");
	const body = title && title.querySelector(":scope > span > span:not([data-ly-scroll-dup])");
	if (!title || !body) return null;
	const tb = title.getBoundingClientRect();
	const bb = body.getBoundingClientRect();
	const reveal = row.querySelector("[data-ly-hover-reveal]");
	const rb = reveal ? reveal.getBoundingClientRect() : null;
	const cs = getComputedStyle(title);
	const stops = maskStops(title);
	let solid = title.clientWidth;
	if (stops) {
		for (let x = title.clientWidth; x >= 0; x--) {
			if (alphaAt(stops, x) >= 0.98) { solid = x; break; }
			solid = 0;
		}
	}
	return {
		box: Math.round(tb.width * 10) / 10,
		text: Math.round(bb.width * 10) / 10,
		textRight: Math.round((bb.right - tb.left) * 10) / 10,
		alphaAtText: Math.round(alphaAt(stops, Math.min(bb.right - tb.left, title.clientWidth)) * 100) / 100,
		solidTo: solid,
		controlsLeft: rb ? Math.round((rb.left - tb.left) * 10) / 10 : -1,
		vars: {
			left: cs.getPropertyValue("--ly-fade-left").trim(),
			right: cs.getPropertyValue("--ly-fade-right").trim(),
			clear: cs.getPropertyValue("--ly-fade-clear").trim(),
			controls: cs.getPropertyValue("--ly-row-controls").trim(),
		},
		scrolls: cs.getPropertyValue("--ly-marquee").trim() !== "",
		hovered: row.matches(":hover"),
	};
})()`;

/** 悬停之后逐帧记文字的 x，问的是「画出来动没动」，不是「动画对象在不在」。 */
const TRACK_START = (sid: string) =>
	`(() => {
	const row = document.querySelector('[data-ly-row="${sid}"]');
	const body = row && row.querySelector(".ly-fade-tail > span > span:not([data-ly-scroll-dup])");
	if (!body) return false;
	window.__lyTrack = { xs: [], anims: [] };
	const tick = () => {
		window.__lyTrack.xs.push(Math.round(body.getBoundingClientRect().left * 10) / 10);
		if (window.__lyTrack.xs.length < 90) requestAnimationFrame(tick);
	};
	requestAnimationFrame(tick);
	return true;
})()`;

const TRACK_READ = (sid: string) =>
	`(() => {
	const row = document.querySelector('[data-ly-row="${sid}"]');
	const track = row && row.querySelector(".ly-marquee-track");
	const anims = track ? track.getAnimations().map((a) => (a.animationName || "") + ":" + a.playState) : [];
	const xs = (window.__lyTrack && window.__lyTrack.xs) || [];
	return { xs, span: xs.length ? Math.max(...xs) - Math.min(...xs) : 0, anims, frames: xs.length };
})()`;

async function hover(x: number, y: number): Promise<void> {
	await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "none", buttons: 0 });
}

try {
	await mkdir(dir, { recursive: true });
	await settle(3500);

	const ready = await app.evaluate<number>('document.querySelectorAll("[data-ly-row]").length');
	check("侧边栏把会话行都摊开了", ready >= LENGTHS.length, `${ready} 行，要 ${LENGTHS.length} 行`);

	const report: Array<{ n: number; rest: Shot; hot: Shot; span: number; anims: string[]; frames: number }> = [];

	for (const n of LENGTHS) {
		const sid = `s${String(n).padStart(2, "0")}`;
		const box = await app.evaluate<{ x: number; y: number } | null>(
			`(() => { const r = document.querySelector('[data-ly-row="${sid}"]'); if (!r) return null; const b = r.getBoundingClientRect(); return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) }; })()`,
		);
		if (!box) continue;

		// 先把指针挪到列表外，上一行的悬停态不能算进这一行的静止态。
		await hover(700, 500);
		await settle(260);
		const rest = await app.evaluate<Shot>(SHOT(sid));

		await hover(box.x, box.y);
		// 合成事件会被真实鼠标顶掉，多发两下把悬停态按住。
		await settle(120);
		await hover(box.x + 1, box.y);
		await settle(640);
		await app.evaluate<boolean>(TRACK_START(sid));
		await settle(1100);
		const track = await app.evaluate<{ xs: number[]; span: number; anims: string[]; frames: number }>(TRACK_READ(sid));
		const hot = await app.evaluate<Shot>(SHOT(sid));

		report.push({ n, rest, hot, span: track.span, anims: track.anims, frames: track.frames });
		if (!hot.hovered) {
			console.log(`   ⚠️ ${n} 字这一轮指针没在行上，读数不算数——真实鼠标抢走了悬停态`);
		}
	}

	await hover(700, 500);
	await settle(300);

	console.log("\n字数  盒宽   文字宽  图标左  静止alpha  悬停alpha  悬停实到  滚动位移  悬着  动画");
	for (const r of report) {
		console.log(
			`${String(r.n).padStart(3)}  ${String(r.rest.box).padStart(6)}  ${String(r.rest.text).padStart(6)}  ` +
				`${String(r.rest.controlsLeft).padStart(6)}  ${String(r.rest.alphaAtText).padStart(8)}  ` +
				`${String(r.hot.alphaAtText).padStart(9)}  ${String(r.hot.solidTo).padStart(8)}  ` +
				`${String(Math.round(r.span * 10) / 10).padStart(8)}  ${r.hot.hovered ? "是" : "否"}  ${r.anims.join(",") || "无"}`,
		);
	}

	/*
	 * 判据一：溢出的行悬停要真的在动。
	 *
	 * 「动画对象在不在」不算数——`getAnimations()` 可以给出一个 running 的对象而位移是 0（变量没写、
	 * 被 reduce-motion 掐掉、track 的 display 不对都会这样）。只认逐帧量到的位移。
	 */
	const valid = report.filter((r) => r.hot.hovered);
	check("每一行都量到了悬停态", valid.length === report.length, `${valid.length}/${report.length} 行当时指针确实在行上`);

	const overflowing = valid.filter((r) => r.rest.text > r.rest.box + 1);
	const moved = overflowing.filter((r) => r.span > 1);
	check(
		"文字溢出的行，悬停会自己读出来",
		overflowing.length > 0 && moved.length === overflowing.length,
		`溢出 ${overflowing.length} 行，其中真的在动的 ${moved.length} 行` +
			(moved.length < overflowing.length
				? `；没动的字数：${overflowing.filter((r) => r.span <= 1).map((r) => r.n).join(",")}`
				: ""),
	);

	/*
	 * 判据二：没伸到图标底下的文字，一个像素都不该被削。
	 *
	 * 这一条是客户截图里的那一行：标题短到根本不需要滚，悬停之后尾巴仍然淡掉甚至被切平——遮罩按
	 * **盒子**算，不管文字到底有多长。
	 */
	const clipped = valid.filter((r) => r.rest.text <= r.rest.box + 1 && r.hot.alphaAtText < 0.98);
	const unnecessary = clipped.filter((r) => r.rest.textRight <= r.rest.controlsLeft + 0.5);
	check(
		"没被图标压住的短标题，悬停时尾巴完好",
		unnecessary.length === 0,
		unnecessary.length === 0
			? "没有被无谓削掉的行"
			: `${unnecessary.length} 行明明没伸到图标下面却被削：` +
				unnecessary.map((r) => `${r.n}字(文字右${r.rest.textRight}<图标左${r.rest.controlsLeft}, alpha ${r.hot.alphaAtText})`).join("；"),
	);

	/*
	 * 判据三：真被图标压住的短标题，让位要化开，不能硬切。
	 *
	 * 不滚动的行没有 `ly-fade-edge`，`--ly-fade-right` 于是是 0——遮罩从全实到全透只用 0px，
	 * 最后那几个字是被一刀切掉的，不是淡出去的。
	 */
	const covered = valid.filter((r) => r.rest.text <= r.rest.box + 1 && r.rest.textRight > r.rest.controlsLeft + 0.5);
	const hardCut = covered.filter((r) => r.hot.vars.right === "0px" || r.hot.vars.right === "0");
	check(
		"被图标压住的短标题，让位是化开的不是切断的",
		covered.length > 0 && hardCut.length === 0,
		`被压住 ${covered.length} 行，其中硬切 ${hardCut.length} 行` +
			(hardCut.length ? `（字数 ${hardCut.map((r) => r.n).join(",")}，--ly-fade-right = 0）` : ""),
	);

	await writeFile(join(dir, "report.json"), JSON.stringify(report, null, 2));

	// 一张悬停中的整窗截图，留着肉眼对账。
	const target = covered[0] ?? overflowing[0] ?? report[report.length - 1];
	if (target) {
		const sid = `s${String(target.n).padStart(2, "0")}`;
		const box = await app.evaluate<{ x: number; y: number }>(
			`(() => { const b = document.querySelector('[data-ly-row="${sid}"]').getBoundingClientRect(); return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) }; })()`,
		);
		await hover(box.x, box.y);
		await settle(900);
		const shot = await app.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
		await writeFile(join(dir, `hover-${target.n}字.png`), Buffer.from(shot.data, "base64"));
		console.log(`\n截图：${join(dir, `hover-${target.n}字.png`)}`);
	}

	console.log(failures === 0 ? "\n全部通过" : `\n${failures} 条不通过`);
} finally {
	await app.stop();
}

process.exit(failures === 0 ? 0 : 1);
