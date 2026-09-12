/* oxlint-disable no-console -- probe CLI that prints what the real window did */
/**
 * 那一个「正在忙」的记号，在真窗口里画出来了没有，以及它真的在动吗。
 *
 * 单测（`test/ui/spinner.test.ts`）能证明八条 `<line>` 都在、`animation-delay` 排得对，那些都是
 * 属性——happy-dom 不跑动画，`getComputedStyle(line).opacity` 在那里永远是 1。所以「亮处沿圈走」
 * 这件事，在单测里一个字都没验到。这份改动的全部内容就是那个动作。
 *
 * 于是这里逐帧读真实的 computed opacity。逐帧而不是定时采样：动画是按绘制帧插值的，`setInterval`
 * 取的样和屏幕上画出来的不是同一串数。
 *
 * 两处一起验，因为这次换掉的是两种不同的旧记号，各在各的地方：
 *
 *   - 任务清单的每一步，原先是自己描的一段圆弧（`Mark`）
 *   - 转录区的工具卡，原先是 lucide 的 `Loader2` 套 `ly-spin`（`ToolCard`）
 *
 * 第三处——侧栏会话行那圈呼吸波纹——**不换**，所以这里反过来验它还在。它回答的不是同一个问题：
 * 一列会话可能同时好几行在跑，而那一列还要用来读标题。这条曾经被「统一」掉一次，捞回来了。
 *
 * 模型是假的，停在一个没写完的工具调用上——界面因此一直停在「正在跑」，可以慢慢读。
 *
 * 用法：node --experimental-strip-types e2e/loading-mark-probe.ts [输出目录]
 */

import { createServer, type Server, type ServerResponse } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { closeListeningServer, startApp, type RunningApp } from "./app.ts";
import { driver, encode, pause, startRecording, type Frame } from "./record.ts";

const OUT_DIR = process.argv[2] ?? join(homedir(), "Desktop", "Lyra加载记号测试");
const PORT = 9468;
const MODEL_PORT = 9588;
const STAMP = new Date().toLocaleString("sv-SE", { timeZone: "Asia/Shanghai" }).replace(/[: ]/g, "-").slice(0, 16);

/** 射线走完一圈的时间，跟 `loaders.tsx` 里是同一个数。 */
const PERIOD_MS = 800;

let app: RunningApp;
let model: Server;
const open = new Set<ServerResponse>();

const checks: { ok: boolean; what: string; saw: string }[] = [];
function check(what: string, ok: boolean, saw: string) {
	checks.push({ ok, what, saw });
	console.log(`   ${ok ? "✅" : "❌"} ${what}${ok ? "" : `  —— 看到的是：${saw}`}`);
}

// ---------------------------------------------------------------------------
// 一个说到一半就不说了的模型
// ---------------------------------------------------------------------------

function sse(res: ServerResponse, payload: unknown): void {
	res.write(`event: ${(payload as { type: string }).type}\ndata: ${JSON.stringify(payload)}\n\n`);
}

/** 只用来给每条回复编个不重样的 id。剧本走哪一支看请求体，不看这个数。 */
let requests = 0;

/**
 * 先写一份三步的清单，再开一条跑很久的命令。
 *
 * 清单要的是「一条在跑、一条做完、一条还没开始」这个组合：三种记号并排，才看得出正在跑的那个
 * 是不是压过了旁边两个——旧的圆弧就压过，它比邻居的点大了半圈。
 *
 * **按请求里写了什么来决定回什么，不是数第几次请求。**
 *
 * 数着数着就错了位：应用在第一条消息之后还会自己发一次请求去拟会话标题，那一次把 0 号占掉，
 * 于是对话的第一轮拿到了本该是第二轮的剧本——清单从来没被写过，而探针报的是「三处只换上两处」，
 * 看上去像记号没接上。请求体自己说得清楚：带着 `todo_write` 工具定义的才是对话，里面出现过
 * `toolu_todo` 的说明清单已经写完了。
 */
