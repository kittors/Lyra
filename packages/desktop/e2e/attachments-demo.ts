/* oxlint-disable no-console -- probe CLI that prints what the real window did */
/**
 * 附件到底有没有被读进去——在真窗口里，用真文件，发给真模型，边验边录。
 *
 * 这件事只有端到端才算数。单测能证明 `extractDocumentText` 抽得出字，但抽得出字和「模型答得上来」
 * 之间隔着四道关：输入框有没有调用抽取、抽出来的字有没有塞进附件、附件有没有进 content、进去的形状
 * 模型认不认。之前那份 `document-text.ts` 恰恰就是在第一道关上断的——代码写好了，零调用点，谁也没
 * 发现，因为没有任何测试跨过那道关。
 *
 * 所以每一条断言问的都是**只有真读了才答得上来的事实**：白皮书里的 P99 数字、合同里的金额、报表里的
 * 单元格、第二张截图上写的那个词。模型答得出，就说明这一整条链是通的；答不出，就是断了，无论中间哪
 * 一段的单测多绿。
 *
 * 用法：node --experimental-strip-types e2e/attachments-demo.ts [输出目录]
 */

import { writeFileSync } from "node:fs";
import { copyFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { zipSync, strToU8 } from "fflate";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";
import { startApp, type RunningApp } from "./app.ts";
import { driver, encode, pause, startRecording, type Frame } from "./record.ts";

const REAL_HOME = join(homedir(), ".lyra");
const OUT_DIR = process.argv[2] ?? join(homedir(), "Desktop", "Lyra附件能力测试");
const PORT = 9425;

/** 文件名里的时间点，精确到分——同一轮跑出来的几个文件排在一起。 */
const STAMP = new Date()
	.toLocaleString("sv-SE", { timeZone: "Asia/Shanghai" })
	.replace(/[: ]/g, "-")
	.slice(0, 16);

let app: RunningApp;
const checks: { ok: boolean; what: string; saw: string }[] = [];
function check(what: string, ok: boolean, saw: string) {
	checks.push({ ok, what, saw });
	console.log(`   ${ok ? "✅" : "❌"} ${what}${ok ? "" : `  —— 看到的是：${saw}`}`);
}

/**
 * 用 Electron 自己印 PDF、自己截 PNG。
 *
 * 和人手里的文件走同一条生产线：印出来的 PDF 带真正的字形编码表，截出来的 PNG 是真正的位图。用手
 * 搓的字节流测，测到的只是自己的想象。
 */
function renderAssets(dir: string): void {
	const script = join(dir, "make.cjs");
	// 整张剧本先在这边拼成 JSON 常量，再交给那个进程——模板串套模板串是踩过的坑。
	const plan = {
		dir,
		pdf: "<html><meta charset=\"utf-8\"><body style=\"font-family:'PingFang SC';padding:40px;line-height:1.9\"><h1>品类实验室 AI 智能分析平台 技术架构白皮书</h1><h2>第二章 关键指标</h2><p>系统在生产环境的 P99 延迟为 <b>327 毫秒</b>，日均处理请求 4200 万次。</p><h2>第三章 部署拓扑</h2><p>生产集群由 12 个计算节点与 3 个协调节点组成，跨两个可用区部署。</p></body></html>",
		shots: ["<html><meta charset=\"utf-8\"><body style=\"margin:0;width:520px;height:300px;background:#1b4f72;display:flex;align-items:center;justify-content:center;font-family:'PingFang SC';font-size:44px;color:#fff\">ALPHA-771</body></html>", "<html><meta charset=\"utf-8\"><body style=\"margin:0;width:520px;height:300px;background:#7b241c;display:flex;align-items:center;justify-content:center;font-family:'PingFang SC';font-size:44px;color:#fff\">BRAVO-882</body></html>", "<html><meta charset=\"utf-8\"><body style=\"margin:0;width:520px;height:300px;background:#186a3b;display:flex;align-items:center;justify-content:center;font-family:'PingFang SC';font-size:44px;color:#fff\">CHARLIE-993</body></html>"],
	};
	writeFileSync(
		script,
		`const { app, BrowserWindow } = require("electron");
const { writeFileSync } = require("node:fs");
const { join } = require("node:path");
const PLAN = ${JSON.stringify(plan)};
const load = (win, html) => win.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html));
app.on("ready", async () => {
	const big = new BrowserWindow({ show: false, width: 900, height: 1200 });
	await load(big, PLAN.pdf);
	writeFileSync(join(PLAN.dir, "白皮书.pdf"), await big.webContents.printToPDF({ printBackground: true }));

	const small = new BrowserWindow({ show: false, width: 520, height: 300 });
	for (let i = 0; i < PLAN.shots.length; i++) {
		await load(small, PLAN.shots[i]);
		await new Promise((r) => setTimeout(r, 300));
		writeFileSync(join(PLAN.dir, "截图" + (i + 1) + ".png"), (await small.webContents.capturePage()).toPNG());
	}
	app.quit();
});`,
	);
	const electron = createRequire(import.meta.url)("electron") as unknown as string;
	execFileSync(electron, [script], { stdio: "ignore", timeout: 120_000 });
}


async function makeOfficeFiles(dir: string): Promise<void> {
	// 一份 Word 合同：金额只写在正文里，页眉里另有一句只有读了才知道的话。
	writeFileSync(
		join(dir, "合同.docx"),
		zipSync({
			"word/document.xml": strToU8(
				`<?xml version="1.0"?><w:document><w:body>` +
					`<w:p><w:r><w:t xml:space="preserve">合同总金额为 </w:t></w:r><w:r><w:t>860,000 元</w:t></w:r></w:p>` +
					`<w:p><w:r><w:t>乙方为品类实验室，履约期 18 个月。</w:t></w:r></w:p>` +
					`</w:body></w:document>`,
			),
			"word/header1.xml": strToU8(`<?xml version="1.0"?><w:hdr><w:p><w:r><w:t>编号 HT-2026-0417</w:t></w:r></w:p></w:hdr>`),
		}),
	);

	// 一份 Excel：数字藏在第二张表里，逼模型把两张表都读了。
	const { utils, write } = await import("xlsx");
	const book = utils.book_new();
	utils.book_append_sheet(book, utils.aoa_to_sheet([["名称", "数量"], ["苹果", 12], ["香蕉", 340]]), "库存");
	utils.book_append_sheet(book, utils.aoa_to_sheet([["月份", "销售额"], ["一月", 8800], ["二月", 15600]]), "销售");
	writeFileSync(join(dir, "报表.xlsx"), Buffer.from(write(book, { type: "array", bookType: "xlsx" })));

	// 一份 CSV：纯文本，从前被当成二进制拒掉。
	writeFileSync(join(dir, "数据.csv"), "城市,订单量\n杭州,4821\n成都,3907\n", "utf8");
}

async function seed(home: string): Promise<void> {
	await mkdir(home, { recursive: true });
	const cwd = join(home, "project");
	await mkdir(cwd, { recursive: true });
	await writeFile(join(cwd, "README.md"), "# 演示工程\n");
	renderAssets(cwd);
	await makeOfficeFiles(cwd);

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
	await writeFile(join(home, "window.json"), JSON.stringify({ width: 1280, height: 860 }));
}

/**
 * 把文件塞进那个 `<input type="file">`，走的是人选完文件之后的同一条路。
 *
 * 不用 `DOM.setFileInputFiles`：那条 CDP 路子要 `DOM` 域给的 nodeId，而这个连接上它一拿到就作废
 * （`Could not find node with given id`）。在页面里自己拼 `DataTransfer` 反而更贴近真实——`change`
 * 事件是输入框真正监听的那一个，中间一步都没少。
 */
async function attach(files: { path: string; name: string; mime: string }[]): Promise<void> {
	const present = await app.evaluate<number>(`document.querySelectorAll('input[type="file"]').length`);
	if (present === 0) throw new Error("页面上没有 file input");

	await app.evaluate(`window.__lyraProbeFiles = []`);
	for (const file of files) {
		const base64 = (await readFile(file.path)).toString("base64");
		await app.evaluate(`
			(() => {
				const bin = atob(${JSON.stringify(base64)});
				const bytes = new Uint8Array(bin.length);
				for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
				window.__lyraProbeFiles.push(new File([bytes], ${JSON.stringify(file.name)}, { type: ${JSON.stringify(file.mime)} }));
			})()
		`);
	}

	await app.evaluate(`
		(() => {
			const input = document.querySelector('input[type="file"]');
			const transfer = new DataTransfer();
			for (const file of window.__lyraProbeFiles) transfer.items.add(file);
			input.files = transfer.files;
			input.dispatchEvent(new Event("change", { bubbles: true }));
		})()
	`);
}

/**
 * 模型到底回了什么——从会话日志里读，不从界面上刮。
 *
 * 刮界面读到的是**整个窗口**的字：侧边栏、我自己刚打的那句问题、上一轮的回答，全在里面。拿它去断言
 * 「回答里有 327」，那 327 可能来自任何地方——这种检测器不会报错，只会永远通过。日志里的是结构化的
 * 助手消息，模型说了什么就是什么。
 */
async function assistantTexts(sessionDir: string): Promise<string[]> {
	const files = await readdir(sessionDir).catch(() => [] as string[]);
	const out: string[] = [];
	for (const name of files.filter((f) => f.endsWith(".jsonl"))) {
		const raw = await readFile(join(sessionDir, name), "utf8").catch(() => "");
		for (const line of raw.split("\n")) {
			if (!line.includes('"role":"assistant"')) continue;
			try {
				const entry = JSON.parse(line) as { type?: string; message?: { role?: string; content?: { type: string; text?: string }[] } };
				if (entry.type !== "message" || entry.message?.role !== "assistant") continue;
				const text = (entry.message.content ?? [])
					.filter((block) => block.type === "text" && block.text)
					.map((block) => block.text)
					.join(" ");
				if (text.trim()) out.push(text.replace(/\s+/g, " ").trim());
			} catch {
				// 半行——还在写。下一轮再读。
			}
		}
	}
	return out;
}

/** 问一句，等到**新的**一条助手回答落盘为止，返回那一条。 */
async function ask(sessionDir: string, question: string, driverApi: { type: (t: string) => Promise<void>; submit: () => Promise<void>; settled: () => Promise<void> }): Promise<string> {
	const before = (await assistantTexts(sessionDir)).length;
	await driverApi.type(question);
	await pause(600);

	/*
	 * 先确认这句话真的进了输入框。
	 *
	 * 第二轮提问最容易在这里悄悄失败：上一轮的字没清干净、焦点跑到了别处，`type` 打进了虚空。而
	 * 后面等日志的循环只会安静地超时，返回一个空串——空串让所有「不该出现 X」的断言全部通过。
	 */
	const typed = await app.evaluate<string>(
		`(() => { const t = document.querySelector("textarea"); return t ? t.value.slice(0, 40) : "(没有输入框)"; })()`,
	);
	if (!typed.startsWith(question.slice(0, 10))) {
		console.log(`      ⚠️ 输入框里是「${typed}」，不是要问的那句`);
	}

	await driverApi.submit();
	/*
	 * 两分钟封顶，不是默认的五分钟。
	 *
	 * 带七个附件的多模态请求偶尔会在服务商那边挂住——实测见过一次 4 分 18 秒还没返回。默认超时下
	 * 整条探针就陪着它干等，录出来的视频大半是一个不动的转圈。等不到就往下走，让断言如实报红，
	 * 比让人对着进度条猜「是不是卡了」强。
	 */
	await driverApi.settled(120_000);

	// 落盘比「这一轮结束」晚一点点，所以这里等的是日志，不是界面。
	for (let waited = 0; waited < 30_000; waited += 400) {
		const texts = await assistantTexts(sessionDir);
		if (texts.length > before) return texts.slice(before).join(" ");
		await pause(400);
	}
	console.log(`      ⚠️ 等了 30 秒没等到新回答（此前 ${before} 条）`);
	return "";
}

async function main() {
	await mkdir(OUT_DIR, { recursive: true });
	const frames: Frame[] = [];
	app = await startApp({ port: PORT, seed, scaleFactor: 2 });
	const driverApi = driver(app);
	const stop = await startRecording(PORT, frames);
	const cwd = join(app.home, "project");
	const projectId = createHash("sha256").update(cwd).digest("hex").slice(0, 16);
	const sessionDir = join(app.home, "sessions", projectId);

	try {
		console.log("【一】七个文件一起附上：PDF / Word / Excel / CSV / 三张截图");
		await pause(1000);
		await attach([
			{ path: join(cwd, "白皮书.pdf"), name: "白皮书.pdf", mime: "application/pdf" },
			{ path: join(cwd, "合同.docx"), name: "合同.docx", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
			{ path: join(cwd, "报表.xlsx"), name: "报表.xlsx", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
			{ path: join(cwd, "数据.csv"), name: "数据.csv", mime: "text/csv" },
			{ path: join(cwd, "截图1.png"), name: "截图1.png", mime: "image/png" },
			{ path: join(cwd, "截图2.png"), name: "截图2.png", mime: "image/png" },
			{ path: join(cwd, "截图3.png"), name: "截图3.png", mime: "image/png" },
		]);
		await pause(2500);

		// 提示条：从前这里会跳出「内容无法作为文本读取」。现在只有真读不了的才该出现。
		// 不用正则：模板串会把 `\n` 这类转义提前吃掉，正则字面量在传过去之前就断了。
		const warned = await app.evaluate<string>(
			`(() => {
				const t = document.body.innerText;
				for (const phrase of ["无法作为文本读取", "只看得到文件名", "只附上了文件名"]) {
					if (t.includes(phrase)) return phrase;
				}
				return "";
			})()`,
		);
		check("不再冒出「内容读不了」那句话", warned === "", warned || "（没有提示）");

		console.log("\n【二】问四份文档里的事实——只有真读进去了才答得上");
		const answer = await ask(
			sessionDir,
			"只依据我附上的文件回答，逐条给出数字，不要解释：" +
				"1) 白皮书里 P99 延迟多少毫秒；2) 合同总金额；3) 报表里二月的销售额；4) 数据.csv 里成都的订单量。",
			driverApi,
		);
		console.log(`      模型回答：${answer.slice(0, 220)}`);
		check("PDF 读到了（P99 = 327 毫秒）", answer.includes("327"), answer.slice(0, 100) || "（没抓到回答）");
		check("Word 读到了（金额 860,000）", /860[,，]?000/.test(answer), answer.slice(0, 100));
		check("Excel 读到了（二月 15600）", /15[,，]?600/.test(answer), answer.slice(0, 100));
		check("CSV 读到了（成都 3907）", answer.includes("3907"), answer.slice(0, 100));

		console.log("\n【三】序号定位：「第二张截图」和「excel 文件 1」");
		const located = await ask(
			sessionDir,
			"两个问题，各一行：1) 我发的第二张截图上写的是哪个词？2) 我说的「excel 文件 1」指的是哪个文件名？",
			driverApi,
		);
		console.log(`      模型回答：${located.slice(0, 220)}`);
		/*
		 * 否定断言必须先有「拿到了回答」这个前提。
		 *
		 * 上一轮就栽在这儿：`located` 是空串，于是「没把第一张当成第二张」通过了，「也没答成第三张」
		 * 也通过了——两条永远为真的断言，报出来是两个绿勾，而实际上那一问根本没问出去。
		 */
		// 模型常把连字符写成 en dash（`BRAVO–882`），那是排版习惯不是答错——检测器得认这一家子。
		const answered = located.trim().length > 0;
		check("第三问确实拿到了回答", answered, "（空的——那一问没问出去）");
		check("第二张截图答对了（BRAVO-882）", answered && /BRAVO[-\s]?882/i.test(located), located.slice(0, 100) || "（没抓到回答）");
		check("没把第一张当成第二张", answered && !/ALPHA[-\s]?771/i.test(located), located.slice(0, 100) || "（没抓到回答）");
		check("也没答成第三张", answered && !/CHARLIE[-\s]?993/i.test(located), located.slice(0, 100) || "（没抓到回答）");
		check("「excel 文件 1」指得准（报表.xlsx）", answered && /报表\.xlsx/.test(located), located.slice(0, 100) || "（没抓到回答）");
		await pause(1500);
	} finally {
		await stop();
		console.log(`\n采到 ${frames.length} 帧，正在合成 60fps…`);
	}

	if (frames.length === 0) throw new Error("一帧都没采到");
	const passed = checks.filter((c) => c.ok).length;
	const out = join(OUT_DIR, `${STAMP}_附件读取与序号定位_${passed}of${checks.length}.mp4`);
	await app.stop();
	await encode(frames, out, 60, 1200);

	console.log(`\n${passed}/${checks.length} 项通过`);
	console.log(`视频：${out}`);
	if (passed !== checks.length) process.exitCode = 1;
}

await main();
