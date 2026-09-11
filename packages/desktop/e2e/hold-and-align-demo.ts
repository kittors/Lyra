/* oxlint-disable no-console -- probe CLI that prints what the real window did */
/**
 * 今天报的两个问题，在真窗口里各验一遍，边验边录。
 *
 *   甲、实时速度**中途消失**了。它该在整个 loading 期间都在——工具跑着的时候挂着上一段的读数，
 *       新的一段写起来之后把它走过去替换掉，而不是一有间隙就不见。
 *   乙、文件链接左边的图标和右边的文件名**没有垂直居中**。
 *
 * 每到一个该验的时刻就从真窗口里读一次，断言它此刻说的话对不对。视频里看到的和断言读到的是同一帧，
 * 所以这段视频本身就是测试记录，而不是一段好看的动图。
 *
 * 甲要靠一个**真实回合**才验得出来：那个 bug 的全部形状是「工具跑完、模型重新开口」的那一瞬间，合成
 * 数据摆不出这个形状。乙相反——排版跟内容是谁写的没有关系，但既然已经起了真窗口、模型也正好会给出
 * 文件链接，就顺手在同一段视频里量了。
 *
 * 用法：node --experimental-strip-types e2e/hold-and-align-demo.ts [输出文件]
 */

import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { startApp, type RunningApp } from "./app.ts";
import { driver, encode, pause, startRecording, type Frame } from "./record.ts";

const REAL_HOME = join(homedir(), ".lyra");
const OUT = process.argv[2] ?? join(homedir(), "Downloads", "lyra-tps-hold-and-align.mp4");
const PORT = 9426;

/*
 * 一道**写字和工具交替**的题目，而不是「先全读完再一口气写」。
 *
 * 这个区别是这次复测才发现的，而且是决定性的：第一版的题目说「先把三个文件都读一遍，然后再写」，于是
 * 整轮的工具调用全发生在第一个字产出之前——那时候本来就还没有读数可保持。断言如实报告了「上一条不作数」，
 * 也就是说那一轮根本没有验到要验的东西。
 *
 * 要让「工具跑着的时候读数挂着」真的发生，必须是 写 → 工具 → 写 → 工具 → 写。每段都要求 400 字上下：
 * 更短的话一段话写完还没跨过 1.2 秒的可信门槛，那一段就不会产出读数。
 */
const PROMPT = [
	"请分三步做，每一步都**先写一段不少于 400 字的中文说明**，讲清楚你接下来要看哪个文件、想从里面确认什么，",
	"写完这段话之后再调用工具去读它。三步依次对应 README.md、index.ts、notes.md。",
	"三步都做完之后，再写一段不少于 300 字的总结，介绍这个工程的结构和用途。",
	"最后单独起一行，给出 README.md 的 markdown 链接（相对路径）。",
].join("");

async function seed(home: string): Promise<void> {
	await mkdir(home, { recursive: true });
	const cwd = join(home, "project");
	await mkdir(cwd, { recursive: true });
	await writeFile(join(cwd, "README.md"), "# 演示工程\n\n一个用来录制界面的空壳工程。\n");
	await writeFile(join(cwd, "index.ts"), "export const version = '1.0.0'\n");
	await writeFile(join(cwd, "notes.md"), "# 笔记\n\n- 这里放一些说明文字，供模型阅读。\n");
	const projectId = createHash("sha256").update(cwd).digest("hex").slice(0, 16);
	await mkdir(join(home, "sessions", projectId), { recursive: true });
	for (const file of ["credentials.json", "vault.key"]) {
		await copyFile(join(REAL_HOME, file), join(home, file)).catch(() => {
			throw new Error(`没找到 ~/.lyra/${file}——真实模型调用需要它`);
		});
	}
	const real = JSON.parse(await readFile(join(REAL_HOME, "settings.json"), "utf8"));
	await writeFile(
		join(home, "settings.json"),
		JSON.stringify({
			...real,
			permissionMode: "full",
			projects: [{ id: projectId, path: cwd, name: "演示工程", pinned: true, lastOpenedAt: Date.now() }],
			pinnedSessionIds: [],
			sync: { enabled: false },
		}),
	);
	await writeFile(join(home, "window.json"), JSON.stringify({ width: 1280, height: 820 }));
}

let app: RunningApp;

const checks: { ok: boolean; what: string; saw: string }[] = [];
function check(what: string, ok: boolean, saw: string) {
	checks.push({ ok, what, saw });
	console.log(`   ${ok ? "✅" : "❌"} ${what}${ok ? "" : `  —— 看到的是：${saw}`}`);
}

/** 运行指示器此刻的样子：说了什么、心情是哪一种。回合结束后它不在了。 */
interface Reading {
	text: string;
	mood: string;
}

async function readLine(): Promise<Reading | null> {
	return app.evaluate<Reading | null>(
		`(() => {
			const el = document.querySelector('[data-ly-running]');
			if (!el) return null;
			return { text: el.innerText.replace(/\\s+/g, ' ').trim(), mood: el.dataset.lyMood || '' };
		})()`,
	);
}

