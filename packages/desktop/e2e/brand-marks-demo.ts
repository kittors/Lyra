/* oxlint-disable no-console -- real-window verification prints measured evidence */
/**
 * Every brand mark that was replaced with its vendor's own, measured in the real window.
 *
 * Search engines (Settings › Browser), code hosts (Settings › Code hosting), the six model marks
 * that were placeholders (Settings › Models and the composer's model menu), and the plugin market's
 * logos, which come from the registry and can only be judged by whether they load.
 *
 * Each theme runs with the system's colour scheme emulated as the opposite one, because that is the
 * case `dark:` used to get wrong: it followed the system, not the app's theme.
 *
 * Usage: build first (`pnpm --filter @lyra/desktop build`), then
 * `node --experimental-strip-types packages/desktop/e2e/brand-marks-demo.ts [outDir]`
 */

import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { WebSocket } from "ws";

import { startApp, type RunningApp } from "./app.ts";
import { encode, pause, startRecording, type Frame } from "./record.ts";

const OUT = process.argv[2] ?? join(homedir(), "Desktop", "Lyra官方图标测试");
const STAMP = new Date().toLocaleString("sv-SE", { timeZone: "Asia/Shanghai" }).replace(/[: ]/g, "-").slice(0, 16);
const PORT = 9871;

const checks: { ok: boolean; what: string }[] = [];
function check(what: string, ok: boolean, saw: unknown) {
	checks.push({ ok, what });
	console.log(`   ${ok ? "✅" : "❌"} ${what}  ${JSON.stringify(saw)}`);
}

const model = (modelId: string, name = modelId) => ({
	id: `all/${modelId}`,
	providerId: "all",
	modelId,
	name,
	contextWindow: 128_000,
	maxOutputTokens: 8192,
	supportsThinking: false,
	supportsImages: false,
	supportsTools: true,
});
const MODELS = [
	model("kimi-k2", "Kimi K2"),
	model("doubao-seed-1.6", "Doubao Seed 1.6"),
	model("MiniMax-M2"),
	model("step-3"),
	model("Baichuan4"),
	model("yi-lightning"),
	model("claude-sonnet-4.5"),
	model("gpt-5.2"),
	model("deepseek-chat"),
	model("gemini-2.5-pro"),
	model("qwen3-max"),
	model("grok-4"),
	model("mistral-large-latest"),
	model("hunyuan-turbos"),
];
const FORGES = [
	{ id: "a-github", kind: "github", label: "kittors · github.invalid", baseUrl: "https://github.invalid", login: "kittors" },
	{ id: "a-gitlab", kind: "gitlab", label: "work · gitlab.invalid", baseUrl: "https://gitlab.invalid", login: "work" },
	{ id: "a-gitee", kind: "gitee", label: "cn · gitee.invalid", baseUrl: "https://gitee.invalid", login: "cn" },
	{ id: "a-gitea", kind: "gitea", label: "home · gitea.invalid", baseUrl: "https://gitea.invalid", login: "home" },
];

function seeder(theme: "light" | "dark") {
	return async (home: string) => {
		const project = join(home, "proj");
		await mkdir(project, { recursive: true });
		await writeFile(join(project, "README.md"), "# proj\n");
		await writeFile(join(home, "window.json"), JSON.stringify({ width: 1280, height: 860, x: 40, y: 40 }));
		await writeFile(
			join(home, "forges.json"),
			JSON.stringify({ version: 1, entries: FORGES.map((account) => ({ account: { ...account, avatarUrl: null, addedAt: 1, enabled: true }, token: "not-a-real-token", encrypted: false })) }),
		);
		await writeFile(
			join(home, "settings.json"),
			JSON.stringify({
				version: 1,
				appearance: { theme, vibrancy: false },
				providers: [{ id: "all", name: "全品牌", api: "openai-chat-completions", baseUrl: "http://127.0.0.1:1/v1", apiKey: "sk-x", enabled: true, models: MODELS }],
				mcpServers: [],
				projects: [{ id: "e2e", name: "proj", path: project, pinned: true, lastOpenedAt: 1 }],
				defaultModelId: "all/kimi-k2",
				permissionMode: "auto",
				thinking: "off",
				hooks: [],
				scheduledTasks: [],
				disabledPlugins: [],
				alwaysAllow: [],
				browser: { searchEngine: "bing" },
			}),
		);
	};
}

let app: RunningApp | undefined;
const frames: Frame[] = [];

/**
 * The system colour scheme, emulated on a connection that stays open: emulation lasts only as long as
 * the CDP session that set it, and `app.send` opens and closes one per call.
 */
