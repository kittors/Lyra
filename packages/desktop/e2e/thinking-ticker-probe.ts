/**
 * The thinking line while reasoning streams, and after: that it ticks, fades, rests at its
 * start, reads back on hover and unfolds beneath itself on click — with no heading and no chevron.
 *
 * `node --experimental-strip-types e2e/thinking-ticker-probe.ts`
 *
 * A scripted model streams one thinking block a few characters at a time and then holds the
 * stream open, so the line can be measured while it is being written; `/finish` on the model
 * ends the turn so the finished state can be measured too. Numbers rather than looks: where the
 * line's last glyph sits against the box it does not fit in, the mask's depths, and two
 * transforms a second apart for the read-back.
 *
 * 2026-09-22：整支探针的选择器全换过一遍，因为它已经空转了很久。这一行后来被重构进 `FlowRow`，
 * `.ly-think-ticker` / `.ly-think-track` / `.ly-think-runs` 三个类随之消失，而探针还在找它们——
 * 「没等到 ticker」之后剩下的判据拿到的全是空数组，`every` 对空数组返回真，于是一串 ✓ 印出来，
 * 底下的功能早就没了。悬停自读正是那次丢掉的：客户拿截图问「鼠标放上去的滚动效果呢」，指的就是
 * 这一行。所以判据里凡是「某一类样本全都满足」的，都先要求那一类不为空——假绿比红线坏得多。
 */

import { mkdir, writeFile } from "node:fs/promises";
import { createServer, type Server, type ServerResponse } from "node:http";
import { join } from "node:path";
import { startApp } from "./app.ts";

const MODEL_PORT = 9571;
const OUT = "/tmp/lyra-thinking-probe";
const settle = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let failures = 0;
function check(label: string, passed: boolean, evidence: string): void {
	if (!passed) failures++;
	process.stdout.write(`${passed ? "✓" : "✗"} ${label}\n    ${evidence}\n`);
}

/*
 * 每一句都长到装不下，这是有意的。
 *
 * 行是一句一句写的（见 `thinkingRuns`），屏幕上任何时刻只有其中一句——所以「溢出之后什么样」这件
 * 事，要靠每一句都溢出才问得稳。上一版每句三十来字，在 618px 的摘要里全都装得下，于是「溢出」那
 * 一类样本一个也没有，判据拿着空数组印 ✓。
 */
const REASONING = [
	"我需要先弄清楚这批未提交的改动都涉及哪些功能，再决定版本号该怎么升，而这件事只看提交信息是看不出来的，得把每个包的 diff 都过一遍。",
	"1. 通读 core 里 provider 相关的 diff，看 **thinking** 选项是怎么被抽出去的，以及它在各家适配器上的默认值有没有跟着一起改",
	"2. 桌面端的 git 面板改了历史视图和文件 diff 列表，需要在真窗口里核对一遍，尤其是那些只有滚动到一定位置才画出来的行",
	"3. 截图标注工具的命中测试有新的单测，说明 `annotate.ts` 的几何计算被重写过，那一块的回归要单独看",
	"综合来看这是一个 minor 版本，release notes 要按功能分组来写，不能按包分组——读的人关心的是能做什么了，而不是这件事落在哪个目录下面。",
].join("\n");

function sse(res: ServerResponse, payload: unknown): void {
	res.write(`event: ${(payload as { type: string }).type}\ndata: ${JSON.stringify(payload)}\n\n`);
}

/** Where the stream is, from the outside: written by the model, read by the probe. */
const stream = { finish: null as (() => void) | null, finished: false, sentAll: false };