const RATE = /(\d+(?:\.\d+)?) tok\/s/;

/**
 * 在整个回合里不停地读那一行，直到它消失。
 *
 * 每次读之前把它滚进视野：这一行跟在正文后面，而正文正在飞快地长，不滚的话断言读到了一串漂亮的数字，
 * 视频里却什么都看不见。断言问的是 DOM，观众看的是视口，两者得对上。
 */
async function watchTurn(maxMs: number, every = 250): Promise<Reading[]> {
	const seen: Reading[] = [];
	for (let waited = 0; waited < maxMs; waited += every) {
		await app.evaluate(`(() => { document.querySelector('[data-ly-running]')?.scrollIntoView({ block: 'center' }); })()`);
		const line = await readLine();
		if (!line) {
			if (seen.length > 0) break; // 回合结束了
		} else {
			seen.push(line);
		}
		await pause(every);
	}
	return seen;
}

async function main() {
	const frames: Frame[] = [];
	app = await startApp({ port: PORT, seed, scaleFactor: 2 });
	const { hover, mark, type, submit, settled } = driver(app);
	const stop = await startRecording(PORT, frames);
	try {
		// ------------------------------------------------------------------
		console.log("【甲】实时速度：整个 loading 期间都该在");
		// ------------------------------------------------------------------
		await pause(900);
		await type(PROMPT);
		await pause(700);
		await submit();

		// 提交后的头一秒：请求还在路上，一个字都没有产出过。
		await pause(1000);
		const atStart = await readLine();
		check("首 token 到达之前不报速度", !RATE.test(atStart?.text ?? ""), atStart?.text ?? "（那一行不在）");

		const seen = await watchTurn(150_000);
		console.log(`   （整轮读了 ${seen.length} 次）`);

		const firstWithRate = seen.findIndex((r) => RATE.test(r.text));
		check("写起来之后出现了速度", firstWithRate >= 0, `${seen.length} 次里一次都没读到`);

		/*
		 * 这一条就是今天报的那个问题本身。
		 *
		 * 从第一次出现速度算起，到这一行消失为止，中间**不该有任何一次**读不到速度。从前的写法按
		 * 「此刻有没有在写」显示，于是一轮里几十次工具调用就是几十次闪烁。
		 */
		const afterFirst = firstWithRate >= 0 ? seen.slice(firstWithRate) : [];
		const gaps = afterFirst.filter((r) => !RATE.test(r.text));
		check(
			"出现之后再没消失过——工具、思考、等首 token 期间都挂着",
			afterFirst.length > 0 && gaps.length === 0,
			`${gaps.length}/${afterFirst.length} 次断掉了，例如「${gaps[0]?.text ?? ""}」`,
		);

		/*
		 * 而且那些间隙是**真的发生过**的，不是因为这一轮碰巧一直在写。
		 *
		 * 少了这一条，上面那条断言在「整轮都在写字」的回合里会白白通过——一个永远为真的断言等于没有断言。
		 * 心情由 `moodFor` 给：正在写正文是 `composing`，工具跑着是那个工具自己的心情，什么都没有时是
		 * `breathing`。要的是后两者。至少三次，一次可能只是状态切换那一帧。
		 */
		const notComposing = afterFirst.filter((r) => r.mood !== "composing");
		check(
			"这一轮确实经历过不在写正文的阶段（否则上一条不作数）",
			notComposing.length >= 3,
			`整轮 ${afterFirst.length} 次读数里只有 ${notComposing.length} 次不是 composing`,
		);
		const heldThrough = notComposing.filter((r) => RATE.test(r.text));
		check(
			"不在写正文的那些时刻，速度照样挂着",
			notComposing.length >= 3 && heldThrough.length === notComposing.length,
			`${heldThrough.length}/${notComposing.length}`,
		);
		console.log(`      期间的心情：${[...new Set(afterFirst.map((r) => r.mood))].join(" / ")}`);

		const values = afterFirst.map((r) => Number(RATE.exec(r.text)?.[1] ?? 0)).filter((v) => v > 0);
		const distinct = new Set(values.map((v) => v.toFixed(1))).size;
		check("数字在走，不是钉死的一个值", distinct >= 3, `只读到 ${distinct} 个不同的值`);
		check("速度都是正数且在合理量级", values.every((v) => v > 0 && v < 5000), `${Math.min(...values)} ~ ${Math.max(...values)}`);
		console.log(`      读到的速度：${values.slice(0, 14).map((v) => v.toFixed(1)).join(" → ")}${values.length > 14 ? " …" : ""}`);

		await settled();
		await pause(1200);
		check("回合结束后整行消失", (await readLine()) === null, String((await readLine())?.text));

		const finished = await app.evaluate<string | null>(
			`(() => { const n=[...document.querySelectorAll('[data-ly-hover-reveal]')]; const l=n[n.length-1]; return l ? l.innerText.replace(/\\s+/g,' ').trim() : null; })()`,
		);
		check("接力给那条消息上服务商报的真数", Boolean(finished && /tok\/s/.test(finished)), String(finished));

		// ------------------------------------------------------------------
		console.log("\n【乙】文件链接：图标、文字、两个按钮的垂直中心");
		// ------------------------------------------------------------------
		const found = await app.evaluate<number>(`document.querySelectorAll('[data-ly-file-link]').length`);
		check("回答里带出了文件链接", found > 0, `找到 ${found} 个`);
		if (found === 0) return;

		await app.evaluate(`(() => { document.querySelector('[data-ly-file-link]')?.scrollIntoView({ block: 'center' }); })()`);
		await pause(1200);

		const box = await app.evaluate<{
			icon: { mid: number } | null;
			label: { mid: number; height: number } | null;
			button: { mid: number } | null;
			linkLine: number;
			proseLine: number;
			plainLine: number;
		}>(`
			(() => {
				const wrap = document.querySelector('[data-ly-file-link]');
				const pick = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { mid: +(r.top + r.height / 2).toFixed(2), height: +r.height.toFixed(2) }; };
				const link = wrap.querySelector('a');
				// 文字自己的盒子：用 Range 圈住文本节点，那才是字形真正占的高度。
				const node = [...link.childNodes].find((n) => n.nodeType === 3 && n.textContent.trim());
				let label = null;
				if (node) { const range = document.createRange(); range.selectNodeContents(node); const r = range.getBoundingClientRect(); label = { mid: +(r.top + r.height / 2).toFixed(2), height: +r.height.toFixed(2) }; }
				const ps = [...document.querySelectorAll('.prose-dw p')];
				const lp = ps.find((p) => p.querySelector('[data-ly-file-link]'));
				const pp = ps.filter((p) => !p.querySelector('[data-ly-file-link]') && p.innerText.trim());
				return {
					icon: pick(link.querySelector('svg')),
					label,
					button: pick(wrap.querySelector('[data-ly-file-actions] > button')),
					linkLine: lp ? +lp.getBoundingClientRect().height.toFixed(2) : -1,
					proseLine: lp ? +parseFloat(getComputedStyle(lp).lineHeight).toFixed(2) : -1,
					plainLine: pp.length ? +parseFloat(getComputedStyle(pp[0]).lineHeight).toFixed(2) : -1,
				};
			})()
		`);

		if (box.icon && box.label) {
			const delta = +(box.icon.mid - box.label.mid).toFixed(2);
			check(`图标和文件名垂直居中（差 ${delta > 0 ? "+" : ""}${delta}px）`, Math.abs(delta) < 0.6, `${delta}px`);
		}
		if (box.button && box.label) {
			const delta = +(box.button.mid - box.label.mid).toFixed(2);
			check(`两个出口按钮也在同一条中线上（差 ${delta > 0 ? "+" : ""}${delta}px）`, Math.abs(delta) < 0.6, `${delta}px`);
		}
		/*
		 * 和**正文自己的行高**比，不和「另一个段落的总高」比。
		 *
		 * 后者是上一版的写法，它在回答很短、正好有个单行段落时碰巧对了；这次回答长了，挑中的基线是一个
		 * 十七行的段落，于是拿 24.5 去和 419.59 比，报了一个假红。行高是这一行该有多高的**定义**，
		 * 不需要另找一个段落来代表它。旁边印一个普通段落的行高，只是对个照：两者该是同一个数。
		 */
		check(
			`带链接那行没被撑高（${box.linkLine}px，正文行高 ${box.proseLine}px，普通段落行高 ${box.plainLine}px）`,
			box.proseLine > 0 && Math.abs(box.linkLine - box.proseLine) < 0.6,
			`${box.linkLine} vs ${box.proseLine}`,
		);

		console.log("\n   悬停：两个图标依次落位，各自的 tooltip");
		await pause(1200);
		await mark("[data-ly-file-link] a", "data-demo");
		await hover("[data-demo]");
		await pause(1800);
		const shown = await app.evaluate<number>(`document.querySelectorAll('[data-ly-file-actions] > button').length`);
		check("悬停后出现了两个出口", shown === 2, `出现了 ${shown} 个`);

		await mark("[data-ly-file-actions] > button:nth-child(1)", "data-demo2");
		await hover("[data-demo2]");
		await pause(2200);
		await mark("[data-ly-file-actions] > button:nth-child(2)", "data-demo3");
		await hover("[data-demo3]");
		await pause(2200);
		await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 60, y: 640 });
		await pause(1600);
	} finally {
		await stop();
		console.log(`\n采到 ${frames.length} 帧，正在合成 60fps…`);
	}

	if (frames.length === 0) throw new Error("一帧都没采到");
	// 60fps，且任何一帧不停超过 1.2 秒——等模型的那几十秒不值得占用同样长的观看时间。
	await encode(frames, OUT, 60, 1200);

	const passed = checks.filter((c) => c.ok).length;
	console.log(`\n${passed}/${checks.length} 项通过`);
	console.log(`视频：${OUT}`);
	await app.stop();
	if (passed !== checks.length) process.exitCode = 1;
}

await main();
