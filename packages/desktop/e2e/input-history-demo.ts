/* oxlint-disable no-console -- probe CLI that prints what the real window did */
/**
 * 方向键往回翻自己说过的话——在真窗口里按真键盘，边验边录。
 *
 * 单测已经把规矩逐条验过了（`test/ui/input-history.test.ts`），但那些跑在 happy-dom 里，按的是合成
 * 出来的 `keydown`。这里补的是它证不到的那一段：键要先经过 `@` 的名单和 `/` 的命令单，两个都得在
 * 方向键上让路；`Input.dispatchKeyEvent` 送的是操作系统那一级的按键，textarea 得真的握着焦点才收
 * 得到。这两层在 happy-dom 里根本不存在，所以那边永远是绿的。
 *
 * 历史直接 seed 成一个会话文件，不去跑模型：这一轮要验的是按键这条路，而一轮真实对话会让页面忙上
 * 好几分钟——上一版就是这么卡在 `Runtime.releaseObjectGroup timed out` 上的，验的东西一条都没轮到。
 *
 * 最要紧的一条是草稿：翻出去再翻回来，手里那句没打完的话必须原样还在。丢一次，这个功能就再也没人
 * 敢按第二次。
 *
 * 用法：node --experimental-strip-types e2e/input-history-demo.ts [输出目录]
 */

import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { startApp, type RunningApp } from "./app.ts";
import { driver, encode, pause, startRecording, type Frame } from "./record.ts";

const REAL_HOME = join(homedir(), ".lyra");
const OUT_DIR = process.argv[2] ?? join(homedir(), "Desktop", "Lyra输入历史测试");
const PORT = 9427;
const STAMP = new Date()
	.toLocaleString("sv-SE", { timeZone: "Asia/Shanghai" })
	.replace(/[: ]/g, "-")
	.slice(0, 16);

const UP = 38;
const DOWN = 40;
const SESSION_ID = randomUUID();

/** 会话里那两句人说过的话。翻出来的必须一字不差是它们。 */
const FIRST = "第一句：这个项目用 pnpm，不要用 npm。";
const SECOND = "第二句：发版走 pnpm release，先排练。";
/** 往回翻之前手里那半句。翻一圈回来，它必须还在。 */
const DRAFT = "这是我打了一半的草稿";

let app: RunningApp;
const checks: { ok: boolean; what: string; saw: string }[] = [];
function check(what: string, ok: boolean, saw: string) {
	checks.push({ ok, what, saw });
	console.log(`   ${ok ? "✅" : "❌"} ${what}${ok ? "" : `  —— 看到的是：${saw}`}`);
}

