/* oxlint-disable no-console -- a probe CLI whose entire output is what it printed */

/**
 * 把改过的那几页拍下来，好跟用户手里那几张截图对着看。
 *
 * 量出来的数已经在 `settings-alignment-probe.ts` 里了；这个脚本只负责出图——对齐这种事，最后还是
 * 得有人用眼睛确认一遍，而「偏 0pt」和「看上去对」偶尔不是同一件事（比如量对了但整体重心不对）。
 *
 * 用法：node --experimental-strip-types e2e/settings-shots.ts [输出目录]
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { startApp } from "./app.ts";

const out = process.argv[2] ?? join(process.env.HOME ?? "/tmp", "Desktop", "lyra-设置改动");
const PORT = 9495;
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function seed(home: string): Promise<void> {
	const project = join(home, "proj");
	await mkdir(project, { recursive: true });
	await writeFile(join(project, "readme.md"), "# probe\n");
	await writeFile(join(home, "window.json"), JSON.stringify({ width: 1360, height: 980, x: 0, y: 0 }));
	await writeFile(
		join(home, "settings.json"),
		JSON.stringify({
			version: 1,
			providers: [],
			mcpServers: [],
			projects: [{ id: "e2e", name: "proj", path: project, pinned: true, lastOpenedAt: 1 }],
			defaultModelId: null,
			permissionMode: "auto",
			thinking: "high",
			maxConcurrentSubAgents: 4,
			retryAttempts: 3,
			hooks: [],
			scheduledTasks: [],
			disabledPlugins: [],
			alwaysAllow: [],
			sync: { enabled: false, port: 4531, token: null },
			searchApiKeys: { tavily: "tv-probe-key", brave: "bs-probe-key", exa: "ex-probe-key" },
		}),
	);
	await seedUsage(home);
}

/** 九十天的假账，好让使用统计那一页有东西可画。跟对齐探针里那份是同一套。 */
async function seedUsage(home: string): Promise<void> {
	const dir = join(home, "sessions", "probe");
	await mkdir(dir, { recursive: true });
	const day = 24 * 60 * 60 * 1000;
	const lines: string[] = [];
	for (let back = 0; back < 90; back++) {
		const at = Date.now() - back * day;
		const scale = 1 + back * 3;
		for (const [provider, model] of [["relay", "gemini-3.8-flash"], ["fast", "grok-4.6"]] as const) {
			lines.push(
				JSON.stringify({
					type: "message",
					message: { role: "assistant", timestamp: at, provider, model, usage: { input: 1200 * scale, output: 320 * scale, cacheRead: 8000 * scale, cacheWrite: 0, cost: 0.004 * scale } },
				}),
			);
		}
	}
	await writeFile(join(dir, "probe.jsonl"), `${lines.join("\n")}\n`);
}

const app = await startApp({ port: PORT, seed });

async function shot(name: string): Promise<void> {
	const { data } = await app.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
	await writeFile(join(out, name), Buffer.from(data, "base64"));
	console.log(`  → ${name}`);
}

async function openPane(label: string): Promise<void> {
	await app.evaluate(`(() => {
		const nav = [...document.querySelectorAll("nav button")].find((b) => b.innerText.trim() === ${JSON.stringify(label)});
		if (nav) nav.click();
	})()`);
	await pause(700);
}

try {
	await mkdir(out, { recursive: true });
	await pause(2600);
	await app.evaluate(`(() => { const e = document.querySelector(".ly-sidebar-foot button"); if (e) e.click(); })()`);
	await pause(1500);

	console.log(`\n出图到 ${out}`);

	await openPane("子智能体调度");
	await shot("01-子智能体调度.png");

	await openPane("网页搜索");
	await shot("02-网页搜索.png");
	/*
	 * hover 那一条单独拍一张。
	 *
	 * 合成事件进不了 `:hover`——那是浏览器按真实指针位置算的——所以这里直接把 hover 那两条样式
	 * 摁在元素上：底色换成 `--color-card-hover`，圈的边框换成 hover 规则里的那个值。拍出来的就是
	 * 鼠标停在那一条上时该有的样子，而「圈还看不看得见」正是要看的东西。
	 */
	await app.evaluate(`(() => {
		const row = document.querySelector('[data-search-provider="duckduckgo"]');
		if (!row) return;
		row.style.backgroundColor = "var(--color-card-hover)";
		const ring = row.querySelector("span.rounded-full");
		if (ring) ring.style.borderColor = "var(--color-ink-faint)";
	})()`);
	await pause(300);
	await shot("03-网页搜索-鼠标停在最后一条.png");

	await openPane("使用统计");
	await pause(1800);
	await shot("04-使用统计-30天.png");
	await app.evaluate(`(() => {
		const seg = [...document.querySelectorAll("[data-segment]")].find((b) => b.dataset.segment === "90");
		if (seg) seg.click();
	})()`);
	// 半途拍一张：动画正在走，数字停在两个端点之间——那正是「不是跳过去的」这句话的样子。
	await pause(140);
	await shot("05-使用统计-切到90天的半途.png");
	await pause(900);
	await shot("06-使用统计-90天.png");

	console.log("");
} finally {
	await app.stop();
}
