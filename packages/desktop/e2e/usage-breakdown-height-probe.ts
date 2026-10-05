/* oxlint-disable no-console -- a probe CLI whose entire output is what it printed */

/**
 * How tall the breakdown gets, and what that does to the card beside it.
 *
 * Two faults, one cause. The grid stretched both items to the taller one's height, so a
 * twenty-row 「明细」 left 「计价质量」 holding 200px of empty background; and nothing capped the
 * table, so the whole page grew a row at a time and pushed 「使用节奏」 out of the pane.
 *
 * Measured on the 「日期」 tab, which is the long one: a month of usage is a month of rows, where
 * the model tab is however many models exist.
 *
 * Run: node --experimental-strip-types e2e/usage-breakdown-height-probe.ts
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { startApp } from "./app.ts";

const PORT = 9431;
const OUT = join(import.meta.dirname, "..", "..", "..", "test-results", "usage-layout");
const DAYS = 26;
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

const model = {
	id: "relay/gemini-3-0", providerId: "relay", modelId: "gemini-3-0", name: "Gemini 3",
	contextWindow: 1_000_000, maxOutputTokens: 65_536, supportsThinking: true, supportsImages: true, supportsTools: true,
	pricing: { input: 0.75, output: 3.75, cacheRead: 0.075, source: "manual" },
};

const app = await startApp({
	port: PORT,
	seed: async (home) => {
		const root = join(home, "project");
		await mkdir(root, { recursive: true });
		await writeFile(join(home, "window.json"), JSON.stringify({ width: 1440, height: 900, x: 0, y: 0 }));

		const projectId = "usagelayout00000".slice(0, 16);
		await mkdir(join(home, "sessions", projectId), { recursive: true });
		const lines: string[] = [];
		let seq = 0;
		for (let daysAgo = DAYS; daysAgo >= 1; daysAgo--) {
			const at = Date.now() - daysAgo * 86_400_000;
			for (let turn = 0; turn < 6; turn++) {
				const input = 20_000 + ((daysAgo * 7_919 + turn * 31) % 40_000);
				lines.push(JSON.stringify({
					seq: ++seq, ts: at, type: "message",
					message: {
						role: "assistant", content: [{ type: "text", text: "。" }], api: "openai-responses",
						provider: "relay", model: "gemini-3-0", stopReason: "stop", timestamp: at,
						usage: { input, output: 800, cacheRead: input * 9, cacheWrite: 0, total: input * 10 + 800, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
					},
				}));
			}
		}
		await writeFile(join(home, "sessions", projectId, "s.jsonl"), lines.join("\n") + "\n");

		await writeFile(join(home, "settings.json"), JSON.stringify({
			version: 1,
			providers: [{ id: "relay", name: "Relay", baseUrl: "https://relay.example/v1", api: "openai-responses", apiKey: "x", enabled: true, models: [model] }],
			mcpServers: [], projects: [{ path: root, name: "project", pinned: false, lastOpenedAt: Date.now() }],
			defaultModelId: "relay/gemini-3-0", permissionMode: "auto", thinking: "medium", retryAttempts: 3,
			hooks: [], scheduledTasks: [], disabledPlugins: [], pluginRegistries: [], skillRegistries: [],
			alwaysAllow: [], sync: { enabled: false, port: 4519, token: null }, appearance: { theme: "dark" },
		}));
	},
});

const shot = async (name: string) => {
	const result = await app.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
	await writeFile(join(OUT, `${name}.png`), Buffer.from(result.data, "base64"));
};

try {
	await mkdir(OUT, { recursive: true });
	await pause(2_600);

	const opened = await app.evaluate<string>(`(async () => {
		const wait = (ms) => new Promise(r => setTimeout(r, ms));
		document.querySelector("[data-ly-open-settings]")?.click();
		await wait(600);
		const nav = [...document.querySelectorAll("nav button")].find(b => (b.textContent || "").includes("使用统计"));
		if (!nav) return "找不到使用统计入口";
		nav.click();
		await wait(2500);
		return document.querySelector('[data-usage-dashboard="true"]') ? "已打开" : "面板未渲染";
	})()`);
	console.log("使用统计:", opened);

	// The date tab is the long list: a row per day, where the model tab has a row per model.
	const onDate = await app.evaluate<boolean>(`(async () => {
		const wait = (ms) => new Promise(r => setTimeout(r, ms));
		const tab = [...document.querySelectorAll("button")].find(b => (b.textContent || "").trim() === "日期");
		if (!tab) return false;
		tab.click();
		await wait(700);
		return true;
	})()`);
	console.log("切到日期明细:", onDate);

	const measure = () => app.evaluate<{
		breakdownH: number; qualityH: number; bottomGap: number; scrollable: boolean;
		visibleRows: number; totalRows: number; scrollH: number; clientH: number;
	} | string>(`(() => {
		const breakdown = document.querySelector('[data-usage-breakdown="true"]');
		const quality = document.querySelector('[data-usage-quality="true"]');
		if (!breakdown || !quality) return "没找到卡片";
		const b = breakdown.getBoundingClientRect();
		const q = quality.getBoundingClientRect();
		const scroller = breakdown.querySelector(".overflow-y-auto");
		// The rows are the scroller's own children; the header sits outside it.
		const rows = scroller ? [...scroller.firstElementChild.children].slice(1) : [];
		const inView = rows.filter(r => { const rr = r.getBoundingClientRect(); return rr.top >= b.top && rr.bottom <= b.bottom + 1; });
		return {
			breakdownH: Math.round(b.height),
			qualityH: Math.round(q.height),
			bottomGap: Math.round(b.bottom - q.bottom),
			scrollable: scroller ? scroller.scrollHeight > scroller.clientHeight + 1 : false,
			visibleRows: inView.length,
			totalRows: rows.length,
			scrollH: scroller ? Math.round(scroller.scrollHeight) : 0,
			clientH: scroller ? Math.round(scroller.clientHeight) : 0,
		};
	})()`);

	console.log("量得:", JSON.stringify(await measure()));

	// Bring the pair into view before photographing them.
	await app.evaluate(`document.querySelector('[data-usage-quality="true"]')?.scrollIntoView({ block: "center" })`);
	await pause(700);
	await shot("breakdown-capped");
	console.log(`\n截图目录: ${OUT}`);
} finally {
	await app.stop();
}