function startModel(): Server {
	const server = createServer((req, res) => {
		let body = "";
		req.on("data", (chunk) => { body += String(chunk); });
		req.on("end", () => {
			res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
			open.add(res);
			res.on("close", () => open.delete(res));

			sse(res, { type: "message_start", message: { id: `msg_${requests++}`, role: "assistant", content: [], usage: { input_tokens: 10, output_tokens: 0 } } });

			// 不带工具的请求不是对话——拟标题的那一次就是这样。给它一句话，别把剧本喂进去。
			if (!body.includes("todo_write")) {
				sse(res, { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } });
				sse(res, { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "换掉全局的加载记号" } });
				sse(res, { type: "content_block_stop", index: 0 });
				sse(res, { type: "message_stop" });
				res.end();
				return;
			}

			if (!body.includes("toolu_todo")) {
				const todos = [
					{ content: "读一遍现有的加载记号", status: "completed", activeForm: "读一遍现有的加载记号" },
					{ content: "把圆圈换成射线", status: "in_progress", activeForm: "把圆圈换成射线" },
					{ content: "在真窗口里量一遍", status: "pending", activeForm: "在真窗口里量一遍" },
				];
				sse(res, { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "toolu_todo", name: "todo_write", input: {} } });
				sse(res, { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: JSON.stringify({ todos }) } });
				sse(res, { type: "content_block_stop", index: 0 });
				sse(res, { type: "message_delta", delta: { stop_reason: "tool_use" } });
				sse(res, { type: "message_stop" });
				res.end();
				return;
			}

			sse(res, { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } });
			sse(res, { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "接着把那几处都换掉" } });
			sse(res, { type: "content_block_stop", index: 0 });
			/*
			 * 参数要流完，工具才真的开始跑。
			 *
			 * 第一版把 `input_json_delta` 断在半截，指望那样窗口就停在「正在跑」——会话确实停住了，
			 * 可 `ToolCard` 的 `running` 读的是 `status === "running"`，参数还没收齐的卡片不在那个状态
			 * 里。于是工具卡画出来了、星芒没有，而探针报的是「三处只换上了一处」。
			 *
			 * 换成一条真的睡很久的命令：工具真的在执行，卡片真的在 running，等的是它而不是一个
			 * 收不了尾的流。
			 */
			sse(res, { type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "toolu_bash", name: "bash", input: {} } });
			sse(res, { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '{"command":"sleep 90"}' } });
			sse(res, { type: "content_block_stop", index: 1 });
			sse(res, { type: "message_delta", delta: { stop_reason: "tool_use" } });
			sse(res, { type: "message_stop" });
			res.end();
		});
	});
	server.listen(MODEL_PORT, "127.0.0.1");
	return server;
}

async function seed(home: string): Promise<void> {
	const project = join(home, "project");
	await mkdir(project, { recursive: true });
	await writeFile(join(project, "one.ts"), "export const one = 1\n");
	await writeFile(join(home, "window.json"), JSON.stringify({ width: 1280, height: 900, x: 0, y: 0 }));
	await writeFile(
		join(home, "settings.json"),
		JSON.stringify({
			version: 1,
			providers: [{
				id: "local", name: "Local", baseUrl: `http://127.0.0.1:${MODEL_PORT}`, api: "anthropic-messages",
				apiKey: "not-a-key", enabled: true,
				models: [{
					id: "local/scripted", providerId: "local", modelId: "scripted", name: "Scripted",
					contextWindow: 200000, maxOutputTokens: 8192, supportsThinking: false, supportsImages: false, supportsTools: true,
				}],
			}],
			mcpServers: [],
			projects: [{ id: "e2e", name: "project", path: project, pinned: true, lastOpenedAt: 1 }],
			defaultModelId: "local/scripted",
			permissionMode: "full",
			thinking: "off",
			retryAttempts: 1,
			hooks: [], scheduledTasks: [], disabledPlugins: [], alwaysAllow: [],
			sync: { enabled: false, port: 4520, token: null },
		}),
	);
}

// ---------------------------------------------------------------------------
// 从窗口里读数
// ---------------------------------------------------------------------------

interface MarkShape {
	/** 这一枚记号在哪——用它最近的那个有名字的祖先说明。 */
	where: string;
	rays: number;
	/** 画出来多大，四舍五入到整数 px。 */
	box: number;
	/** 八条线的角度，按文档顺序。 */
	angles: number[];
	colour: string;
}

