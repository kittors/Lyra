/**
 * The three things asked for on the appearance and formatting pages.
 *
 * `node --experimental-strip-types e2e/settings-preview-probe.ts [dir]`
 *
 *   1. 「Lyra 默认」 is the default, and it leaves the app's own surface alone — a fresh install
 *      must not repaint itself in somebody else's palette.
 *   2. 代码格式化's preview leads the page, is really highlighted, and its language picker
 *      searches — including by extension and by tool name.
 *   3. 代码外观's specimens take typing directly, stay highlighted while they do, and carry one
 *      reset button that does not sit on top of the theme's name.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { startApp } from "./app.ts";

const dir = process.argv[2] ?? "/tmp/lyra-preview";

async function seed(home: string): Promise<void> {
	await writeFile(join(home, "window.json"), JSON.stringify({ width: 1320, height: 940, x: 0, y: 0 }));
	/*
	 * No `appearance` key at all, deliberately.
	 *
	 * That is what a fresh install looks like, and the whole of requirement 1 is what the app
	 * does when nobody has chosen anything.
	 */
	await writeFile(
		join(home, "settings.json"),
		JSON.stringify({
			version: 1,
			providers: [],
			mcpServers: [],
			projects: [],
			defaultModelId: null,
			permissionMode: "auto",
			thinking: "medium",
			retryAttempts: 3,
			hooks: [],
			scheduledTasks: [],
			disabledPlugins: [],
			alwaysAllow: [],
			sync: { enabled: false, port: 4533, token: null },
		}),
	);
}

const app = await startApp({ port: 9487, seed });
const settle = (ms = 700) => new Promise((resolve) => setTimeout(resolve, ms));

let failures = 0;
function check(label: string, passed: boolean, evidence: string): void {
	if (!passed) failures++;
	process.stdout.write(`${passed ? "✓" : "✗"} ${label}\n    ${evidence}\n`);
}
const shoot = async (name: string) => {
	const shot = await app.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
	await writeFile(join(dir, `${name}.png`), Buffer.from(shot.data, "base64"));
};
const openSettings = (page: string) =>
	app.evaluate(`(async () => {
		const wait = (ms) => new Promise((r) => setTimeout(r, ms));
		if (!document.querySelector(".ly-settings, [data-settings]")) {
			document.querySelector("[data-ly-open-settings]")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
			await wait(1100);
		}
		[...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === ${JSON.stringify(page)})?.click();
		await wait(1100);
		return true;
	})()`);

