/**
 * 这次改动的样子，拍下来。
 *
 * `node --experimental-strip-types e2e/appearance-inline-code-demo.ts [目录]`
 *
 * 断言归 `appearance-inline-code-probe.ts`，这个文件只管产物：同一句话在三种配色下各一张，
 * 界面字重轻重各一张，外观页上新增的那几行一张，代码托管页收拾完一张。
 *
 * 分成两个文件而不是给探针加个截图参数，是因为两者失败的含义不同——探针红了是功能坏了，这里
 * 少一张图只是少一张图。混在一起，一次截图失败会读成一次功能回归。
 */

import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { startApp } from "./app.ts";

const outDir = process.argv[2] ?? join(homedir(), "Desktop", "行内代码配色测试");
const home = "/tmp/lyra-inline-demo";
const project = join(home, "proj");

async function seed(dir: string): Promise<void> {
	await mkdir(project, { recursive: true });
	await writeFile(join(dir, "window.json"), JSON.stringify({ width: 1280, height: 860, x: 0, y: 0 }));
	await writeFile(
		join(dir, "settings.json"),
		JSON.stringify({
			version: 1,
			providers: [],
			mcpServers: [],
			projects: [{ id: "e2e", name: "proj", path: project, pinned: true, lastOpenedAt: 1 }],
			defaultModelId: null,
			permissionMode: "auto",
			thinking: "medium",
			retryAttempts: 3,
			hooks: [],
			scheduledTasks: [],
			disabledPlugins: [],
			alwaysAllow: [],
			sync: { enabled: false, port: 4535, token: null },
			appearance: { theme: "light", codeLightTheme: "solarized-light", codeDarkTheme: "github-dark" },
		}),
	);

	const projectId = createHash("sha256").update(project).digest("hex").slice(0, 16);
	await mkdir(join(dir, "sessions", projectId), { recursive: true });
	const meta = {
		id: "inline",
		title: "行内代码",
		cwd: project,
		projectId,
		projectName: "proj",
		createdAt: 1,
		updatedAt: 2,
		modelId: "none",
		messageCount: 2,
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			total: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		seq: 3,
	};
	/* 用户截图里那一段的形状：一段话里挂着分支名、提交号、路径，底下跟一个围栏块作对照。 */
	const reply = [
		"当前工作区所有改动已全部验证、提交并推送到远端分支 `origin/codex/city-scene-rebuild`（最新 Commit：`f36a74b`）。",
		"",
		"改动落在 `packages/core/src/config/settings.ts` 和 `packages/desktop/src/styles/markdown.css` 两处，",
		"跑 `pnpm test && pnpm run build` 通过。",
		"",
		"```bash",
		"git log --oneline -1",
		"# f36a74b feat: 行内代码支持自定义配色",
		"```",
	].join("\n");
	const lines = [
		JSON.stringify({ seq: 1, ts: 1, type: "meta", meta }),
		JSON.stringify({
			seq: 2,
			ts: 2,
			type: "message",
			message: { role: "user", content: [{ type: "text", text: "提交并推送所有代码" }], timestamp: 2 },
		}),
		JSON.stringify({
			seq: 3,
			ts: 3,
			type: "message",
			message: { role: "assistant", content: [{ type: "text", text: reply }], timestamp: 3 },
		}),
	];
	await writeFile(join(dir, "sessions", projectId, "inline.jsonl"), `${lines.join("\n")}\n`);
	await writeFile(join(dir, "sessions", "index.json"), JSON.stringify([meta], null, 2));
}

const app = await startApp({ port: 9489, seed });
const settle = (ms = 800) => new Promise((resolve) => setTimeout(resolve, ms));

async function shot(name: string): Promise<void> {
	const { data } = await app.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
	await writeFile(join(outDir, `${name}.png`), Buffer.from(data, "base64"));
	process.stdout.write(`  · ${name}.png\n`);
}

/** 用真实鼠标点开会话行。 */
async function openSession(): Promise<void> {
	const at = await app.evaluate<{ x: number; y: number } | null>(`(() => {
		const row = [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("行内代码"));
		if (!row) return null;
		const box = row.getBoundingClientRect();
		return { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) };
	})()`);
	if (!at) return;
	await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...at });
	for (const type of ["mousePressed", "mouseReleased"]) {
		await app.send("Input.dispatchMouseEvent", { type, ...at, button: "left", clickCount: 1 });
	}
	await settle(1700);
}

const openSettings = (section: string) =>
	app.evaluate<boolean>(`(async () => {
		const wait = (ms) => new Promise((r) => setTimeout(r, ms));
		const hit = (text) => {
			const el = [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === text);
			el?.click();
			return Boolean(el);
		};
		if (!hit(${JSON.stringify(section)})) {
			document.querySelector(".ly-sidebar-foot button")?.click();
			await wait(1300);
			if (!hit(${JSON.stringify(section)})) return false;
		}
		await wait(1000);
		return true;
	})()`);

const backToWorkspace = () =>
	app.evaluate(`(async () => {
		const wait = (ms) => new Promise((r) => setTimeout(r, ms));
		[...document.querySelectorAll("button")].find((b) => b.textContent?.includes("返回工作区"))?.click();
		await wait(1500);
	})()`);

/**
 * 改一项外观设置，走真实的保存路径。
 *
 * 不是往 DOM 上写样式——那只能证明浏览器会画颜色。这一趟要过主进程、落盘、广播回来、再由
 * `applyAppearance` 写成变量，拍到的才是用户改完设置之后看见的那张画面。
 */