async function emulateScheme(scheme: "light" | "dark"): Promise<() => void> {
	const targets = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()) as { type: string; url: string; webSocketDebuggerUrl: string }[];
	const page = targets.find((target) => target.type === "page" && !target.url.startsWith("devtools://"))!;
	const socket = new WebSocket(page.webSocketDebuggerUrl);
	await new Promise<void>((done, fail) => {
		socket.once("open", () => done());
		socket.once("error", fail);
	});
	socket.send(JSON.stringify({ id: 1, method: "Emulation.setEmulatedMedia", params: { features: [{ name: "prefers-color-scheme", value: scheme }] } }));
	await new Promise<void>((done) => socket.once("message", () => done()));
	return () => socket.close();
}

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
	for (const type of ["mousePressed", "mouseReleased"]) await app!.send("Input.dispatchMouseEvent", { type, x: at[0], y: at[1], button: "left", clickCount: 1 });
}
async function key(name: string, code: number) {
	for (const type of ["keyDown", "keyUp"]) await app!.send("Input.dispatchKeyEvent", { type, key: name, windowsVirtualKeyCode: code });
}
const q = (selector: string) => `document.querySelector(${JSON.stringify(selector)})`;
const byText = (selector: string, text: string) => `[...document.querySelectorAll(${JSON.stringify(selector)})].find((el) => (el.textContent || "").trim() === ${JSON.stringify(text)})`;
async function shot(name: string) {
	const picture = await app!.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
	await writeFile(join(OUT, `${STAMP}_${name}.png`), Buffer.from(picture.data, "base64"));
}

/** Painted size of each mark under `scope`, and for raster marks whether the shown file decodes. */
const MEASURE = (scope: string, attr: string) => `(async () => {
	const decode = (src) => new Promise((done) => { const img = new Image(); img.onload = () => done(img.naturalWidth); img.onerror = () => done(0); img.src = src; });
	const out = {};
	for (const svg of document.querySelectorAll(${JSON.stringify(scope)} + " [" + ${JSON.stringify(attr)} + "]")) {
		const name = svg.getAttribute(${JSON.stringify(attr)});
		const box = svg.getBoundingClientRect();
		const shown = [...svg.querySelectorAll("image")].filter((image) => getComputedStyle(image).display !== "none");
		const drawn = [...svg.querySelectorAll("path, rect, circle")].reduce((sum, el) => { const b = el.getBBox(); return sum + b.width * b.height; }, 0);
		out[name] = { w: Math.round(box.width), h: Math.round(box.height), drawn: drawn > 0, images: shown.length, decoded: shown.length ? await decode(shown[0].getAttribute("href")) : null, which: shown.map((image) => image.getAttribute("class") || "") };
	}
	return out;
})()`;

