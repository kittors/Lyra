/**
 * 子智能体调度这一页，在真窗口里到底长什么样、按下去有没有反应。
 *
 * UI 测试是在 jsdom 里跑的：它能证明点了之后写进设置的值是对的，证明不了这一页在真窗口里
 * 排得开、导航里点得到、禁用态看得出来。这个仓库里「代码在、功能不在」出现过十几次，其中
 * 好几次的形态就是「组件写好了、菜单里没有它」——那是 jsdom 永远看不见的一类。
 *
 * 三件事，都是量出来的而不是看出来的：
 *
 *   1. 导航里有这一项，点了真的切过去；
 *   2. 自动模式下五档是禁用的（`disabled` 属性 + 光标形状），并且标出了当前落在哪一档；
 *   3. 并发输入框在它那一行的中线上，而不是贴着标题浮在上半截。
 *
 * 用法：node --experimental-strip-types e2e/delegation-settings-probe.ts /tmp/lyra-deleg
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { startApp } from "./app.ts";

const dir = process.argv[2] ?? "/tmp/lyra-deleg";
const project = join(dir, "proj");

async function seed(home: string): Promise<void> {
	await mkdir(project, { recursive: true });
	await writeFile(join(project, "readme.md"), "# probe\n");
	await writeFile(join(home, "window.json"), JSON.stringify({ width: 1280, height: 940, x: 0, y: 0 }));
	await writeFile(
		join(home, "settings.json"),
		JSON.stringify({
			version: 1,
			providers: [],
			mcpServers: [],
			projects: [{ id: "e2e", name: "proj", path: project, pinned: true, lastOpenedAt: 1 }],
			defaultModelId: null,
			permissionMode: "auto",
			// 中档：自动推出来该是「挑着派」，并发 8 收一半到 4——这一页最该解释清楚的那个组合。
			thinking: "medium",
			maxConcurrentSubAgents: 8,
			retryAttempts: 3,
			hooks: [],
			scheduledTasks: [],
			disabledPlugins: [],
			alwaysAllow: [],
			sync: { enabled: false, port: 4531, token: null },
		}),
	);
}

const app = await startApp({ port: 9487, seed });
const settle = (ms = 700) => new Promise((resolve) => setTimeout(resolve, ms));

interface PageState {
	found: boolean;
	navLabel: string | null;
	heading: string;
	auto: boolean;
	selected: string | null;
	disabled: string[];
	cursor: string;
	badge: string | null;
	levelHints: string[];
	/** 并发输入框的中线，减去它那一行的中线。0 = 正着；负数 = 偏上。 */
	fieldOffset: number;
	/** 每一档的名字和副标题，按屏幕上的顺序——文案是这一页的主要产出，得看得见。 */
	rows: { tier: string; name: string; detail: string }[];
	/** 有没有横向溢出：这一页每行是「记号 + 两行字 + 右侧等级」，窄一点就会挤。 */
	overflow: number;
}

