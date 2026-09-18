/* oxlint-disable no-console -- a probe CLI whose entire output is what it printed */

/**
 * Controls that appear on hover, after you have clicked one and moved the pointer away.
 *
 * The report was about conversation rows: the pin and archive buttons reserve their space on hover,
 * and once a conversation had been opened that space stayed reserved with nothing in it. The cause
 * is not specific to that row — it is `:focus-within` used as a stand-in for "the pointer is here".
 * Clicking anything inside such a row focuses it, in Chromium, and the focus outlives the pointer:
 * `:hover` drops, `:focus-within` does not, and whatever it was driving stays on.
 *
 * So every place in the app that shows or makes room for controls on hover is measured here, with
 * the class lists copied verbatim from the components. Four steps each — at rest, hovered, clicked,
 * pointer moved away — and the last must equal the first.
 *
 * Real pointer events through the debugger: `:hover` and `:focus-visible` cannot be produced by
 * dispatching events from inside the page, and `:focus-visible` in particular is the whole point —
 * it is what tells a keyboard user apart from a mouse click.
 *
 * Run: node --experimental-strip-types e2e/session-row-probe.ts
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { startApp } from "./app.ts";

const PORT = 9419;
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

let project = "";
const app = await startApp({
	port: PORT,
	seed: async (home) => {
		project = join(home, "demo-project");
		await mkdir(project, { recursive: true });
		await writeFile(join(project, "readme.md"), "# demo\n");
		await writeFile(join(home, "window.json"), JSON.stringify({ width: 1280, height: 900, x: 0, y: 0 }));

		await writeFile(
			join(home, "settings.json"),
			JSON.stringify({
				version: 1,
				providers: [],
				mcpServers: [],
				projects: [{ path: project, name: "demo-project", pinned: false, lastOpenedAt: Date.now() }],
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
				appearance: { theme: "dark" },
			}),
		);
	},
});

const problems: string[] = [];
const note = (s: string) => console.log(s);

/** A real pointer move, which is the only thing that produces `:hover`. */
const mouseTo = (x: number, y: number) =>
	app.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
const clickAt = async (x: number, y: number) => {
	await app.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1 });
	await app.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount: 1 });
};

/** The row's title button: where it is, what it reserves on the right, and what has focus. */
/** One case's title button: where it is, what it reserves, and what the strip and fade are doing. */
const readCase = (index: number) =>
	app.evaluate<{ x: number; y: number; stripX: number; stripY: number; paddingRight: string; stripOpacity: string; fade: string; focused: string; hovered: boolean }>(`(() => {
		const box = document.querySelectorAll("#ly-probe-row [data-name]")[${index}];
		const row = box.querySelector("[data-case]");
		const main = box.querySelector("[data-main]");
		const strip = box.querySelector("[data-strip]");
		const title = box.querySelector("[data-title]");
		const r = main.getBoundingClientRect();
		const sr = strip.getBoundingClientRect();
		return {
			x: Math.round(r.x + r.width / 2),
			y: Math.round(r.y + r.height / 2),
			stripX: Math.round(sr.x + sr.width / 2),
			stripY: Math.round(sr.y + sr.height / 2),
			paddingRight: getComputedStyle(main).paddingRight,
			stripOpacity: getComputedStyle(strip).opacity,
			fade: title ? (getComputedStyle(title).getPropertyValue("--ly-fade-right") || "-").trim() : "-",
			focused: document.activeElement ? document.activeElement.tagName + ":" + (document.activeElement.textContent || "").trim().slice(0, 8) : "none",
			hovered: row.matches(":hover"),
		};
	})()`);

/**
 * Each case, and where the pointer has to go for it.
 *
 * Most of these reveal their controls when the *row* is hovered, so the title is the target. The
 * preview card's strip is always faintly visible and brightens on its own hover, so for that one
 * the target is the strip itself — pointing at the title would measure nothing and pass by default.
 */
const CASES: [name: string, target: "row" | "strip"][] = [
	["会话行", "row"],
	["项目行", "row"],
	["消息操作", "row"],
	["分支行", "row"],
	["预览卡", "strip"],
];

