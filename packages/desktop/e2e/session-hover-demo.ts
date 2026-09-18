/* oxlint-disable no-console -- probe CLI that prints what the real window did */
/**
 * 会话行右侧虚化 / 图标让位——对着刚打出来的 Lyra.app 边量边录。
 *
 * 用户截到的是标题右边一块空、虚化位置对不上图标。单测读的是 class 名；这里问的是打包进 asar
 * 之后，真窗口里那一行在静止和悬停时各占多少像素。
 *
 * `LYRA_E2E_APP` 指向 `packages/desktop/release/mac-arm64/Lyra.app` 时，开的就是那份包，不是
 * `pnpm dev`。用法：
 * `LYRA_E2E_APP=... node --experimental-strip-types e2e/session-hover-demo.ts [输出目录]`
 */

import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { startApp, type RunningApp } from "./app.ts";
import { driver, encode, pause, startRecording, type Frame } from "./record.ts";

const REPO = "/Users/kittors/Developer/opensource/Lyra";
const OUT_DIR = process.argv[2] ?? join(homedir(), "Desktop", "会话行虚化让位测试");
const PORT = 9531;
const STAMP = new Date()
	.toLocaleString("sv-SE", { timeZone: "Asia/Shanghai" })
	.replace(/[: ]/g, "-")
	.slice(0, 16);

const LONG =
	"统一所有页面标题大小并适配各屏幕在顶部背景中水平垂直居中并且再补一段很长的说明用来确认上百字符时静止铺满悬停让位离开收回都不叠字" +
	"还要再写到一百个字以上才够用来核对虚化起点和图标叠上去之后有没有空槽或第二份标题";
const TITLES = [
	"你觉得我们这个项目写得如何呢？",
	"子代理检查项目并总结",
	"安排子智能体检查项目质量",
	"仔细看下我这个截图，这是啥问题",
	"帮我把这一版的发布文案写了",
	LONG,
];

const usage = {
	input: 0,
	output: 0,
	total: 0,
	cacheRead: 0,
	cacheWrite: 0,
	cost: { input: 0, output: 0, total: 0, cacheRead: 0, cacheWrite: 0 },
};

let app: RunningApp;
const checks: { ok: boolean; what: string; saw: string }[] = [];
function check(what: string, ok: boolean, saw: string) {
	checks.push({ ok, what, saw });
	console.log(`   ${ok ? "✅" : "❌"} ${what}${ok ? "" : `  —— 看到的是：${saw}`}`);
}

async function seed(home: string): Promise<void> {
	const projectId = createHash("sha256").update(REPO).digest("hex").slice(0, 16);
	await mkdir(join(home, "sessions", projectId), { recursive: true });
	await writeFile(join(home, "window.json"), JSON.stringify({ width: 1180, height: 820, x: 48, y: 48 }));
	await writeFile(
		join(home, "settings.json"),
		JSON.stringify({
			version: 1,
			providers: [],
			mcpServers: [],
			projects: [{ id: projectId, name: "Lyra", path: REPO, pinned: true, lastOpenedAt: Date.now() }],
			defaultModelId: null,
			permissionMode: "auto",
			thinking: "medium",
			retryAttempts: 3,
			hooks: [],
			scheduledTasks: [],
			disabledPlugins: [],
			alwaysAllow: [],
			sync: { enabled: false, port: 4541, token: null },
			appearance: { theme: "light" },
		}),
	);

	const metas: object[] = [];
	for (let i = 0; i < TITLES.length; i++) {
		const id = `hover${String(i + 1).padStart(2, "0")}`;
		const messages = [
			{ role: "user", content: [{ type: "text", text: TITLES[i] }], timestamp: 1 },
			{
				role: "assistant",
				content: [{ type: "text", text: "好的。" }],
				api: "anthropic-messages",
				provider: "test",
				model: "test",
				usage,
				stopReason: "stop",
				timestamp: 2,
			},
		];
		const meta = {
			id,
			title: TITLES[i],
			cwd: REPO,
			projectId,
			projectName: "Lyra",
			createdAt: 1_700_000_000_000 + i * 1000,
			updatedAt: 1_700_000_000_000 + i * 1000,
			modelId: "test",
			messageCount: messages.length,
			usage,
			seq: messages.length + 1,
		};
		metas.push(meta);
		await writeFile(
			join(home, "sessions", projectId, `${id}.jsonl`),
			[
				JSON.stringify({ seq: 0, ts: 1, type: "meta", meta }),
				...messages.map((message, at) => JSON.stringify({ seq: at + 1, ts: at + 1, type: "message", message })),
				JSON.stringify({ seq: meta.seq, ts: 2, type: "meta", meta }),
			].join("\n") + "\n",
		);
	}
	await writeFile(join(home, "sessions", "index.json"), JSON.stringify(metas));
}

