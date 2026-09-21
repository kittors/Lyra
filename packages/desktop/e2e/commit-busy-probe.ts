/* oxlint-disable no-console -- probe CLI that prints what the real window did */
/**
 * 提交在跑的时候，工具条上那颗按钮说不说话。
 *
 * 单测钉住的是状态：「这次提交」的现场活在弹窗外面，关掉再打开还是原来那一个。但按钮自己长什么
 * 样——转不转、灰不灰、按下去是取消还是回到弹窗——只有画出来才算数，那一层任何结构断言都看不见。
 *
 * 两段慢都是真的，没有打桩：模型那一步用一个故意慢七秒的假 provider（`generateCommitMessage` 走
 * 的就是默认模型），`git commit` 那一步靠仓库自己的 pre-commit hook 里一句 sleep。仓库是临时建
 * 的，跟本机任何一个真仓库无关——这个探针会真的提交下去，末尾还回头读 `git log` 对一次。
 *
 * 用法：node --experimental-strip-types e2e/commit-busy-probe.ts [输出目录]
 */

import { execFile } from "node:child_process";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { createServer, type Server, type ServerResponse } from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { closeListeningServer, startApp, type RunningApp } from "./app.ts";
import { driver, encode, pause, startRecording, type Frame } from "./record.ts";

const exec = promisify(execFile);
const OUT_DIR = process.argv[2] ?? join(homedir(), "Desktop", "Lyra提交按钮忙态测试");
const STAMP = new Date().toLocaleString("sv-SE", { timeZone: "Asia/Shanghai" }).replace(/[: ]/g, "-").slice(0, 16);
const PORT = 9748;
/** 模型慢这么久，中间够把弹窗关掉、再点开、各拍一张（全屏 PNG 一张要好几百毫秒）。 */
const MODEL_DELAY_MS = 9_000;
const GENERATED = "chore: 探针写的一句提交说明";

let app: RunningApp;
let project = "";
const checks: { ok: boolean; what: string; saw: string }[] = [];

function check(what: string, ok: boolean, saw: string): void {
	checks.push({ ok, what, saw });
	console.log(`   ${ok ? "✅" : "❌"} ${what}  ——  ${saw}`);
}

function git(cwd: string, ...args: string[]): Promise<{ stdout: string }> {
	return exec("git", args, { cwd });
}

/** 一个只会说一句话的模型，而且说得很慢——慢正是这里要的东西。 */
function slowModel(): Server {
	return createServer((req, res) => {
		req.on("data", () => {});
		req.on("end", () => {
			setTimeout(() => reply(res), MODEL_DELAY_MS);
		});
	});
}

function reply(res: ServerResponse): void {
	res.writeHead(200, { "content-type": "text/event-stream" });
	const emit = (type: string, data: object) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
	emit("message_start", { message: { id: "commit-msg", role: "assistant", content: [], usage: { input_tokens: 40, output_tokens: 0 } } });
	emit("content_block_start", { index: 0, content_block: { type: "text", text: "" } });
	emit("content_block_delta", { index: 0, delta: { type: "text_delta", text: GENERATED } });
	emit("content_block_stop", { index: 0 });
	emit("message_delta", { delta: { stop_reason: "end_turn" }, usage: { output_tokens: 12 } });
	emit("message_stop", {});
	res.end();
}

async function seed(home: string, modelPort: number): Promise<void> {
	project = join(home, "project");
	await mkdir(project, { recursive: true });
	await writeFile(join(project, "one.txt"), "one\n");
	await exec("git", ["init", "-q", "--initial-branch=main", project]);
	await git(project, "config", "user.email", "probe@example.com");
	await git(project, "config", "user.name", "Probe");
	await git(project, "add", ".");
	await git(project, "commit", "-qm", "first");

	// 一处已暂存的改动，提交按钮才有东西可提交。
	await writeFile(join(project, "one.txt"), "one\ntwo\n");
	await git(project, "add", ".");

	/*
	 * 让 `git commit` 自己慢下来。
	 *
	 * 本地提交平时是几十毫秒的事，转圈一闪而过，拍不到也量不着。一句 sleep 换来的是一段真实的
	 * 「提交中」——走的还是那条路，只是长得够看清楚。
	 */
	const hook = join(project, ".git", "hooks", "pre-commit");
	await writeFile(hook, "#!/bin/sh\nsleep 6\n");
	await chmod(hook, 0o755);

	await writeFile(join(home, "window.json"), JSON.stringify({ width: 1280, height: 880, x: 40, y: 40 }));
	await writeFile(
		join(home, "settings.json"),
		JSON.stringify({
			version: 1,
			providers: [
				{
					id: "probe",
					name: "慢速假模型",
					api: "anthropic-messages",
					baseUrl: `http://127.0.0.1:${modelPort}`,
					apiKey: "test",
					enabled: true,
					models: [
						{
							id: "probe/slow",
							providerId: "probe",
							modelId: "slow",
							name: "Slow",
							contextWindow: 128000,
							maxOutputTokens: 4096,
							supportsImages: false,
							supportsTools: true,
							supportsThinking: false,
						},
					],
				},
			],
			defaultModelId: "probe/slow",
			mcpServers: [],
			projects: [{ id: "probe", name: "project", path: project, pinned: true, lastOpenedAt: 1 }],
			commitLanguage: "zh",
			permissionMode: "full",
			thinking: "off",
			retryAttempts: 1,
			hooks: [],
			scheduledTasks: [],
			disabledPlugins: [],
			alwaysAllow: [],
			appearance: { theme: "light", reduceMotion: "off" },
			sync: { enabled: false, port: 4528, token: null },
		}),
	);
}

