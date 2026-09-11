/* oxlint-disable no-console -- probe CLI that prints what the real window did */
/**
 * 方向键往回翻自己说过的话——在真窗口里按真键盘，边验边录。
 *
 * 单测已经把规矩逐条验过了（`test/ui/input-history.test.ts`），但那些跑在 happy-dom 里，按的是合成
 * 出来的 `keydown`。这里补的是它证不到的那几段：键要先经过 `@` 的名单和 `/` 的命令单，两个都得在
 * 方向键上让路；`Input.dispatchKeyEvent` 送的是操作系统那一级的按键，textarea 得真的握着焦点才收
 * 得到；而叉的显隐是 CSS 的 `:hover` 加一段过渡，happy-dom 里既没有真指针，也不跑过渡。
 *
 * 历史直接 seed 成一个会话文件，不去跑模型：这一轮要验的是按键这条路，而一轮真实对话会让页面忙上
 * 好几分钟。只有最后那一次发送是真的（借了真实模型配置）——「发出去之后那行小字还在不在」，只有真
 * 走一遍 submit 才算数。
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

/** 会话里那三句人说过的话。翻出来的必须一字不差是它们。 */
const WITH_IMAGE = "这个图片里面有什么呢？";
const FIRST = "第一句：这个项目用 pnpm，不要用 npm。";
const SECOND = "第二句：发版走 pnpm release，先排练。";
const SHOT = "截图.png";
/** 往回翻之前手里那半句。翻一圈回来，它必须还在。 */
const DRAFT = "这是我打了一半的草稿";
/** 一张 1×1 的红点 PNG。够小，而且是张真图——加载不了的话缩略图就是个空框。 */
const PNG =
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

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
	 * 序号从 1 起，meta 占掉第一个。
	 *
	 * `store.read` 的闸门是 `record.seq > sinceSeq`，而 `sinceSeq` 默认 0——一条 `seq: 0` 的 meta
	 * 会被读掉，`load` 在 `if (!meta) return null` 处交回 null，会话连列表都进不去。
	 */
	const at = Date.now() - 600_000;
	const record = (seq: number, role: string, text: string) =>
		JSON.stringify({
			seq,
			ts: at + seq * 1000,
			type: "message",
			message: { role, content: [{ type: "text", text }], timestamp: at + seq * 1000 },
		});
	/*
	 * 一条带图的消息，照 `outgoing.ts` 打包出来的形状写：图片前一行标签、然后是 image 块、最后才
	 * 是人打的那句话。`attachments` 是那份元数据清单，`displayText` 是人看到的字。
	 */
	const withImage = (seq: number) =>
		JSON.stringify({
			seq,
			ts: at + seq * 1000,
			type: "message",
			message: {
				role: "user",
				content: [
					{ type: "text", text: `\n\n### Attachment 1 of 1: ${SHOT}\n\n` },
					{ type: "image", data: PNG, mimeType: "image/png" },
					{ type: "text", text: WITH_IMAGE },
				],
				displayText: WITH_IMAGE,
				attachments: [{ name: SHOT, kind: "image", mimeType: "image/png" }],
				timestamp: at + seq * 1000,
			},
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
				messageCount: 6,
				usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, cost: 0 },
				seq: 0,
			},
		}),
		withImage(2),
		record(3, "assistant", "图里是一个一像素的红点。"),
		record(4, "user", FIRST),
		record(5, "assistant", "好的，记下了：用 pnpm。"),
		record(6, "user", SECOND),
		record(7, "assistant", "也记下了：发版前先排练。"),
	];
	await writeFile(join(dir, `${SESSION_ID}.jsonl`), `${lines.join("\n")}\n`);

	/*
	 * 借真实的模型配置，只为了让最后那一次「发送」是真的发出去。
	 *
	 * 不借的话 submit 照样会清空输入框、验证照样成立——但窗口上会挂一条「未配置模型」的红提示，录
	 * 进视频里比功能本身更抢眼。
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

/** 输入框里那行小字。没在翻历史时它根本不该存在。 */
function indicator(): Promise<string> {
	return app.evaluate<string>(
		'(() => { const el = document.querySelector("[data-ly-history]"); return el && el.textContent ? el.textContent.trim() : ""; })()',
	);
}

/**
 * 输入框里此刻挂着几张图、都叫什么名字。
 *
 * 从 textarea 往上 `closest(".ly-composer")` 再往下找，**不能**直接
 * `querySelector("[data-ly-attachments]")`：同一个组件在气泡外面也画一排，转录排在输入框前面，
 * 于是那句话会拿到转录里的附件条。上一版就是这么写的，结果「图跟着回来了」这一条是假绿——它看
 * 的一直是转录里那张图，输入框里有没有根本没验到。
 */
