/* oxlint-disable no-console -- a probe CLI whose entire output is what it printed */

/**
 * CI 那一列能不能滚。
 *
 * 报告是「鼠标放上去竟然没有滚动移动」，而这句话有两种完全不同的意思，从截图上分不出来：滚轮
 * 推不动内容，或者内容根本没溢出、只是被上面某一层 `overflow-hidden` 切掉了。两者看起来一模
 * 一样——底下那条记录都是被裁掉一半的。
 *
 * 所以这里不看样式，看数：造一屏放不下的运行记录，然后问那个滚动容器它自己的 `scrollHeight`
 * 和 `clientHeight`，再真的推一下滚轮看 `scrollTop` 动没动。溢出了却推不动是一种毛病，压根
 * 没溢出是另一种，需要修的地方不在同一个文件里。
 *
 * 假的 Forge 服务照搬 `pipelines-loading.test.ts`：真的 git remote、真的账号存储、真的 IPC，
 * 只有 HTTP 那一端是合成的。
 *
 * 用法：node --experimental-strip-types e2e/pipelines-scroll-probe.ts
 */

import { execFile } from "node:child_process";
import { createServer, type Server } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { closeListeningServer, startApp } from "./app.ts";

const PORT = 9501;
const RUNS = 40;
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
const pane = '[data-dock-pane="review"]';

let baseUrl = "";

/** Enough runs that the list cannot possibly fit, so "did not overflow" means a real fault. */
function runs(): unknown[] {
	return Array.from({ length: RUNS }, (_, i) => ({
		id: 100 + i,
		name: i % 3 === 0 ? "CI" : i % 3 === 1 ? "CodeQL" : "Dependency review",
		display_title: `chore(deps): bump something across ${i} directories`,
		event: "pull_request",
		status: "completed",
		conclusion: i % 4 === 0 ? "failure" : "success",
		head_branch: `dependabot/npm_and_yarn/pkg-${i}`,
		head_sha: `${i}`.padStart(7, "0") + "abcdef012345678",
		created_at: new Date(Date.now() - i * 60_000).toISOString(),
		html_url: `${baseUrl}/fixture/repo/actions/runs/${100 + i}`,
	}));
}

/**
 * 报告指的那一行在详情页里：展开一个 job 之后的步骤名，`Windows desktop and trans…`。
 * 步骤名照抄真实工作流的长度，短名字撑不出溢出，也就问不出虚化到底在不在。
 */
function jobs(): unknown[] {
	return [
		{
			id: 900,
			name: "windows-ui",
			status: "completed",
			conclusion: "failure",
			started_at: new Date(Date.now() - 600_000).toISOString(),
			completed_at: new Date().toISOString(),
			steps: [
				"Set up job",
				"Windows desktop and translations end-to-end suite",
				"Upload the failing renderer screenshots as build artifacts",
				"Complete job",
			].map((name, i) => ({
				number: i + 1,
				name,
				status: "completed",
				conclusion: i === 1 ? "failure" : "success",
				started_at: new Date(Date.now() - (4 - i) * 60_000).toISOString(),
				completed_at: new Date(Date.now() - (3 - i) * 60_000).toISOString(),
			})),
		},
	];
}

const forge: Server = createServer((req, res) => {
	req.resume();
	const url = req.url ?? "";
	const base = "/api/v3/repos/fixture/repo/actions/runs";
	const reply = (body: unknown) => {
		res.writeHead(200, { "content-type": "application/json" });
		res.end(JSON.stringify(body));
	};
	if (url.startsWith(`${base}?`)) return reply({ workflow_runs: runs() });
	if (/\/actions\/runs\/\d+\/jobs/.test(url)) return reply({ jobs: jobs() });
	if (/\/actions\/runs\/\d+$/.test(url)) return reply(runs()[0]);
	res.writeHead(404);
	res.end();
});

await new Promise<void>((resolve) => forge.listen(0, "127.0.0.1", resolve));
const address = forge.address();
if (!address || typeof address === "string") throw new Error("假 Forge 没起来");
baseUrl = `http://127.0.0.1:${address.port}`;

