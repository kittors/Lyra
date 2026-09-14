/* oxlint-disable no-console -- probe CLI that prints what the real window did */
/**
 * 在真窗口里换一次模型。
 *
 * 单元测试跑在 happy-dom 上，那里没有合成器：CSS 动画不走，`animationend` 不来，两个浮层各自
 * 的退场时长——菜单 120ms、确认框 130ms——在那里读不出先后。而这个 bug 的全部内容就是那 10ms
 * 的先后。所以它必须在真的 Chromium 里跑一遍。
 *
 * 复现的是用户录屏里的动作：一个已经聊过的会话，打开模型菜单，点另一个模型，确认框弹出来，
 * 按「确认切换」。然后问一句真正要紧的事——底下那个标签，到底换没换。
 */

import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { startApp } from "./app.ts";

const MODELS = [
	{ id: "qa/alpha", providerId: "qa", modelId: "gpt-6-astra", name: "Alpha", contextWindow: 128000, maxOutputTokens: 4096, supportsImages: false, supportsTools: true, supportsThinking: true },
	{ id: "qa/beta", providerId: "qa", modelId: "claude-opus-4-6", name: "Beta", contextWindow: 128000, maxOutputTokens: 4096, supportsImages: false, supportsTools: true, supportsThinking: true },
];

async function seed(home: string): Promise<void> {
	await mkdir(home, { recursive: true });
	const cwd = join(home, "project");
	await mkdir(cwd, { recursive: true });
	const projectId = createHash("sha256").update(cwd).digest("hex").slice(0, 16);
	await mkdir(join(home, "sessions", projectId), { recursive: true });

	const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
	// 已经聊过——这正是弹确认框的前提。
	const messages = [
		{ role: "user", content: [{ type: "text", text: "已经聊过一轮了。" }], timestamp: 1 },
		{ role: "assistant", content: [{ type: "text", text: "收到。" }], api: "anthropic-messages", provider: "qa", model: "gpt-6-astra", usage, stopReason: "stop", timestamp: 2 },
	];
	const meta = { id: "switch-me", title: "换模型", projectId, projectName: "换模型验证", cwd, createdAt: 1, updatedAt: 2, modelId: "qa/alpha", messageCount: messages.length, usage, seq: messages.length + 1 };
	await writeFile(
		join(home, "sessions", projectId, "switch-me.jsonl"),
		[
			JSON.stringify({ type: "meta", meta, seq: 0, ts: 1 }),
			...messages.map((message, i) => JSON.stringify({ type: "message", message, seq: i + 1, ts: 1 })),
			JSON.stringify({ type: "meta", meta, seq: meta.seq, ts: 2 }),
		].join("\n") + "\n",
	);
	await writeFile(join(home, "sessions", "index.json"), JSON.stringify([meta]));
	await writeFile(join(home, "window.json"), JSON.stringify({ width: 1200, height: 800 }));
	await writeFile(
		join(home, "settings.json"),
		JSON.stringify({
			providers: [{ id: "qa", name: "QA", api: "anthropic-messages", baseUrl: "http://127.0.0.1:1", apiKey: "test", enabled: true, models: MODELS }],
			defaultModelId: "qa/alpha",
			mcpServers: [],
			hooks: [],
			sync: { enabled: false },
			projects: [{ id: projectId, path: cwd, name: "换模型验证", pinned: true, lastOpenedAt: 1 }],
		}),
	);
}

/**
 * 一次真实的按下。
 *
 * `mousedown` 是 Popover 判定「点在外面」的那个时刻，`click` 是确认框的按钮真正响应的那个。
 * 两个都要发，顺序也要对——只发 click 的话，这个 bug 根本不会出现。
 */
const PRESS = `(element) => {
	for (const type of ["mousedown", "mouseup", "click"]) {
		element.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
	}
}`;