/** 把当前这一页的状态量回来。选择器用的都是组件里写死的 data 属性，不是文字匹配。 */
const READ = `(() => {
	const host = document.querySelector("[data-delegation-settings]");
	const nav = [...document.querySelectorAll("nav button")].find((b) => b.innerText.trim() === "子智能体调度");
	const tiers = [...document.querySelectorAll("[data-delegation-tier]")];
	const picked = tiers.find((t) => t.dataset.selected !== undefined);
	const toggle = document.querySelector('[aria-label="跟随思考等级"]');
	const field = document.querySelector('[aria-label="最多同时运行的子智能体数量"]');
	const fieldRow = field ? field.closest("[data-settings-row]") : null;
	const badge = picked ? [...picked.querySelectorAll("span")].find((s) => s.innerText.trim() === "当前") : null;
	const rowOf = (t) => {
		const spans = [...t.querySelectorAll("span")];
		return { tier: t.dataset.delegationTier, name: spans[1] ? spans[1].innerText.trim() : "", detail: spans[spans.length - 1] ? spans[spans.length - 1].innerText.trim() : "" };
	};
	return {
		found: Boolean(host),
		navLabel: nav ? nav.innerText.trim() : null,
		heading: host ? (host.querySelector("h1") || {}).innerText || "" : "",
		auto: toggle ? toggle.getAttribute("aria-checked") === "true" : false,
		selected: picked ? picked.dataset.delegationTier : null,
		disabled: tiers.filter((t) => t.disabled).map((t) => t.dataset.delegationTier),
		cursor: tiers[0] ? getComputedStyle(tiers[0]).cursor : "",
		badge: badge ? badge.innerText.trim() : null,
		levelHints: tiers.map((t) => { const s = [...t.querySelectorAll("span")]; const last = s[s.length - 1]; return last && last.innerText.includes("·") || (last && /^(中|高|仅自定义)$/.test(last.innerText.trim())) ? last.innerText.trim() : ""; }).filter(Boolean),
		rows: tiers.map(rowOf),
		overflow: host ? host.scrollWidth - host.clientWidth : -1,
		fieldOffset: field && fieldRow
			? Math.round((field.getBoundingClientRect().top + field.getBoundingClientRect().bottom) / 2
				- (fieldRow.getBoundingClientRect().top + fieldRow.getBoundingClientRect().bottom) / 2)
			: -9999,
	};
})()`;

const read = () => app.evaluate<PageState>(READ);
const shot = async (name: string) => {
	const png = await app.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
	await writeFile(join(dir, name), Buffer.from(png.data, "base64"));
};

function report(title: string, state: PageState): void {
	process.stdout.write(`\n── ${title} ──\n`);
	process.stdout.write(`  页面在不在      ${state.found ? "在" : "不在"}   标题「${state.heading}」\n`);
	process.stdout.write(`  跟随思考等级    ${state.auto ? "开" : "关"}\n`);
	process.stdout.write(`  选中的档位      ${state.selected ?? "无"}${state.badge ? `（标着「${state.badge}」）` : ""}\n`);
	process.stdout.write(`  禁用的档位      ${state.disabled.length > 0 ? state.disabled.join("、") : "无"}   光标 ${state.cursor}\n`);
	process.stdout.write(`  等级映射提示    ${state.levelHints.length > 0 ? state.levelHints.join(" / ") : "（没有显示）"}\n`);
	process.stdout.write(`  横向溢出        ${state.overflow > 0 ? `${state.overflow}px —— 挤出去了` : "没有"}\n`);
	process.stdout.write(`  输入框垂直位置  ${state.fieldOffset === 0 ? "正在中线上" : `偏${state.fieldOffset < 0 ? "上" : "下"} ${Math.abs(state.fieldOffset)}px`}\n`);
	for (const row of state.rows) process.stdout.write(`    ${row.tier.padEnd(10)} ${row.name}｜${row.detail}\n`);
}

const problems: string[] = [];
const check = (ok: boolean, why: string) => {
	if (!ok) problems.push(why);
};