const patchAppearance = (patch: Record<string, unknown>) =>
	app.evaluate(`(async () => {
		const wait = (ms) => new Promise((r) => setTimeout(r, ms));
		const settings = await window.lyra.settings.get();
		await window.lyra.settings.save({
			...settings,
			appearance: { ...settings.appearance, ...${JSON.stringify(patch)} },
		});
		await wait(1200);
	})()`);

try {
	await mkdir(outDir, { recursive: true });
	await settle(2600);
	await openSession();

	process.stdout.write("行内代码，三种配色：\n");
	await patchAppearance({ inlineCode: "app" });
	await shot("1-行内代码-跟界面（默认，改动前的样子）");

	await patchAppearance({ inlineCode: "syntax" });
	await shot("2-行内代码-跟代码主题（Solarized Light）");

	await patchAppearance({
		inlineCode: "custom",
		inlineCodeLightBg: "#FFF1E0",
		inlineCodeLightFg: "#B34700",
		inlineCodeBorder: false,
	});
	await shot("3-行内代码-自定义配色");

	await patchAppearance({ inlineCodeBorder: true });
	await shot("4-行内代码-自定义配色加描边");

	/* 只改文字色、底色留白，这是描边那个开关存在的理由。 */
	await patchAppearance({ inlineCodeLightBg: "#FFFFFF", inlineCodeLightFg: "#C2410C" });
	await shot("5-行内代码-只要字色不要底色，靠描边分界");

	/*
	 * 字重的对照拍在设置页上，不拍在对话里。
	 *
	 * 那一页上四级层次同时在场：页标题（display + semibold）、分节标题、每行的名字（medium）、
	 * 名字底下那行小字。要看的正是「基准提上去之后这四级还分不分得开」——PingFang 只到 600，
	 * 基准 500 时 +100 和 +200 会落到同一档，这是认过的账，但得看得见它到底像什么样。
	 */
	process.stdout.write("界面字重：\n");
	await patchAppearance({ inlineCode: "app", inlineCodeBorder: false });
	await openSettings("外观");
	await settle(1200);
	await patchAppearance({ uiFontWeight: 400 });
	await shot("6-界面字重-400（改动前的默认，偏细）");
	await patchAppearance({ uiFontWeight: 500 });
	await shot("7-界面字重-500（新默认）");
	await patchAppearance({ uiFontWeight: 300 });
	await shot("8-界面字重-300（最细那一档）");
	await patchAppearance({ uiFontWeight: 500 });

	process.stdout.write("设置页：\n");
	await settle(1000);
	/* 把「代码外观」那张卡片滚进视野——新增的几行在它下半截。 */
	await app.evaluate(`(async () => {
		const wait = (ms) => new Promise((r) => setTimeout(r, ms));
		document.querySelector("[data-ly-code-appearance]")?.scrollIntoView({ block: "center" });
		await wait(900);
	})()`);
	await shot("9-外观设置-行内代码那几行和预览");

	/*
	 * 这两张走真实输入，不走 patchAppearance。
	 *
	 * 「改底色字色自动跟上」这件事是写在设置页那个 onChange 里的，绕过界面直接写设置就把它绕过去了
	 * ——拍出来的是我自己配好的一对颜色，不是界面算出来的那一对。要证明的恰恰是界面会算。
	 */
	const typeInto = (which: string, value: string) =>
		app.evaluate(`(async () => {
			const wait = (ms) => new Promise((r) => setTimeout(r, ms));
			const card = document.querySelector("[data-ly-code-appearance]");
			const input = [...card.querySelectorAll("input")].find((i) => i.getAttribute("aria-label")?.includes(${JSON.stringify(which)}));
			if (!input) return false;
			const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
			setter.call(input, ${JSON.stringify(value)});
			input.dispatchEvent(new Event("input", { bubbles: true }));
			await wait(1400);
			card.scrollIntoView({ block: "center" });
			await wait(600);
			return true;
		})()`);

	/*
	 * 先把这一对摆回出厂那一对，也就是「字色还是自动的」那个状态。
	 *
	 * 上面第 5 张为了演示「只要字色不要底色」手填过一个 #C2410C，界面据此认定字色被人动过，之后
	 * 改底色就不再碰它——那是对的，但接下来要拍的正是「会跟」。不重置的话拍出来的三张图标题说着
	 * 跟随、画面里纹丝不动。
	 */
	await patchAppearance({ inlineCodeLightBg: "#F4F4F5", inlineCodeLightFg: "#1C1C21" });

	await app.evaluate(`(async () => {
		const wait = (ms) => new Promise((r) => setTimeout(r, ms));
		const card = document.querySelector("[data-ly-code-appearance]");
		[...(card?.querySelectorAll("button") ?? [])].find((b) => b.textContent?.trim() === "自定义…")?.click();
		await wait(700);
		card?.scrollIntoView({ block: "center" });
		await wait(700);
	})()`);
	await shot("10-外观设置-自定义时展开的两个颜色");

	await typeInto("底色", "#FFE8CC");
	await shot("10a-改底色为浅橙，字色自动跟成深棕");
	await typeInto("底色", "#1A1A1A");
	await shot("10b-底色改成深的，字色自动翻到浅的那头");
	await typeInto("字色", "#4ADE80");
	await shot("10c-手动指定字色之后，它就固定了");

	await app.evaluate(`(async () => {
		const wait = (ms) => new Promise((r) => setTimeout(r, ms));
		[...document.querySelectorAll("div")]
			.find((d) => d.innerText?.trim().startsWith("UI 字重"))
			?.scrollIntoView({ block: "center" });
		await wait(900);
	})()`);
	await shot("11-外观设置-UI 字重");

	await openSettings("代码托管");
	await settle(1100);
	await shot("12-代码托管-收拾干净之后");

	await backToWorkspace();
	process.stdout.write(`\n都在 ${outDir}\n`);
} finally {
	await app.stop();
}