/**
 * 页面上每一枚 `.ly-star`，连同它长在哪。
 *
 * `checkVisibility()` 而不是「查得到」：折叠起来的面板里那一枚仍然在 DOM 里，把它算进来，
 * 「侧栏那一处换上了」就会在侧栏其实没画东西的时候也成立。
 */
const READ_MARKS = `(() => {
	const named = (el) => {
		const hit = el.closest("[data-ly-star-where]");
		return hit ? hit.getAttribute("data-ly-star-where") : "?";
	};
	return [...document.querySelectorAll("svg.ly-star")]
		.filter((svg) => svg.checkVisibility())
		.map((svg) => {
			const box = svg.getBoundingClientRect();
			const lines = [...svg.querySelectorAll("line")];
			return {
				where: named(svg),
				rays: lines.length,
				box: Math.round(box.width),
				angles: lines.map((l) => Number(((/rotate\\(([-\\d.]+)/).exec(l.getAttribute("transform") || "") || [])[1])),
				colour: getComputedStyle(svg).color,
			};
		});
})()`;

/**
 * 出岔子的时候，窗口里到底有什么。
 *
 * 上一版少了这个，于是「三处只换上一处」只能靠猜——是记号没接上，还是那两处压根没画出来。
 * 连不可见的 `.ly-star` 一起数，那个差值本身就是答案：都在 DOM 里而看不见，说明是折叠。
 */
const DIAGNOSE = `(() => ({
	star: document.querySelectorAll("svg.ly-star").length,
	starVisible: [...document.querySelectorAll("svg.ly-star")].filter((s) => s.checkVisibility()).length,
	toolCards: document.querySelectorAll("[data-ly-run]").length,
	expanders: [...document.querySelectorAll("main button[aria-expanded]")].map((b) => (b.innerText || "").slice(0, 24)),
	running: Boolean(document.querySelector('button[aria-label="停止"]')),
}))()`;

/** 旧记号还剩几个在画——更新徽章的进度环是白名单，这个场景里它不出现。 */
const READ_OLD = `(() => {
	const spinning = [...document.querySelectorAll(".ly-spin")].filter((el) => el.checkVisibility());
	return spinning.map((el) => (el.getAttribute("data-ring") === null ? el.className.baseVal || el.className : "进度环"));
})()`;

/**
 * 一枚记号，逐绘制帧记下八条线的 opacity。
 *
 * 注入的代码里不写反引号也不写换行转义：这段字符串还要在外层的模板串里活一遍，两次转义之间
 * 丢过东西。
 */
function sampleFrames(where: string, ms: number): string {
	return `(() => new Promise((resolve) => {
		const svg = [...document.querySelectorAll("svg.ly-star")].filter((s) => s.checkVisibility() && s.closest("[data-ly-star-where=" + ${JSON.stringify(JSON.stringify(where))} + "]"))[0];
		if (!svg) { resolve(null); return; }
		const lines = [...svg.querySelectorAll("line")];
		const samples = [];
		const start = performance.now();
		const tick = () => {
			const at = performance.now() - start;
			samples.push({ at: Math.round(at), opacity: lines.map((l) => Number(getComputedStyle(l).opacity)) });
			if (at < ${ms}) requestAnimationFrame(tick); else resolve(samples);
		};
		requestAnimationFrame(tick);
	}))()`;
}

interface Sample { at: number; opacity: number[] }

/** 每一帧里最亮的是第几条。 */
function brightestOf(samples: Sample[]): { at: number; index: number }[] {
	return samples.map(({ at, opacity }) => ({
		at,
		index: opacity.reduce((best, value, index) => (value > opacity[best]! ? index : best), 0),
	}));
}

/**
 * 亮处是不是在顺时针走。
 *
 * 不要求每一帧都前进一格——帧率不定，一帧可能跨过两格。要求的是它只往前走、不往回退：把相邻两
 * 帧的差取模 8，全都落在 0..2 之间就是顺时针，出现 6、7 就是在倒着走。
 */