/** 工具条上那颗推送按钮此刻在说什么。注入的代码里不写反引号——它还要在模板串里活一遍。 */
const BUTTON = `(() => {
	const span = document.querySelector('span[data-ly-sync="push"]');
	const btn = document.querySelector('[data-ly-sync="push"] button, button[data-ly-sync="push"]');
	if (!btn) return null;
	return {
		busy: span ? span.getAttribute('data-ly-busy') : null,
		label: btn.getAttribute('aria-label') || '',
		disabled: btn.disabled,
		spinner: Boolean(btn.querySelector('svg.ly-arc')),
		dialog: Boolean(document.querySelector('[data-ly-commit-dialog]')),
	};
})()`;

/** 弹窗里此刻在说什么：框里那句话、占位符、以及三行里哪一行在转。 */
const DIALOG = `(() => {
	const field = document.querySelector('[data-ly-commit-message]');
	if (!field) return null;
	const rows = [...document.querySelectorAll('[data-ly-commit-dialog] button')].filter((b) => b.querySelector('svg'));
	const spinning = rows.filter((b) => b.querySelector('svg.ly-arc')).map((b) => (b.innerText || '').trim().split('\\n')[0]);
	return { value: field.value, placeholder: field.placeholder, disabled: field.disabled, spinning: spinning };
})()`;

type Button = { busy: string | null; label: string; disabled: boolean; spinner: boolean; dialog: boolean };
type Dialog = { value: string; placeholder: string; disabled: boolean; spinning: string[] };

