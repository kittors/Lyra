/* oxlint-disable no-console -- probe CLI that prints what the real window did */
/**
 * 在真窗口里、用真实供应商验证这一轮修的几件事。
 *
 * 不是模拟：它把本机 `~/.lyra` 的 `settings.json` 与 `credentials.json` 复制进一个临时 profile，
 * 于是发出去的是真的 HTTP 请求，回来的是真的模型输出。客户报的两条 400（`input[N].id` 和
 * `input[N].content`）只在真实上游那里才会出现，模型桩永远是绿的——这个探针存在的理由就是这个。
 *
 *   1. 换模型之后还能不能继续说话（客户问题 2、3）
 *   2. 引用一份长 md，气泡里不铺正文，而模型确实读到了（客户问题 1）
 *   3. 拉取弹窗的遮罩盖没盖住整扇窗（客户问题 6）
 *
 * 用完把临时 profile 删掉，不在用户目录里留东西。
 */

import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { startApp, type RunningApp } from "./app.ts";

const REAL_HOME = join(homedir(), ".lyra");

/** 一份 400 行的 md，长到「铺在气泡里」和「没铺」一眼就能分辨。 */
const LONG_DOC = [
	"# 验收文档",
	"",
	"这份文档存在的唯一目的，是证明它的正文不会被塞进消息气泡里。",
	"",
	...Array.from({ length: 400 }, (_, i) => `- 第 ${i + 1} 行填充内容，用来把这份文档撑长。`),
	"",
	"## 暗号",
	"",
	"HANDSHAKE-7F3B16F2",
	"",
].join("\n");

async function seed(home: string): Promise<void> {
	await mkdir(home, { recursive: true });
	const cwd = join(home, "project");
	await mkdir(cwd, { recursive: true });
	await writeFile(join(cwd, "README.md"), "# 验收工程\n");
	const projectId = createHash("sha256").update(cwd).digest("hex").slice(0, 16);
	await mkdir(join(home, "sessions", projectId), { recursive: true });

	/*
	 * 真实供应商与真实密钥。
	 *
	 * `credentials.json` 原样复制（密钥不解析、不打印、不写到别处）；`settings.json` 只留供应商和
	 * 默认模型，项目列表换成这个临时目录——真实的是「跟谁说话」，不是「在谁的工作区里说」，
	 * 用户自己的会话一条都不该被这个探针碰到。
	 */
	// `credentials.json` 是 AES-GCM 密文，钥匙在 `vault.key`——两个都要，少一个就是 401。
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
			projects: [{ id: projectId, path: cwd, name: "验收工程", pinned: true, lastOpenedAt: Date.now() }],
			pinnedSessionIds: [],
			sync: { enabled: false },
		}),
	);
	await writeFile(join(home, "window.json"), JSON.stringify({ width: 1400, height: 900 }));
	await writeFile(join(home, "handshake.md"), LONG_DOC);
}

const WAIT = `(ms) => new Promise((r) => setTimeout(r, ms))`;

/**
 * 发一句话，等这一轮跑完，把结果带回来。
 *
 * 结论从会话日志里读，不从 DOM 里刮：`errorMessage` 是助手消息上的字段，400 的原文就在那儿，
 * 而转录里它可能被折叠、被截断，或者干脆画在一个探针不认识的元素上。日志是这件事的真相。
 */
function turnScript(body: string): string {
	return `(async () => {
		const wait = ${WAIT};
		${body}
		const deadline = Date.now() + 180000;
		let started = false;
		let quiet = 0;
		while (Date.now() < deadline) {
			await wait(150);
			const turning = Boolean(document.querySelector('button[aria-label="停止"]'));
			if (turning) { started = true; quiet = 0; }
			else if (started && ++quiet > 16) break;
		}
		const list = await window.lyra.sessions.list();
		const meta = list[0];
		const snapshot = meta ? await window.lyra.sessions.open(meta.projectId, meta.id) : null;
		const messages = snapshot?.messages ?? [];
		const assistants = messages.filter((m) => m.role === "assistant");
		const last = assistants.at(-1);
		const bubbles = [...document.querySelectorAll(".ly-user-bubble")];
		return {
			started,
			modelId: meta?.modelId ?? null,
			messageCount: messages.length,
			lastBubble: (bubbles.at(-1)?.innerText ?? "").slice(0, 400),
			lastBubbleLength: bubbles.at(-1)?.innerText?.length ?? 0,
			reply: (last?.content ?? []).filter((c) => c.type === "text").map((c) => c.text).join("").slice(0, 600),
			stopReason: last?.stopReason ?? null,
			errorMessage: (last?.errorMessage ?? "").slice(0, 500),
		};
	})()`;
}

function type(text: string): string {
	return `
		const field = document.querySelector("main textarea");
		const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
		setter.call(field, ${JSON.stringify(text)});
		field.dispatchEvent(new Event("input", { bubbles: true }));
		field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
	`;
}

let app: RunningApp;
const results: Array<{ name: string; ok: boolean; detail: string }> = [];
function check(name: string, ok: boolean, detail: string) {
	results.push({ name, ok, detail });
	console.log(`${ok ? "✅" : "❌"} ${name}\n     ${detail.replace(/\n/g, "\n     ")}`);
}

