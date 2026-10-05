/**
 * 代码高亮主题, across every surface that draws code, in both schemes.
 *
 * `node --experimental-strip-types e2e/code-surface-probe.ts [dir]`
 *
 * The bug this exists for: the theme's `background` and `foreground` were declared in
 * `code-themes.ts`, labelled "preview color", and read by exactly one thing — the swatch on the
 * settings page. So choosing Solarized Light gave you a warm yellow sample and left the editor,
 * the fenced blocks and the terminal on the app's own white. The tokens were themed; the surface
 * they sat on was not, which is the half you actually see.
 *
 * Four surfaces, because they reach the colour four different ways: the editor and the blocks
 * read a CSS variable, the terminal has to be handed literal colours (it paints a canvas), and
 * the diff rows have their own pair. A previous version of this check counted token colours and
 * passed while every background was wrong — so each assertion here names the exact colour the
 * theme declares and fails on anything else.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { startApp } from "./app.ts";

const dir = process.argv[2] ?? "/tmp/lyra-surface";
const project = join(dir, "proj");

const TS = `// 一个注释
export function greet(name: string): string {
	const count = 42;
	return \`Hello, \${name}\`;
}
`;

const MD = `# 说明

\`\`\`ts
export const x: number = 1;
\`\`\`
`;

/** Declared values, restated so the probe compares against `code-themes.ts` rather than itself. */
const THEMES = {
	"solarized-light": { background: "#fdf6e3", foreground: "#657b83" },
	"github-dark": { background: "#0d1117", foreground: "#c9d1d9" },
	"github-light": { background: "#ffffff", foreground: "#24292f" },
	"dracula": { background: "#282a36", foreground: "#f8f8f2" },
};

function rgb(hex: string): string {
	const n = Number.parseInt(hex.slice(1), 16);
	return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}

async function seed(home: string): Promise<void> {
	await mkdir(project, { recursive: true });
	await writeFile(join(project, "sample.ts"), TS);
	await writeFile(join(project, "readme.md"), MD);
	await writeFile(join(home, "window.json"), JSON.stringify({ width: 1300, height: 900, x: 0, y: 0 }));
	await writeFile(
		join(home, "settings.json"),
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
			sync: { enabled: false, port: 4527, token: null },
			appearance: { theme: "light", codeLightTheme: "solarized-light", codeDarkTheme: "github-dark" },
		}),
	);
}

const app = await startApp({ port: 9481, seed });
const settle = (ms = 700) => new Promise((resolve) => setTimeout(resolve, ms));

let failures = 0;
function check(label: string, passed: boolean, evidence: string): void {
	if (!passed) failures++;
	process.stdout.write(`  ${passed ? "✓" : "✗"} ${label}\n      ${evidence}\n`);
}

type Surfaces = {
	scheme: string;
	editor: string;
	gutter: string;
	editorFg: string;
	block: string;
	blockFg: string;
	terminal: string;
	terminalFg: string;
	rootBg: string;
};

const readSurfaces = `(() => {
	const paint = (el, prop) => (el ? getComputedStyle(el)[prop] : "无");
	return {
		scheme: getComputedStyle(document.documentElement).colorScheme,
		editor: paint(document.querySelector(".cm-editor"), "backgroundColor"),
		gutter: paint(document.querySelector(".cm-gutters"), "backgroundColor"),
		editorFg: paint(document.querySelector(".cm-editor"), "color"),
		block: paint(document.querySelector(".prose-dw pre"), "backgroundColor"),
		blockFg: paint(document.querySelector(".prose-dw pre"), "color"),
		// .xterm-scrollable-element is where xterm actually puts the theme background. Not
		// .xterm-viewport — that comes back rgb(0,0,0) whatever the theme says, which is how an
		// earlier run of this probe reported the terminal as broken when it was not.
		terminal: paint(document.querySelector(".xterm-scrollable-element"), "backgroundColor"),
		terminalFg: paint(document.querySelector(".xterm-rows"), "color"),
		rootBg: getComputedStyle(document.documentElement).getPropertyValue("--ly-code-bg").trim(),
	};
})()`;

/** Open the files pane and a file in it. */
const open = (name: string) =>
	app.evaluate(`(async () => {
		const wait = (ms) => new Promise((r) => setTimeout(r, ms));
		if (!document.querySelector("[data-ly-tree]")) {
			document.querySelector('button[aria-label="面板"]')?.click();
			await wait(250);
			[...document.querySelectorAll('[role="menuitem"]')].find((b) => b.innerText.trim().startsWith("文件"))?.click();
			await wait(1100);
		}
		const row = [...document.querySelectorAll("[role=treeitem]")].find((r) => r.getAttribute("data-path")?.endsWith(${JSON.stringify(name)}));
		row?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
		await wait(1600);
		return Boolean(row);
	})()`);

/**
 * Pick a code theme from the 浅色代码高亮 dropdown, by clicking it.
 *
 * A `Dropdown`, not a `<select>`: the trigger is a button labelled with the current theme, and
 * the options are `[role=menuitem]`. Driven through the real control so this exercises the path
 * a person takes rather than a store write.
 */
const pickTheme = (current: string, wanted: string) =>
	app.evaluate<boolean>(`(async () => {
		const wait = (ms) => new Promise((r) => setTimeout(r, ms));
		const trigger = [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === ${JSON.stringify(current)});
		if (!trigger) return false;
		trigger.click();
		await wait(400);
		const option = [...document.querySelectorAll('[role="menuitem"]')].find((b) => b.textContent?.trim() === ${JSON.stringify(wanted)});
		if (!option) return false;
		option.click();
		await wait(400);
		return true;
	})()`);

