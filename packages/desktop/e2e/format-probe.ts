/**
 * Does 代码格式化 actually format, and does 代码外观 actually reach the three surfaces that draw code?
 *
 * `node --experimental-strip-types e2e/format-probe.ts [dir]`
 *
 * Both halves are things that were previously claimed and not shown. The appearance settings wrote
 * five CSS variables and two of them were read by nobody; the terminal read four of them once, at
 * construction, and never again. So the measurements here are taken from the real rendered
 * elements in a real window — computed styles off the live DOM, and the terminal's own row count,
 * which changes only if the cell was genuinely re-measured.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { startApp } from "./app.ts";

const dir = process.argv[2] ?? "/tmp/lyra-format";
const project = join(dir, "proj");

/** Deliberately ill-formatted, and valid. Formatting it must change it. */
const UGLY = `const routes=[{path:"/",name:'home'},{path:"/about",name:'about'}]
export  function resolve( name,fallback=null ){
const match=routes.find((route)=>route.name===name)
return match??fallback
}
`;

async function seed(home: string): Promise<void> {
	await mkdir(project, { recursive: true });
	await writeFile(join(project, "messy.ts"), UGLY);
	await writeFile(join(home, "window.json"), JSON.stringify({ width: 1240, height: 860, x: 0, y: 0 }));
	await writeFile(
		join(home, "settings.json"),
		JSON.stringify({
			version: 1,
			providers: [],
			mcpServers: [],
			projects: [{ path: project, pinned: false, lastOpenedAt: Date.now() }],
			defaultModelId: null,
			permissionMode: "auto",
			thinking: "medium",
			retryAttempts: 3,
			hooks: [],
			scheduledTasks: [],
			disabledPlugins: [],
			pluginRegistries: [],
			skillRegistries: [],
			alwaysAllow: [],
			sync: { enabled: false, port: 4519, token: null },
			editor: { defaultOpenTarget: "Zed", showBottomPanel: true },
			appearance: { theme: "dark", codeFontSize: 12, codeFontWeight: 400, codeLineHeight: 1.6, codeLetterSpacing: 0 },
		}),
	);
}

const app = await startApp({ port: 9473, seed });
const settle = (ms = 700) => new Promise((resolve) => setTimeout(resolve, ms));
const shoot = async (name: string) => {
	const shot = await app.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
	await writeFile(join(dir, `${name}.png`), Buffer.from(shot.data, "base64"));
};

let failures = 0;
function check(label: string, passed: boolean, evidence: string): void {
	if (!passed) failures++;
	process.stdout.write(`${passed ? "✓" : "✗"} ${label}\n    ${evidence}\n`);
}