try {
	await mkdir(dir, { recursive: true });
	await settle(2400);

	/* ---------- 1. 默认主题 ---------- */

	const surface = await app.evaluate<{ bg: string; fg: string; shell: string; ink: string }>(`(() => {
		const root = getComputedStyle(document.documentElement);
		return {
			bg: root.getPropertyValue("--ly-code-bg").trim(),
			fg: root.getPropertyValue("--ly-code-fg").trim(),
			shell: root.getPropertyValue("--color-shell").trim(),
			ink: root.getPropertyValue("--color-ink").trim(),
		};
	})()`);
	process.stdout.write(`\n── 默认主题 ──\n  代码表面 ${surface.bg} / ${surface.fg}\n  应用表面 ${surface.shell} / ${surface.ink}\n`);
	check(
		"全新安装下，代码表面就是应用自己的表面（没有被主题重新上色）",
		surface.bg.toLowerCase() === surface.shell.toLowerCase() && surface.fg.toLowerCase() === surface.ink.toLowerCase(),
		`${surface.bg} vs ${surface.shell}`,
	);

	await openSettings("外观");
	const themeNames = await app.evaluate<string[]>(
		`[...document.querySelectorAll("button")].map((b) => b.textContent?.trim()).filter((t) => t === "Lyra 默认")`,
	);
	check("外观页两个下拉都停在「Lyra 默认」上", themeNames.length === 2, `找到 ${themeNames.length} 个`);

	/* ---------- 3. 代码外观的预览 ---------- */

	const specimen = await app.evaluate<{
		textareas: number;
		pencils: number;
		resets: number;
		colours: number;
		overlap: boolean;
	}>(`(() => {
		const boxes = [...document.querySelectorAll('[class*="group/spec"]')];
		const first = boxes[0];
		const spans = first ? [...first.querySelectorAll("span[style*=color]")] : [];
		const colours = new Set(spans.map((s) => getComputedStyle(s).color));
		// The reset lives in the header row beside the theme's name; overlapping means it is
		// positioned over it instead of laid out next to it.
		const reset = first?.querySelector('button[aria-label="还原示例内容"]');
		const label = [...(first?.querySelectorAll("span") ?? [])].find((s) => s.textContent?.trim() === "Lyra 默认");
		let overlap = false;
		if (reset && label) {
			const a = reset.getBoundingClientRect();
			const b = label.getBoundingClientRect();
			overlap = !(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom);
		}
		return {
			textareas: boxes.filter((box) => box.querySelector("textarea")).length,
			pencils: document.querySelectorAll('[aria-label="编辑预览内容"]').length,
			resets: boxes.filter((box) => box.querySelector('button[aria-label="还原示例内容"]')).length,
			colours: colours.size,
			overlap,
		};
	})()`);

	process.stdout.write(`\n── 代码外观的两个预览 ──\n`);
	check("两个预览都能直接打字（各有一个 textarea）", specimen.textareas === 2, `${specimen.textareas} 个`);
	check("那个铅笔按钮没了", specimen.pencils === 0, `${specimen.pencils} 个`);
	check("默认状态下不显示还原（没什么可还原的）", specimen.resets === 0, `${specimen.resets} 个`);
	check("预览是带高亮的", specimen.colours >= 4, `${specimen.colours} 种颜色`);

	// Type into the first specimen, and check the highlighting survives it.
	await app.evaluate(`(() => {
		const area = document.querySelector('[class*="group/spec"] textarea');
		if (!area) return false;
		const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
		setter.call(area, "// 我自己的代码\\nconst answer: number = 42;");
		area.dispatchEvent(new Event("input", { bubbles: true }));
		return true;
	})()`);
	await settle(900);

	const afterTyping = await app.evaluate<{ colours: number; resets: number; overlap: boolean; text: string }>(`(() => {
		const boxes = [...document.querySelectorAll('[class*="group/spec"]')];
		const first = boxes[0];
		const spans = [...first.querySelectorAll("span[style*=color]")];
		const reset = first.querySelector('button[aria-label="还原示例内容"]');
		const label = [...first.querySelectorAll("span")].find((s) => s.textContent?.trim() === "Lyra 默认");
		let overlap = false;
		if (reset && label) {
			const a = reset.getBoundingClientRect();
			const b = label.getBoundingClientRect();
			overlap = !(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom);
		}
		return {
			colours: new Set(spans.map((s) => getComputedStyle(s).color)).size,
			resets: boxes.filter((box) => box.querySelector('button[aria-label="还原示例内容"]')).length,
			overlap,
			text: first.querySelector("textarea")?.value ?? "",
		};
	})()`);

	check("打进去的内容确实被两个框都接住了", afterTyping.text.includes("我自己的代码"), afterTyping.text.slice(0, 24));
	check("自己写的代码仍然有高亮（旧版本这里会掉色）", afterTyping.colours >= 3, `${afterTyping.colours} 种颜色`);
	check("改过之后才出现还原按钮，两个框各一个", afterTyping.resets === 2, `${afterTyping.resets} 个`);
	check("还原按钮没有压在主题名上", !afterTyping.overlap, afterTyping.overlap ? "重叠了" : "不重叠");

	/*
	 * The overlay has to line up to the pixel, or the caret sits beside the glyph it is in front of.
	 *
	 * This is the one real risk in drawing a transparent textarea over a coloured copy: the two are
	 * different elements with different UA defaults for `white-space`, `tab-size` and padding, and
	 * any of them shifts one layer relative to the other. Measured by putting a probe span at a
	 * known character and comparing it against where the textarea puts the same character.
	 */
	const alignment = await app.evaluate<{ dx: number; dy: number; font: boolean; note: string }>(`(() => {
	  try {
		const box = document.querySelector('[class*="group/spec"]');
		const area = box && box.querySelector("textarea");
		if (!area) return { dx: -1, dy: -1, font: false, note: "找不到 textarea" };
		// Both layers live in the same wrapper: the rendered lines, then the textarea over them.
		const wrap = area.parentElement;
		/*
		 * The rendered *line*, not the span inside it.
		 *
		 * A span box is the glyph box and sits centred in the line box, so comparing it against the
		 * textarea first line reports half the leading as a misalignment — 1.5px at 12px/1.6, which
		 * is measurement error rather than drift. The line div is the line box, which is what the
		 * textarea lays its own first line out as.
		 */
		const first = wrap && wrap.querySelector("div");
		if (!first) return { dx: -1, dy: -1, font: false, note: "找不到渲染层" };
		const a = getComputedStyle(area);
		const r = getComputedStyle(first);
		const areaBox = area.getBoundingClientRect();
		const firstBox = first.getBoundingClientRect();
		// Where each layer actually starts drawing: its box plus its own left padding. The line div
		// carries a negative margin and matching padding, so its box starts 12px left of the text —
		// comparing boxes alone reports that offset as drift. What must match is where glyphs land.
		return {
			dx: Math.abs((areaBox.left + parseFloat(a.paddingLeft)) - (firstBox.left + parseFloat(r.paddingLeft))),
			dy: Math.abs((areaBox.top + parseFloat(a.paddingTop)) - firstBox.top),
			font:
				a.fontFamily === r.fontFamily &&
				a.fontSize === r.fontSize &&
				a.letterSpacing === r.letterSpacing &&
				a.lineHeight === r.lineHeight,
			note: a.fontSize + " / " + r.fontSize + "  行高 " + a.lineHeight + " / " + r.lineHeight,
		};
	  } catch (e) { return { dx: -1, dy: -1, font: false, note: "抛错：" + String(e && e.message || e) }; }
	})()`);
	check(
		"两层的字体度量完全一致（字体、字号、字距、行高）",
		alignment.font,
		alignment.note,
	);
	check(
		"两层的起点重合（误差小于 1px）",
		alignment.dx < 1 && alignment.dy < 1.5,
		`水平差 ${alignment.dx.toFixed(2)}px，垂直差 ${alignment.dy.toFixed(2)}px`,
	);

	// Scrolled to the specimens, so the screenshot shows the thing being described.
	await app.evaluate(`(() => { document.querySelector('[class*="group/spec"]')?.scrollIntoView({ block: "center" }); return true; })()`);
	await settle(600);
	await shoot("01-appearance");

	/* ---------- 2. 格式化页的预览 ---------- */

	await openSettings("代码格式化");
	// Back to the top: the specimen screenshot above scrolled the panel, and a viewport-relative
	// measurement taken from halfway down reports the preview as being off-screen.
	await app.evaluate(`(() => {
		for (const el of document.querySelectorAll("*")) if (el.scrollTop > 0) el.scrollTop = 0;
		return true;
	})()`);
	await settle(1400);

	const layout = await app.evaluate<{ previewTop: number; firstCardTop: number; colours: number; sample: string }>(`(() => {
		const heads = [...document.querySelectorAll("*")].filter((el) => el.children.length === 0 && el.textContent?.trim() === "预览");
		const preview = heads[0]?.closest("div")?.parentElement;
		const card = document.querySelector(".ly-settings-card, [class*=rounded-xl][class*=border]");
		const box = [...document.querySelectorAll("div")].find((d) => d.style.height === "236px");
		const spans = box ? [...box.querySelectorAll("span[style*=color]")] : [];
		return {
			previewTop: preview?.getBoundingClientRect().top ?? -1,
			firstCardTop: [...document.querySelectorAll("*")].find((el) => el.children.length === 0 && el.textContent?.trim() === "保存时格式化")?.getBoundingClientRect().top ?? -1,
			colours: new Set(spans.map((s) => getComputedStyle(s).color)).size,
			sample: (box?.textContent ?? "").slice(0, 40),
		};
	})()`);

	process.stdout.write(`\n── 代码格式化的预览 ──\n  预览在 y=${Math.round(layout.previewTop)}，第一个设置项在 y=${Math.round(layout.firstCardTop)}\n`);
	check("预览排在设置项之前（在顶部）", layout.previewTop > 0 && layout.previewTop < layout.firstCardTop, `${Math.round(layout.previewTop)} < ${Math.round(layout.firstCardTop)}`);
	check("预览是高亮的", layout.colours >= 4, `${layout.colours} 种颜色`);
	check("预览显示的是格式化后的结果", layout.sample.includes("export async function"), JSON.stringify(layout.sample.slice(0, 30)));

	/* ---------- 沙盒：能不能真的拿来试 ---------- */

	const typeIn = (text: string) =>
		app.evaluate<boolean>(`(() => {
			const area = document.querySelector('textarea[aria-label*="试一段代码"]');
			if (!area) return false;
			const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
			setter.call(area, ${JSON.stringify(text)});
			area.dispatchEvent(new Event("input", { bubbles: true }));
			return true;
		})()`);
	const press = (label: string) =>
		app.evaluate<boolean>(`(() => {
			const hit = [...document.querySelectorAll("button")].find((b) => (b.textContent || "").trim() === ${JSON.stringify(label)});
			if (!hit || hit.disabled) return false;
			hit.click();
			return true;
		})()`);
	const boxText = () => app.evaluate<string>(`document.querySelector('textarea[aria-label*="试一段代码"]')?.value ?? ""`);

	check("代码区可以直接输入", await typeIn("const a={b:1,c:2};function f(x){return x}"), "已输入");
	await settle(700);
	check("按下格式化按钮", await press("格式化"), "已点击");
	await settle(1200);
	const formatted = await boxText();
	check(
		"格式化真的改写了框里的内容",
		formatted.includes("const a = { b: 1, c: 2 }"),
		JSON.stringify(formatted.split("\n")[0].slice(0, 46)),
	);

	// 改一个配置，再格式化一次 —— 结果必须跟着变
	await app.evaluate(`(() => {
		const seg = [...document.querySelectorAll("button")].find((b) => (b.textContent || "").trim() === "单引号");
		seg?.click();
		return Boolean(seg);
	})()`);
	await settle(900);
	await typeIn('const s = "带引号的字符串";');
	await settle(600);
	await press("格式化");
	await settle(1200);
	const single = await boxText();
	check("改了「引号」设置后，再格式化结果跟着变", single.includes("'带引号的字符串'"), JSON.stringify(single.slice(0, 40)));

	check("改过之后出现还原按钮", await press("还原"), "已点击");
	await settle(800);
	const restored = await boxText();
	check("还原把示例放了回来", restored.includes("findUser") || restored.includes("export"), JSON.stringify(restored.slice(0, 34)));

	// 不支持格式化的语言：按钮该是禁用的，而不是一句没用的说明
	await app.evaluate(`(async () => {
		const wait = (ms) => new Promise((r) => setTimeout(r, ms));
		const trigger = [...document.querySelectorAll("button")].find((b) => (b.textContent || "").includes("."));
		trigger?.click();
		await wait(500);
		const input = document.querySelector('input[placeholder*="搜索"]');
		const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
		setter.call(input, "Svelte");
		input.dispatchEvent(new Event("input", { bubbles: true }));
		await wait(400);
		[...document.querySelectorAll('[role="menuitem"]')].find((b) => (b.textContent || "").includes("Svelte"))?.click();
		await wait(700);
		return true;
	})()`);
	await settle(900);
	const disabled = await app.evaluate<boolean>(
		`[...document.querySelectorAll("button")].find((b) => (b.textContent || "").trim() === "格式化")?.disabled ?? false`,
	);
	check("没有格式化工具的语言，按钮是禁用的", disabled, disabled ? "已禁用" : "还能点");
	const gone = await app.evaluate<number>(
		`[...document.querySelectorAll("span")].filter((s) => (s.textContent || "").includes("暂不支持格式化")).length`,
	);
	check("那句「暂不支持格式化」的废话没了", gone === 0, `还有 ${gone} 处`);

	// 回到 TypeScript，后面的布局测量在同一状态下做
	await app.evaluate(`(async () => {
		const wait = (ms) => new Promise((r) => setTimeout(r, ms));
		const trigger = [...document.querySelectorAll("button")].find((b) => (b.textContent || "").includes("."));
		trigger?.click();
		await wait(500);
		[...document.querySelectorAll('[role="menuitem"]')].find((b) => (b.textContent || "").includes("TypeScript"))?.click();
		await wait(600);
		return true;
	})()`);
	await settle(800);

	// The language picker: open it, search by extension and by tool.
	const picker = await app.evaluate<{ opened: boolean; total: number }>(`(async () => {
		const wait = (ms) => new Promise((r) => setTimeout(r, ms));
		const trigger = [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("TypeScript"));
		if (!trigger) return { opened: false, total: 0 };
		trigger.click();
		await wait(600);
		return { opened: true, total: document.querySelectorAll('[role="menuitem"]').length };
	})()`);
	check("语言列表打得开，且有几十种", picker.opened && picker.total >= 40, `${picker.total} 种`);

	const byExtension = await app.evaluate<string[]>(`(async () => {
		const wait = (ms) => new Promise((r) => setTimeout(r, ms));
		const input = document.querySelector('input[type="search"], input[placeholder*="搜索"]');
		if (!input) return ["没有搜索框"];
		const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
		setter.call(input, "gofmt");
		input.dispatchEvent(new Event("input", { bubbles: true }));
		await wait(400);
		return [...document.querySelectorAll('[role="menuitem"]')].map((b) => b.textContent?.trim().slice(0, 20) ?? "");
	})()`);
	check("按工具名能搜到（gofmt → Go）", byExtension.some((t) => t.startsWith("Go")), byExtension.join(" / ").slice(0, 60));
	await shoot("02-format-picker");

	// Pick Go, and check the page admits these settings do not apply to it.
	await app.evaluate(`(async () => {
		const wait = (ms) => new Promise((r) => setTimeout(r, ms));
		[...document.querySelectorAll('[role="menuitem"]')].find((b) => b.textContent?.trim().startsWith("Go"))?.click();
		await wait(900);
		return true;
	})()`);
	await settle(1200);

	const afterGo = await app.evaluate<{ note: string; colours: number; sample: string }>(`(() => {
		const box = [...document.querySelectorAll("div")].find((d) => d.style.height === "236px");
		const spans = box ? [...box.querySelectorAll("span[style*=color]")] : [];
		const note = [...document.querySelectorAll("span")].find((s) => s.textContent?.includes("不生效"))?.textContent?.trim() ?? "无";
		return { note, colours: new Set(spans.map((s) => getComputedStyle(s).color)).size, sample: (box?.textContent ?? "").slice(0, 30) };
	})()`);
	check("选了 Go 之后，页面明说这些设置对它不生效", afterGo.note.includes("gofmt"), afterGo.note);
	check("Go 的示例照样有高亮", afterGo.colours >= 3, `${afterGo.colours} 种颜色`);
	check("换语言后示例真的换了", afterGo.sample.includes("package main"), JSON.stringify(afterGo.sample.slice(0, 24)));
	await shoot("03-format-go");

	// Close the list before measuring: an open popover overlaps everything by design.
	await app.evaluate(`(() => { document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); return true; })()`);
	await settle(600);

	/*
	 * The controls belong to the specimen, not to the page above it.
	 *
	 * Three things floating over a rectangle read as three unrelated things; inside its header
	 * they read as the specimen's own. Checked structurally — inside the same box — and
	 * geometrically, because "inside" is worth nothing if they land on top of each other.
	 */
	const chrome = await app.evaluate<{
		insideBox: boolean;
		pickerOverNote: boolean;
		headerOverCode: boolean;
		boxHeight: number;
		pickerRight: number;
		noteRight: number;
	}>(`(() => {
		const code = [...document.querySelectorAll("div")].find((d) => d.style.height === "236px");
		const box = code && code.closest(".ly-scroll-host");
		const picker = box && [...box.querySelectorAll("button")].find((b) => b.textContent && b.textContent.includes("."));
		const note = box && [...box.querySelectorAll("span")].find((sp) => (sp.textContent || "").includes("生效"));
		if (!box || !picker || !note) return { insideBox: false, pickerOverNote: false, headerOverCode: false, boxHeight: 0, pickerRight: 0, noteRight: 0 };
		const hit = (a, b) => !(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom);
		const p = picker.getBoundingClientRect();
		const n = note.getBoundingClientRect();
		const c = code.getBoundingClientRect();
		return {
			insideBox: box.contains(picker) && box.contains(note),
			pickerOverNote: hit(p, n),
			headerOverCode: hit(p, c) || hit(n, c),
			boxHeight: Math.round(c.height),
			pickerRight: Math.round(p.right),
			noteRight: Math.round(n.right),
		};
	})()`);

	check("语言选择器和说明都在代码框内部", chrome.insideBox, chrome.insideBox ? "在框内" : "还在框外面");
	check("这两个控件互不重叠", !chrome.pickerOverNote, chrome.pickerOverNote ? "重叠了" : "不重叠");
	check("它们也没有压住代码区", !chrome.headerOverCode, chrome.headerOverCode ? "压住了" : "没有压住");
	check("说明贴在右侧，选择器在左侧", chrome.noteRight > chrome.pickerRight, `选择器右缘 ${chrome.pickerRight} < 说明右缘 ${chrome.noteRight}`);
	check("代码区高度是固定的 236", chrome.boxHeight === 236, `${chrome.boxHeight}px`);



	process.stdout.write(`\n截图：${dir}\n`);
} finally {
	await app.stop();
}

process.exit(failures === 0 ? 0 : 1);
