/* oxlint-disable no-console -- a probe CLI whose entire output is what it printed */

/**
 * 模型设置页上那两个新按钮，在真窗口里跑一遍。
 *
 * 三件事只有真窗口能回答：新增的两个图标跟旁边那颗刷新按钮是不是同一副长相（间距、尺寸、色值），
 * 导出前的警告是不是真的挡在下载前面，以及导入的那张预览表把「新增」和「覆盖」分没分对——最后
 * 一条尤其重要，因为一份从另一台机器带来的文件里，多数条目是覆盖而不是新增，而这两件事在 JSON
 * 里长得一模一样。
 *
 * 导出那一步只按到确认框为止：真按下去会弹系统的保存对话框，它是原生的，CDP 打不开也关不掉。
 *
 * 用法：node --experimental-strip-types e2e/provider-transfer-probe.ts [输出目录]
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { startApp } from "./app.ts";

const out = process.argv[2] ?? join(process.env.HOME ?? "/tmp", "Desktop", "lyra-供应商导入导出");
const PORT = 9497;
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function provider(id: string, name: string, key: string, models: string[]) {
	return {
		id,
		name,
		baseUrl: `https://${id}.example.com/api`,
		api: "anthropic-messages",
		apiKey: key,
		enabled: true,
		models: models.map((modelId) => ({
			id: `${id}/${modelId}`,
			providerId: id,
			modelId,
			name: modelId,
			contextWindow: 1_000_000,
			maxOutputTokens: 32_768,
			supportsThinking: true,
			supportsImages: false,
			supportsTools: true,
		})),
	};
}

const HERE = [
	provider("glm", "GLM", "sk-glm-local", ["glm-5.3", "glm-5.3-flash"]),
	provider("deer", "Deer", "sk-deer-local", ["deer-2"]),
	provider("xiaoji", "xiaojiGpt", "sk-xiaoji-local", ["xiaoji-pro"]),
];

/** 从「另一台机器」带来的文件：一条覆盖、一条新增，外加一条被人手工抹掉密钥的。 */
const FILE = {
	kind: "lyra.providers",
	version: 1,
	exportedAt: new Date().toISOString(),
	containsSecrets: true,
	providers: [
		{ ...provider("glm", "GLM（另一台）", "sk-glm-remote", ["glm-5.3", "glm-6"]) },
		{ ...provider("deer", "Deer", "", ["deer-2"]) },
		{ ...provider("relay", "中转", "sk-relay", ["gpt-5.6-terra"]) },
	],
};

async function seed(home: string): Promise<void> {
	const project = join(home, "proj");
	await mkdir(project, { recursive: true });
	await writeFile(join(project, "readme.md"), "# probe\n");
	await writeFile(join(home, "window.json"), JSON.stringify({ width: 1360, height: 980, x: 0, y: 0 }));
	await writeFile(
		join(home, "settings.json"),
		JSON.stringify({
			version: 1,
			providers: HERE,
			defaultModelId: "glm/glm-5.3-flash",
			mcpServers: [],
			projects: [{ id: "e2e", name: "proj", path: project, pinned: true, lastOpenedAt: 1 }],
			permissionMode: "auto",
			thinking: "high",
			retryAttempts: 3,
			hooks: [],
			scheduledTasks: [],
			disabledPlugins: [],
			alwaysAllow: [],
			sync: { enabled: false, port: 4531, token: null },
		}),
	);
}

const app = await startApp({ port: PORT, seed });

async function shot(name: string): Promise<void> {
	const { data } = await app.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
	await writeFile(join(out, name), Buffer.from(data, "base64"));
	console.log(`  → ${name}`);
}

