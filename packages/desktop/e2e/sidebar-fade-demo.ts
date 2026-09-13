/* oxlint-disable no-console -- probe CLI plumbing that prints what it did */
/**
 * 把侧边栏上下滚一遍录下来，看两头化不化得开。
 *
 * `node --experimental-strip-types e2e/sidebar-fade-demo.ts [dir]`
 *
 * 数字在 `e2e/sidebar-fade-probe.ts` 里，那支探针一格一格停下来量停稳之后的形状。这一支问的是
 * 另一半：滚起来的时候，每一帧都对吗。逐格都对、滚起来仍然可能在某一帧上闪一下——那种闪只在
 * 连着看的时候才现形。
 *
 * 所以片子和数一起出。每一帧拍一张，同时把这一帧的遮罩厚度记下来（`trace-*.json`）：片子负责
 * 「看着对」，曲线负责「每一帧都对」。眼睛能看出明显的断层，看不出三五个像素的一跳，而抖动恰恰
 * 是那种量级。
 *
 * 抓的是窗口不是屏幕，录屏会把用户自己的窗口一起录进去。用 `Page.captureScreenshot` 逐帧抓而不是
 * screencast：后者给的是合成帧，窗口被别的窗口盖住就一帧都不来——测试跑起来终端正好在窗口前面，
 * 所以那是常态不是偶然。截图每次强制渲染，挡不挡得住都拍得到。
 *
 * 滚动按**真实流逝的时间**推 `scrollTop`，不按帧号：拍照本身要几十毫秒，按帧数推会让动画随机器
 * 快慢变速。这么推出来的时间轴是真的，CSS 那 220ms 的过渡也就跟着真的走完。
 *
 * 带 `before` 参数跑一趟、还原代码再跑一趟，两段片子可以并排合成对照。
 */

import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { startApp } from "./app.ts";
import { MASK_PROBE } from "./mask.ts";
import { encode, frameGrabber, pause, type Frame } from "./record.ts";

const dir = process.argv[2] ?? "/tmp/lyra-fade-demo";
const tag = process.argv[3] ?? "after";
const REPO = "/Users/kittors/Developer/opensource/Lyra";
const PORT = 9518;

const usage = { input: 0, output: 0, total: 0, cacheRead: 0, cacheWrite: 0, cost: { input: 0, output: 0, total: 0, cacheRead: 0, cacheWrite: 0 } };

/**
 * 浅色、三个项目、每个十几条会话。
 *
 * 浅色是因为用户报这件事的三张截图都是浅色——对照要对得上。会话标题写得长短不一，滚动时顶上化开
 * 的是一行行真的字，不是一条均匀的灰。
 */
