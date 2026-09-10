/* oxlint-disable no-console -- probe CLI that prints what the real window did */
/**
 * 把这一轮的三处界面修复录下来，真模型、真设置页，拍窗口不拍屏幕。
 *
 * 要看到的三件事：
 *
 *   ① 思考行逐字写的时候，**两头是化开的**，不再是一刀切。左边宽一点（要离开的字），右边窄一点
 *     （刚落下的字，化太多就该看的看不清）。而且只在真的溢出时才化——短句子从左边开始写，加渐隐
 *     等于平白抹淡开头。
 *   ② 一轮跑完之后，过程收起。**收起和展开，到下面那段答案的距离是同一个**。它们一度是 2px 和
 *     10px：点一下开、点一下关，答案就在原地跳。所以要连着开、关、再开地拍，才看得出它不跳。
 *   ③ 新加一个模型时，三个能力开关**默认都开着**。原本默认全关，于是加完之后模型不会调工具、
 *     思考档位是灰的，界面上还没有一处说明为什么。
 *
 * 用法：node --experimental-strip-types e2e/ui-fixes-recorder.ts [输出文件]
 */

import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { startApp, type RunningApp } from "./app.ts";
import { driver, encode, pause, startRecording, type Frame } from "./record.ts";

const REAL_HOME = join(homedir(), ".lyra");
const OUT = process.argv[2] ?? join(homedir(), "Downloads", "lyra-ui-fixes.mp4");
const PORT = 9422;

/** 一个想起来要花点功夫的问题——思考那一行得够长，才看得见它在两头化开。 */
const PROMPT = [
	"先想清楚再动手：一个 8x8 的棋盘，去掉对角线上的两个格子，还能不能用 31 张 1x2 的骨牌铺满？",
	"把推理过程想完整，然后用 ls 看一眼这个工程里有哪些文件，最后把结论追加到 README.md。",
].join("\n");

async function seed(home: string): Promise<void> {
	await mkdir(home, { recursive: true });
	const cwd = join(home, "project");
	await mkdir(cwd, { recursive: true });
	await writeFile(join(cwd, "README.md"), "# 演示工程\n\n一个用来录制界面的空壳工程。\n");
	await writeFile(join(cwd, "index.ts"), "export const version = '1.0.0'\n");
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
	await writeFile(join(home, "window.json"), JSON.stringify({ width: 1440, height: 900 }));
}

let app: RunningApp;

