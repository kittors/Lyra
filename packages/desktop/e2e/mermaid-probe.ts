/* oxlint-disable no-console -- a picture-taker that says what it found and where it put the files */
/**
 * ```mermaid 到底画出来了没有。
 *
 * 用户截图里那块是原样印着的 `graph TD`——二十行给渲染器看的字，摆在读者面前。这件事只有真窗口
 * 能验：单测能断言组件返回了什么，断言不了 mermaid 的布局引擎在 Electron 里跑没跑起来、SVG 有
 * 没有真的落进 DOM、暗色下是不是白底黑字。
 *
 * 四种围栏一起喂：截图里那张真图、一张语法错的、一个普通 ts 围栏、一个大小写混着的 `Mermaid`。
 * 前两种分别验「画得出」和「画不出时安静退回代码块」——后者尤其重要，因为流式输出时围栏有一大半
 * 时间语法是不完整的。
 *
 * 不是测试——`node e2e/mermaid-probe.ts`——跑 `out/` 产物，改完先 `pnpm build`。
 */

import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { projectIdFor } from "@lyra/core";
import { startApp } from "./app.ts";
import { frameGrabber } from "./record.ts";

const PORT = 9645;
const SESSION_ID = "11111111-2222-3333-4444-555555555555";
const TITLE = "mermaid 渲染检查";
const OUT = join(homedir(), ".lyra/scratch/mermaid");

/** 截图里那张进程树，一字不改。 */
const REAL = `graph TD
    subgraph ProcessTree["已终止的进程树"]
        A["PID 13597<br/>pnpm --filter agent run dev"] --> B["PID 13679<br/>tsx watch src/server.ts"]
        B --> C["PID 62999<br/>node src/server.ts<br/><b>[监听 4100]</b>"]
        C --> D["PID 63003<br/>esbuild service"]
    end

    Kill["kill 13597 13679 62999 63003"] -.-> ProcessTree

    style Kill fill:#fee2e2,stroke:#ef4444,stroke-width:2px;
    style C fill:#fef3c7,stroke:#f59e0b,stroke-width:2px;`;

const BODY = [
	"这是真图：",
	"",
	"```mermaid",
	REAL,
	"```",
	"",
	"这是画不出来的（语法是坏的）：",
	"",
	"```mermaid",
	"graph TD\n  A -->",
	"```",
	"",
	"这是普通代码围栏，不该被碰：",
	"",
	"```ts",
	'const x: number = 1;\nconsole.log("hello");',
	"```",
	"",
	"大小写混着的也算 mermaid：",
	"",
	"```Mermaid",
	"graph LR\n  X --> Y",
	"```",
].join("\n");

const app = await startApp({
	port: PORT,
	seed: async (home) => {
		const root = join(home, "project");
		await mkdir(root, { recursive: true });
		await writeFile(join(home, "window.json"), JSON.stringify({ x: 0, y: 0, width: 1440, height: 900 }));

		const projectId = projectIdFor(root);
		await mkdir(join(home, "sessions", projectId), { recursive: true });
		const now = Date.now();
		/*
		 * `seq` 从 1 起，meta 自己那个内层的 seq 是 0。
		 *
		 * 外层写 0 的话，这条 meta 会被静默读掉——会话连侧边栏都进不去，而探针只会报「没找到
		 * 会话行」，把人引向完全不相干的地方。
		 */
		/*
		 * `usage` 不能省。
		 *
		 * `SessionStore.load` 读它的 `.total`，缺了就抛 `Cannot read properties of undefined`，
		 * 而 `rebuildIndex` 把每个 load 的异常都吞掉——于是会话不是报错，是干脆不存在，
		 * 探针只会说「侧边栏里没有那条会话」。手写固件先用 Node 调一次 load，比在窗口里猜快得多。
		 */
		const zeroUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
		const lines = [
			{ seq: 1, ts: now, type: "meta", meta: { id: SESSION_ID, title: TITLE, cwd: root, projectId, projectName: "project", createdAt: now, updatedAt: now, modelId: null, messageCount: 2, usage: zeroUsage, seq: 0 } },
			{ seq: 2, ts: now, type: "message", message: { role: "user", content: [{ type: "text", text: "画个图看看" }], timestamp: now } },
			{ seq: 3, ts: now + 1, type: "message", message: { role: "assistant", content: [{ type: "text", text: BODY }], api: "openai-responses", provider: "x", model: "m", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: "stop", timestamp: now + 1 } },
		];
		await writeFile(join(home, "sessions", projectId, `${SESSION_ID}.jsonl`), `${lines.map((l) => JSON.stringify(l)).join("\n")}\n`);

		await writeFile(
			join(home, "settings.json"),
			JSON.stringify({
				version: 1, providers: [], mcpServers: [],
				projects: [{ path: root, name: "project", pinned: false, lastOpenedAt: now }],
				defaultModelId: null, permissionMode: "auto", thinking: "medium", retryAttempts: 3,
				hooks: [], scheduledTasks: [], disabledPlugins: [], pluginRegistries: [], skillRegistries: [],
				alwaysAllow: [], sync: { enabled: false, port: 4519, token: null },
			}),
		);
	},
});