async function seed(home: string): Promise<void> {
	await writeFile(join(home, "window.json"), JSON.stringify({ width: 1180, height: 820, x: 60, y: 60 }));

	const projects = [
		{ path: REPO, name: "Lyra" },
		{ path: join(home, "proj-two"), name: "生产管控平台" },
		{ path: join(home, "proj-three"), name: "源码-plfx" },
	].map((p) => ({ ...p, id: createHash("sha256").update(p.path).digest("hex").slice(0, 16) }));

	await writeFile(
		join(home, "settings.json"),
		JSON.stringify({
			version: 1,
			providers: [],
			mcpServers: [],
			projects: projects.map((p, i) => ({ id: p.id, name: p.name, path: p.path, pinned: i === 0, lastOpenedAt: 3 - i })),
			defaultModelId: null,
			permissionMode: "auto",
			thinking: "medium",
			retryAttempts: 3,
			hooks: [],
			scheduledTasks: [],
			disabledPlugins: [],
			alwaysAllow: [],
			sync: { enabled: false, port: 4541, token: null },
			appearance: { theme: "light" },
		}),
	);

	const titles = [
		"你觉得我们这个项目写得如何呢？",
		"子代理检查项目并总结",
		"安排子智能体检查项目质量",
		"仔细看下我这个截图，这是啥问题",
		"客户说有这个问题：说超级慢",
		"这个里面写了啥？",
		"项目帮我启动下吧",
		"详细介绍下这个项目吧",
		"我们这个项目是干啥的？",
		"这个截图的需求你理解了吗？",
		"有多少人给我们提交 PR 了？",
		"帮我把这一版的发布文案写了",
	];

	const metas: object[] = [];
	let n = 0;
	for (const project of projects) {
		await mkdir(project.path, { recursive: true });
		await mkdir(join(home, "sessions", project.id), { recursive: true });
		for (let i = 0; i < titles.length; i++) {
			n++;
			const id = `s${String(n).padStart(3, "0")}`;
			const messages = [
				{ role: "user", content: [{ type: "text", text: titles[i] }], timestamp: 1 },
				{ role: "assistant", content: [{ type: "text", text: "好的。" }], api: "anthropic-messages", provider: "test", model: "test", usage, stopReason: "stop", timestamp: 2 },
			];
			const meta = {
				id, title: titles[i], cwd: project.path,
				projectId: project.id, projectName: project.name,
				createdAt: 1_700_000_000_000 + n * 1000, updatedAt: 1_700_000_000_000 + n * 1000,
				modelId: "test", messageCount: messages.length, usage, seq: messages.length + 1,
			};
			metas.push(meta);
			await writeFile(
				join(home, "sessions", project.id, `${id}.jsonl`),
				[
					JSON.stringify({ seq: 0, ts: 1, type: "meta", meta }),
					...messages.map((message, at) => JSON.stringify({ seq: at + 1, ts: at + 1, type: "message", message })),
					JSON.stringify({ seq: meta.seq, ts: 2, type: "meta", meta }),
				].join("\n") + "\n",
			);
		}
	}
	await writeFile(join(home, "sessions", "index.json"), JSON.stringify(metas));
}

const app = await startApp({ port: PORT, seed });

/**
 * 一段剧本，按**时间**说清每一刻列表该在哪。
 *
 * 写成「从 t 秒到 t 秒，从这滚到那」而不是一串命令，是因为录制的节奏由拍照的快慢定，而拍照多快
 * 取决于当时这台机器。位置按真实流逝的时间算出来，快慢就跟帧率脱钩了：机器忙的时候帧少一点，
 * 动作还是那个动作，播出来还是那个速度。
 */
type Beat =
	| { kind: "hold"; ms: number }
	| { kind: "glide"; ms: number; to: "bottom" | "top" }
	| { kind: "tab"; to: "chats" | "projects"; ms: number };

const script: Beat[] = [
	// 顶上先停一下：列表在顶端，这时**不该**有上沿的虚化，它是后面那条的对照。
	{ kind: "hold", ms: 1100 },
	{ kind: "glide", ms: 3600, to: "bottom" },
	{ kind: "hold", ms: 900 },
	{ kind: "glide", ms: 3600, to: "top" },
	{ kind: "hold", ms: 900 },
	// 再来一趟快的：慢推看得清形状，快推才看得出抖不抖。
	{ kind: "glide", ms: 1200, to: "bottom" },
	{ kind: "hold", ms: 500 },
	{ kind: "glide", ms: 1200, to: "top" },
	{ kind: "hold", ms: 700 },
	/*
	 * 换到「聊天」再走一趟。
	 *
	 * 这一侧只有标签栏会吸顶，没有分组标题——保护区永远只有一片，而「只有一片」正是这次修的那个
	 * 分支。项目那一侧至少还有几帧碰巧是两片，这一侧一帧都没有。
	 */
	{ kind: "tab", to: "chats", ms: 1100 },
	{ kind: "glide", ms: 3000, to: "bottom" },
	{ kind: "hold", ms: 800 },
	{ kind: "glide", ms: 3000, to: "top" },
	{ kind: "hold", ms: 900 },
];