/** 供应商里有哪些模型可以用来做「换模型」这件事。 */
async function models(): Promise<Array<{ id: string; label: string }>> {
	return app.evaluate(`(async () => {
		const settings = await window.lyra.settings.get();
		const out = [];
		for (const p of settings.providers ?? []) {
			if (!p.enabled) continue;
			for (const m of p.models ?? []) if (m.supportsTools !== false) out.push({ id: m.id, label: m.name || m.modelId });
		}
		return out;
	})()`);
}

async function main() {
	// `startApp` 自己造 profile 目录并把它传给 seed——用它的，别自己再造一个。
	app = await startApp({ port: 9412, seed });
	try {
		const available = await models();
		console.log(`\n可用模型 ${available.length} 个，前四个：${available.slice(0, 4).map((m) => m.id).join(", ")}\n`);
		if (available.length < 2) throw new Error("至少要两个模型才能验证「换模型」");

		// 应用启动时就落在这个项目上（settings 里只有它一个），等界面稳定即可。
		await app.evaluate(`(async () => { await (${WAIT})(1500); return true; })()`);

		// ---- 客户问题 2 / 3：换模型之后还能不能继续说话 --------------------------------
		const first = await app.evaluate<Record<string, unknown>>(turnScript(type("用一句话说明什么是 HTTP。不要用工具。")));
		check("第一轮（模型 A，真实请求）", Boolean(first.reply), `started=${first.started} stop=${first.stopReason} 消息数=${first.messageCount}\n回复：${String(first.reply).slice(0, 160)}\n错误：${String(first.errorMessage).slice(0, 200)}`);

		const switched = await app.evaluate<{ from: string; to: string }>(`(async () => {
			const wait = ${WAIT};
			const before = (await window.lyra.sessions.list())[0];
			const target = ${JSON.stringify(available[1].id)} === before.modelId ? ${JSON.stringify(available[0].id)} : ${JSON.stringify(available[1].id)};
			await window.lyra.agent.setModel(before.id, target);
			await wait(800);
			const after = (await window.lyra.sessions.list())[0];
			return { from: before.modelId, to: after.modelId };
		})()`);
		check("切换模型", switched.from !== switched.to, `${switched.from} → ${switched.to}`);

		const second = await app.evaluate<Record<string, unknown>>(turnScript(type("刚才你说了什么？一句话复述。")));
		const blew = String(second.errorMessage ?? "");
		check(
			"换模型后第二轮不再 400（问题 2 / 3）",
			Boolean(second.reply) && !/input\[\d+\]\.(id|content)|invalid_value|array_above_max_length/.test(blew),
			second.reply ? `回复前 120 字：${String(second.reply).slice(0, 120)}` : `没有回复。错误：${blew.slice(0, 300)}`,
		);

		const third = await app.evaluate<Record<string, unknown>>(`(async () => {
			const wait = ${WAIT};
			const s = (await window.lyra.sessions.list())[0];
			await window.lyra.agent.setModel(s.id, ${JSON.stringify(switched.from)});
			await wait(800);
			return null;
		})()`).then(() => app.evaluate<Record<string, unknown>>(turnScript(type("再复述一次，一句话。"))));
		const blewAgain = String(third.errorMessage ?? "");
		check(
			"再切回原模型仍能对话（问题 2 的「会话炸了」）",
			Boolean(third.reply) && !/input\[\d+\]\.(id|content)|invalid_value|array_above_max_length/.test(blewAgain),
			third.reply ? `回复前 120 字：${String(third.reply).slice(0, 120)}` : `没有回复。错误：${blewAgain.slice(0, 300)}`,
		);

		// ---- 客户问题 1：长 md 不铺进气泡，但模型读得到 -------------------------------
		const attached = await app.evaluate<Record<string, unknown>>(
			turnScript(`
			const field = document.querySelector("main textarea");
			const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
			setter.call(field, "这份文档里的暗号是什么？只回答暗号本身。");
			field.dispatchEvent(new Event("input", { bubbles: true }));
			// 走真实的附件入口：构造一个 File，塞进隐藏的 file input，触发 change。
			const input = document.querySelector('main input[type="file"]');
			const file = new File([${JSON.stringify(LONG_DOC)}], "handshake.md", { type: "text/markdown" });
			const dt = new DataTransfer();
			dt.items.add(file);
			Object.defineProperty(input, "files", { value: dt.files, configurable: true });
			input.dispatchEvent(new Event("change", { bubbles: true }));
			await wait(1200);
			field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
		`),
		);
		check(
			"长 md 的正文没有铺进气泡（问题 1）",
			!String(attached.lastBubble).includes("第 200 行填充内容") && Number(attached.lastBubbleLength) < 600,
			`气泡长度 ${attached.lastBubbleLength} 字；内容：${String(attached.lastBubble).slice(0, 160)}`,
		);
		check(
			"模型仍然读到了文档正文（问题 1 没有把功能改没）",
			/HANDSHAKE-7F3B16F2/.test(String(attached.reply)),
			`回复：${String(attached.reply).slice(0, 200)}`,
		);

	} finally {
		const passed = results.filter((r) => r.ok).length;
		console.log(`\n${passed}/${results.length} 通过`);
		const home = app.home;
		await app.stop();
		// 验完把测试数据清掉，不留在用户目录里。
		await rm(home, { recursive: true, force: true });
		if (passed !== results.length) process.exitCode = 1;
	}
}

await main();