type RowMeasure = {
	rows: number;
	wrapped: boolean;
	groupSession: boolean;
	title: string;
	pad: number;
	gutter: number;
	fadeRight: number;
	fadeClear: number;
	controls: number;
	revealOpacity: number;
	icons: number;
	iconLabels: string;
	copies: number;
	dupVisible: boolean;
	overlap: number;
	iconLeft: number;
	iconRight: number;
	clearStart: number;
	leftGap: number;
	rightGap: number;
	notice: boolean;
	longHit: boolean;
	titleLen: number;
};

const READ_ROW = `(() => {
	const rows = [...document.querySelectorAll(".ly-sidebar-fill [data-ly-row]")];
	const row = rows.find((el) => (el.querySelector(".ly-fade-tail")?.textContent || "").includes("上百字符")) || rows[0];
	if (!row) return null;
	const main = row.querySelector("button");
	const fade = row.querySelector(".ly-fade-tail");
	const reveal = row.querySelector("[data-ly-hover-reveal]");
	const rowBox = row.getBoundingClientRect();
	const titleBox = (fade || main).getBoundingClientRect();
	const cs = fade ? getComputedStyle(fade) : null;
	const icons = reveal ? [...reveal.querySelectorAll("button")] : [];
	const body = fade?.querySelector("span > span:not([data-ly-scroll-dup])");
	const dup = fade?.querySelector("[data-ly-scroll-dup]");
	const bodyBox = body?.getBoundingClientRect();
	const dupBox = dup?.getBoundingClientRect();
	const dupVisible = Boolean(dup && getComputedStyle(dup).visibility !== "hidden");
	const overlap = bodyBox && dupBox && dupVisible
		? Math.max(0, Math.round(bodyBox.right - dupBox.left))
		: 0;
	const fadeClear = cs ? parseFloat(cs.getPropertyValue("--ly-fade-clear")) || 0 : -1;
	const firstIcon = icons[0]?.getBoundingClientRect();
	const lastIcon = icons.at(-1)?.getBoundingClientRect();
	const fullTitle = (body?.textContent || fade?.textContent || "").trim();
	const clearStart = fadeClear >= 0 ? Math.round(titleBox.right - fadeClear) : -1;
	const leftGap = firstIcon && clearStart >= 0 ? Math.round(firstIcon.left - clearStart) : -1;
	const rightGap = lastIcon ? Math.round(rowBox.right - lastIcon.right) : -1;
	return {
		rows: rows.length,
		wrapped: row.hasAttribute("data-ly-hover-row"),
		groupSession: row.className.includes("group/row"),
		title: fullTitle.slice(0, 24),
		longHit: fullTitle.includes("上百字符"),
		titleLen: fullTitle.length,
		pad: main ? parseFloat(getComputedStyle(main).paddingRight) || 0 : 0,
		gutter: Math.round(rowBox.right - titleBox.right),
		fadeRight: cs ? parseFloat(cs.getPropertyValue("--ly-fade-right")) || 0 : -1,
		fadeClear,
		controls: parseFloat(getComputedStyle(row).getPropertyValue("--ly-row-controls")) || 0,
		revealOpacity: reveal ? parseFloat(getComputedStyle(reveal).opacity) : -1,
		icons: icons.length,
		iconLabels: icons.map((el) => el.getAttribute("aria-label") || el.getAttribute("data-ly-tip") || "").join("|"),
		copies: fade ? fade.querySelectorAll("span > span").length : 0,
		dupVisible,
		overlap,
		iconLeft: firstIcon ? Math.round(firstIcon.left) : -1,
		iconRight: lastIcon ? Math.round(lastIcon.right) : -1,
		clearStart,
		leftGap,
		rightGap,
		notice: Boolean(document.querySelector("[data-foreign-config-notice]")),
	};
})()`;