/**
 * Every surface, measured — which takes two passes.
 *
 * Only one file renders at a time: opening the second unmounts the first. So the fenced block
 * has to be read while the Markdown file is showing and the editor while the .ts is, and a
 * single snapshot of the DOM can never contain both. Reading one snapshot is what made an
 * earlier run report the code block as missing when it was correct.
 */
async function measure(): Promise<Surfaces> {
	await open("readme.md");
	await settle(1500);
	const withBlock = await app.evaluate<Surfaces>(readSurfaces);
	await open("sample.ts");
	await settle(1500);
	const withEditor = await app.evaluate<Surfaces>(readSurfaces);
	return { ...withEditor, block: withBlock.block, blockFg: withBlock.blockFg };
}

try {
	await mkdir(dir, { recursive: true });
	await settle(2400);

	// The three panes that draw code, all open at once so one measurement covers them.
	await open("sample.ts");
	await app.evaluate(`(async () => {
		const wait = (ms) => new Promise((r) => setTimeout(r, ms));
		if (!document.querySelector(".xterm-viewport")) {
			document.querySelector('button[aria-label="面板"]')?.click();
			await wait(250);
			[...document.querySelectorAll('[role="menuitem"]')].find((b) => b.innerText.trim().startsWith("终端"))?.click();
			await wait(1400);
		}
		return true;
	})()`);
	await settle(2000);
	await settle(1500);

	/* ---------- light ---------- */
	const light = await measure();
	const wantLight = THEMES["solarized-light"];
	process.stdout.write(`\n── 浅色：Solarized Light（应为 ${wantLight.background} / ${wantLight.foreground}）──\n`);
	process.stdout.write(`  实测：编辑器 ${light.editor} · 行号槽 ${light.gutter} · 代码块 ${light.block} · 终端 ${light.terminal}\n`);
	check("编辑器背景是主题的背景", light.editor === rgb(wantLight.background), `${light.editor}`);
	check("编辑器前景是主题的前景", light.editorFg === rgb(wantLight.foreground), `${light.editorFg}`);
	check("行号槽不再是应用的白", light.gutter !== "rgb(255, 255, 255)" && light.gutter !== light.editor, `${light.gutter}`);
	check("三反引号代码块背景是主题的背景", light.block === rgb(wantLight.background), `${light.block}`);
	check("代码块前景是主题的前景", light.blockFg === rgb(wantLight.foreground), `${light.blockFg}`);
	check("终端背景是主题的背景", light.terminal === rgb(wantLight.background), `${light.terminal}`);

	const shotLight = await app.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
	await writeFile(join(dir, "01-solarized-light.png"), Buffer.from(shotLight.data, "base64"));

	/* ---------- switch theme without reloading ---------- */
	await app.evaluate(`(() => {
		document.querySelector("[data-ly-open-settings]")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		return true;
	})()`);
	await settle(1100);
	await app.evaluate(`(() => {
		[...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "外观")?.click();
		return true;
	})()`);
	await settle(1000);

	const switched = await pickTheme("Solarized Light", "GitHub Light");
	process.stdout.write(`\n── 换成 GitHub Light（下拉可用：${switched}）──\n`);
	await settle(1400);
	await app.evaluate(`(() => {
		[...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "返回工作区")?.click();
		return true;
	})()`);
	await settle(2200);
	const other = await measure();
	const wantOther = THEMES["github-light"];
	process.stdout.write(`  实测：编辑器 ${other.editor} · 代码块 ${other.block} · 终端 ${other.terminal}\n`);
	check("换主题后编辑器跟着变", other.editor === rgb(wantOther.background), `应为 ${rgb(wantOther.background)}，实为 ${other.editor}`);
	check("换主题后代码块跟着变", other.block === rgb(wantOther.background), `${other.block}`);
	check("换主题后终端跟着变", other.terminal === rgb(wantOther.background), `${other.terminal}`);

	/* ---------- dark, which must not have regressed ---------- */
	await app.evaluate(`(() => {
		document.querySelector("[data-ly-open-settings]")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		return true;
	})()`);
	await settle(1100);
	await app.evaluate(`(() => {
		[...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "外观")?.click();
		return true;
	})()`);
	await settle(1000);
	await app.evaluate(`(() => {
		const hit = [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "深色");
		hit?.click();
		return Boolean(hit);
	})()`);
	await settle(1600);
	await app.evaluate(`(() => {
		[...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "返回工作区")?.click();
		return true;
	})()`);
	await settle(2400);

	const dark = await measure();
	const wantDark = THEMES["github-dark"];
	process.stdout.write(`\n── 深色：GitHub Dark（应为 ${wantDark.background} / ${wantDark.foreground}）──\n`);
	process.stdout.write(`  实测：color-scheme ${dark.scheme} · 编辑器 ${dark.editor} · 代码块 ${dark.block} · 终端 ${dark.terminal}\n`);
	check("深色下 color-scheme 切过来了", dark.scheme === "dark", dark.scheme);
	check("深色下编辑器是深色主题的背景", dark.editor === rgb(wantDark.background), `${dark.editor}`);
	check("深色下代码块是深色主题的背景", dark.block === rgb(wantDark.background), `${dark.block}`);
	check("深色下终端是深色主题的背景", dark.terminal === rgb(wantDark.background), `${dark.terminal}`);

	const shotDark = await app.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
	await writeFile(join(dir, "02-github-dark.png"), Buffer.from(shotDark.data, "base64"));

	process.stdout.write(`\n截图：${dir}\n`);
} finally {
	await app.stop();
}

process.exit(failures === 0 ? 0 : 1);