function stripState(): Promise<{ images: number; names: string }> {
	return app.evaluate(
		'(() => {' +
			' const shell = document.querySelector("main textarea")?.closest(".ly-composer");' +
			' const strip = shell ? shell.querySelector("[data-ly-attachments]") : null;' +
			' if (!strip) return { images: 0, names: "" };' +
			' const images = strip.querySelectorAll("img").length;' +
			' const names = [...strip.querySelectorAll("[data-ly-tip]")].map((el) => el.getAttribute("data-ly-tip") || "").join("|");' +
			' return { images, names };' +
			'})()',
	);
}

/** 那个叉此刻的不透明度。0 = 藏着，1 = 露出来了。 */
function crossOpacity(): Promise<string> {
	return app.evaluate<string>(
		'(() => {' +
			' const shell = document.querySelector("main textarea")?.closest(".ly-composer");' +
			' const el = shell ? shell.querySelector("[data-ly-hover-reveal]") : null;' +
			' return el ? getComputedStyle(el).opacity : "(没有这个元素)";' +
			'})()',
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
		console.log("【一】打开那个说过三句话的会话，其中一句还附了张图");
		await d.until('document.querySelector("main textarea")', 30000);
		await pause(1200);
		// 真鼠标：会话行用 evaluate 里的 .click() 是打不开的。
		await d.click(`[data-ly-row="${SESSION_ID}"]`);
		await d.until(`document.body.innerText.includes(${JSON.stringify("不要用 npm")})`, 20000);
		await pause(1500);
		check("会话开着，那几句都在转录里", true, "");

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
		check("框里标着 1/3", /1\s*\/\s*3/.test(mark1), mark1 || "（没有指示器）");
		const inside = await app.evaluate<boolean>(
			'(() => { const el = document.querySelector("main [data-ly-history]"); return Boolean(el && el.closest(".ly-composer")); })()',
		);
		check("那行小字长在输入框里面", inside, inside ? "" : "（跑到框外面去了）");

		await d.key("ArrowUp", UP);
		await pause(1100);
		check("再按 ↑ 翻到更早那句", (await fieldValue()) === FIRST, await fieldValue());

		console.log("\n【三】再翻一条——那一条当初附了图，图得跟着回来");
		await d.key("ArrowUp", UP);
		await pause(1400);
		const withImg = await fieldValue();
		const strip = await stripState();
		check("翻出的是带图的那句", withImg === WITH_IMAGE, withImg || "（空的）");
		check("那张图跟着回到输入框里了", strip.images === 1, `缩略图 ${strip.images} 张`);
		check("认得出是哪个文件", strip.names.includes(SHOT), strip.names || "（没有文件名）");
		await pause(1200);

		console.log("\n【四】叉要等鼠标挪上去才现身");
		const resting = await crossOpacity();
		check("没碰它的时候，叉是藏着的", resting === "0", resting);
		await d.hover(".ly-composer [data-ly-attachments] img");
		await pause(900);
		const hovered = await crossOpacity();
		check("鼠标挪上去，叉就出来了", hovered === "1", hovered);
		await pause(1200);
		// 挪开再看一眼：这一步同时说明「现身」不是一次性的。
		await d.hover("main textarea");
		await pause(900);
		const left = await crossOpacity();
		check("鼠标挪开又藏回去", left === "0", left);
		await pause(800);

		console.log("\n【五】一路翻回来，草稿和它的附件都得原样还在");
		await d.key("ArrowDown", DOWN);
		await pause(900);
		await d.key("ArrowDown", DOWN);
		await pause(900);
		await d.key("ArrowDown", DOWN);
		await pause(1400);
		const back = await fieldValue();
		const backStrip = await stripState();
		check("回到自己那半句草稿", back === DRAFT, back || "（空的——草稿丢了）");
		check("草稿本来没附件，图也跟着退干净", backStrip.images === 0, `还剩 ${backStrip.images} 张`);
		check("回到草稿就不再标第几条", (await indicator()) === "", (await indicator()) || "（已消失）");

		console.log("\n【六】多行文本里，方向键该归光标管");
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
		check("光标贴到最前面时才翻历史", (await fieldValue()) === SECOND, await fieldValue());
		await pause(1200);

		console.log("\n【七】发出去之后，那行小字不该还留着");
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