try {
	await mkdir(dir, { recursive: true });
	await pause(3000);

	// 侧边栏在窗口里占多宽，裁剪版按这个比例切。读出来而不是写死：布局改了片子不能跟着歪。
	const slice = await app.evaluate<{ ratio: number; rows: number; scrollable: number }>(
		'(() => {' +
			'const pane = document.querySelector(".ly-sidebar-fill");' +
			'const view = pane.querySelector(".ly-scroll-view");' +
			'return {' +
				'ratio: pane.getBoundingClientRect().width / window.innerWidth,' +
				'rows: view.querySelectorAll("[data-ly-row]").length,' +
				'scrollable: view.scrollHeight - view.clientHeight,' +
			'};' +
		'})()',
	);
	process.stdout.write(`侧边栏占窗口宽度 ${(slice.ratio * 100).toFixed(1)}%，${slice.rows} 行，可滚 ${slice.scrollable}px\n`);
	if (slice.scrollable < 120) throw new Error(`列表滚不动（只能滚 ${slice.scrollable}px），录下来看不出东西`);

	const grab = await frameGrabber(PORT);
	const frames: Frame[] = [];

	/*
	 * 每一帧除了拍下来，还把这一帧的虚化厚度记下来。
	 *
	 * 「录完反复看」用眼睛做，能看出明显的断层，看不出三五个像素的一跳——而抖动恰恰是那种量级。
	 * 所以同一趟里再记一条曲线：拍照那一刻遮罩上下两头各有多厚。片子负责「看着对」，曲线负责
	 * 「每一帧都对」，两样一起才敢说没抖。
	 *
	 * 装成页面上的一个函数，而不是每帧现拼一段脚本：那段量尺一百多行，按帧传过去光解析就够呛。
	 */
	await grab.evaluate(
		'(() => {' +
			MASK_PROBE +
			'window.__lyFade = () => {' +
				'const view = document.querySelector(".ly-sidebar-fill .ly-scroll-view");' +
				'const cs = getComputedStyle(view);' +
				'const num = (name) => parseFloat(cs.getPropertyValue(name)) || 0;' +
				'return [Math.round(view.scrollTop), softSpan(view), bottomSpan(view),' +
					'num("--ly-fade-top"), num("--ly-fade-bottom"), num("--ly-fade-inset"),' +
					'num("--ly-hold-top"), num("--ly-hold-gap"), num("--ly-hold-next"), num("--ly-hold-next-fade"),' +
					'view.clientHeight];' +
			'};' +
		'})()',
	);
	/** 每帧一条：滚到哪、两头多厚，外加遮罩此刻的每一个长度——某一帧不对时，得能当场问出是哪个数。 */
	type Sample = [number, number, number, number, number, number, number, number, number, number, number];
	const trace: Sample[] = [];

	/*
	 * 一拍一拍地走：把此刻该在的位置摆好，拍一张，再看表。
	 *
	 * 位置按这一拍真正流逝了多久去算，而不是「第几帧」——拍照本身要几十毫秒，按帧数推会让动画随
	 * 机器快慢变速。CSS 那 220ms 的过渡也一样按真机时间跑，所以录下来的就是真的。
	 */
	const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
	let from = 0;
	for (const beat of script) {
		if (beat.kind === "tab") {
			await grab.evaluate(`(() => { document.querySelector('.ly-sidebar-fill [data-ly-tab="${beat.to}"]')?.click(); })()`);
			from = 0;
		}
		const span = await grab.evaluate<number>(
			'(() => { const v = document.querySelector(".ly-sidebar-fill .ly-scroll-view"); return v.scrollHeight - v.clientHeight; })()',
		);
		const target = beat.kind === "glide" ? (beat.to === "bottom" ? span : 0) : from;
		const start = Date.now();
		for (;;) {
			const elapsed = Date.now() - start;
			const at = Math.min(1, elapsed / beat.ms);
			if (beat.kind === "glide") {
				await grab.evaluate(
					`(() => { document.querySelector(".ly-sidebar-fill .ly-scroll-view").scrollTop = ${(from + (target - from) * ease(at)).toFixed(2)}; })()`,
				);
			}
			trace.push(await grab.evaluate<Sample>("window.__lyFade()"));
			frames.push({ at: Date.now(), data: await grab.shot() });
			if (at >= 1) break;
		}
		from = target;
	}
	grab.close();
	const seconds = (frames.at(-1)!.at - frames[0].at) / 1000;
	process.stdout.write(`录到 ${frames.length} 帧，${seconds.toFixed(1)} 秒，约 ${(frames.length / seconds).toFixed(0)} fps\n`);

	/*
	 * 逐帧过一遍这条曲线。
	 *
	 * 两个问法。一是**该有的时候有没有**：列表离开顶端、过渡也走完了，那一帧顶上就得有虚化。二是
	 * **有没有哪一帧跳**：相邻两帧之间厚度差多少。前一帧到后一帧只隔五十毫秒，这中间虚化的深浅
	 * 是跟着吸顶的行连续变的，跳一下就是画面上闪一下。
	 *
	 * 渐入的那几帧要放过，而且得按**过渡有没有停**来放，不能按滚动位置：列表刚离顶那一下，
	 * `--ly-fade-top` 正从 0 往上爬，这一段本来就该一帧比一帧厚。两帧的 `--ly-fade-top` 相等，
	 * 才说明过渡停了、这一帧的形状就是稳态该有的形状。
	 */
	await writeFile(join(dir, `trace-${tag}.json`), JSON.stringify(trace));
	let moving = 0;
	let thin = 0;
	let jumped = 0;
	let worst = 0;
	const steady = (i: number) => trace[i][0] > 4 && trace[i - 1][0] > 4 && trace[i][3] === trace[i - 1][3];
	for (let i = 1; i < trace.length; i++) {
		if (!steady(i)) continue;
		moving++;
		if (trace[i][1] < 24) thin++;
		const step = Math.abs(trace[i][1] - trace[i - 1][1]);
		worst = Math.max(worst, step);
		if (step > 6) jumped++;
	}
	process.stdout.write(
		`滚动中的 ${moving} 帧：顶部虚化不足的 ${thin} 帧，帧间跳变超过 6px 的 ${jumped} 帧，最大跳变 ${worst.toFixed(1)}px\n`,
	);
	const spans = trace.filter(([top]) => top > 4).map(([, soft]) => soft);
	process.stdout.write(`滚动中顶部厚度 ${Math.min(...spans).toFixed(1)}–${Math.max(...spans).toFixed(1)}px\n`);
	if (thin > 0 || jumped > 0) {
		const bad = trace
			.map((row, i) => ({ row, i }))
			.filter(({ row, i }) => i > 0 && steady(i) && (row[1] < 24 || Math.abs(row[1] - trace[i - 1][1]) > 6))
			.slice(0, 10);
		process.stdout.write(
			`  可疑帧：${bad.map(({ row, i }) => `#${i} 滚到 ${row[0]} 厚 ${row[1]}（上一帧 ${trace[i - 1][1]}，fade-top ${row[3]}，inset ${row[5]}，gap ${row[7]}）`).join("；")}\n`,
		);
	}

	const full = join(dir, `sidebar-fade-${tag}.mp4`);
	await encode(frames, full, 60);
	process.stdout.write(`整窗：${full}\n`);

	/*
	 * 再出一版只有侧边栏的。
	 *
	 * 「反复检查细节」在整窗那一版上做不到——侧边栏只占四分之一宽，虚化是三十几个像素的一条带子，
	 * 缩在里面根本数不清。裁出来再放大，一行字化开的过程才看得见。
	 */
	const cropped = join(dir, `sidebar-fade-${tag}-crop.mp4`);
	await new Promise<void>((done, fail) => {
		const ff = spawn(
			"ffmpeg",
			[
				"-y", "-i", full,
				"-vf", `crop=iw*${slice.ratio.toFixed(4)}:ih:0:0,scale=-2:1440:flags=lanczos`,
				"-c:v", "libx264", "-preset", "slow", "-crf", "18", "-pix_fmt", "yuv420p",
				"-movflags", "+faststart",
				cropped,
			],
			{ stdio: ["ignore", "ignore", "pipe"] },
		);
		let err = "";
		ff.stderr.on("data", (c: Buffer) => { err = (err + c.toString()).slice(-3000); });
		ff.once("close", (code) => (code === 0 ? done() : fail(new Error(`裁剪失败：\n${err}`))));
	});
	process.stdout.write(`侧边栏：${cropped}\n`);
} finally {
	await app.stop();
}
