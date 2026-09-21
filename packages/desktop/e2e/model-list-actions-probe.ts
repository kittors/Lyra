/* oxlint-disable no-console -- 探针把量到的东西打出来，那就是它的产物 */
/**
 * 模型设置里「模型列表」那一行的两颗动作按钮。
 *
 * 之前一颗是手写的 28px 纯图标 `<button>`，另一颗是描边的 `GhostButton`——同一行上并排站着两种
 * 高度、两种轮廓，而云朵下载和一条脉冲这两个图标谁也猜不出是「拉取模型」和「测试全部」。
 *
 * 量的是画出来的结果：各自的可见文字、算出来的边框宽度、实际高度。样式类名对不对不算数，
 * `getComputedStyle` 说了算。
 */

import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { startApp, type RunningApp } from "./app.ts";

const OUT = join(homedir(), "Desktop", "Lyra模型列表按钮测试");

let app: RunningApp;

async function pause(ms: number) {
	await new Promise((r) => setTimeout(r, ms));
}

async function shot(name: string) {
	await mkdir(OUT, { recursive: true });
	const { data } = await app.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
	await writeFile(join(OUT, `${name}.png`), Buffer.from(data, "base64"));
	return join(OUT, `${name}.png`);
}

async function seed(home: string) {
	const project = join(home, "proj");
	const id = createHash("sha256").update(project).digest("hex").slice(0, 16);
	await mkdir(project, { recursive: true });
	await writeFile(join(project, "README.md"), "# proj\n");
	await writeFile(join(home, "window.json"), JSON.stringify({ width: 1280, height: 860, x: 40, y: 40 }));
	const model = (modelId: string) => ({
		id: `probe/${modelId}`, providerId: "probe", modelId, name: modelId,
		contextWindow: 200000, maxOutputTokens: 8192, supportsImages: true, supportsTools: true, supportsThinking: false,
	});
	await writeFile(join(home, "settings.json"), JSON.stringify({
		version: 1,
		providers: [{
			id: "probe", name: "新供应商", api: "openai-responses",
			baseUrl: "https://relay.example.com", apiKey: "sk-probe", enabled: true,
			models: ["claude-opus-4-6-thinking", "claude-sonnet-4-6", "command/deepseek-v4-flash"].map(model),
		}],
		mcpServers: [],
		projects: [{ id, name: "proj", path: project, pinned: true, lastOpenedAt: 10 }],
		defaultModelId: "probe/claude-sonnet-4-6",
		permissionMode: "auto", thinking: "off", retryAttempts: 3,
		hooks: [], scheduledTasks: [], disabledPlugins: [], alwaysAllow: [],
		sync: { enabled: false, port: 4578, token: null },
		appearance: { theme: "light", reduceMotion: "on" },
	}));
}

/** 两颗按钮自己画出来的样子。类名不算数，取计算样式。 */
async function buttonState() {
	return app.evaluate<{
		found: number;
		buttons: { text: string; variant: string; borderWidth: string; borderStyle: string; height: number; width: number }[];
	}>(`(()=>{
		const label = [...document.querySelectorAll('span')].find(s => (s.textContent || '').trim() === '模型列表');
		const row = label ? label.closest('div').parentElement : null;
		const group = row ? row.querySelector('div:last-child') : null;
		const buttons = group ? [...group.querySelectorAll('button')] : [];
		return {
			found: buttons.length,
			buttons: buttons.map(b => {
				const s = getComputedStyle(b);
				const r = b.getBoundingClientRect();
				return {
					text: (b.textContent || '').trim(),
					variant: b.getAttribute('data-variant') || '(无)',
					borderWidth: s.borderTopWidth,
					borderStyle: s.borderTopStyle,
					height: Math.round(r.height),
					width: Math.round(r.width),
				};
			}),
		};
	})()`);
}

async function main() {
	app = await startApp({ port: 9731, seed });
	await app.evaluate("document.fonts.ready");
	await pause(1400);

	// 打开设置，再进「模型设置」。
	await app.evaluate(`(()=>{const b=document.querySelector('.ly-sidebar-foot button'); if(b) b.click(); return !!b;})()`);
	await pause(900);
	await app.evaluate(`(()=>{
		const nav = [...document.querySelectorAll('nav button')].find(b => (b.textContent || '').trim() === '模型设置');
		if (nav) nav.click();
		return !!nav;
	})()`);
	await pause(1200);

	const state = await buttonState();
	const png = await shot("模型列表两颗按钮");

	await app.stop();

	console.log(JSON.stringify(state, null, 2));
	console.log("截图:", png);

	const [fetchBtn, testBtn] = state.buttons;
	const checks: [string, boolean][] = [
		["两颗按钮都在", state.found === 2],
		["第一颗带文字「拉取模型」", fetchBtn?.text === "拉取模型"],
		["第二颗带文字「测试全部」", testBtn?.text === "测试全部"],
		["第一颗没有边框", fetchBtn?.borderWidth === "0px" || fetchBtn?.borderStyle === "none"],
		["第二颗没有边框", testBtn?.borderWidth === "0px" || testBtn?.borderStyle === "none"],
		["两颗都是 subtle", fetchBtn?.variant === "subtle" && testBtn?.variant === "subtle"],
		["两颗高度一致", fetchBtn?.height === testBtn?.height],
		["高度是 sm 档的 26px", testBtn?.height === 26],
		["带字之后不再是正方形", (fetchBtn?.width ?? 0) > (fetchBtn?.height ?? 0) + 20],
	];
	console.log("\n=== 判定 ===");
	let bad = 0;
	for (const [name, ok] of checks) { if (!ok) bad++; console.log(`${ok ? "✔" : "✘"} ${name}`); }
	console.log(bad === 0 ? "\n全部成立" : `\n${bad} 条不成立`);
}

await main();