try {
	await pause(1800);

	/*
	 * Every hover-revealed control in the app, built from the components' own class lists.
	 *
	 * Verbatim copies — the stylesheet resolving them is the application's own, so what is measured
	 * is the real cascade. What is skipped is only getting each surface into a state where it would
	 * render naturally, which needs conversations, branches and messages and would not change which
	 * CSS conditions `:hover` and `:focus-visible` satisfy.
	 */
	await app.evaluate(`(() => {
		document.getElementById("ly-probe-row")?.remove();
		const host = document.createElement("div");
		host.id = "ly-probe-row";
		host.style.cssText = "position:fixed;left:20px;top:120px;width:240px;z-index:99999";
		const rows = [
			// SessionRow: the strip, and the room the title button makes for it.
			["会话行", \`<div data-case class="ly-scroll group/session relative rounded-lg hover:bg-card-hover" style="--ly-row-controls:58px">
				<button type="button" data-main class="flex w-full min-w-0 items-center gap-2 rounded-lg pl-2 text-left text-label transition-[color,background-color] pr-14 h-[27px]">
					<span data-title class="ly-fade-tail min-w-0 flex-1">会话标题</span>
				</button>
				<span data-strip class="pointer-events-none absolute inset-y-0 right-0 flex items-center rounded-r-lg pr-1.5 opacity-0 transition-opacity group-hover/session:opacity-100 group-has-[:focus-visible]/session:opacity-100">
					<button type="button" class="pointer-events-auto rounded p-1">P</button>
				</span></div>\`],
			// ProjectHead: same strip, no padding change on the title.
			["项目行", \`<div data-case class="group/project relative rounded-lg" style="--ly-row-controls:30px">
				<button type="button" data-main class="flex w-full items-center gap-2.5 rounded-lg pr-2 pl-2 text-left text-label h-[27px]">
					<span data-title class="ly-fade-tail min-w-0 flex-1">项目名</span>
				</button>
				<span data-strip class="pointer-events-none absolute inset-y-0 right-0 flex items-center rounded-r-lg pr-1.5 opacity-0 transition-opacity group-hover/project:opacity-100 group-has-[:focus-visible]/project:opacity-100">
					<button type="button" class="pointer-events-auto rounded p-1">M</button>
				</span></div>\`],
			// MessageActions.
			["消息操作", \`<div data-case class="group/msg relative rounded-lg"><button type="button" data-main class="h-[27px] w-full text-left">消息</button>
				<span data-strip class="mt-1 flex h-6 items-center gap-1.5 opacity-0 transition-opacity group-hover/msg:opacity-100 has-[:focus-visible]:opacity-100">
					<button type="button" class="rounded p-1">C</button>
				</span></div>\`],
			// BranchRow: overlay strip, title reserved, fade yields via --ly-row-controls.
			["分支行", \`<div data-case class="ly-scroll group/branch relative rounded-lg" style="--ly-row-controls:52px">
				<div data-main class="flex min-w-0 items-center h-[27px]">
					<span data-title class="ly-fade-tail min-w-0 flex-1">分支</span>
				</div>
				<span data-strip class="pointer-events-none absolute inset-y-0 right-0 flex items-center rounded-r-md pr-1.5 opacity-0 transition-opacity group-hover/branch:opacity-100 group-has-[:focus-visible]/branch:opacity-100">
					<button type="button" class="pointer-events-auto rounded p-1">B</button>
				</span></div>\`],
			// PreviewCard: the strip is always faintly there and comes up on hover.
			["预览卡", \`<div data-case class="group/card relative rounded-lg"><button type="button" data-main class="h-[27px] w-full text-left">预览</button>
				<span data-strip class="flex items-center gap-0.5 rounded-lg p-0.5 opacity-45 transition-opacity hover:opacity-100 has-[:focus-visible]:opacity-100">
					<button type="button" class="rounded p-1">X</button>
				</span></div>\`],
		];
		host.innerHTML = rows.map(([name, html]) => \`<div data-name="\${name}" style="margin-bottom:14px">\${html}</div>\`).join("");
		document.body.appendChild(host);
		return rows.length;
	})()`);
	await pause(400);

	for (const [i, [name, target]] of CASES.entries()) {
		const idle = await readCase(i);
		const at: [number, number] = target === "strip" ? [idle.stripX, idle.stripY] : [idle.x, idle.y];

		await mouseTo(at[0], at[1]);
		await pause(300);
		const hovered = await readCase(i);

		await clickAt(at[0], at[1]);
		await pause(350);
		const clicked = await readCase(i);

		// Far away, and below everything — not over another case.
		await mouseTo(idle.x + 700, idle.y + 400);
		await pause(450);
		const left = await readCase(i);

		note(`${name}`);
		note(`   静止 留白 ${idle.paddingRight} 条 ${idle.stripOpacity} 遮罩 ${idle.fade}`);
		note(`   悬停 留白 ${hovered.paddingRight} 条 ${hovered.stripOpacity} 遮罩 ${hovered.fade}`);
		note(`   点击 留白 ${clicked.paddingRight} 条 ${clicked.stripOpacity} 焦点 ${clicked.focused}`);
		note(`   移开 留白 ${left.paddingRight} 条 ${left.stripOpacity} 遮罩 ${left.fade} :hover=${left.hovered} 焦点 ${left.focused}`);

		/*
		 * Hovering has to do something, or the case is measuring nothing and would pass by accident.
		 */
		const reacts = hovered.paddingRight !== idle.paddingRight || hovered.stripOpacity !== idle.stripOpacity || hovered.fade !== idle.fade;
		if (!reacts) problems.push(`${name}：悬停时没有任何变化，这个用例测不到东西`);

		// And everything it did must be undone when the pointer leaves, click or no click.
		if (left.paddingRight !== idle.paddingRight) {
			problems.push(`${name}：移开后右侧仍留着 ${left.paddingRight}（静止 ${idle.paddingRight}），条的透明度是 ${left.stripOpacity}——位置占着，没有东西显示`);
		}
		if (left.stripOpacity !== idle.stripOpacity) {
			problems.push(`${name}：移开后操作条透明度 ${left.stripOpacity}，静止时是 ${idle.stripOpacity}——点过之后就不消失了`);
		}
		if (left.fade !== idle.fade) {
			problems.push(`${name}：移开后标题右侧的渐变遮罩还是 ${left.fade}（静止 ${idle.fade}）——标题末尾一直被盖着`);
		}
	}

} finally {
	await app.stop();
}