async function runTheme(theme: "light" | "dark") {
	console.log(`\n== ${theme}`);
	app = await startApp({ port: PORT, seed: seeder(theme) });
	const stop = await startRecording(PORT, frames);
	try {
		const release = await emulateScheme(theme === "dark" ? "light" : "dark");
		const system = await app.evaluate<boolean>(`matchMedia("(prefers-color-scheme: dark)").matches`);
		check(`${theme}: 系统配色已模拟成与应用主题相反`, system === (theme === "light"), { systemDark: system });
		await app.evaluate("document.fonts.ready");
		await until(`document.documentElement.classList.contains("dark") === ${theme === "dark"}`);

		await clickAt(q(".ly-sidebar-foot button"));
		await until(`Boolean(${byText("nav button", "浏览器")})`);
		await pause(400);
		await clickAt(byText("nav button", "浏览器"));
		await until(`[...document.querySelectorAll("main button")].some((b) => b.querySelector("[data-search-engine]"))`);
		await pause(500);
		await clickAt(`[...document.querySelectorAll("main button")].find((b) => b.querySelector("[data-search-engine]"))`);
		await until(`document.querySelectorAll("[data-search-engine]").length >= 5`);
		await pause(700);
		await shot(`${theme}_01_地址栏搜索引擎`);
		const engines = await app.evaluate<Record<string, { w: number; h: number; drawn: boolean }>>(MEASURE("body", "data-search-engine"));
		check(`${theme}: 四个搜索引擎图标各占 16×16 并画出了官方路径`, ["google", "bing", "baidu", "duckduckgo"].every((k) => engines[k]?.w === 16 && engines[k]?.h === 16 && engines[k]?.drawn), engines);
		await key("Escape", 27);
		await pause(400);

		await clickAt(byText("nav button", "代码托管"));
		await until(`document.querySelectorAll("[data-forge-mark], main svg.text-\\\\[\\\\#24292f\\\\]").length >= 4`);
		await pause(600);
		await shot(`${theme}_02_代码托管`);
		const forges = await app.evaluate<{ marks: string[]; github: string; page: string }>(`(() => {
			const github = document.querySelector("main svg.text-\\\\[\\\\#24292f\\\\]");
			return { marks: [...document.querySelectorAll("[data-forge-mark]")].map((el) => el.getAttribute("data-forge-mark") + ":" + Math.round(el.getBoundingClientRect().width)), github: github ? getComputedStyle(github).color : "none", page: getComputedStyle(document.querySelector("main")).backgroundColor };
		})()`);
		const expected = theme === "dark" ? "rgb(240, 246, 252)" : "rgb(36, 41, 47)";
		check(`${theme}: GitLab/Gitee/Gitea 各自的标志，13px`, ["gitlab:13", "gitee:13", "gitea:13"].every((m) => forges.marks.includes(m)), forges.marks);
		check(`${theme}: GitHub 标志跟应用主题走（系统配色故意设成相反）`, forges.github === expected, { github: forges.github, expected });

		await clickAt(byText("nav button", "模型设置"));
		await until(q("[data-ly-model-list]"));
		await pause(700);
		await shot(`${theme}_03_模型设置_全品牌`);
		const models = await app.evaluate<Record<string, { w: number; drawn: boolean; images: number; decoded: number | null; which: string[] }>>(MEASURE("[data-ly-model-list]", "data-model-brand"));
		const brands = ["kimi", "doubao", "minimax", "stepfun", "baichuan", "yi", "claude", "openai", "deepseek", "gemini", "qwen", "grok", "mistral", "hunyuan"];
		check(`${theme}: 14 个品牌都认出来了（step-3 不再是豆包）`, brands.every((b) => models[b]), Object.keys(models));
		check(`${theme}: 位图品牌显示的那张都能解码（豆包、百川、零一、Kimi）`, ["doubao", "baichuan", "yi", "kimi"].every((b) => models[b]?.images === 1 && (models[b]?.decoded ?? 0) > 0), Object.fromEntries(["doubao", "baichuan", "yi", "kimi"].map((b) => [b, models[b]])));
		check(`${theme}: Kimi 显示的是${theme === "dark" ? "深色" : "浅色"}那一版`, models.kimi?.which[0] === (theme === "dark" ? "hidden dark:inline" : "dark:hidden"), models.kimi?.which);
		check(`${theme}: 矢量品牌都画出来了`, ["minimax", "stepfun", "claude", "openai", "deepseek", "gemini", "qwen", "grok", "mistral", "hunyuan"].every((b) => models[b]?.drawn), null);

		await clickAt(`[...document.querySelectorAll("button")].find((b) => (b.textContent || "").includes("返回工作区"))`);
		await until(`[...document.querySelectorAll("button.ly-composer-control[aria-haspopup=menu]")].find((b) => b.querySelector("[data-model-brand]"))`);
		await pause(600);
		await clickAt(`[...document.querySelectorAll("button.ly-composer-control[aria-haspopup=menu]")].find((b) => b.querySelector("[data-model-brand]"))`);
		await until(`document.querySelectorAll("[role=menuitem] [data-model-brand]").length >= 14`);
		await pause(700);
		await shot(`${theme}_04_输入框模型菜单`);
		const menu = await app.evaluate<number>(`document.querySelectorAll("[role=menuitem] [data-model-brand]").length`);
		check(`${theme}: 输入框的模型菜单里 14 个图标`, menu >= 14, menu);
		await key("Escape", 27);
		await pause(400);

		if (theme === "light") {
			await clickAt(`[...document.querySelectorAll("button, a")].find((b) => (b.textContent || "").trim() === "插件")`);
			const loaded = await (async () => {
				for (let i = 0; i < 150; i++) {
					const n = await app!.evaluate<number>(`document.querySelectorAll("main img").length`);
					if (n >= 6) return n;
					await pause(200);
				}
				return 0;
			})();
			await pause(2500);
			const market = await app.evaluate<{ total: number; broken: string[] }>(`(() => {
				const imgs = [...document.querySelectorAll("main img")];
				return { total: imgs.length, broken: imgs.filter((img) => img.complete && img.naturalWidth === 0).map((img) => (img.alt || "") + " " + (img.currentSrc || img.src).slice(0, 80)) };
			})()`);
			await shot(`${theme}_05_插件市场`);
			check("插件市场的 logo 没有碎图", loaded > 0 && market.broken.length === 0, market);
		}
		release();
	} finally {
		await stop();
		await app.stop();
		app = undefined;
	}
}

await mkdir(OUT, { recursive: true });
try {
	await runTheme("light");
	await runTheme("dark");
} finally {
	if (app) await app.stop();
}
const passed = checks.filter((c) => c.ok).length;
await encode(frames, join(OUT, `${STAMP}_官方图标_${passed}of${checks.length}.mp4`), 12, 1500);
console.log(`\n${passed}/${checks.length} passed → ${OUT}`);
process.exitCode = passed === checks.length ? 0 : 1;