function isClockwise(order: { index: number }[]): { ok: boolean; steps: number[] } {
	const steps: number[] = [];
	for (let i = 1; i < order.length; i++) {
		steps.push((order[i]!.index - order[i - 1]!.index + 8) % 8);
	}
	return { ok: steps.every((step) => step <= 2), steps };
}

async function main() {
	await mkdir(OUT_DIR, { recursive: true });
	const frames: Frame[] = [];
	model = startModel();
	app = await startApp({ port: PORT, seed, scaleFactor: 2 });
	const d = driver(app);
	/*
	 * 录之前先把窗口调到前面。
	 *
	 * `Page.startScreencast` 只在窗口画得出来的时候发帧——被别的窗口盖住就安安静静地一帧不发。
	 * 有一次整轮跑完只采到 2 帧，合出来的「视频」是两张静止画，而终端上的勾全是绿的。
	 */
	await app.send("Page.bringToFront").catch(() => {});
	const stop = await startRecording(PORT, frames);

	try {
		console.log("【一】起一轮，让这几处都进入「正在跑」");
		await d.until('document.querySelector("main textarea")', 30000);
		await pause(1000);

		await d.type("把全局的 loading 换掉");
		await d.submit();

		await d.until('document.querySelector("svg.ly-star")', 30000);
		await pause(2500);

		/*
		 * 把任务清单点开。
		 *
		 * 它默认收着，收起来的时候只有一行「正在做的那件事」，每一步的记号在一个高度为 0 的
		 * `.ly-reveal` 里——`querySelector` 找得到，`checkVisibility()` 说没画。要验的正是那些记号。
		 *
		 * 点不开也接着往下跑：这一步是为了够到那些记号，它自己失手不该把后面几十项测量一起带走。
		 */
		const found = await app.evaluate<boolean>(`(() => {
			const head = [...document.querySelectorAll("button[aria-expanded]")].find((b) => (b.innerText || "").includes("把圆圈换成射线"));
			if (!head) return false;
			head.setAttribute("data-ly-todo-head", "");
			return true;
		})()`);
		if (!found) {
			console.log("   （没找到任务清单的展开按钮，跳过这一步）");
		} else {
			await d.click("[data-ly-todo-head]");
			await pause(1200);
			/*
			 * 真鼠标点不开就退回 `.click()`。
			 *
			 * 这个头浮在转录之上（floating 的 `TaskList`），落点上盖着什么并不由这里说了算。要够到
			 * 的是它展开之后的那几个记号，不是「这个按钮能不能用鼠标点」——后者有它自己的测试。
			 */
			const open = await app.evaluate<string | null>(`document.querySelector("[data-ly-todo-head]")?.getAttribute("aria-expanded") ?? null`);
			if (open !== "true") {
				console.log(`   （真鼠标没点开，aria-expanded=${open}，改用 .click()）`);
				await app.evaluate(`(() => { document.querySelector("[data-ly-todo-head]").click(); return true; })()`);
				await pause(1200);
			}
			console.log(`   清单展开了吗：${await app.evaluate<string | null>(`document.querySelector("[data-ly-todo-head]")?.getAttribute("aria-expanded") ?? null`)}`);
		}

		/*
		 * 再把正在跑的那个工具组点开。
		 *
		 * 组自己那一行不画 spinner，是故意的：它用摘要上的一道扫光说「在跑」，`ToolGroup` 的注释
		 * 写着「同一件事说两遍，是长任务让人觉得吵的原因」。spinner 在组里那张卡上，组收着就够不到。
		 *
		 * 这一段是量出来的，不是猜的：`data-ly-run` 明明是 `running`，组里却一枚记号都没有——
		 * 差一点当成「工具卡没接上」报出去。
		 */
		const group = await app.evaluate<boolean>(`(() => {
			const head = [...document.querySelectorAll("button[aria-expanded]")].find((b) => (b.innerText || "").includes("执行命令"));
			if (!head) return false;
			head.setAttribute("data-ly-group-head", "");
			if (head.getAttribute("aria-expanded") !== "true") head.click();
			return true;
		})()`);
		if (group) await pause(1200);
		else console.log("   （没找到正在跑的工具组）");

		/*
		 * 等到两处都画出来了再读，不要读一个还在成形的窗口。
		 *
		 * 两处不是同时到的：清单要等 `todo_write` 落地，工具卡要等 `bash` 真的开跑。上一次就是在
		 * `bash` 还没进 running 的那一瞬读的数，于是同一份代码一次报这两枚、一次报另外两枚——
		 * 不是记号时有时无，是尺子伸早了。
		 */
		/*
		 * 等不到就把窗口的实情打出来，别停在一句「等不到」上。
		 *
		 * 这份诊断救过两次：一次「工具卡没换上」其实是组收着，一次「清单没换上」其实是剧本被拟标题
		 * 的那次请求错了位。两次的表象都是数量不对，而数量不对说不出原因。
		 */
		await d
			.until('[...document.querySelectorAll("svg.ly-star")].filter((s) => s.checkVisibility()).length >= 2', 25000)
			.catch(async () => {
				console.log("   （等不到两枚，照现状读下去）");
				console.log(`   窗口里：${JSON.stringify(await app.evaluate<unknown>(DIAGNOSE))}`);
				console.log(`   工具卡：${JSON.stringify(await app.evaluate<unknown[]>(`[...document.querySelectorAll("[data-ly-run]")].map((c) => ({ text: (c.innerText || "").replace(/\\s+/g, " ").slice(0, 44), star: c.querySelectorAll("svg.ly-star").length, run: c.getAttribute("data-ly-run") }))`))}`);
			});
		await pause(500);

		// 三处都在了，挂抓手——它们是这一轮才画出来的。
		await app.evaluate(`(() => {
			const put = (el, name) => { if (el) el.setAttribute("data-ly-star-where", name); };
			const star = [...document.querySelectorAll("svg.ly-star")].filter((s) => s.checkVisibility());
			for (const svg of star) {
				if (svg.closest("aside")) { put(svg.parentElement, "侧栏"); continue; }
				if (svg.closest("[data-ly-run]")) { put(svg.closest("[data-ly-run]"), "工具卡"); continue; }
				put(svg.parentElement, "任务清单");
			}
			return true;
		})()`);
		await pause(600);

		const marks = await app.evaluate<MarkShape[]>(READ_MARKS);
		console.log(`   画在屏幕上的记号：${marks.length} 枚`);
		for (const mark of marks) console.log(`     · ${mark.where}  ${mark.box}px  ${mark.rays} 条  ${mark.colour}`);

		check("两处都换上了新记号", marks.length >= 2, `只有 ${marks.length} 枚`);
		check("每一枚都是八条射线", marks.every((m) => m.rays === 8), marks.map((m) => m.rays).join("/"));
		check(
			"八条均分一圈",
			marks.every((m) => m.angles.join() === [0, 45, 90, 135, 180, 225, 270, 315].join()),
			marks[0]?.angles.join() ?? "（没读到）",
		);
		check("画出来的尺寸在 11–20px 之间", marks.every((m) => m.box >= 11 && m.box <= 20), marks.map((m) => `${m.box}px`).join("/"));

		const old = await app.evaluate<string[]>(READ_OLD);
		check("旧的转圈记号一个都不剩", old.length === 0, old.join("、") || "（干净）");

		/*
		 * 侧栏那圈呼吸，必须原样还在。
		 *
		 * 这一条验的是「没被换掉」，方向和上面几条相反。它被「统一 loading」顺手删过一次，删的时候
		 * 每一条测试都是绿的——因为当时没有一条测试说它该在。
		 *
		 * 查的是波纹自己那两个环在不在动，不是类名在不在：类名留着而 `@keyframes` 被清掉的话，
		 * 侧栏会画出一个不动的圆圈，而 `querySelector` 照样说「在」。
		 */
		const breathe = await app.evaluate<{ found: number; animated: number; core: boolean }>(`(() => {
			const nodes = [...document.querySelectorAll(".ly-breathe")].filter((el) => el.checkVisibility());
			const animated = nodes.filter((el) => [...el.querySelectorAll("i")].every((ring) => {
				const name = getComputedStyle(ring).animationName;
				return name.includes("ly-breathe-wave") && name.includes("ly-breathe-hue");
			}) && el.querySelectorAll("i").length === 2).length;
			return {
				found: nodes.length,
				animated,
				core: nodes.every((el) => getComputedStyle(el.querySelector("b")).animationName.includes("ly-breathe-core")),
			};
		})()`);
		check("侧栏会话行那圈呼吸还在（没被一起换掉）", breathe.found > 0, `一个都没画`);
		check("两道波纹还挂着 wave + hue 两条动画", breathe.found > 0 && breathe.animated === breathe.found, `${breathe.animated}/${breathe.found} 枚是完整的`);
		check("核心还在走 accent → info → violet", breathe.core && breathe.found > 0, breathe.core ? "（没找到波纹）" : "核心的动画掉了");

		console.log("\n【二】逐帧读它到底动没动");
		const where = marks.find((m) => m.where === "任务清单")?.where ?? marks.find((m) => m.where !== "?")?.where ?? "任务清单";
		const samples = await app.evaluate<Sample[] | null>(sampleFrames(where, PERIOD_MS * 2));
		if (!samples || samples.length === 0) {
			check(`量到了「${where}」那一枚的逐帧透明度`, false, "（一帧都没采到）");
		} else {
			const spread = samples.map((s) => Math.max(...s.opacity) - Math.min(...s.opacity));
			const moved = new Set(samples.map((s) => s.opacity.map((o) => o.toFixed(2)).join())).size;
			console.log(`   ${where}：采到 ${samples.length} 帧，跨 ${samples.at(-1)!.at}ms，出现过 ${moved} 种不同的明暗组合`);

			check("它真的在动，不是一张静止的星", moved > 10, `只出现过 ${moved} 种组合`);
			check(
				"任何一帧里八条都拉得开明暗（最亮减最暗 > 0.5）",
				spread.every((value) => value > 0.5),
				`最小的一帧只差 ${Math.min(...spread).toFixed(2)}`,
			);
			check(
				"最暗的一条也没有消失（留着底，星的轮廓才不跟着转）",
				samples.every((s) => Math.min(...s.opacity) > 0.05),
				`见过 ${Math.min(...samples.map((s) => Math.min(...s.opacity))).toFixed(3)}`,
			);

			const order = brightestOf(samples);
			const { ok, steps } = isClockwise(order);
			check("亮处顺时针走，没有倒着退", ok, `逐帧步长 ${steps.slice(0, 24).join(",")}`);

			const visited = new Set(order.map((o) => o.index)).size;
			check("两个周期里八条都轮到过最亮", visited === 8, `只轮到了 ${visited} 条`);
		}

		console.log("\n【三】浅色底下也看得见");
		await app.evaluate(`(() => { document.documentElement.classList.remove("dark"); document.documentElement.classList.add("light"); return true; })()`);
		await pause(1500);
		const light = await app.evaluate<MarkShape[]>(READ_MARKS);
		check("换到浅色，记号还在画", light.length === marks.length, `深色 ${marks.length} 枚、浅色 ${light.length} 枚`);
		await pause(1200);
		await app.evaluate(`(() => { document.documentElement.classList.remove("light"); document.documentElement.classList.add("dark"); return true; })()`);
		await pause(1500);
	} finally {
		await stop();
		console.log(`\n采到 ${frames.length} 帧，正在合成 60fps…`);
	}

	if (frames.length === 0) throw new Error("一帧都没采到");
	const passed = checks.filter((c) => c.ok).length;
	const out = join(OUT_DIR, `${STAMP}_全局加载记号换成射线_${passed}of${checks.length}.mp4`);
	await app.stop();
	await closeListeningServer(model);
	await encode(frames, out, 60, 1200);

	console.log(`\n${passed}/${checks.length} 项通过`);
	console.log(`视频：${out}`);
	if (passed !== checks.length) process.exitCode = 1;
}

main().catch(async (error) => {
	console.error(error);
	for (const res of open) res.destroy();
	await app?.stop().catch(() => {});
	await closeListeningServer(model).catch(() => {});
	process.exitCode = 1;
});