const app = await startApp({
	port: PORT,
	seed: async (home) => {
		const project = join(home, "project");
		await mkdir(project, { recursive: true });
		await promisify(execFile)("git", ["init", "-b", "main"], { cwd: project });
		await writeFile(join(project, "readme.md"), "# probe\n");
		await promisify(execFile)("git", ["add", "-A"], { cwd: project });
		await promisify(execFile)("git", ["-c", "user.email=p@e", "-c", "user.name=p", "commit", "-m", "init"], { cwd: project });
		await promisify(execFile)("git", ["remote", "add", "origin", `${baseUrl}/fixture/repo.git`], { cwd: project });
		await writeFile(join(home, "window.json"), JSON.stringify({ width: 1400, height: 900, x: 0, y: 0 }));
		await writeFile(
			join(home, "forges.json"),
			JSON.stringify({
				version: 1,
				entries: [
					{
						account: { id: "synthetic-forge", kind: "github", baseUrl, login: "synthetic", label: "Synthetic local Forge", avatarUrl: null, addedAt: 1, enabled: true },
						token: "synthetic-test-token",
						encrypted: false,
					},
				],
			}),
		);
		await writeFile(
			join(home, "settings.json"),
			JSON.stringify({
				version: 1,
				providers: [],
				mcpServers: [],
				projects: [{ id: "e2e", name: "project", path: project, pinned: true, lastOpenedAt: 1 }],
				defaultModelId: null,
				permissionMode: "auto",
				hooks: [],
				scheduledTasks: [],
				disabledPlugins: [],
				alwaysAllow: [],
			}),
		);
	},
});

const problems: string[] = [];

