/* oxlint-disable no-console -- real-window verification prints measured evidence */
/**
 * 模型设置页改成分组列表之后，在真窗口里量一遍。
 *
 * 一个本地假接口顶替供应商：`sk-good` 通过，`sk-bad` 回 401。于是「测试」的两种结果都是真的请求
 * 跑出来的，不是往组件里塞的状态。浅色跑完整个剧本，深色再起一次只拍两张。
 *
 * 用法：先 `pnpm --filter @lyra/desktop build`，再
 * `node --experimental-strip-types packages/desktop/e2e/model-settings-demo.ts`
 */

import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";

import { startApp, type RunningApp } from "./app.ts";
import { encode, pause, startRecording, type Frame } from "./record.ts";

const out = process.argv[2] ?? join(homedir(), "Desktop", "Lyra模型设置重设计");
const stamp = new Date().toLocaleString("sv-SE", { timeZone: "Asia/Shanghai" }).replace(/[: ]/g, "-").slice(0, 16);
const PORT = 9862;
const checks: { name: string; ok: boolean; measured: unknown }[] = [];
const check = (name: string, ok: boolean, measured: unknown) => {
	checks.push({ name, ok, measured });
	console.log(`${ok ? "PASS" : "FAIL"} ${name} ${JSON.stringify(measured)}`);
};