try {
	await mkdir(out, { recursive: true });
	await pause(2600);
	await app.evaluate(`(() => { const e = document.querySelector(".ly-sidebar-foot button"); if (e) e.click(); })()`);
	await pause(1500);
	await app.evaluate(`(() => {
		const nav = [...document.querySelectorAll("nav button")].find((b) => b.innerText.trim() === "模型设置");
		if (nav) nav.click();
	})()`);
	await pause(900);

	console.log(`\n出图到 ${out}`);
	await shot("01-模型设置.png");

	// 三颗按钮的几何：新来的两颗要跟那颗刷新是同一副长相，中间那道竖线把两件事分开。
	const geometry = await app.evaluate<Record<string, unknown>>(`(() => {
		const head = document.querySelector("header");
		const buttons = [...head.querySelectorAll("button")].map((b) => {
			const r = b.getBoundingClientRect();
			const s = getComputedStyle(b);
			return { tip: b.getAttribute("data-ly-tip"), w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x), color: s.color, radius: s.borderRadius };
		});
		const rule = head.querySelector("span[aria-hidden]");
		const rr = rule ? rule.getBoundingClientRect() : null;
		const gaps = buttons.slice(1).map((b, i) => Math.round(b.x - (buttons[i].x + buttons[i].w)));
		return { buttons, gaps, rule: rr ? { w: Math.round(rr.width), h: Math.round(rr.height) } : null };
	})()`);
	console.log("\n按钮几何：");
	console.log(JSON.stringify(geometry, null, 2));

	/*
	 * 导出：警告要挡在下载前面，写出来的东西还得是能读回来的。
	 *
	 * 真按下去会弹系统的保存对话框——原生的，CDP 打不开也关不掉——所以这里把锚点的 click 换掉，
	 * 接住那个 blob 自己读。拦的是「保存到哪」，不是「导出做了什么」：blob 已经建好了，内容就是
	 * 会落到磁盘上的那份。
	 */
	// blob 本身留一份：`fetch("blob:…")` 在这个窗口里过不去，而手里有 Blob 就直接读得到。
	await app.evaluate(`(() => {
		window.__caught = null;
		const make = URL.createObjectURL.bind(URL);
		URL.createObjectURL = (blob) => { window.__blob = blob; return make(blob); };
		HTMLAnchorElement.prototype.click = function () { window.__caught = { href: this.href, name: this.download }; };
	})()`);
	await app.evaluate(`(() => {
		const b = [...document.querySelectorAll("header button")].find((x) => (x.getAttribute("data-ly-tip") ?? "").includes("导出"));
		if (b) b.click();
	})()`);
	await pause(600);
	await shot("02-导出前的警告.png");
	const warning = await app.evaluate<string>(
		`(() => { const d = document.querySelector("[data-dialog-title]"); return d ? d.parentElement.innerText : "(没有确认框)"; })()`,
	);
	console.log(`\n导出确认框：\n${warning}\n`);

	await app.evaluate(`(() => { const b = [...document.querySelectorAll("button")].find((x) => x.innerText.trim() === "导出"); if (b) b.click(); })()`);
	await pause(700);
	const written = await app.evaluate<{ name: string; text: string }>(`(async () => {
		if (!window.__caught || !window.__blob) return { name: "(没有触发下载)", text: "" };
		return { name: window.__caught.name, text: await window.__blob.text() };
	})()`);
	console.log(`导出的文件：${written.name}`);
	const parsed = written.text ? (JSON.parse(written.text) as { kind: string; containsSecrets: boolean; providers: { id: string; apiKey: string }[] }) : null;
	console.log(
		parsed
			? `  kind=${parsed.kind} containsSecrets=${parsed.containsSecrets} providers=${parsed.providers.map((one) => `${one.id}:${one.apiKey || "(空)"}`).join(" ")}`
			: "  (空)",
	);
	await pause(500);

	/*
	 * 导入：把文件塞进那个隐藏的 input。
	 *
	 * `input.files` 只能用 `DataTransfer` 赋值，而 React 监听的是原生 change——所以事件要冒泡，
	 * 否则委派在根节点上的处理器收不到。文本用 JSON 送进去，免得反引号在模板串里被提前吃掉。
	 */
	const payload = JSON.stringify(JSON.stringify(FILE, null, "\t"));
	await app.evaluate(`(() => {
		const input = document.querySelector('input[type="file"][accept*="json"]');
		if (!input) return "没有找到文件输入框";
		const file = new File([${payload}], "lyra-providers.json", { type: "application/json" });
		const dt = new DataTransfer();
		dt.items.add(file);
		input.files = dt.files;
		input.dispatchEvent(new Event("change", { bubbles: true }));
		return "已投喂";
	})()`);
	await pause(900);
	await shot("03-导入预览.png");

	const plan = await app.evaluate<Record<string, unknown>>(`(() => {
		const rows = [...document.querySelectorAll("label")].filter((l) => l.querySelector("[data-ly-tip]"));
		return {
			rows: rows.map((l) => l.innerText.replace(/\\s+/g, " ").trim()),
			footer: (document.body.innerText.match(/新增 \\d+ 个，覆盖 \\d+ 个/) ?? ["(没找到)"])[0],
		};
	})()`);
	console.log("导入预览的每一行：");
	console.log(JSON.stringify(plan, null, 2));

	await app.evaluate(`(() => { const b = [...document.querySelectorAll("button")].find((x) => x.innerText.includes("导入 ")); if (b) b.click(); })()`);
	await pause(1400);
	await shot("04-导入之后.png");

	/*
	 * 落盘的才算数——但密钥不在这个文件里。
	 *
	 * `saveSettings` 会把每个 apiKey 抽进保险箱、往文件里填空字符串（见 `config/settings.ts`），
	 * 所以这里能核对的是名字、模型和默认模型；密钥得去窗口里问。
	 */
	const saved = JSON.parse(await readFile(join(app.home, "settings.json"), "utf8")) as {
		providers: { id: string; name: string; apiKey: string; models: { id: string }[] }[];
		defaultModelId: string | null;
	};
	console.log("\n落盘之后（密钥在保险箱里，文件里一律是空的）：");
	for (const one of saved.providers) {
		console.log(`  ${one.id.padEnd(8)} name=${one.name.padEnd(12)} models=${one.models.map((m) => m.id).join(",")}`);
	}
	console.log(`  defaultModelId=${saved.defaultModelId}`);

	// 表单里显示的密钥：覆盖的那个要换成文件里的，被抹掉密钥的那个要保住本机原来的。
	console.log("\n窗口里的 API Key：");
	for (const name of ["GLM", "Deer", "xiaojiGpt", "中转"]) {
		const shown = await app.evaluate<string>(`(async () => {
			const row = [...document.querySelectorAll("button")].find((b) => b.className.includes("ly-scroll") && b.innerText.trim().startsWith(${JSON.stringify(name)}));
			if (!row) return "(列表里没有这一条)";
			row.click();
			await new Promise((r) => setTimeout(r, 400));
			const input = document.querySelector('input[autocomplete="off"][type="password"], input[autocomplete="off"][type="text"]');
			return input ? (input.value || "(空)") : "(没有找到输入框)";
		})()`);
		console.log(`  ${name.padEnd(10)} ${shown}`);
	}
	console.log("");
} finally {
	await app.stop();
}