function startModel(): Server {
	const server = createServer((req, res) => {
		if (req.url === "/finish") {
			stream.finish?.();
			res.end("ok");
			return;
		}
		req.resume();
		req.on("end", async () => {
			res.writeHead(200, {
				"content-type": "text/event-stream",
				"cache-control": "no-cache",
				connection: "keep-alive",
			});
			const done = new Promise<void>((resolve) => {
				stream.finish = () => {
					stream.finished = true;
					resolve();
				};
			});
			sse(res, {
				type: "message_start",
				message: { id: "msg_1", role: "assistant", content: [], usage: { input_tokens: 10, output_tokens: 0 } },
			});
			sse(res, { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } });
			let sent = 0;
			while (sent < REASONING.length && !stream.finished) {
				const piece = REASONING.slice(sent, sent + 5);
				sent += piece.length;
				sse(res, { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: piece } });
				await settle(90);
			}
			stream.sentAll = true;
			await done;
			sse(res, { type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: "sig" } });
			sse(res, { type: "content_block_stop", index: 0 });
			sse(res, { type: "content_block_start", index: 1, content_block: { type: "text", text: "" } });
			sse(res, { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "看完了，可以发。" } });
			sse(res, { type: "content_block_stop", index: 1 });
			sse(res, { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 40 } });
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
			providers: [
				{
					id: "local",
					name: "Local",
					baseUrl: `http://127.0.0.1:${MODEL_PORT}`,
					api: "anthropic-messages",
					apiKey: "not-a-key",
					enabled: true,
					models: [
						{
							id: "local/scripted",
							providerId: "local",
							modelId: "scripted",
							name: "Scripted",
							contextWindow: 200000,
							maxOutputTokens: 8192,
							supportsThinking: true,
							supportsImages: false,
							supportsTools: true,
						},
					],
				},
			],
			mcpServers: [],
			projects: [{ id: "e2e", name: "project", path: project, pinned: true, lastOpenedAt: 1 }],
			defaultModelId: "local/scripted",
			permissionMode: "full",
			thinking: "medium",
			retryAttempts: 1,
			hooks: [],
			scheduledTasks: [],
			disabledPlugins: [],
			alwaysAllow: [],
			sync: { enabled: false, port: 4521, token: null },
			appearance: { theme: "dark" },
		}),
	);
}

interface Reading {
	boxWidth: number;
	/** 字尾到盒子右边缘的距离。顶住了就是 0——那是「看到的永远是刚落下的几个字」的说法。 */
	tailGap: number;
	/** 行首相对盒子左边缘。装得下是 0，装不下就是负的，越负表示往左走得越远。 */
	headLeft: number;
	/** 这一句此刻溢不溢出，由 `ThinkingBlock` 的帧循环顺手量出来写在行上。 */
	clipped: boolean;
	fadeLeft: string;
	fadeRight: string;
	mask: string;
	chars: number;
	/** 这一句开头那几个字，用来认「还是不是同一句」——字数认不出来，见下面那条判据。 */
	head: string;
	boxRight: number;
	mainRight: number;
}

/**
 * Everything measurable about the live ticker, read off the DOM in one go.
 *
 * 正在写的那一句不换成滚动的壳（见 `FlowRow`）：字尾顶右是 flex 的事，不是 transform 的事，所以
 * 问的是两个矩形的相对位置，不是矩阵里的那个 e。
 */
const READ = `(() => {
	const box = document.querySelector("main [data-ly-thinking] .ly-flow-summary[data-follow-end]");
	if (!box) return null;
	const body = box.firstElementChild;
	if (!body) return null;
	const bs = getComputedStyle(box);
	const bb = body.getBoundingClientRect();
	const xb = box.getBoundingClientRect();
	return {
		boxWidth: box.clientWidth,
		tailGap: Math.round((bb.right - xb.right) * 10) / 10,
		headLeft: Math.round((bb.left - xb.left) * 10) / 10,
		clipped: box.hasAttribute("data-clipped"),
		fadeLeft: bs.getPropertyValue("--ly-fade-left").trim(),
		fadeRight: bs.getPropertyValue("--ly-fade-right").trim(),
		mask: (bs.maskImage || bs.webkitMaskImage || "").slice(0, 40),
		chars: box.textContent.length,
		head: box.textContent.slice(0, 10),
		boxRight: Math.round(xb.right),
		mainRight: Math.round(document.querySelector("main").getBoundingClientRect().right),
	};
})()`;

