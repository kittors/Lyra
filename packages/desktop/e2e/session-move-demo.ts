/* oxlint-disable no-console -- a probe CLI whose entire output is what it printed */
/**
 * 把一条对话搬到另一个项目下，录下来。
 *
 * 用户报的是两句话：「无法移动到新项目」「过 1 秒就恢复原样了」。两句说的是同一件事——那个菜单
 * 从来只改内存：三个字段在渲染层改掉、弹一句「已移动到 X」，磁盘上一个字节都没动，主进程那边连
 * 「移动会话」这个操作都不存在。于是下一次推送把整条 meta 换回磁盘那一份，对话自己飘回原处。
 *
 * 所以这段片子要回答的不是「点得动吗」，是**它待得住吗**。三段：
 *
 *   一、搬过去。右键那条对话 → 项目 → 另一个项目，看它从一个分组跳到另一个分组。
 *   二、盯住它。镜头不动，停六秒——原来的毛病就发生在这六秒里的第一秒。
 *   三、重启。旧实现在这一步是必然回弹的（内存没了，磁盘上从来就是旧的），所以这一段才是结论。
 *
 * 断言另走一路打在终端上：DOM 里它在哪个分组、磁盘上那个 jsonl 躺在哪个目录。视频回答「看起来
 * 对不对」，终端回答「量出来是多少」。
 */

import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { projectIdFor, SessionStore } from "@lyra/core";
import { startApp, type RunningApp } from "./app.ts";
import { encode, startRecording, type Frame } from "./record.ts";

const OUT = join(homedir(), "Desktop", "Lyra移动对话测试");
const stamp = new Date().toLocaleString("sv-SE", { timeZone: "Asia/Shanghai" }).replace(/[: ]/g, "-");
const PORT = 9421;

const FROM = { name: "设计稿", dir: "project-from" };
const TO = { name: "插件开发", dir: "project-to" };