async function main() {
	const frames: Frame[] = [];
	app = await startApp({ port: PORT, seed, scaleFactor: 2 });
	const d = driver(app);
	const stop = await startRecording(PORT, frames);
	/** 拍完之后把量到的数印出来——画面好看不算数，数一致才算。 */
	let measured = "";
	try {
		console.log("① 提问：思考行逐字写，两头化开");
		await pause(1200);
		await d.type(PROMPT);
		await pause(1500);
		await d.submit();
		// 流式过程本身就是要拍的东西，不快进。
		await d.settled();
		await pause(2500);

		console.log("② 收起状态：到答案的距离");
		await pause(2200);

		console.log("③ 展开：同一个距离，答案不跳");
		await d.mark("[data-ly-turn-process] .ly-flow-row", "data-demo");
		await d.click("[data-demo]");
		await pause(2600);

		console.log("④ 再收起，再展开——两次都不跳");
		await d.click("[data-demo]");
		await pause(1800);
		await d.click("[data-demo]");
		await pause(1800);

		measured = await app.evaluate<string>(`(() => {
			const proc = document.querySelector('[data-ly-turn-process]');
			const answer = proc?.nextElementSibling;
			const gap = () => Math.round(answer.getBoundingClientRect().top - proc.getBoundingClientRect().bottom);
			const open = gap();
			const rows = [...document.querySelectorAll('[data-ly-turn-process] .ly-flow-row')];
			const inner = [];
			for (let i = 1; i < rows.length; i++) {
				inner.push(Math.round(rows[i].getBoundingClientRect().top - rows[i - 1].getBoundingClientRect().bottom));
			}
			return JSON.stringify({ open, inner: [...new Set(inner)] });
		})()`);

		console.log("⑤ 收起，停一拍");
		await d.click("[data-demo]");
		await pause(2000);
		const closed = await app.evaluate<number>(`(() => {
			const proc = document.querySelector('[data-ly-turn-process]');
			return Math.round(proc.nextElementSibling.getBoundingClientRect().top - proc.getBoundingClientRect().bottom);
		})()`);
		measured = `${measured} 收起=${closed}px`;

		console.log("⑥ 设置页 → 模型设置 → 添加模型：三个开关默认都开着");
		await d.click(".ly-sidebar-foot button");
		await pause(1200);
		await app.evaluate(`(()=>{document.querySelector('[data-demo3]')?.removeAttribute('data-demo3');[...document.querySelectorAll("nav button")].find((b)=>b.textContent.trim()==="模型设置")?.setAttribute('data-demo3','');})()`);
		await d.click("[data-demo3]");
		await pause(1600);

		/*
		 * 先选中一个供应商。
		 *
		 * 「添加模型」在 `ProviderModels` 里，而那是 `ProviderEditor` 的一部分——没选供应商时右边那
		 * 半边根本没有它。第一版录制就是直接找那个按钮，找不到，最后一幕整段丢了。
		 */
		await app.evaluate(`(()=>{
			document.querySelector('[data-demo6]')?.removeAttribute('data-demo6');
			const list = document.querySelectorAll('main aside button, main nav ~ div button');
			const row = [...document.querySelectorAll('button')].find((b) => /^provider-|relay|deepseek|api\\./i.test(b.innerText.trim()));
			(row ?? list[0])?.setAttribute('data-demo6', '');
		})()`);
		await d.click("[data-demo6]").catch(() => console.log("   （供应商已经选中了）"));
		await pause(1500);

		await d.markByText("/添加模型/", "data-demo5");
		await d.click("[data-demo5]");
		await d.until(`document.querySelector('[data-ly-modal]')`, 20000);
		await pause(1200);
		// 三个开关在弹窗底部，滚到它们那里再停住让人看清。
		await app.evaluate(`(()=>{
			const modal = document.querySelector('[data-ly-modal]');
			const scroller = [...modal.querySelectorAll('*')].find((e) => e.scrollHeight > e.clientHeight + 20);
			scroller?.scrollTo({ top: scroller.scrollHeight, behavior: 'smooth' });
		})()`);
		await pause(3400);
		const toggles = await app.evaluate<string>(`(() => {
			const modal = document.querySelector('[data-ly-modal]');
			const rows = [...modal.querySelectorAll('button[role="switch"], [role="switch"], input[type="checkbox"]')];
			return JSON.stringify(rows.map((r) => r.getAttribute('aria-checked') ?? String(r.checked)));
		})()`).catch(() => "读不到");
		measured = `${measured}；新建模型的三个开关 = ${toggles}`;
	} catch (e) {
		/*
		 * 一幕没拍成，不该把已经拍到的都扔掉。
		 *
		 * 上一版是直接抛：最后一幕的选择器没命中，前面 1959 帧连同那一整轮真实对话一起没了，要重来
		 * 得再等好几分钟、再花一次模型的钱。哪一幕断的印出来就够了，片子照出。
		 */
		console.log(`\n⚠️  剧本中断：${String(e).slice(0, 200)}`);
		console.log("   前面拍到的照常合成。");
	} finally {
		await stop();
		console.log(`\n采到 ${frames.length} 帧，正在合成…`);
		const home = app.home;
		await app.stop();
		await rm(home, { recursive: true, force: true });
	}
	if (frames.length === 0) throw new Error("一帧都没采到");
	await encode(frames, OUT);
	console.log(`\n量到的间距：${measured}`);
	console.log(`✅ ${OUT}`);
}

await main();