/*
 * The same rule, checked against the source.
 *
 * Everything above measures class lists written into this file, so it proves what those classes do
 * — not that the components still use them. This closes that gap: in a component, `:focus-within`
 * driving visibility or spacing is the bug, because it does not distinguish a keyboard user from
 * the focus a mouse click leaves behind. On a border or a background it is right, and those are
 * allowed by name.
 */
const GUARDED = [
	"src/components/sidebar/SessionRow.tsx",
	"src/components/sidebar/ProjectHead.tsx",
	"src/components/MessageActions.tsx",
	"src/components/git/BranchRow.tsx",
	"src/components/PreviewCard.tsx",
	"src/styles.css",
];
for (const file of GUARDED) {
	const text = await readFile(new URL(`../${file}`, import.meta.url), "utf8").catch(() => "");
	for (const [n, line] of text.split("\n").entries()) {
		// Comments explain why it is not used; they are not uses.
		const code = line.replace(/^\s*[*/].*/, "");
		const hit = /(?:group-)?focus-within[:\]]?[^\s"'`]*(opacity|pr-|pl-|px-|w-|translate|scale)/.exec(code);
		if (hit) problems.push(`${file}:${n + 1} 用 focus-within 驱动了「${hit[1]}」——鼠标点击留下的焦点会让它一直生效`);
		if (/\.group\\?\/[a-z]+:focus-within/.test(code)) {
			problems.push(`${file}:${n + 1} 用 :focus-within 选中整组——应该是 :has(:focus-visible)`);
		}
	}
}

console.log("");
if (problems.length === 0) {
	console.log("✅ 全部通过");
} else {
	console.log(`❌ ${problems.length} 个问题：`);
	for (const p of problems) console.log(`   - ${p}`);
	process.exitCode = 1;
}