try {
	await mkdir(dir, { recursive: true });
	await settle(2600);

	// 1. 导航里点得到吗——组件写好了、菜单里没有它，是这类改动最常见的失败形态。
	const opened = await app.evaluate<{ settings: boolean; nav: boolean }>(`(async () => {
		const wait = (ms) => new Promise((r) => setTimeout(r, ms));
		const entry = document.querySelector(".ly-sidebar-foot button");
		if (!entry) return { settings: false, nav: false };
		entry.click();
		await wait(1400);
		const item = [...document.querySelectorAll("nav button")].find((b) => b.innerText.trim() === "子智能体调度");
		if (!item) return { settings: true, nav: false };
		item.click();
		await wait(900);
		return { settings: true, nav: true };
	})()`);
	check(opened.settings, "侧边栏底部没找到设置入口");
	check(opened.nav, "设置导航里没有「子智能体调度」这一项——组件写了，菜单里没接上");
	await settle(600);

	const auto = await read();
	report("跟随思考等级（默认）", auto);
	await shot("01-auto.png");
	check(auto.found, "页面没渲染出来");
	check(auto.selected === "selective", `中档该落在「挑着派」，实际是 ${auto.selected}`);
	check(auto.badge === "当前", "自动模式下没标出当前落在哪一档");
	check(auto.disabled.length === 5, `自动模式下五档都该是禁用的，实际禁用了 ${auto.disabled.length} 个`);
	check(auto.cursor === "default", `禁用的档位光标该是 default，实际是 ${auto.cursor}`);
	check(auto.levelHints.length >= 4, "自动模式下该写明哪些等级落到哪一档");
	check(auto.overflow <= 0, `页面横向挤出去了 ${auto.overflow}px`);
	// 一像素的容差：中文字体的行盒不一定是整数高。
	check(Math.abs(auto.fieldOffset) <= 1, `并发输入框没落在它那一行的中线上，偏了 ${auto.fieldOffset}px`);

	// 2. 关掉跟随，档位应当就地钉住——而不是跳到某个默认值。
	await app.evaluate(`(async () => {
		document.querySelector('[aria-label="跟随思考等级"]').click();
		await new Promise((r) => setTimeout(r, 700));
	})()`);
	await settle(600);
	const pinned = await read();
	report("关掉跟随（应当钉在原地）", pinned);
	await shot("02-pinned.png");
	check(!pinned.auto, "开关没关上");
	check(pinned.selected === "selective", `关掉的瞬间档位跳到了 ${pinned.selected}，用户按这个开关正是为了别再变`);
	check(pinned.disabled.length === 0, "钉死之后五档该可点了");
	check(pinned.levelHints.length === 0, "钉死之后不该还显示等级映射——那条因果已经断了");

	// 3. 切到「从不派」。
	await app.evaluate(`(async () => {
		document.querySelector('[data-delegation-tier="off"]').click();
		await new Promise((r) => setTimeout(r, 700));
	})()`);
	await settle(600);
	const off = await read();
	report("切到「从不派」", off);
	await shot("03-off.png");
	check(off.selected === "off", `点了「从不派」却选中了 ${off.selected}`);
	// 关掉之后要说清楚点名这条路还通——那是这一档下唯一还通的路。
	check(off.rows.some((r) => r.tier === "off" && /@ 点名/.test(r.detail)), "「从不派」没说清 @ 点名仍然有效");

	// 4. 切到「放开派」。
	await app.evaluate(`(async () => {
		document.querySelector('[data-delegation-tier="eager"]').click();
		await new Promise((r) => setTimeout(r, 700));
	})()`);
	await settle(600);
	const eager = await read();
	report("切到「放开派」", eager);
	await shot("04-eager.png");
	check(eager.selected === "eager", `点了「放开派」却选中了 ${eager.selected}`);
	check(Math.abs(eager.fieldOffset) <= 1, `换档之后输入框离开了中线，偏了 ${eager.fieldOffset}px`);

	// 5. 窄窗口：这一页每行是「记号 + 两行字 + 右侧等级」，挤是可以预见的。
	await app.send("Emulation.setDeviceMetricsOverride", { width: 900, height: 900, deviceScaleFactor: 1, mobile: false });
	await settle(900);
	const narrow = await read();
	report("窄窗口 900px", narrow);
	await shot("05-narrow.png");
	check(narrow.overflow <= 0, `窄窗口下横向挤出去了 ${narrow.overflow}px`);
	// 窄窗口下控件掉到文字下面，那是另一种排法——不套居中那条。


	process.stdout.write(`\n${"─".repeat(60)}\n`);
	if (problems.length === 0) process.stdout.write("全部通过。\n");
	else for (const problem of problems) process.stdout.write(`✗ ${problem}\n`);
	process.stdout.write(`截图：${dir}\n`);
	process.exitCode = problems.length === 0 ? 0 : 1;
} finally {
	await app.stop();
}