async function measure(): Promise<RowMeasure | null> {
	return app.evaluate<RowMeasure | null>(READ_ROW);
}

async function rowPoint(index: number): Promise<{ x: number; y: number }> {
	return app.evaluate<{ x: number; y: number }>(
		`(() => {
			const rows = [...document.querySelectorAll(".ly-sidebar-fill [data-ly-row]")];
			const long = rows.find((el) => (el.querySelector(".ly-fade-tail")?.textContent || "").includes("上百字符"));
			const row = ${index} === 0 ? (long || rows[0]) : rows[${index}];
			if (!row) throw new Error("没有第 ${index + 1} 条会话");
			const title = row.querySelector(".ly-fade-tail") || row;
			const r = title.getBoundingClientRect();
			return { x: r.x + Math.min(24, r.width / 3), y: r.y + r.height / 2 };
		})()`,
	);
}

async function iconPoint(index: number): Promise<{ x: number; y: number }> {
	return app.evaluate<{ x: number; y: number }>(
		`(() => {
			const rows = [...document.querySelectorAll(".ly-sidebar-fill [data-ly-row]")];
			const long = rows.find((el) => (el.querySelector(".ly-fade-tail")?.textContent || "").includes("上百字符"));
			const row = ${index} === 0 ? (long || rows[0]) : rows[${index}];
			const btn = row.querySelector("[data-ly-hover-reveal] button");
			if (!btn) throw new Error("这一行没有图标按钮");
			const r = btn.getBoundingClientRect();
			return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
		})()`,
	);
}