async function main() {
	const app = await startApp({ port: 9351, seed });
	const log = (label: string, value: unknown) => console.log(`${label.padEnd(28)} ${JSON.stringify(value)}`);

	try {
		// 打开那个已经聊过的会话——点侧边栏那一行，跟人做的一样。
		const opened = await app.evaluate<boolean>(`(async () => {
			const press = ${PRESS};
			const row = document.querySelector('[data-ly-row="switch-me"]');
			if (!row) return false;
			press(row.querySelector("button") ?? row);
			await new Promise((r) => setTimeout(r, 1200));
			return document.body.innerText.includes("已经聊过一轮了");
		})()`);
		log("会话打开了吗", opened);
		if (!opened) throw new Error("没能打开那个会话——确认框的前提是它已经有对话记录");

		const before = await app.evaluate<string | null>(
			`(async () => { const list = await window.lyra.sessions.list(); return (list.find((s) => s.id === "switch-me") ?? {}).modelId ?? null; })()`,
		);
		log("开始时的模型", before);

		/*
		 * 顺路把 gpt-6-astra 的思考等级也在真窗口里点一遍。
		 *
		 * `qa/alpha` 的 modelId 就是 `gpt-6-astra`。它上线那天落在最后一条兜底规则上，于是一个
		 * 有六档的模型被画成了四档——`xhigh`、`max`、`ultra` 在滑块上根本不存在。滑块能拉到第几格
		 * 是这件事在界面上唯一的证据。
		 */
		const levels = await app.evaluate<{ steps: number; labels: string[] }>(`(async () => {
			const press = ${PRESS};
			const trigger = [...document.querySelectorAll('button[aria-haspopup="menu"]')].find((b) => /^(关闭|极简|低|中|高|超高|最高|极致)$/.test((b.textContent ?? "").trim()));
			if (!trigger) throw new Error("composer 上找不到思考等级按钮");
			press(trigger);
			await new Promise((r) => setTimeout(r, 400));
			const slider = document.querySelector('input[type="range"][aria-label="推理强度"]');
			if (!slider) throw new Error("思考等级菜单没打开");
			const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
			const labels = [];
			for (let i = 0; i <= Number(slider.max); i++) {
				setter.call(slider, String(i));
				slider.dispatchEvent(new Event("input", { bubbles: true }));
				slider.dispatchEvent(new Event("change", { bubbles: true }));
				await new Promise((r) => setTimeout(r, 120));
				const shown = document.querySelector('[aria-label="推理强度"]').closest("div").parentElement.querySelector("span.font-medium");
				labels.push((shown?.textContent ?? "").trim());
			}
			// 还回原样：这是别人借来的窗口，下一段还要用它。
			press(document.body);
			await new Promise((r) => setTimeout(r, 300));
			return { steps: Number(slider.max) + 1, labels };
		})()`);
		log("gpt-6-astra 的档位数", levels.steps);
		log("gpt-6-astra 的档位", levels.labels);

		// 打开模型菜单：点 composer 上那个显示当前模型的按钮。
		const menuUp = await app.evaluate<boolean>(`(async () => {
			const press = ${PRESS};
			const trigger = [...document.querySelectorAll('button[aria-haspopup="menu"]')].find((b) => (b.textContent ?? "").includes("Alpha"));
			if (!trigger) return false;
			press(trigger);
			await new Promise((r) => setTimeout(r, 400));
			return Boolean(document.querySelector('[role="menu"][aria-label="选择模型"]'));
		})()`);
		log("模型菜单打开了吗", menuUp);
		if (!menuUp) throw new Error("没能打开模型菜单");

		// 点另一个模型，等确认框。
		const asked = await app.evaluate<string | null>(`(async () => {
			const press = ${PRESS};
			const row = document.querySelector('[data-model="qa/beta"] button');
			if (!row) return null;
			press(row);
			await new Promise((r) => setTimeout(r, 400));
			const dialog = document.querySelector("[data-ly-modal]");
			return dialog ? (dialog.textContent ?? "").slice(0, 20) : null;
		})()`);
		log("确认框问了什么", asked);
		if (!asked) throw new Error("没弹出确认框");

		/*
		 * 按下确认，然后等得比两个动画都久。
		 *
		 * 500ms 远超菜单的 120 和确认框的 130——如果这之后模型还没换，那就不是「还没到」，
		 * 是真的没换。
		 */
		const after = await app.evaluate<{ dialogStillUp: boolean; menuStillOpen: boolean; label: string }>(`(async () => {
			const press = ${PRESS};
			const confirm = [...document.querySelectorAll("[data-ly-modal] button")].find((b) => b.textContent === "确认切换");
			if (!confirm) throw new Error("确认框上没有「确认切换」");
			press(confirm);
			await new Promise((r) => setTimeout(r, 600));
			const trigger = [...document.querySelectorAll('button[aria-haspopup="menu"]')].find((b) => /Alpha|Beta/.test(b.textContent ?? ""));
			return {
				dialogStillUp: Boolean(document.querySelector("[data-ly-modal]")),
				menuStillOpen: Boolean(document.querySelector('[role="menu"][aria-label="选择模型"]')),
				label: (trigger?.textContent ?? "").trim(),
			};
		})()`);
		log("按下确认之后（界面）", after);

		// 落盘的那一份也要跟着换——不然重开窗口又回去了。
		const persisted = await app.evaluate<string | null>(`(async () => {
			await new Promise((r) => setTimeout(r, 400));
			const list = await window.lyra.sessions.list();
			return (list.find((each) => each.id === "switch-me") ?? {}).modelId ?? null;
		})()`);
		log("会话日志里记的模型", persisted);

		const switched = persisted === "qa/beta" && after.label.includes("Beta") && !after.dialogStillUp;
		// 界面上的字来自 i18n（`thinking.off` 是「关」），不是 `thinking-options.ts` 里的 label。
		const graded = levels.steps === 7 && ["关", "低", "中", "高", "超高", "最高", "极致"].every((label, i) => levels.labels[i] === label);
		console.log(`\n${switched ? "✅ 模型换成功了" : "❌ 模型没换过去"}`);
		console.log(`${graded ? "✅ gpt-6-astra 的七档都在（关闭 + 六档）" : "❌ gpt-6-astra 的档位不对"}`);
		if (!switched || !graded) process.exitCode = 1;
	} finally {
		await app.stop();
	}
}

await main();