async function main(): Promise<void> {
	const model = slowModel();
	await new Promise<void>((resolve) => model.listen(0, "127.0.0.1", resolve));
	const address = model.address();
	if (!address || typeof address === "string") throw new Error("假模型没起来");

	await mkdir(OUT_DIR, { recursive: true });
	app = await startApp({ port: PORT, seed: (home) => seed(home, address.port) });
	const ui = driver(app);
	const evaluate = <T,>(expression: string): Promise<T> => app.evaluate<T>(expression);
	const frames: Frame[] = [];
	const stop = await startRecording(PORT, frames);

	let shotIndex = 0;
	async function shot(name: string): Promise<void> {
		const file = join(OUT_DIR, `${STAMP}_${String(++shotIndex).padStart(2, "0")}_${name}.png`);
		const { data } = await app.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
		await writeFile(file, Buffer.from(data, "base64"));
		console.log(`   📷 ${file}`);
	}

	try {
		await evaluate("document.fonts.ready");

		// Git 面板：从面板菜单里进去，和 `git-sync.test.ts` 走同一条路。
		await evaluate(`(async () => {
			const wait = (ms) => new Promise((r) => setTimeout(r, ms));
			document.querySelector('button[aria-label="面板"]').click();
			await wait(250);
			const row = [...document.querySelectorAll('[role="menuitem"]')].find((item) => item.textContent.trim().startsWith("Git"));
			if (!row) throw new Error("面板菜单里没有 Git 那一行");
			row.click();
			await wait(900);
			return true;
		})()`);
		await ui.until(`document.querySelector('[data-ly-sync="push"]')`, 30000);
		await pause(1200);
		await shot("起点_按钮静止");

		console.log("\n【一】留空提交：模型开始写，按钮该转起来");
		await ui.click('[data-ly-sync="push"] button, button[data-ly-sync="push"]');
		await ui.until(`document.querySelector('[data-ly-commit-dialog]')`, 15000);
		await pause(800);
		/*
		 * 输入框留空，点「提交」——这一下先生成，再提交。
		 *
		 * 先给那一行挂个记号再用真鼠标点：按文字找是必须的（这三行没有别的抓手），而 `.click()`
		 * 在这个界面里有打不开东西的前科。记号限定在弹窗里边找，免得认到面板上别的「提交」。
		 */
		await evaluate(`(() => {
			const row = [...document.querySelectorAll('[data-ly-commit-dialog] button')].find((b) => {
				const text = (b.innerText || '').trim();
				return text.startsWith('提交') && !text.includes('推送');
			});
			if (!row) throw new Error('弹窗里没有「提交」那一行');
			row.setAttribute('data-probe-commit', '');
			return true;
		})()`);
		await ui.click("[data-probe-commit]");
		await pause(900);

		const generating = await evaluate<Button | null>(BUTTON);
		check(
			"生成中：按钮在转，而且没有被禁用",
			Boolean(generating?.spinner && generating?.busy === "working" && generating?.disabled === false),
			JSON.stringify(generating),
		);
		check(
			"生成中：按钮说的是正在生成，不是「取消推送」",
			generating?.label === "正在生成提交说明…",
			`aria-label = ${JSON.stringify(generating?.label)}`,
		);
		await shot("生成中_弹窗开着");

		console.log("\n【二】把弹窗关掉：事情还在跑，按钮还在转");
		await ui.key("Escape", 27);
		await pause(700);
		const closed = await evaluate<Button | null>(BUTTON);
		check(
			"弹窗关了，按钮照样在转",
			Boolean(closed && !closed.dialog && closed.spinner && closed.busy === "working"),
			JSON.stringify(closed),
		);
		check("关着的时候它仍然按得下去", closed?.disabled === false, `disabled = ${closed?.disabled}`);
		await shot("生成中_弹窗关掉后按钮还在转");

		console.log("\n【三】按一下那颗转着的按钮：弹窗回来，进度还在里面");
		await ui.click('[data-ly-sync="push"] button, button[data-ly-sync="push"]');
		await pause(700);
		const reopened = await evaluate<Dialog | null>(DIALOG);
		check(
			"点转着的按钮，弹窗重新打开了（不是把事情取消掉）",
			Boolean(reopened),
			reopened ? "弹窗在屏幕上" : "弹窗没回来",
		);
		check(
			"重开后看到的还是那一下：输入框写着正在生成",
			reopened?.placeholder === "正在生成提交说明…",
			`placeholder = ${JSON.stringify(reopened?.placeholder)}`,
		);
		check(
			"「提交」那一行也还在转",
			Boolean(reopened?.spinning.some((row) => row.startsWith("提交") && !row.includes("推送"))),
			`转着的行：${JSON.stringify(reopened?.spinning)}`,
		);
		await shot("生成中_按按钮把弹窗叫回来");

		console.log("\n【四】模型写完，轮到 git 提交——按钮改口说「正在提交…」");
		await ui.until(`document.querySelector('[data-ly-sync="push"] button, button[data-ly-sync="push"]')?.getAttribute('aria-label') === '正在提交…'`, 30000);
		const committing = await evaluate<Button | null>(BUTTON);
		const filled = await evaluate<Dialog | null>(DIALOG);
		check(
			"提交中：按钮还在转，说的是「正在提交…」",
			Boolean(committing?.spinner && committing?.label === "正在提交…" && committing?.busy === "working"),
			JSON.stringify(committing),
		);
		check(
			"生成出来的那句话写回了框里",
			filled?.value === GENERATED,
			`框里是 ${JSON.stringify(filled?.value)}`,
		);
		await shot("提交中_按钮改口");

		console.log("\n【五】提交落地：弹窗自己关上，按钮回到静止");
		await ui.until(`!document.querySelector('[data-ly-commit-dialog]')`, 40000);
		await pause(1200);
		const done = await evaluate<Button | null>(BUTTON);
		check(
			"完事之后按钮不再转，也不再自称在忙",
			Boolean(done && !done.spinner && done.busy === null),
			JSON.stringify(done),
		);
		await shot("终点_提交完成");

		const { stdout: subject } = await git(project, "log", "-1", "--pretty=%s");
		check(
			"磁盘上真的多了一条提交，说的就是那句话",
			subject.trim() === GENERATED,
			`git log -1 = ${JSON.stringify(subject.trim())}`,
		);
	} finally {
		await stop();
		await app?.stop();
		await closeListeningServer(model);
		const passed = checks.filter((entry) => entry.ok).length;
		if (frames.length > 0) {
			// 文件名带通过数，见 AGENTS.md：一段视频要能自己说清它当时验到了什么程度。
			const video = join(OUT_DIR, `${STAMP}_提交按钮忙态_${passed}of${checks.length}.mp4`);
			await encode(frames, video, 12, 1500).catch((error: unknown) => console.log(`   录像合成失败：${String(error)}`));
			console.log(`   🎬 ${video}`);
		}
		const failed = checks.filter((entry) => !entry.ok);
		console.log(`\n${failed.length === 0 ? "✅ 全过" : `❌ ${failed.length} 条没过`}：${checks.length} 条检查，输出在 ${OUT_DIR}`);
		process.exitCode = failed.length === 0 ? 0 : 1;
	}
}

await main();