async function main() {
	if (!process.env.LYRA_E2E_APP) {
		throw new Error("先设 LYRA_E2E_APP 指向刚打出来的 Lyra.app，否则录到的不是包装后的程序");
	}
	await mkdir(OUT_DIR, { recursive: true });
	console.log(`包：${process.env.LYRA_E2E_APP}`);
	app = await startApp({ port: PORT, seed });
	const d = driver(app);
	const frames: Frame[] = [];
	const stop = await startRecording(PORT, frames);

	try {
		await d.until('document.querySelector(".ly-sidebar-fill [data-ly-row]")', 30000);
		await app.evaluate(
			`(() => {
				document.activeElement instanceof HTMLElement && document.activeElement.blur();
				const neu = [...document.querySelectorAll("button")].find((el) => (el.textContent || "").includes("新对话"));
				if (neu) neu.setAttribute("data-ly-new-chat", "");
			})()`,
		);
		if (await app.evaluate<boolean>('Boolean(document.querySelector("[data-ly-new-chat]"))')) {
			await d.click("[data-ly-new-chat]");
		}
		await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 720, y: 360 });
		await pause(1400);

		const home = await app.evaluate<{ notice: boolean; question: boolean }>(
			`(() => ({
				notice: Boolean(document.querySelector("[data-foreign-config-notice]")),
				question: /要在/.test(document.body.innerText),
			}))()`,
		);
		check("欢迎页输入框上方不再提醒别人的配置", !home.notice, home.notice ? "还挂着 data-foreign-config-notice" : "");
		check("欢迎页能看见", home.question, home.question ? "" : "没有「要在」");
		await pause(1200);

		console.log("【一】静止：标题铺满，不留空槽，图标藏着");
		const rest = await measure();
		if (!rest) throw new Error("侧边栏里没有会话行");
		console.log(`   量到 ${JSON.stringify(rest)}`);
		check("第一条标题超过一百个字", LONG.length >= 100 && rest.longHit, `${LONG.length} 字 / 行内 ${rest.titleLen}`);
		check("列表里有那几条长标题", rest.rows >= 4, `${rest.rows} 行`);
		check("会话行走统一的 HoverRow", rest.wrapped, rest.wrapped ? "" : "没有 data-ly-hover-row");
		check("会话行是 group/row", rest.groupSession, rest.groupSession ? "" : rest.title);
		check("没悬停时图标条是藏着的", rest.revealOpacity === 0, `opacity ${rest.revealOpacity}`);
		check("静止时标题铺到行边，不留 56px 空槽", rest.pad <= 10 && rest.gutter <= 12, `pad ${rest.pad} gutter ${rest.gutter}`);
		check("静止时不挖空图标底下", rest.fadeClear === 0, `fadeClear ${rest.fadeClear}`);
		check("静止时第二份标题不画出来", !rest.dupVisible, `dupVisible ${rest.dupVisible} overlap ${rest.overlap}`);
		check("置顶和归档两个按钮都在", rest.icons === 2, `${rest.icons} 个：${rest.iconLabels}`);
		check("输入框上方不再提醒别人的配置", !rest.notice, rest.notice ? "还挂着 data-foreign-config-notice" : "");
		await pause(1200);

		console.log("【二】鼠标放到第一条长标题上：图标出来，虚化让到 --ly-row-controls");
		await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...(await rowPoint(0)) });
		await pause(1100);
		const hovered = await measure();
		if (!hovered) throw new Error("悬停后找不到行");
		console.log(`   量到 ${JSON.stringify(hovered)}`);
		check("悬停后图标条露出来", hovered.revealOpacity === 1, `opacity ${hovered.revealOpacity}`);
		check("两份标题不重叠", hovered.overlap <= 1, `重叠 ${hovered.overlap}px`);
		check("悬停不改标题的 padding", Math.abs(hovered.pad - rest.pad) < 1, `静止 ${rest.pad} / 悬停 ${hovered.pad}`);
		check(
			"悬停时图标底下整段让开，不是一道半透明渐变",
			hovered.fadeClear > 0 && Math.abs(hovered.fadeClear - hovered.controls) < 1,
			`fadeClear ${hovered.fadeClear} / controls ${hovered.controls} / fadeRight ${hovered.fadeRight}`,
		);
		check(
			"第一个图标落在让开的那段里面",
			hovered.iconLeft >= 0 && hovered.clearStart >= 0 && hovered.iconLeft + 1 >= hovered.clearStart,
			`icon ${hovered.iconLeft} / clearStart ${hovered.clearStart}`,
		);
		check(
			"最左按钮左边和最右按钮右边留白一样",
			hovered.leftGap >= 5 && hovered.rightGap >= 5 && Math.abs(hovered.leftGap - hovered.rightGap) <= 1,
			`left ${hovered.leftGap} / right ${hovered.rightGap}`,
		);
		check("置顶还在", hovered.iconLabels.includes("置顶") || /pin/i.test(hovered.iconLabels), hovered.iconLabels);
		await pause(1400);

		console.log("【三】点置顶，再把指针挪开：图标必须收回，不能留下空槽悬着");
		const pin = await iconPoint(0);
		for (const type of ["mouseMoved", "mousePressed", "mouseReleased"] as const) {
			await app.send("Input.dispatchMouseEvent", {
				type,
				...pin,
				...(type === "mouseMoved" ? {} : { button: "left", clickCount: 1 }),
			});
		}
		await pause(800);
		await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 640, y: 400 });
		await pause(1100);
		const left = await measure();
		if (!left) throw new Error("挪开后找不到行");
		console.log(`   量到 ${JSON.stringify(left)}`);
		check("指针离开后图标又藏回去", left.revealOpacity === 0, `opacity ${left.revealOpacity}`);
		check(
			"离开后让开收回，标题重新铺满",
			left.revealOpacity === 0 && left.fadeClear === 0 && Math.abs(left.fadeRight - rest.fadeRight) < 1,
			`fadeClear ${left.fadeClear} fadeRight ${left.fadeRight}（静止 ${rest.fadeRight}）`,
		);
		await pause(1000);

		console.log("【四】再悬停下一条，确认不是只有第一行能用");
		await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...(await rowPoint(1)) });
		await pause(1200);
		const second = await app.evaluate<{ opacity: number; title: string }>(
			`(() => {
				const rows = [...document.querySelectorAll(".ly-sidebar-fill [data-ly-row]")];
				const row = rows[1];
				const reveal = row?.querySelector("[data-ly-hover-reveal]");
				return {
					opacity: reveal ? parseFloat(getComputedStyle(reveal).opacity) : -1,
					title: (row?.querySelector(".ly-fade-tail")?.textContent || "").trim().slice(0, 24),
				};
			})()`,
		);
		check("第二条悬停也露出图标", second.opacity === 1, `${second.title} opacity ${second.opacity}`);
		await pause(1400);

		const open = await rowPoint(0);
		for (const type of ["mouseMoved", "mousePressed", "mouseReleased"] as const) {
			await app.send("Input.dispatchMouseEvent", {
				type,
				...open,
				...(type === "mouseMoved" ? {} : { button: "left", clickCount: 1 }),
			});
		}
		await pause(1200);

		console.log("【五】打开 Git 面板的分支页，看分支行图标和对齐");
		await app.evaluate(
			`(() => {
				document.querySelector("[data-ly-open-git]")?.removeAttribute("data-ly-open-git");
				[...document.querySelectorAll("button[aria-label]")].find((b) => /^Git/.test(b.getAttribute("aria-label") || ""))?.setAttribute("data-ly-open-git", "");
			})()`,
		);
		const gitBtn = await app.evaluate<boolean>('Boolean(document.querySelector("[data-ly-open-git]"))');
		if (gitBtn) {
			await d.click("[data-ly-open-git]");
			await pause(1600);
			await app.evaluate(
				`(() => {
					document.querySelector("[data-ly-git-branches]")?.removeAttribute("data-ly-git-branches");
					[...document.querySelectorAll("button[aria-label]")].find((b) => (b.getAttribute("aria-label") || "") === "分支")?.setAttribute("data-ly-git-branches", "");
				})()`,
			);
			const tab = await app.evaluate<boolean>('Boolean(document.querySelector("[data-ly-git-branches]"))');
			if (tab) {
				await d.click("[data-ly-git-branches]");
				await pause(1800);
			}
			const branch = await app.evaluate<{
				count: number;
				pad: number;
				gutter: number;
				opacity: number;
			} | null>(
				`(() => {
					const names = [...document.querySelectorAll("[data-ly-branch-name]")];
					if (!names.length) return null;
					const name = names.find((el) => el.parentElement?.querySelector("[data-ly-hover-reveal]")) || names[0];
					name.setAttribute("data-ly-probe-branch", "");
					const host = name.parentElement;
					const reveal = host?.querySelector("[data-ly-hover-reveal]");
					const box = name.getBoundingClientRect();
					const row = host?.getBoundingClientRect();
					return {
						count: names.length,
						pad: parseFloat(getComputedStyle(name).paddingRight) || 0,
						gutter: row ? Math.round(row.right - box.right) : -1,
						opacity: reveal ? parseFloat(getComputedStyle(reveal).opacity) : -1,
					};
				})()`,
			);
			check("Git 分支列表出来了", Boolean(branch && branch.count > 0), branch ? `${branch.count} 条` : "没有分支行");
			if (branch) {
				check("分支名静止也不留大空槽", branch.pad <= 10 && branch.gutter <= 12, `pad ${branch.pad} gutter ${branch.gutter}`);
				const branchPoint = await app.evaluate<{ x: number; y: number }>(
					`(() => {
						const el = document.querySelector("[data-ly-probe-branch]");
						if (!el) throw new Error("没有探针分支");
						const r = el.getBoundingClientRect();
						return { x: r.x + Math.min(24, r.width / 3), y: r.y + r.height / 2 };
					})()`,
				);
				await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...branchPoint });
				await pause(1200);
				const hoveredBranch = await app.evaluate<number>(
					`(() => {
						const reveal = document.querySelector("[data-ly-probe-branch]")
							?.closest("[data-ly-hover-row]")
							?.querySelector("[data-ly-hover-reveal]");
						return reveal ? parseFloat(getComputedStyle(reveal).opacity) : -1;
					})()`,
				);
				check("悬停分支行时图标露出来", hoveredBranch === 1, `opacity ${hoveredBranch}`);
			}
			await pause(1400);
		} else {
			check("找到 Git 面板按钮", false, "标题栏里没有 Git");
		}

		await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 640, y: 400 });
		await pause(900);
	} finally {
		await stop();
		console.log(`\n采到 ${frames.length} 帧，正在合成 60fps…`);
	}

	if (frames.length === 0) throw new Error("一帧都没采到");
	const passed = checks.filter((c) => c.ok).length;
	const out = join(OUT_DIR, `${STAMP}_会话行虚化让位_${passed}of${checks.length}.mp4`);
	await app.stop();
	await encode(frames, out, 60, 1200);
	console.log(`\n${passed}/${checks.length} 项通过`);
	console.log(`视频：${out}`);
	if (passed !== checks.length) process.exitCode = 1;
}

main().catch(async (error) => {
	console.error(error);
	await app?.stop().catch(() => {});
	process.exitCode = 1;
});