interface Loop {
	marquee: boolean;
	copies: number;
	tx: number;
	width: number;
	fadeEdge: boolean;
	fadeLeft: string;
	fadeRight: string;
	text: string;
}

/**
 * The finished line's ticker, at rest or reading back.
 *
 * 停下来之后这一句交给 `ScrollText`，`data-ly-scroll-fit` 就是它的壳——`over` 是静止就装不下，`yield` 是
 * 只有悬停时控件压上来才装不下。转录里的过程行没有那种控件，所以这里永远是 `over`。
 */
const READ_LOOP = `(() => {
	const box = document.querySelector("main [data-ly-thinking] .ly-flow-summary [data-ly-scroll-fit]");
	if (!box) return null;
	const track = box.firstElementChild;
	const cs = getComputedStyle(track);
	const m = new DOMMatrixReadOnly(cs.transform === "none" ? "" : cs.transform);
	const bs = getComputedStyle(box);
	return {
		marquee: track.classList.contains("ly-marquee-track"),
		copies: track.children.length,
		tx: Math.round(m.e * 10) / 10,
		width: box.clientWidth,
		fadeEdge: box.classList.contains("ly-fade-edge"),
		fadeLeft: bs.getPropertyValue("--ly-fade-left").trim(),
		fadeRight: bs.getPropertyValue("--ly-fade-right").trim(),
		text: box.textContent.slice(0, 12),
	};
})()`;

/** What the line says about itself: whether any heading or chevron crept back in. */
const READ_CHROME = `(() => {
	const b = document.querySelector("main [data-ly-thinking]");
	if (!b) return null;
	return {
		heading: b.innerText.includes("思考过程"),
		chevron: Boolean(b.querySelector("svg.lucide-chevron-right")),
		brain: Boolean(b.querySelector("svg.lucide-brain")),
		follow: Boolean(b.querySelector(".ly-flow-summary[data-follow-end]")),
		settled: Boolean(b.querySelector(".ly-flow-summary [data-ly-scroll-fit]")),
		unfolded: Boolean(b.querySelector('button[aria-expanded="true"]')),
		body: (b.querySelector(".border-l-2")?.innerText ?? "").length,
		textLen: b.innerText.length,
		reply: document.querySelector("main").innerText.includes("看完了"),
	};
})()`;

interface Chrome {
	heading: boolean;
	chevron: boolean;
	brain: boolean;
	follow: boolean;
	/** 停下来之后那一句换成了会滚的壳——和「正在写」互斥，两个都真或都假都是错的。 */
	settled: boolean;
	unfolded: boolean;
	body: number;
	textLen: number;
	reply: boolean;
}

await mkdir(OUT, { recursive: true });
const model = startModel();
const app = await startApp({ port: 9463, seed });

async function ask(text: string): Promise<void> {
	await app.evaluate(`(() => {
		const field = document.querySelector("main textarea");
		const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
		setter.call(field, ${JSON.stringify(text)});
		field.dispatchEvent(new Event("input", { bubbles: true }));
		field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
		return true;
	})()`);
}

/** A point near the line's left end — on the icon and the first words, whatever the ticker is doing. */
async function lineAt(): Promise<{ x: number; y: number }> {
	return app.evaluate<{ x: number; y: number }>(`(() => {
		const r = document.querySelector("main [data-ly-thinking] button").getBoundingClientRect();
		return { x: Math.round(r.left + Math.min(40, r.width / 2)), y: Math.round(r.top + r.height / 2) };
	})()`);
}

async function moveTo(at: { x: number; y: number }): Promise<void> {
	await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: at.x, y: at.y });
}