try {
	await mkdir(dir, { recursive: true });
	await settle(2200);

	/* ---------- 1. 代码外观 reaches every surface that draws code ---------- */

	/**
	 * Read back what each surface is *actually* rendering with.
	 *
	 * Computed styles off elements that exist, not off a probe element built for the occasion —
	 * an injected `<pre class="prose-dw">` inherits the same variables and would pass even if
	 * nothing in the app used them, which is exactly the mistake that left this unverified before.
	 */
	const measure = `(() => {
		const out = {};
		const root = getComputedStyle(document.documentElement);
		out.vars = {
			size: root.getPropertyValue("--ly-code-size").trim(),
			weight: root.getPropertyValue("--ly-code-weight").trim(),
			line: root.getPropertyValue("--ly-code-line-height").trim(),
			track: root.getPropertyValue("--ly-code-tracking").trim(),
		};
		const cm = document.querySelector(".cm-content");
		if (cm) {
			const s = getComputedStyle(cm);
			out.editor = { size: s.fontSize, weight: s.fontWeight, tracking: s.letterSpacing };
			const sc = document.querySelector(".cm-scroller");
			if (sc) out.editor.line = getComputedStyle(sc).lineHeight;
		}
		const rows = document.querySelector(".xterm-rows");
		if (rows) {
			const s = getComputedStyle(rows);
			// The row count is the load-bearing number: it changes only if xterm re-measured the
			// cell and refitted, which is the whole claim being tested.
			out.terminal = { size: s.fontSize, weight: s.fontWeight, rows: rows.childElementCount, height: rows.clientHeight };
		}
		return out;
	})()`;

	type Measured = {
		vars: { size: string; weight: string; line: string; track: string };
		editor?: { size: string; weight: string; tracking: string; line?: string };
		terminal?: { size: string; weight: string; rows: number; height: number };
	};

	/*
	 * Into the files pane, then into the file — the same two clicks a person makes.
	 *
	 * Via the dock's panel menu, because there is no tab strip: which panes exist is chosen from
	 * that menu. `files.test.ts` opens it the same way.
	 */
	await app.evaluate(`(async () => {
		const wait = (ms) => new Promise((r) => setTimeout(r, ms));
		if (!document.querySelector("[data-ly-tree]")) {
			document.querySelector('button[aria-label="面板"]')?.click();
			await wait(200);
			const item = [...document.querySelectorAll('[role="menuitem"]')].find((b) => b.innerText.trim().startsWith("文件"));
			item?.click();
			await wait(900);
		}
		const row = [...document.querySelectorAll("[data-ly-tree] *")].find((el) => el.textContent?.trim() === "messy.ts" && el.children.length === 0);
		row?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		await wait(300);
		row?.closest("[role=treeitem],button,div")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		return Boolean(row);
	})()`);
	await settle(1800);
	// The terminal pane too, since it is the surface that was genuinely broken.
	await app.evaluate(`(async () => {
		const wait = (ms) => new Promise((r) => setTimeout(r, ms));
		if (!document.querySelector(".xterm-rows")) {
			document.querySelector('button[aria-label="面板"]')?.click();
			await wait(200);
			const item = [...document.querySelectorAll('[role="menuitem"]')].find((b) => b.innerText.trim().startsWith("终端"));
			item?.click();
			await wait(1200);
		}
		return Boolean(document.querySelector(".xterm-rows"));
	})()`);
	await settle(1500);

	const before = await app.evaluate<Measured>(measure);
	await shoot("01-before");
	process.stdout.write(`起始：${JSON.stringify(before)}\n\n`);

	/*
	 * Driven through the settings page itself.
	 *
	 * Reaching into the store would test that the CSS variables follow a settings object, which was
	 * never in doubt. What was in doubt is whether the controls on that page reach the surfaces —
	 * so the controls are what gets used.
	 */
	await app.evaluate(`(() => {
		document.querySelector("[data-ly-open-settings]")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		return true;
	})()`);
	await settle(1100);
	await app.evaluate(`(() => {
		const hit = [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "外观");
		hit?.click();
		return Boolean(hit);
	})()`);
	await settle(900);

	/** Set a number field by its accessible name, the way typing into it would. */
	const setNumber = async (label: string, value: number) =>
		app.evaluate<boolean>(`(() => {
			const input = document.querySelector('input[aria-label=${JSON.stringify(label)}]');
			if (!input) return false;
			const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
			setter.call(input, ${JSON.stringify(String(value))});
			input.dispatchEvent(new Event("input", { bubbles: true }));
			input.dispatchEvent(new Event("change", { bubbles: true }));
			return true;
		})()`);

	const fields = await app.evaluate<string[]>(
		`[...document.querySelectorAll("input[aria-label]")].map((i) => i.getAttribute("aria-label"))`,
	);
	process.stdout.write(`外观页上的数值输入：${JSON.stringify(fields)}\n`);

	await setNumber("代码字体大小", 19);
	await settle(400);
	await setNumber("字重", 700);
	await settle(400);
	await setNumber("行高", 1.8);
	await settle(400);
	await setNumber("字距", 0.08);
	await settle(1400);
	await shoot("02-settings");

	// Back to the file, where the editor and the terminal are. Via 返回工作区 — Escape does not
	// close this page, which is why the first run measured the settings panel and found no editor.
	await app.evaluate(`(() => {
		const hit = [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "返回工作区");
		hit?.click();
		return Boolean(hit);
	})()`);
	await settle(2000);

	const after = await app.evaluate<Measured>(measure);
	await shoot("03-after");
	process.stdout.write(`\n改后：${JSON.stringify(after)}\n\n`);

	check(
		"CSS 变量跟着设置走",
		after.vars.size !== before.vars.size && after.vars.weight !== before.vars.weight,
		`${JSON.stringify(before.vars)} → ${JSON.stringify(after.vars)}`,
	);
	check(
		"编辑器的字号跟着变",
		Boolean(before.editor && after.editor && before.editor.size !== after.editor.size),
		`${before.editor?.size} → ${after.editor?.size}`,
	);
	check(
		"编辑器的字重跟着变（这条以前是断的）",
		Boolean(before.editor && after.editor && before.editor.weight !== after.editor.weight),
		`${before.editor?.weight} → ${after.editor?.weight}`,
	);
	check(
		"编辑器的字间距跟着变（这条以前是断的）",
		Boolean(before.editor && after.editor && before.editor.tracking !== after.editor.tracking),
		`${before.editor?.tracking} → ${after.editor?.tracking}`,
	);
	check(
		"编辑器的行高跟着变",
		Boolean(before.editor?.line && after.editor?.line && before.editor.line !== after.editor.line),
		`${before.editor?.line} → ${after.editor?.line}`,
	);
	if (before.terminal && after.terminal) {
		check(
			"终端的字号跟着变（以前只在构造时读一次）",
			before.terminal.size !== after.terminal.size,
			`${before.terminal.size} → ${after.terminal.size}`,
		);
		check(
			"终端重新排了行数——说明真的重新量了字符格",
			before.terminal.rows !== after.terminal.rows,
			`${before.terminal.rows} 行 → ${after.terminal.rows} 行`,
		);
	} else {
		process.stdout.write(`— 终端不在当前布局里，跳过（before=${JSON.stringify(before.terminal)}）\n`);
	}

	/* ---------- 2. 格式化 ---------- */

	const textOf = () => app.evaluate<string>(`document.querySelector(".cm-content")?.innerText ?? ""`);
	const original = await textOf();

	/*
	 * ⇧⌥F as a real key, through the browser's input pipeline.
	 *
	 * A synthesised `KeyboardEvent` is not enough: CodeMirror derives the binding name from
	 * `code` and the modifier state the way the platform reports them, and a hand-built event
	 * arrives without the untrusted-event handling that its keymap relies on. `Input.dispatchKeyEvent`
	 * is the same path a keypress takes, so this tests the shortcut rather than a stand-in for it.
	 */
	await app.evaluate(`(() => { document.querySelector(".cm-content")?.focus(); return true; })()`);
	await settle(300);
	// ⌘⇧F on this platform. Meta = 4, Shift = 8.
	for (const type of ["rawKeyDown", "keyUp"]) {
		await app.send("Input.dispatchKeyEvent", {
			type,
			modifiers: 12,
			key: "F",
			code: "KeyF",
			windowsVirtualKeyCode: 70,
			nativeVirtualKeyCode: 70,
		});
	}
	await settle(3000);
	const formatted = await textOf();
	await shoot("04-formatted");

	check(
		"⇧⌘F 真的改写了缓冲区",
		formatted !== original && formatted.length > 0,
		`前 ${original.split("\n")[0]?.slice(0, 44)} … / 后 ${formatted.split("\n")[0]?.slice(0, 44)} …`,
	);
	check(
		"格式化结果是 Prettier 的输出，不是随便动了动",
		formatted.includes('{ path: "/", name: "home" }'),
		JSON.stringify(formatted.split("\n")[0]?.slice(0, 70)),
	);
	check("原文里那种紧贴的写法没了", !formatted.includes('path:"/"'), `仍含 path:"/" = ${formatted.includes('path:"/"')}`);

	process.stdout.write(`\n截图写到 ${dir}\n`);
} finally {
	await app.stop();
}

process.exit(failures === 0 ? 0 : 1);