let app: RunningApp;
const frames: Frame[] = [];
const results: { name: string; ok: boolean; detail: string }[] = [];
function check(name: string, ok: boolean, detail: string) {
	results.push({ name, ok, detail });
	console.log(`${ok ? "✅" : "❌"} ${name}\n     ${detail}`);
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(expression: string, label = expression) {
	await app.evaluate(
		`new Promise((resolve,reject)=>{const end=Date.now()+20000;const step=()=>{if(${expression})resolve();else if(Date.now()<end)requestAnimationFrame(step);else reject(new Error(${JSON.stringify(label)}));};step();})`,
	);
}

/** 真实指针，不是合成事件——这个应用里有一部分控件只认真实的命中测试。 */
async function point(selector: string): Promise<{ x: number; y: number }> {
	await until(`document.querySelector(${JSON.stringify(selector)})?.checkVisibility()`, `等 ${selector}`);
	await app.evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'nearest',behavior:'instant'})`);
	await pause(120);
	return app.evaluate<{ x: number; y: number }>(
		`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`,
	);
}

async function click(selector: string, button: "left" | "right" = "left") {
	const at = await point(selector);
	// 先把指针移过去：菜单项要 hover 才亮，录出来也才看得出是点了哪一条。
	await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...at });
	await pause(260);
	await app.send("Input.dispatchMouseEvent", { type: "mousePressed", ...at, button, clickCount: 1 });
	/*
	 * 按下和抬起之间要有一段真实的间隔。
	 *
	 * 连着发，两个事件落在同一个 tick 里：菜单项的 `onClick` 在按下那一下就把弹层换成了下一级，
	 * 等抬起到达时，它原来那个节点已经从 DOM 里摘掉了——新挂上来的弹层去问「这一下点在我里面
	 * 吗」，`contains()` 对着一个游离节点答 false，于是它把自己关掉。真手指按一下是八十毫秒上下，
	 * 那段时间足够新的一层挂稳。
	 */
	await pause(90);
	await app.send("Input.dispatchMouseEvent", { type: "mouseReleased", ...at, button, clickCount: 1 });
}

/**
 * 按可见文字点一个菜单项。
 *
 * 指针真的移过去（菜单项要 hover 才亮，录出来也才看得出点的是哪一条），但**按下那一下走 DOM 的
 * `click()`**。合成指针在这里过不去：`Popover` 的关闭条件是 `mousedown` 落在自己之外，而「项目」
 * 这一项按下去会把整个弹层换成下一级——等这一串事件走完，判定用的那个节点已经不在文档里了，
 * `contains()` 对着游离节点答 false，新挂上来的那一层就把自己关掉了。真手点没事，是因为手指
 * 按下到抬起有八十来毫秒，而 CDP 连发是同一个 tick。这是录制脚本的时序问题，不是产品的毛病——
 * 已经用直接调 IPC 的那条旁路对照确认过：后端那一侧一直是好的。
 *
 * 找的范围只在弹层里（`[data-ly-popover]`），这一条同样是踩出来的：侧边栏自己也有一个写着
 * 「项目」的按钮，而且在 DOM 顺序上排在菜单前面——全局找第一个匹配，点到的是它，菜单原地不动，
 * 看起来就像这一项没反应。
 */
async function byText(text: string, scope = "[data-ly-popover] button") {
	const match = `(e)=>e.checkVisibility()&&(e.innerText||'').trim()===${JSON.stringify(text)}`;
	await until(`[...document.querySelectorAll(${JSON.stringify(scope)})].some(${match})`, `等菜单项「${text}」`);
	await app.evaluate(
		`(()=>{document.querySelector('[data-demo-qa]')?.removeAttribute('data-demo-qa');[...document.querySelectorAll(${JSON.stringify(scope)})].find(${match}).setAttribute('data-demo-qa','');})()`,
	);
	const at = await point("[data-demo-qa]");
	await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...at });
	await pause(420);
	await app.evaluate(`document.querySelector('[data-demo-qa]').click()`);
}

/**
 * 这条对话此刻挂在侧边栏的哪个分组底下——问的是画面，不是 store。
 *
 * 按 DOM 顺序往回找最近的一个分组标题，也就是人眼看到的「它在谁下面」。分组容器本身没有记号
 * （`ProjectGroup` 的根节点上什么都没有），而标题行有 `data-ly-project`，会话行有 `data-ly-row`,
 * 两者在同一条顺序流里先后排着——这也正是读 store 得不到的那个答案：分组是按 `cwd` 算出来的，
 * 而这次修的就是 `cwd` 到底有没有真的变。
 */
function groupOf(sessionId: string): Promise<string | null> {
	return app.evaluate<string | null>(`(() => {
		const id = ${JSON.stringify(sessionId)};
		const marks = [...document.querySelectorAll('[data-ly-project],[data-ly-row]')];
		const at = marks.findIndex((el) => el.getAttribute('data-ly-row') === id);
		if (at < 0) return null;
		for (let i = at - 1; i >= 0; i--) {
			const name = marks[i].getAttribute('data-ly-project');
			if (name) return name;
		}
		return null;
	})()`);
}

/** 磁盘上那个 jsonl 此刻躺在哪个目录——`sessions/<projectId>/`。 */
async function onDisk(home: string, sessionId: string): Promise<string[]> {
	const root = join(home, "sessions");
	const dirs = await readdir(root, { withFileTypes: true }).catch(() => []);
	const found: string[] = [];
	for (const dir of dirs) {
		if (!dir.isDirectory()) continue;
		const files = await readdir(join(root, dir.name)).catch((): string[] => []);
		if (files.includes(`${sessionId}.jsonl`)) found.push(dir.name);
	}
	return found;
}

let sessionId = "";
let fromCwd = "";
let toCwd = "";

async function seed(home: string): Promise<void> {
	const from = join(home, FROM.dir);
	const to = join(home, TO.dir);
	await mkdir(from, { recursive: true });
	await mkdir(to, { recursive: true });
	fromCwd = from;
	toCwd = to;

	// 真的用 store 建，这样 index.json 和 jsonl 都是应用自己写出来的那种。
	const store = new SessionStore(join(home, "sessions"));
	const meta = await store.create(from, "fake/model", "要搬家的那条对话");
	sessionId = meta.id;
	let latest = meta;
	for (const text of ["这条对话原本属于「设计稿」。", "待会儿把它搬到「插件开发」下面。"]) {
		latest = await store.append(latest, {
			type: "message",
			message: { role: "user", content: [{ type: "text", text }], timestamp: Date.now() },
		});
	}

	await writeFile(join(home, "window.json"), JSON.stringify({ width: 1280, height: 860 }));
	await writeFile(
		join(home, "settings.json"),
		JSON.stringify({
			uiLocale: "zh-CN",
			permissionMode: "full",
			projectMemory: false,
			thinking: "off",
			mcpServers: [],
			hooks: [],
			sync: { enabled: false },
			appearance: { reduceMotion: "off" },
			projects: [
				{ path: from, name: FROM.name, pinned: true, lastOpenedAt: Date.now() },
				{ path: to, name: TO.name, pinned: true, lastOpenedAt: Date.now() - 1000 },
			],
			defaultModelId: null,
			providers: [],
		}),
	);
}

async function main() {
	await mkdir(OUT, { recursive: true });
	/*
	 * profile 目录自己管，因为这段片子要重启一次应用。
	 *
	 * `startApp` 不给 `reuseHome` 的时候，它自己 `mkdtemp` 一个，并在 `stop()` 里删掉——而第三段
	 * 正是要用同一份 profile 再起一次。所以这里先建好、先种好，两次启动都指着它，最后自己清。
	 */
	const home = await mkdtemp(join(tmpdir(), "lyra-move-demo-"));
	await seed(home);
	app = await startApp({ port: PORT, reuseHome: home });
	let stop = await startRecording(PORT, frames);

	try {
		await app.evaluate("document.fonts.ready");
		await until(`document.querySelector('[data-ly-row="${sessionId}"]')`, "等那条对话出现在侧边栏");
		await pause(1200);

		const before = await groupOf(sessionId);
		const beforeDirs = await onDisk(home, sessionId);
		check(
			"出发点：对话在「设计稿」底下，日志也在它的目录里",
			before === FROM.name && beforeDirs.length === 1 && beforeDirs[0] === projectIdFor(fromCwd),
			`画面上的分组：${before}；磁盘上的目录：${JSON.stringify(beforeDirs)}`,
		);

		// ---- 一、搬过去 ------------------------------------------------------------
		await click(`[data-ly-row="${sessionId}"]`, "right");
		await pause(900);
		console.log("   右键菜单里有：", await app.evaluate<string[]>(`[...document.querySelectorAll('[role="menu"] button, [data-ly-modal] button')].filter((b)=>b.checkVisibility()).map((b)=>(b.innerText||'').trim())`));
		await byText("项目");
		await pause(700);
		console.log("   项目子菜单里有：", await app.evaluate<string[]>(`[...document.querySelectorAll('[data-ly-popover] button')].filter((b)=>b.checkVisibility()).map((b)=>(b.innerText||'').trim())`));
		await byText(TO.name);
		await pause(900);
		console.log("   界面上的提示：", await app.evaluate<string[]>(`[...document.querySelectorAll('[data-ly-toast], [role="status"], [role="alert"]')].map((n)=>(n.innerText||'').trim()).filter(Boolean)`));

		await until(`!document.querySelector('[data-ly-modal]') && !document.querySelector('[role="menu"]')`, "等菜单收起").catch(() => {});
		await pause(1500);

		const after = await groupOf(sessionId);
		check(
			"点完就到了「插件开发」底下",
			after === TO.name,
			`画面上的分组：${after}`,
		);

		/*
		 * ---- 二、盯住它 ------------------------------------------------------------
		 *
		 * 原来的毛病就发生在这几秒里的第一秒：主进程一推送，它自己飘回去。
		 *
		 * 这六秒要让指针一直在动。screencast 只在画面变化时才给帧，干等的话这一整段只有一两帧，
		 * 合成时被压成一闪而过——而这一段恰恰是整段片子的论点：时间在走，它没有动。指针在两个
		 * 分组之间来回扫，每一下都换一行高亮，于是这六秒有六秒的样子。
		 */
		// 扫的是两个分组的标题，不是那条对话本身——停在对话行上会弹出它的悬浮卡片，
		// 正好盖住这一段要给人看的东西。
		const watchFrom = await point(`[data-ly-project="${FROM.name}"]`);
		const watchTo = await point(`[data-ly-project="${TO.name}"]`);
		for (let i = 0; i < 12; i++) {
			const at = i % 2 === 0 ? watchTo : watchFrom;
			await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: at.x, y: at.y + (i % 3) - 1 });
			await pause(500);
		}
		const stillThere = await groupOf(sessionId);
		check(
			"盯住六秒，它没有飘回「设计稿」（这正是「过 1 秒就恢复原样」那一条）",
			stillThere === TO.name,
			`六秒之后画面上的分组：${stillThere}`,
		);

		const movedDirs = await onDisk(home, sessionId);
		check(
			"日志文件真的搬进了新项目的目录",
			movedDirs.length === 1 && movedDirs[0] === projectIdFor(toCwd),
			`磁盘上的目录：${JSON.stringify(movedDirs)}（新项目应当是 ${projectIdFor(toCwd)}）`,
		);

		// ---- 三、重启 --------------------------------------------------------------
		await stop();
		await app.stop();
		app = await startApp({ port: PORT, reuseHome: home });
		stop = await startRecording(PORT, frames);
		await app.evaluate("document.fonts.ready");
		await until(`document.querySelector('[data-ly-row="${sessionId}"]')`, "重启后等那条对话");
		await pause(2500);

		const afterRestart = await groupOf(sessionId);
		check(
			"重启之后它还在「插件开发」底下（旧实现在这一步必然打回原形）",
			afterRestart === TO.name,
			`重启后画面上的分组：${afterRestart}`,
		);

		const restartDirs = await onDisk(home, sessionId);
		check(
			"重启之后日志也还在新目录里，没有留下一份旧的",
			restartDirs.length === 1 && restartDirs[0] === projectIdFor(toCwd),
			`磁盘上的目录：${JSON.stringify(restartDirs)}`,
		);
		// 收尾也让指针动一动，理由同上：不动就没有帧，最后一段会一闪而过。
		const ending = await point(`[data-ly-project="${TO.name}"]`);
		for (let i = 0; i < 8; i++) {
			await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: ending.x + (i % 2 ? 10 : -10), y: ending.y });
			await pause(450);
		}
	} finally {
		await stop().catch(() => undefined);
		const passed = results.filter((r) => r.ok).length;
		const file = join(OUT, `${stamp}_把对话搬到另一个项目_${passed}of${results.length}.mp4`);
		// 重启那一段中间的空档不该变成十秒黑屏，所以每一帧最多停 1.2 秒。
		await encode(frames, file, 12, 1200).catch((cause) => console.log(`录像没能合成：${cause}`));
		console.log(`\n${passed}/${results.length} 通过`);
		console.log(`🎬 ${file}`);
		await app.stop();
		await rm(home, { recursive: true, force: true });
		if (passed !== results.length) process.exitCode = 1;
	}
}

await main();