const endpoint = createServer((req, res) => {
	const good = req.headers.authorization === "Bearer sk-good";
	// A little latency, so the number on the button is not a suspicious 0.
	setTimeout(() => {
		if (!good) {
			res.writeHead(401, { "content-type": "application/json" });
			res.end(JSON.stringify({ error: { message: "invalid api key" } }));
			return;
		}
		res.writeHead(200, { "content-type": "application/json" });
		res.end(req.url?.endsWith("/models") ? JSON.stringify({ data: [{ id: "gpt-6-sol" }] }) : JSON.stringify({ output: [] }));
	}, 120);
});
await new Promise<void>((resolve) => endpoint.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${(endpoint.address() as AddressInfo).port}/v1`;

const model = (provider: string, modelId: string, contextWindow: number, caps: { thinking?: boolean; images?: boolean; tools?: boolean }, name?: string) => ({
	id: `${provider}/${modelId}`,
	providerId: provider,
	modelId,
	name: name ?? modelId,
	contextWindow,
	maxOutputTokens: 8192,
	supportsThinking: caps.thinking ?? false,
	supportsImages: caps.images ?? false,
	supportsTools: caps.tools ?? true,
});

function seeder(theme: "light" | "dark") {
	return async (home: string) => {
		const project = join(home, "proj");
		await mkdir(project, { recursive: true });
		await writeFile(join(project, "README.md"), "# proj\n");
		await writeFile(join(home, "window.json"), JSON.stringify({ width: 1240, height: 900, x: 40, y: 40 }));
		await writeFile(
			join(home, "settings.json"),
			JSON.stringify({
				version: 1,
				appearance: { theme },
				providers: [
					{ id: "co", name: "公司", api: "openai-responses", baseUrl: base, apiKey: "sk-good", enabled: true, models: [
						model("co", "gpt-6-astra", 272_000, { thinking: true, images: true }),
						model("co", "gpt-6-luna", 200_000, { thinking: true }),
						model("co", "gpt-6-sol", 272_000, { thinking: true, images: true }),
						model("co", "gpt-6.1-sol", 272_000, { thinking: true, images: true }),
					] },
					{ id: "ds", name: "deepseek", api: "openai-chat-completions", baseUrl: base, apiKey: "sk-good", enabled: true, models: [
						model("ds", "deepseek-chat", 128_000, {}),
						model("ds", "deepseek-reasoner", 128_000, { thinking: true }, "DeepSeek R2"),
					] },
					{ id: "cc", name: "commandcode", api: "openai-responses", baseUrl: base, apiKey: "sk-bad", enabled: true, models: [
						model("cc", "qwen3-coder-plus", 1_000_000, {}),
					] },
					{ id: "local", name: "本地", api: "openai-chat-completions", baseUrl: "http://127.0.0.1:1/v1", apiKey: "", enabled: false, models: [
						model("local", "qwen3:32b", 40_000, { thinking: true, tools: false }),
					] },
					{ id: "px", name: "Portunex", api: "openai-responses", baseUrl: base, apiKey: "sk-good", enabled: true, models: [] },
				],
				mcpServers: [],
				projects: [{ id: "e2e", name: "proj", path: project, pinned: true, lastOpenedAt: 1 }],
				defaultModelId: "co/gpt-6.1-sol",
				permissionMode: "auto",
				thinking: "off",
				retryAttempts: 3,
				hooks: [],
				scheduledTasks: [],
				disabledPlugins: [],
				alwaysAllow: [],
			}),
		);
	};
}

let app: RunningApp | undefined;
let stopRecording: (() => Promise<void>) | undefined;
const frames: Frame[] = [];

async function until(expression: string, ms = 20_000) {
	for (let i = 0; i < ms / 100; i++) {
		if (await app!.evaluate(`Boolean(${expression})`)) return;
		await pause(100);
	}
	throw new Error(`UI condition not reached: ${expression}`);
}
async function clickAt(expression: string) {
	await until(expression);
	const at = await app!.evaluate<[number, number]>(
		`(()=>{const el=${expression};el.scrollIntoView({block:'nearest',behavior:'instant'});const r=el.getBoundingClientRect();return [r.x+r.width/2,r.y+r.height/2]})()`,
	);
	await app!.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: at[0], y: at[1] });
	for (const type of ["mousePressed", "mouseReleased"]) {
		await app!.send("Input.dispatchMouseEvent", { type, x: at[0], y: at[1], button: "left", clickCount: 1 });
	}
}
/*
 * The grey a surface actually shows: its background laid over the page's, as the eye sees it.
 * The groups are a translucent wash, so their computed colour alone says nothing about contrast.
 */
const EFFECTIVE = `((el) => { const rgb = (c) => { const n = c.match(/[\\d.]+/g).map(Number); return c.startsWith("color(") ? [...n.slice(0, 3).map((v) => v * 255), n[3]] : n; }; const page = rgb(getComputedStyle(document.querySelector("main.ly-card-page")).backgroundColor); const [r, , , a = 1] = rgb(getComputedStyle(el).backgroundColor); return Math.round(r * a + page[0] * (1 - a)); })`;
const q = (selector: string) => `document.querySelector(${JSON.stringify(selector)})`;
const byText = (selector: string, text: string) =>
	`[...document.querySelectorAll(${JSON.stringify(selector)})].find((el) => (el.textContent || "").trim() === ${JSON.stringify(text)})`;
async function hold(ms = 1000) {
	const end = Date.now() + ms;
	while (Date.now() < end) {
		const picture = await app!.send<{ data: string }>("Page.captureScreenshot", { format: "jpeg", quality: 82 });
		frames.push({ at: Date.now(), data: Buffer.from(picture.data, "base64") });
		await pause(Math.min(200, Math.max(0, end - Date.now())));
	}
}
async function shot(name: string) {
	const picture = await app!.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
	await writeFile(join(out, `${stamp}_${name}.png`), Buffer.from(picture.data, "base64"));
}
async function openModels() {
	await clickAt(q(".ly-sidebar-foot button"));
	await until(`Boolean(document.querySelector("nav button"))`);
	await pause(400);
	await clickAt(byText("nav button", "模型设置"));
	await until(q("[data-ly-model-list]"));
	await pause(600);
}
const selectProvider = (name: string) => clickAt(`[...document.querySelectorAll("main button.h-9")].find((b) => (b.textContent || "").includes(${JSON.stringify(name)}))`);

await mkdir(out, { recursive: true });
try {
	app = await startApp({ port: PORT, seed: seeder("light") });
	stopRecording = await startRecording(PORT, frames);
	await app.evaluate("document.fonts.ready");
	await openModels();
	await hold(1200);
	await shot("01_浅色_公司");

	// 重命名、删除两颗按钮常驻在标题行，不再藏在 ⋯ 里；各点一次，看它们真的通到原来的动作。
	const heading = await app.evaluate<{ rename: boolean; remove: boolean; more: number }>(`(() => {
		const visible = (el) => Boolean(el) && el.getBoundingClientRect().width > 0;
		return { rename: visible(${q("[data-ly-provider-rename]")}), remove: visible(${q("[data-ly-provider-delete]")}), more: [...document.querySelectorAll("main button[aria-label='更多操作']")].filter((b) => !b.closest("[data-ly-model-list], header")).length };
	})()`);
	await clickAt(q("[data-ly-provider-rename]"));
	await until(`document.activeElement?.value === "公司"`);
	await hold(900);
	await shot("01b_浅色_重命名");
	await app.evaluate(`document.activeElement.blur()`);
	await clickAt(q("[data-ly-provider-delete]"));
	await until(`${q("[role=dialog]")}?.textContent.includes("公司")`);
	await hold(900);
	await shot("01c_浅色_删除确认");
	const asked = await app.evaluate<string>(`${q("[role=dialog]")}.textContent`);
	for (const type of ["keyDown", "keyUp"]) await app.send("Input.dispatchKeyEvent", { type, key: "Escape", windowsVirtualKeyCode: 27 });
	await until(`!${q("[role=dialog]")}`);
	const still = await app.evaluate<boolean>(`[...document.querySelectorAll("main button.h-9")].some((b) => b.textContent.includes("公司"))`);
	check("重命名、删除常驻标题行（没有 ⋯）：点重命名出输入框，点删除先问一句，取消后供应商还在", heading.rename && heading.remove && heading.more === 0 && asked.includes("公司") && still, { heading, asked: asked.slice(0, 40), still });

	// 结构：供应商列表和编辑区同在一张大卡片里，中间一条通到底的竖线；连接、模型各一张设置卡片（其他设置页同一个组件），一行一条细线、最后一行不画。
	const lines = await app.evaluate<{ cards: string[]; radius: string; rules: { connection: number[]; models: number[] }; divider: { width: string; pane: number; card: number }; group: number; page: number }>(`(() => {
		const ruled = (card) => [...card.children].map((row) => parseFloat(getComputedStyle(row).borderBottomWidth) > 0 ? 1 : 0);
		const connection = document.querySelector("[data-ly-provider-connection]");
		const models = document.querySelector("[data-ly-model-list]");
		const panes = document.querySelector("[data-ly-provider-panes]");
		const list = panes.firstElementChild;
		return {
			cards: [...document.querySelectorAll("main .ly-settings-card")].map((c) => c.hasAttribute("data-ly-provider-panes") ? "panes" : c.hasAttribute("data-ly-provider-connection") ? "connection" : c.hasAttribute("data-ly-model-list") ? "models" : "other"),
			radius: getComputedStyle(connection).borderRadius + " " + getComputedStyle(connection).borderTopWidth,
			rules: { connection: ruled(connection), models: ruled(models) },
			divider: { width: getComputedStyle(list).borderRightWidth, pane: Math.round(list.getBoundingClientRect().height), card: panes.clientHeight },
			group: ${EFFECTIVE}(connection),
			page: ${EFFECTIVE}(document.querySelector("main.ly-card-page")),
		};
	})()`);
	check(
		"一张大卡片装下列表和编辑区，中间竖线通到底；连接、模型各一张卡片（12px 圆角 1px 边），行间细线、末行不画",
		JSON.stringify(lines.cards) === '["panes","connection","models"]' && lines.divider.width === "1px" && lines.divider.pane === lines.divider.card && lines.radius === "12px 1px" && JSON.stringify(lines.rules.connection) === "[1,1,0]" && JSON.stringify(lines.rules.models) === "[1,1,1,0]",
		lines,
	);
	// 「添加模型」右缘和卡片右缘齐平、落在滚动区里面：之前往外探了 8px，悬停底色被滚动区切掉一截。
	const addEdge = await app.evaluate<{ button: number; card: number; clip: number }>(`(() => { const b = ${q("[data-ly-add-model]")}; let clip = b.parentElement; while (clip && getComputedStyle(clip).overflowX === "visible") clip = clip.parentElement; return { button: Math.round(b.getBoundingClientRect().right), card: Math.round(${q("[data-ly-model-list]")}.getBoundingClientRect().right), clip: Math.round(clip.getBoundingClientRect().right) }; })()`);
	check("添加模型按钮右缘与卡片齐平，没有被滚动区切掉", addEdge.button === addEdge.card && addEdge.button <= addEdge.clip, addEdge);
	// 「立即更新」悬停只变色，不画下划线。每次 send 是一条新连接，强制悬停态留不住，所以查样式表：
	// 所有落在这颗按钮上的 :hover 规则里，有改颜色的、没有画下划线的。
	const hoverRules = await app.evaluate<{ color: number; underline: number }>(`(() => {
		const b = ${q("[data-ly-model-catalog] button")};
		const rules = [];
		const walk = (list) => { for (const r of list) { if (r.cssRules) walk(r.cssRules); if (r.selectorText?.includes(":hover")) rules.push(r); } };
		for (const sheet of document.styleSheets) { try { walk(sheet.cssRules); } catch {} }
		const mine = rules.filter((r) => r.selectorText.split(",").some((sel) => { try { return b.matches(sel.replaceAll(":hover", "")); } catch { return false; } }));
		return { color: mine.filter((r) => r.style.color).length, underline: mine.filter((r) => /underline/.test(r.style.textDecorationLine + r.style.textDecoration)).length };
	})()`);
	check("悬停「立即更新」只变色，没有下划线", hoverRules.color > 0 && hoverRules.underline === 0, hoverRules);
	const field = await app.evaluate<{ background: string; shadow: string }>(`(() => { const s = getComputedStyle(${q("[data-ly-provider-connection] .ly-field")}); return { background: s.backgroundColor, shadow: s.boxShadow }; })()`);
	check("卡片比页面亮；输入框和其他设置页一样是透明底加一圈细线", lines.group > lines.page && field.shadow.includes("inset"), { card: lines.group, page: lines.page, field });

	// 对齐：四行的上下文标签右缘在同一条竖线上，名字左缘也是。
	const columns = await app.evaluate<{ rows: number; ctxRight: number[]; nameLeft: number[] }>(`(() => {
		const rows = [...document.querySelectorAll("[data-ly-model-list] .group\\\\/row")];
		return {
			rows: rows.length,
			ctxRight: rows.map((r) => Math.round([...r.querySelectorAll("span")].find((s) => /^\\d+(K|M)$/.test(s.textContent.trim())).getBoundingClientRect().right)),
			nameLeft: rows.map((r) => Math.round(r.querySelector(".font-mono").getBoundingClientRect().left)),
		};
	})()`);
	check("4 行模型，上下文标签右缘对齐", columns.rows === 4 && new Set(columns.ctxRight).size === 1, columns.ctxRight);
	check("模型名左缘对齐", new Set(columns.nameLeft).size === 1, columns.nameLeft);

	const caps = await app.evaluate<number[]>(`[...document.querySelectorAll("[data-ly-model-list] .group\\\\/row")].map((r) => r.querySelectorAll("[role=img]").length)`);
	check("能力标记按模型各自的能力出现（思考/图片/工具）", JSON.stringify(caps) === "[3,2,3,3]", caps);

	const badge = await app.evaluate<string>(`[...document.querySelectorAll("[data-ly-model-list] .group\\\\/row")].findIndex((r) => r.textContent.includes("默认")) + ""`);
	check("默认徽标在 gpt-6.1-sol 那一行", badge === "3", badge);

	// 测试：按钮本身就是结果。
	await clickAt(q("[data-ly-provider-test]"));
	await until(`${q("[data-ly-provider-test]")}?.getAttribute("data-ly-provider-test") === "passed"`);
	await hold(1200);
	const passed = await app.evaluate<{ text: string; color: string }>(`(() => { const b = ${q("[data-ly-provider-test]")}; return { text: b.textContent.trim(), color: getComputedStyle(b.querySelector(".text-ok")).color }; })()`);
	check("测试通过：按钮原地变成 ✓ 和延迟", /^\d+ms$/.test(passed.text), passed);
	await shot("02_浅色_测试通过");

	// 单个模型测试，结果落在那一行。
	await clickAt(`[...document.querySelectorAll("[data-ly-model-list] .group\\\\/row")][1].querySelectorAll("button")[1]`);
	await until(`/\\d+ms/.test([...document.querySelectorAll("[data-ly-model-list] .group\\\\/row")][1].textContent)`);
	await hold(900);
	check("单个模型测试：延迟出现在那一行", true, await app.evaluate(`[...document.querySelectorAll("[data-ly-model-list] .group\\\\/row")][1].textContent.match(/\\d+ms/)[0]`));

	// ⋯ → 设为默认，徽标挪过去。
	await clickAt(`[...document.querySelectorAll("[data-ly-model-list] .group\\\\/row")][0].querySelectorAll("button")[2]`);
	await until(`[...document.querySelectorAll("[role=menuitem]")].some((el) => el.textContent.includes("设为默认模型"))`);
	await hold(900);
	await shot("03_浅色_模型菜单");
	await clickAt(`[...document.querySelectorAll("[role=menuitem]")].find((el) => el.textContent.includes("设为默认模型"))`);
	await until(`[...document.querySelectorAll("[data-ly-model-list] .group\\\\/row")][0].textContent.includes("默认")`);
	await hold(900);
	const moved = await app.evaluate<number>(`[...document.querySelectorAll("[data-ly-model-list] .group\\\\/row")].filter((r) => r.textContent.includes("默认")).length`);
	check("设为默认之后只有第一行带默认徽标", moved === 1, moved);

	// 失败：401 写在 Key 那一行下面，按钮变红。
	await selectProvider("commandcode");
	await until(`${q("[data-ly-model-list]")}?.textContent.includes("qwen3-coder-plus")`);
	await hold(700);
	await clickAt(q("[data-ly-provider-test]"));
	await until(`${q("[data-ly-provider-test]")}?.getAttribute("data-ly-provider-test") === "failed"`);
	await hold(1400);
	const failed = await app.evaluate<string>(`${q("[data-ly-provider-connection]")}.lastElementChild.textContent`);
	check("测试失败：按钮变红，原因写在 API Key 那一行里", failed.includes("测试失败") && failed.includes("401"), failed.match(/HTTP 401[^}]*/)?.[0] ?? failed.slice(-80));
	await shot("04_浅色_测试失败");

	// 停用：左栏写「已禁用」，右边两个分组淡下去。
	await selectProvider("Portunex");
	await until(`${q("[data-ly-model-list]")}?.textContent.includes("还没有模型")`);
	await hold(900);
	await shot("05_浅色_空模型");
	await clickAt(q("main [role=switch]"));
	await until(`[...document.querySelectorAll("main button.h-9")].find((b) => b.textContent.includes("Portunex"))?.textContent.includes("已禁用")`);
	await hold(1000);
	const dim = await app.evaluate<string>(`getComputedStyle(${q("[data-ly-provider-connection]")}.closest(".transition-opacity")).opacity`);
	check("停用后左栏标「已禁用」，右边淡到 0.6", dim === "0.6", dim);
	await clickAt(q("main [role=switch]"));
	await hold(700);
} catch (error) {
	check("verification script completed", false, String(error));
	await shot("失败现场_浅色").catch(() => {});
} finally {
	await stopRecording?.();
	await app?.stop();
	app = undefined;
}

// 深色：同一份数据，重起一次，只拍。
try {
	app = await startApp({ port: PORT, seed: seeder("dark") });
	await app.evaluate("document.fonts.ready");
	await openModels();
	await pause(500);
	await shot("06_深色_公司");
	const dark = await app.evaluate<{ group: number; page: number }>(`({ group: ${EFFECTIVE}(document.querySelector("main .ly-settings-card")), page: ${EFFECTIVE}(document.querySelector("main.ly-card-page")) })`);
	check("深色下卡片底色和页面也至少差 6 级", Math.abs(dark.group - dark.page) >= 6, dark);
} catch (error) {
	check("dark pass completed", false, String(error));
	await shot("失败现场_深色").catch(() => {});
} finally {
	await app?.stop();
	endpoint.close();
	const pass = checks.filter((item) => item.ok).length;
	const name = `${stamp}_模型设置分组_${pass}of${checks.length}`;
	await writeFile(join(out, `${name}.json`), JSON.stringify({ checks }, null, 2));
	if (frames.length) await encode(frames, join(out, `${name}.mp4`), 60);
	console.log(`Evidence: ${join(out, name)} (${frames.length} captured frames)`);
	if (checks.some((item) => !item.ok)) process.exitCode = 1;
}