async function click(at: { x: number; y: number }): Promise<void> {
	await moveTo(at);
	await app.send("Input.dispatchMouseEvent", { type: "mousePressed", x: at.x, y: at.y, button: "left", clickCount: 1 });
	await app.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: at.x, y: at.y, button: "left", clickCount: 1 });
}

async function shot(name: string): Promise<void> {
	const png = await app.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
	await writeFile(join(OUT, name), Buffer.from(png.data, "base64"));
}

/** Somewhere in the transcript that is not the line, for the pointer to rest between checks. */
const AWAY = { x: 640, y: 520 };

/** 把收起的那一轮过程摊开；已经摊开就什么都不做。 */
async function unfoldProcess(): Promise<void> {
	const at = await app.evaluate<{ x: number; y: number } | null>(`(() => {
		if (document.querySelector("main [data-ly-thinking]")) return null;
		const fold = document.querySelector("main [data-ly-turn-process] > .ly-flow-row[data-expandable]");
		if (!fold) return null;
		const r = fold.getBoundingClientRect();
		return { x: Math.round(r.left + 40), y: Math.round(r.top + r.height / 2) };
	})()`);
	if (!at) return;
	await click(at);
	await settle(600);
}

try {
	await app.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
	await settle(600);
	await ask("看看这批改动");

	let there = false;
	for (let i = 0; i < 40 && !there; i++) {
		there = await app.evaluate<boolean>(
			`Boolean(document.querySelector("main [data-ly-thinking] .ly-flow-summary[data-follow-end]"))`,
		);
		if (!there) await settle(250);
	}
	check("吐思考时那一行就是滚动的思考内容", there, there ? "找到正在写的那一句" : "没等到那一行");

	/* ---------- while it streams ---------- */
	/*
	 * 采得密一点，因为「溢出」是个很窄的窗口。
	 *
	 * 一句话只有写到后半截才装不下，写完就换下一句从头再来。八次 350ms 的采样撞进那个窗口的次数
	 * 是个位数，判据于是拿着一个样本谈「只朝一个方向走」。
	 */
	const samples: Reading[] = [];
	for (let i = 0; i < 18; i++) {
		const reading = await app.evaluate<Reading | null>(READ);
		if (reading) samples.push(reading);
		await settle(200);
	}
	const chars = samples.map((s) => s.chars);
	/*
	 * 问的是「在吐」，不是「越来越长」。
	 *
	 * 一句写完就换下一句，字数于是锯齿状地涨落（36 → 2 → 16）。旧判据要的是单调不减，那是所有
	 * 句子拼在一条轨道上的年代才成立的形状。
	 */
	check(
		"字在一个一个往外吐",
		samples.length > 2 && new Set(chars).size > 2,
		`字数序列 ${chars.join(" → ")}`,
	);
	/*
	 * 两类样本各自判，而且各自都要有货。
	 *
	 * 从前这里写的是 `fitting.every(...)`，对空数组返回真——选择器一失效，两类都是空的，两条判据
	 * 同时印 ✓。空样本不是通过，是没量到。
	 */
	/*
	 * 「不溢出」要连着两次才算数，否则量到的是过渡中途。
	 *
	 * 一句写完换下一句，`data-clipped` 那一刻被摘掉，而两个深度是注册过的自定义属性——它们从 20px
	 * 和 12px **渐变**回 0。正好落在那几十毫秒里的一次采样会报 11.4871px/6.89227px：既不是 0 也不是
	 * 满深，两个数都对，都不是要问的那个状态。采样间隔比过渡长，所以前一次也不溢出，就说明这一次
	 * 已经停稳了。
	 */
	const overflowing = samples.filter((s) => s.clipped);
	const fitting = samples.filter((s, i) => !s.clipped && i > 0 && !samples[i - 1].clipped);
	/* 同一个理由的另一半：刚溢出那一下，两个深度正从 0 渐变到满，量到的是 19.9955px 这种数。 */
	const settledOver = samples.filter((s, i) => s.clipped && i > 0 && samples[i - 1].clipped);
	check(
		"未溢出时没有渐变，文字从左边开始",
		fitting.length > 0 && fitting.every((s) => s.fadeLeft === "0px" && s.fadeRight === "0px" && Math.abs(s.headLeft) <= 1),
		`${fitting.length} 个停稳的样本 ${fitting.map((s) => `${s.fadeLeft}/${s.fadeRight}/${s.headLeft}`).join(" ")}`,
	);
	check(
		"溢出后向左走，末尾贴着右边",
		overflowing.length > 0 && overflowing.every((s) => s.headLeft < -1 && Math.abs(s.tailGap) <= 1),
		`${overflowing.length} 个溢出样本 行首=${overflowing.map((s) => s.headLeft).join(" ")}，字尾差=${overflowing.map((s) => s.tailGap).join(" ")}`,
	);
	/*
	 * 只在同一句里比，换句了就重新开始。
	 *
	 * 行首序列 -82 → -180 → -267 → -91：前三个是一句话越写越长、行首一路往左退，第四个是**下一句**
	 * 从头写起又长到溢出。拿它去比上一句的 -267，得出的「往回跳了」是把两句话接在一起读造成的。
	 *
	 * 认同一句要靠开头那几个字，不能靠字数。字数会从 64 直接跳到下一句的 66——两次采样之间隔了
	 * 200ms，而这一行每秒能写四十到两百个字，归零重来的那一段整个漏在采样缝里。开头几个字一旦
	 * 写完就不再变，换了句它必然跟着换。
	 */
	const sameRun = overflowing.filter((s, i) => i > 0 && s.head === overflowing[i - 1].head);
	check(
		"同一句里只朝一个方向走",
		sameRun.length > 0 && sameRun.every((s) => {
			const before = overflowing[overflowing.indexOf(s) - 1];
			return s.headLeft <= before.headLeft + 0.5;
		}),
		`行首序列 ${overflowing.map((s) => `${s.headLeft}(${s.chars}字·${s.head.slice(0, 4)})`).join(" → ")}`,
	);
	check(
		"溢出后左右都有渐变遮罩",
		settledOver.length > 0 &&
			settledOver.every((s) => s.fadeLeft === "20px" && s.fadeRight === "12px" && s.mask.startsWith("linear-gradient")),
		`${settledOver.length} 个停稳的样本 ${settledOver.map((s) => `${s.fadeLeft}/${s.fadeRight}`).join(" ")} ${settledOver.map((s) => s.mask).slice(-1).join("")}`,
	);
	const chromeLive = await app.evaluate<Chrome>(READ_CHROME);
	check(
		"行上只有图标和内容：没有「思考过程」字样，没有箭头",
		chromeLive.brain && !chromeLive.heading && !chromeLive.chevron,
		JSON.stringify(chromeLive),
	);
	await shot("01-streaming.png");

	/* ---------- once the text has all arrived (stream still open) ---------- */
	for (let i = 0; i < 80 && !stream.sentAll; i++) await settle(250);
	await settle(700);
	const rest = await app.evaluate<Reading>(READ);
	check(
		"字全到了、流还开着的时候，末尾仍然贴着右边缘",
		rest.clipped && Math.abs(rest.tailGap) <= 1 && rest.headLeft < -1,
		`字尾差=${rest.tailGap} 行首=${rest.headLeft} box=${rest.boxWidth}`,
	);
	check("整条不越出转录列", rest.boxRight <= rest.mainRight, `right=${rest.boxRight} main.right=${rest.mainRight}`);

	/* ---------- hover while streaming: same line, nothing else ---------- */
	const at = await lineAt();
	await moveTo(at);
	await settle(700);
	const hovered = await app.evaluate<{ follow: boolean; loop: boolean; extra: number }>(`(() => ({
		follow: Boolean(document.querySelector("main [data-ly-thinking] .ly-flow-summary[data-follow-end]")),
		loop: Boolean(document.querySelector("main [data-ly-thinking] .ly-marquee-track")),
		extra: document.querySelectorAll("[data-ly-thinking-peek], .ly-tooltip:not([hidden])").length,
	}))()`);
	check("吐出中悬停不改变形态、不弹别的东西", hovered.follow && !hovered.loop && hovered.extra === 0, JSON.stringify(hovered));

	/* ---------- click: the whole text unfolds beneath the line, which stays as it is ---------- */
	await click(at);
	await settle(400);
	const opened = await app.evaluate<Chrome>(READ_CHROME);
	check(
		"点击展开：全文在行下方带左边线出现，行本身不变，仍无标题和箭头",
		opened.unfolded && opened.body > 100 && opened.follow && !opened.heading && !opened.chevron && opened.brain,
		JSON.stringify(opened),
	);
	await shot("02-unfolded.png");

	await click(at);
	await settle(400);
	const refolded = await app.evaluate<Chrome>(READ_CHROME);
	/* 全文收起之后仍留在 DOM 里（`Collapse keepMounted`），所以问的是开合状态，不是它在不在。 */
	check("再点一下收起", !refolded.unfolded && refolded.follow, JSON.stringify(refolded));

	/* ---------- finish the turn ---------- */
	await moveTo(AWAY);
	await settle(300);
	await fetch(`http://127.0.0.1:${MODEL_PORT}/finish`);
	await settle(1500);
	/*
	 * 一轮跑完，整段过程收进「调用工具 N 个」那一行里——思考行连同它的壳一起从 DOM 上下来了。
	 *
	 * 跑着的时候过程是全开的，所以前面那几段不必操心；这里要接着量同一条线，就得先把它摊开。
	 */
	await unfoldProcess();
	const finished = await app.evaluate<Chrome>(READ_CHROME);
	const resting = await app.evaluate<Loop | null>(READ_LOOP);
	check(
		"思考结束后那一行停在开头，还是没有「思考过程」和箭头",
		finished.brain && !finished.heading && !finished.chevron && !finished.follow && finished.settled && finished.reply,
		JSON.stringify(finished),
	);
	check(
		"停着时不动：右边渐隐说明还有，左边不遮",
		Boolean(resting && resting.tx === 0 && resting.fadeEdge && resting.fadeRight === "22px" && resting.fadeLeft === "0px"),
		JSON.stringify(resting),
	);
	await shot("03-finished-rest.png");

	/* ---------- hover after finishing: reads back along the line ---------- */
	const at2 = await lineAt();
	await moveTo(at2);
	await settle(600);
	const loopA = await app.evaluate<Loop | null>(READ_LOOP);
	await settle(1000);
	const loopB = await app.evaluate<Loop | null>(READ_LOOP);
	check(
		"悬停时思考内容在行内读回",
		Boolean(loopA && loopA.marquee && loopA.copies === 2),
		JSON.stringify(loopA),
	);
	check(
		"读回是在动的，且两端有渐变",
		Boolean(loopA && loopB && loopB.tx < loopA.tx - 5 && loopB.fadeLeft === "13px" && loopB.fadeRight === "22px"),
		`tx ${loopA?.tx} → ${loopB?.tx}，fade ${loopB?.fadeLeft}/${loopB?.fadeRight}`,
	);
	await shot("04-hover-finished.png");

	await moveTo(AWAY);
	await settle(500);
	const back = await app.evaluate<Loop | null>(READ_LOOP);
	check("鼠标移开，回到开头停住", Boolean(back && back.tx === 0 && back.fadeLeft === "0px"), JSON.stringify(back));
} finally {
	stream.finish?.();
	await app.stop();
	await new Promise((resolve) => model.close(() => resolve(null)));
}

process.stdout.write(`\n${failures === 0 ? "全部通过" : `${failures} 项未通过`}，截图在 ${OUT}\n`);
process.exit(failures === 0 ? 0 : 1);