async function seed(home: string): Promise<void> {
	await mkdir(home, { recursive: true });
	const cwd = join(home, "project");
	await mkdir(cwd, { recursive: true });
	await writeFile(join(cwd, "README.md"), "# 演示工程\n");

	const projectId = createHash("sha256").update(cwd).digest("hex").slice(0, 16);
	const dir = join(home, "sessions", projectId);
	await mkdir(dir, { recursive: true });

	/*
	 * 一整个会话，照着磁盘上真实的那种形状写：一条 meta 打头，后面是消息，一行一条。
	 *
	 * 两问两答而不是光有两问：中间夹着 assistant，才说得清「翻的是人说的那两句，没把模型的话也算
	 * 进去」——这正是 `spokenByPerson` 要挡住的事情之一。
	 */
	const at = Date.now() - 600_000;
	/*
	 * 序号从 1 起，meta 占掉第一个。
	 *
	 * `store.read` 的闸门是 `record.seq > sinceSeq`，而 `sinceSeq` 默认 0——一条 `seq: 0` 的 meta
	 * 于是被读掉了，`load` 在 `if (!meta) return null` 处交回 null，会话连列表都进不去。磁盘上真
	 * 实的日志也是从 1 开始编的。
	 */
	const record = (seq: number, role: string, text: string) =>
		JSON.stringify({
			seq,
			ts: at + seq * 1000,
			type: "message",
			message: { role, content: [{ type: "text", text }], timestamp: at + seq * 1000 },
		});
	const lines = [
		JSON.stringify({
			seq: 1,
			ts: at,
			type: "meta",
			meta: {
				id: SESSION_ID,
				title: "输入历史演示",
				cwd,
				projectId,
				projectName: "演示工程",
				createdAt: at,
				updatedAt: at,
				modelId: "relay/gemini-3.7-flash-high",
				messageCount: 4,
				usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, cost: 0 },
				seq: 0,
			},
		}),
		record(2, "user", FIRST),
		record(3, "assistant", "好的，记下了：用 pnpm。"),
		record(4, "user", SECOND),
		record(5, "assistant", "也记下了：发版前先排练。"),
	];
	await writeFile(join(dir, `${SESSION_ID}.jsonl`), `${lines.join("\n")}\n`);

	/*
	 * 借真实的模型配置，只为了让最后那一次「发送」是真的发出去。
	 *
	 * 不借的话，submit 照样会清空输入框（`setText("")` 在 `buildOutgoing` 之后、模型调用之前），
	 * 验证还是成立的——但窗口上会挂一条「未配置模型」的红提示，录进视频里比功能本身更抢眼。
	 */
	for (const file of ["credentials.json", "vault.key"]) {
		await copyFile(join(REAL_HOME, file), join(home, file)).catch(() => {
			throw new Error(`没找到 ~/.lyra/${file}——最后那次真实发送需要它`);
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
	await writeFile(join(home, "window.json"), JSON.stringify({ width: 1280, height: 860 }));
}

function fieldValue(): Promise<string> {
	return app.evaluate<string>(
		'(() => { const el = document.querySelector("main textarea"); return el ? el.value : ""; })()',
	);
}

/** 输入框上沿那行小字。没在翻历史时它根本不该存在。 */
function indicator(): Promise<string> {
	return app.evaluate<string>(
		'(() => { const el = document.querySelector("[data-ly-history]"); return el && el.textContent ? el.textContent.trim() : ""; })()',
	);
}

/** 把光标放到第 n 个字符处，顺手确保输入框握着焦点——真实按键只送给聚焦的那个元素。 */
function putCaret(at: number): Promise<void> {
	return app.evaluate(
		`(() => { const el = document.querySelector("main textarea"); el.focus(); el.setSelectionRange(${at}, ${at}); })()`,
	);
}

async function main() {
	await mkdir(OUT_DIR, { recursive: true });
	const frames: Frame[] = [];
	app = await startApp({ port: PORT, seed, scaleFactor: 2 });
	const d = driver(app);
	const stop = await startRecording(PORT, frames);

	try {
		console.log("【一】打开那个已经说过两句话的会话");
		await d.until('document.querySelector("main textarea")', 30000);
		await pause(1200);
		// 真鼠标：会话行用 evaluate 里的 .click() 是打不开的。
		await d.click(`[data-ly-row="${SESSION_ID}"]`);
		await d.until(`document.body.innerText.includes(${JSON.stringify("不要用 npm")})`, 20000);
		await pause(1500);
		check("会话开着，两句话都在转录里", true, "");

		console.log("\n【二】先打半句草稿，再往回翻");
		await d.type(DRAFT);
		await pause(1200);
		await putCaret(DRAFT.length);
		await pause(400);

		await d.key("ArrowUp", UP);
		await pause(1100);
		const up1 = await fieldValue();
		const mark1 = await indicator();
		check("↑ 翻出的是最近说的那句", up1 === SECOND, up1 || "（空的）");
		check("框里标着 1/2", /1\s*\/\s*2/.test(mark1), mark1 || "（没有指示器）");
		/*
		 * 在框**里**，不是浮在框外。
		 *
		 * 从 `.ly-composer` 往上找；页面里不止一个输入框外壳（侧边聊天共用同一个），所以先用
		 * `main` 限定到主输入框这一个。
		 */
		const inside = await app.evaluate<boolean>(
			'(() => { const el = document.querySelector("main [data-ly-history]"); return Boolean(el && el.closest(".ly-composer")); })()',
		);
		check("那行小字长在输入框里面", inside, inside ? "" : "（跑到框外面去了）");

		await d.key("ArrowUp", UP);
		await pause(1100);
		const up2 = await fieldValue();
		const mark2 = await indicator();
		check("再按 ↑ 翻到更早那句", up2 === FIRST, up2 || "（空的）");
		check("框里标着 2/2", /2\s*\/\s*2/.test(mark2), mark2 || "（没有指示器）");

		await d.key("ArrowUp", UP);
		await pause(900);
		const up3 = await fieldValue();
		check("到头就停住，不绕回最近那条", up3 === FIRST, up3);

		console.log("\n【三】翻回来，草稿必须原样还在");
		await d.key("ArrowDown", DOWN);
		await pause(1000);
		const down1 = await fieldValue();
		check("↓ 回到较近的那句", down1 === SECOND, down1);

		await d.key("ArrowDown", DOWN);
		await pause(1400);
		const back = await fieldValue();
		check("再 ↓ 回到自己那半句草稿", back === DRAFT, back || "（空的——草稿丢了）");
		check("回到草稿就不再标第几条", (await indicator()) === "", (await indicator()) || "（已消失）");

		console.log("\n【四】多行文本里，方向键该归光标管");
		await pause(600);
		await d.type("上面一行\n下面一行");
		await pause(900);
		// 光标搁在第二行开头：它上面还有一行，↑ 的本分是把光标挪上去，不是翻历史。
		await putCaret(5);
		await pause(400);
		await d.key("ArrowUp", UP);
		await pause(1000);
		const multi = await fieldValue();
		check("多行里没被历史抢走 ↑", multi === "上面一行\n下面一行", multi.replace(/\n/g, "⏎"));

		// 挪到最前面，这才轮到历史接手。
		await putCaret(0);
		await pause(400);
		await d.key("ArrowUp", UP);
		await pause(1200);
		const fromTop = await fieldValue();
		check("光标贴到最前面时才翻历史", fromTop === SECOND, fromTop);
		await pause(1200);

		console.log("\n【五】发出去之后，那行小字不该还留着");
		check("发送前确实标着", (await indicator()) !== "", "（发送前就没有，这一条白验了）");
		await d.submit();
		await pause(2000);
		const afterSend = await indicator();
		check("发完之后那行小字没了", afterSend === "", afterSend);
		check("输入框也空了", (await fieldValue()) === "", await fieldValue());
		await pause(1800);
	} finally {
		await stop();
		console.log(`\n采到 ${frames.length} 帧，正在合成 60fps…`);
	}

	if (frames.length === 0) throw new Error("一帧都没采到");
	const passed = checks.filter((c) => c.ok).length;
	const out = join(OUT_DIR, `${STAMP}_方向键翻输入历史_${passed}of${checks.length}.mp4`);
	await app.stop();
	await encode(frames, out, 60, 1200);

	console.log(`\n${passed}/${checks.length} 项通过`);
	console.log(`视频：${out}`);
	if (passed !== checks.length) process.exitCode = 1;
}

main().catch(async (error) => {
	console.error(error);
	await app?.stop().catch(() => {});
	process.exitCode = 1;
});