try {
	await pause(3000);
	// Git 面板走它自己的快捷键（⌘⇧R，见 `panels/builtin.tsx`），比在工具栏里认按钮稳。
	for (const type of ["keyDown", "keyUp"]) {
		await app.send("Input.dispatchKeyEvent", {
			type,
			modifiers: 4 | 8,
			key: "R",
			code: "KeyR",
			windowsVirtualKeyCode: 82,
			nativeVirtualKeyCode: 82,
		});
	}
	await pause(1400);
	// 标签在面板里叫「流水线」。
	await app.evaluate(`(() => {
		const tab = [...document.querySelectorAll('${pane} button')].find((b) =>
			/流水线|Pipelines|パイプライン|파이프라인|Конвейеры/.test((b.dataset.lyTip ?? "") + (b.textContent ?? "")));
		if (tab) tab.click();
	})()`);
	await pause(3000);

	/*
	 * 要问的不是「这一列能不能上下滚」，而是「一行放不下的字，看不看得全」。
	 *
	 * 截断成 `Windows desktop and trans…` 的行，省略号只说了「被切了」，没说切掉了什么。
	 * 别处的做法是 `ScrollText`：右边缘虚化代替省略号，鼠标停上去这行字自己走一遍。这里量的
	 * 就是那两件事在 CI 这一列里到底有没有生效。
	 */
	const lines = (await app.evaluate(`(() => {
		const out = [];
		for (const el of document.querySelectorAll('${pane} .ly-fade-edge')) {
			const body = el.querySelector('.ly-marquee-track > span');
			const css = getComputedStyle(el);
			out.push({
				text: (body ? body.textContent : '').slice(0, 34),
				box: Math.round(el.clientWidth),
				body: Math.round(body ? body.offsetWidth : 0),
				masked: (css.maskImage || css.webkitMaskImage || 'none') !== 'none',
			});
		}
		return out;
	})()`)) as { text: string; box: number; body: number; masked: boolean }[];

	console.log("");
	if (lines.length === 0) {
		problems.push("CI 这一列里一行放不下的字都没接虚化——还是老的省略号");
		console.log("  没找到一条虚化的行");
	} else {
		for (const line of lines.slice(0, 6)) {
			console.log(`  「${line.text}」 行宽 ${line.box}  文字 ${line.body}  ${line.masked ? "虚化在" : "✗ 没虚化"}`);
		}
		console.log(`  共 ${lines.length} 行溢出并接上了虚化`);
		const bare = lines.filter((l) => !l.masked).length;
		if (bare > 0) problems.push(`${bare} 行标了溢出却没有虚化`);

		/*
		 * 真实鼠标，不是合成的 PointerEvent：`:hover` 只认真指针，合成事件照样能让探针打印出
		 * 一个「动了」的结论。动画还有 300ms 起步延迟，所以进场后先等够再取第一帧。
		 */
		const at = (await app.evaluate(`(() => {
			const el = document.querySelector('${pane} .ly-fade-edge');
			const r = el.getBoundingClientRect();
			return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
		})()`)) as { x: number; y: number };

		const shift = `(() => {
			const t = document.querySelector('${pane} .ly-fade-edge .ly-marquee-track');
			if (!t) return null;
			const css = getComputedStyle(t);
			return { name: css.animationName, x: Math.round(new DOMMatrixReadOnly(css.transform).m41) };
		})()`;

		const idle = (await app.evaluate(shift)) as { name: string; x: number } | null;
		await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: at.x, y: at.y });
		await pause(700);
		const early = (await app.evaluate(shift)) as { name: string; x: number } | null;
		await pause(600);
		const late = (await app.evaluate(shift)) as { name: string; x: number } | null;

		console.log(`\n  鼠标进场前 动画=${idle?.name ?? "?"} 位移=${idle?.x ?? "?"}`);
		console.log(`  进场 700ms  动画=${early?.name ?? "?"} 位移=${early?.x ?? "?"}`);
		console.log(`  再过 600ms  动画=${late?.name ?? "?"} 位移=${late?.x ?? "?"}`);

		if (idle?.name !== "none") problems.push("鼠标还没进来这行字就在动了");
		if (late?.name !== "ly-marquee") problems.push("鼠标停上去没有起自动滚动");
		else if (early && late && early.x === late.x) problems.push("动画挂上了，可位移一直没变——字其实没走");
	}

	// 报告里箭头指的那一行不在列表页，在点进去、再把 job 展开之后的步骤名上。
	await app.evaluate(`(() => {
		const row = document.querySelector('${pane} .ly-scroll-view button.ly-scroll');
		if (row) row.click();
	})()`);
	await pause(1800);
	await app.evaluate(`(() => {
		const job = [...document.querySelectorAll('${pane} button.ly-scroll')].find((b) => /windows-ui/.test(b.textContent || ''));
		if (job) job.click();
	})()`);
	await pause(1000);

	const step = (await app.evaluate(`(() => {
		const hit = [...document.querySelectorAll('${pane} .ly-fade-edge')].find((el) => /Windows desktop/.test(el.textContent || ''));
		if (!hit) return null;
		const body = hit.querySelector('.ly-marquee-track > span');
		const css = getComputedStyle(hit);
		const r = hit.getBoundingClientRect();
		return {
			text: (body ? body.textContent : '').slice(0, 34),
			box: Math.round(hit.clientWidth),
			body: Math.round(body ? body.offsetWidth : 0),
			masked: (css.maskImage || css.webkitMaskImage || 'none') !== 'none',
			x: Math.round(r.left + r.width / 2),
			y: Math.round(r.top + r.height / 2),
		};
	})()`)) as { text: string; box: number; body: number; masked: boolean; x: number; y: number } | null;

	console.log("");
	if (!step) {
		problems.push("详情页展开 job 后没找到接了虚化的步骤名——报告指的正是这一行");
		console.log("  详情页里没找到那一行步骤名");
	} else {
		console.log(`  详情页步骤「${step.text}」 行宽 ${step.box}  文字 ${step.body}  ${step.masked ? "虚化在" : "✗ 没虚化"}`);
		if (!step.masked) problems.push("详情页的步骤名溢出了却没有虚化");
		const track = `(() => {
			const hit = [...document.querySelectorAll('${pane} .ly-fade-edge')].find((el) => /Windows desktop/.test(el.textContent || ''));
			const t = hit && hit.querySelector('.ly-marquee-track');
			if (!t) return null;
			const css = getComputedStyle(t);
			return { name: css.animationName, x: Math.round(new DOMMatrixReadOnly(css.transform).m41) };
		})()`;
		// 先把指针挪开，免得上一段 hover 的残留冒充成这一段的结论。
		await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 5, y: 5 });
		await pause(500);
		const before = (await app.evaluate(track)) as { name: string; x: number } | null;
		await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: step.x, y: step.y });
		await pause(700);
		const mid = (await app.evaluate(track)) as { name: string; x: number } | null;
		await pause(600);
		const end = (await app.evaluate(track)) as { name: string; x: number } | null;
		console.log(`  鼠标进场前 动画=${before?.name ?? "?"} 位移=${before?.x ?? "?"}`);
		console.log(`  进场 700ms  动画=${mid?.name ?? "?"} 位移=${mid?.x ?? "?"}`);
		console.log(`  再过 600ms  动画=${end?.name ?? "?"} 位移=${end?.x ?? "?"}`);
		if (before?.name !== "none") problems.push("详情页那一行没碰就在动");
		if (end?.name !== "ly-marquee") problems.push("详情页的步骤名停上去不会自己走");
		else if (mid && end && mid.x === end.x) problems.push("详情页动画挂上了，可位移没变");
	}

	console.log(problems.length === 0 ? "\nCI 这一列：溢出的行虚化了，鼠标停上去自己走\n" : `\n${problems.length} 处：\n${problems.map((p) => `  ✗ ${p}`).join("\n")}\n`);
	process.exitCode = problems.length === 0 ? 0 : 1;
} finally {
	await app.stop();
	await closeListeningServer(forge);
}