const wire = await frameGrabber(PORT);
const settle = (ms: number) => new Promise((done) => setTimeout(done, ms));

try {
	await mkdir(OUT, { recursive: true });
	await settle(2500);

	const row = await wire.evaluate<{ x: number; y: number } | null>(
		`(() => {
			const all = [...document.querySelectorAll('*')].filter((e) => (e.textContent || '').trim() === ${JSON.stringify(TITLE)});
			const el = all[all.length - 1];
			if (!el) return null;
			const hit = el.closest('button, [role="button"], a, li') || el;
			const r = hit.getBoundingClientRect();
			if (r.width === 0) return null;
			return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
		})()`,
	);
	if (!row) throw new Error("侧边栏里没有那条会话——固件没被读进去");
	for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) {
		await wire.send("Input.dispatchMouseEvent", { type, x: row.x, y: row.y, ...(type === "mouseMoved" ? {} : { button: "left", clickCount: 1 }) });
	}
	// mermaid 是动态 import 的，第一次要现取现跑，给够时间。
	await settle(4000);

	const read = () =>
		wire.evaluate<{ figures: number; svgs: number; nodeTexts: string[]; fences: number; tsFence: boolean; rawGraphTd: boolean; width: number }>(
			`(() => {
				const figs = [...document.querySelectorAll('.ly-mermaid')];
				const svgs = figs.filter((f) => f.querySelector('svg'));
				const texts = [];
				for (const s of svgs) for (const t of s.querySelectorAll('text, .nodeLabel')) {
					const v = (t.textContent || '').trim();
					if (v && !texts.includes(v)) texts.push(v);
				}
				const pres = [...document.querySelectorAll('pre')];
				return {
					figures: figs.length,
					svgs: svgs.length,
					nodeTexts: texts.slice(0, 12),
					fences: pres.length,
					// 普通 ts 围栏必须还在
					tsFence: pres.some((p) => (p.textContent || '').includes('const x: number')),
					// 真图的原文不该还以文本形式摆在页面上
					rawGraphTd: pres.some((p) => (p.textContent || '').includes('PID 13597')),
					width: svgs[0] ? Math.round(svgs[0].getBoundingClientRect().width) : 0,
				};
			})()`,
		);

	const light = await read();
	console.log("=== 亮色 ===");
	console.log(JSON.stringify(light, null, 1));

	const shot = async (name: string) => {
		await writeFile(join(OUT, name), await wire.shot());
		console.log(`截图 → ${join(OUT, name)}`);
	};
	await shot("01-light.png");

	// 换暗色再看一遍：一张亮底的图钉在暗色对话里，是这类组件最常见的半成品。
	await wire.evaluate<boolean>(`(() => { document.documentElement.style.colorScheme = 'dark'; return true; })()`);
	await settle(3000);
	const dark = await read();
	console.log("\n=== 暗色 ===");
	console.log(JSON.stringify({ svgs: dark.svgs, width: dark.width }, null, 1));
	await shot("02-dark.png");

	console.log("\n=== 判定 ===");
	const verdict = [
		/*
		 * 画得出的才留下容器。
		 *
		 * 坏语法那个按设计整块退回 `CodeBlock`，所以 DOM 里根本没有它的 `.ly-mermaid`——
		 * 两个容器、两张图、剩下那个躺在 `pre` 里，正是想要的样子。
		 */
		[light.figures === 2, `画得出的两个进了 MermaidBlock（实际 ${light.figures}）`],
		[light.svgs === 2, `两个都出了 SVG（实际 ${light.svgs}）`],
		[light.fences === 2, `坏语法那个退回了代码块，和 ts 围栏一起共 2 个 pre（实际 ${light.fences}）`],
		[light.nodeTexts.some((t) => t.includes("13597")), `图里有真实节点文字（${light.nodeTexts.slice(0, 3).join(" / ")}）`],
		[!light.rawGraphTd, "真图的原文不再以文本形式摆着"],
		[light.tsFence, "普通 ts 围栏没被波及"],
		[light.width > 200, `画出来有实际宽度（${light.width}px）`],
		[dark.svgs === 2, `换暗色后仍是两张图（实际 ${dark.svgs}）`],
	] as const;
	for (const [ok, what] of verdict) console.log(`${ok ? "✅" : "❌"} ${what}`);
	console.log(verdict.every(([ok]) => ok) ? "\n全部通过" : "\n有未通过项");
} finally {
	wire.close();
	await app.stop();
}
