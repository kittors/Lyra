/* oxlint-disable no-console -- probe CLI that prints what the real window did */
/**
 * 更新弹窗各阶段在真窗口里长什么样，边验边录。
 *
 * 不下一份 200MB 的包。进度条要的是 `info` 和 `phase`，不是 GitHub 的字节。说明故意带着
 * GitHub 的 `<details><summary>中文（简体）</summary>`，抽语言之后那层壳必须消失。
 *
 * 用法：先 `pnpm --filter @lyra/desktop build`，再
 * `node --experimental-strip-types e2e/update-dialog-demo.ts`
 */

import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { startApp, type RunningApp } from "./app.ts";
import { driver, encode, pause, startRecording, type Frame } from "./record.ts";

const OUT_DIR = process.argv[2] ?? join(homedir(), "Desktop", "Lyra更新弹窗测试");
const PORT = 9461;
const STAMP = new Date()
	.toLocaleString("sv-SE", { timeZone: "Asia/Shanghai" })
	.replace(/[: ]/g, "-")
	.slice(0, 16);

const NOTES = [
	"<!-- lyra:notes en -->",
	"### New",
	"- Mermaid diagrams render in the conversation.",
	"- Long release notes scroll inside the dialog.",
	"",
	"<!-- lyra:notes zh-CN -->",
	"<details>",
	"<summary>中文（简体）</summary>",
	"",
	"### 新功能",
	"",
	"- **对话里的 mermaid 围栏会画成图。** 不再是一整墙源码。",
	"- **更多语言能直接「保存时格式化」。** 不用先装那些工具链。",
	"- **更新说明太长时，弹窗里可以上下滚。** 顶底会虚化，底下的按钮不动。",
	"- **设置里的语言决定看到哪一段说明。** 不会再摊开一叠语言折叠。",
	"",
	"### 修复",
	"",
	"- **打开会话不再把窗口卡死或整页刷白。**",
	"- **软链项目里的文件操作会作用在真实路径上。** 以前写了也没动静。",
	"- **Windows 路径不再按斜杠去猜「在不在项目里」。**",
	"- **关于页的当前版本更新内容只显示当前界面语言。** 没有这段就回落到英文。",
	"- **更新失败时，磁盘路径不会出现在按钮旁边。** 说明写在内容区。",
	"",
	"### 还改了这些",
	"",
	"- 输入框用方向键可以翻自己刚发过的话。",
	"- 附件的 token 左右留白一致，长文件名不再把芯片撑破。",
	"- 文件链接只显示文件名，完整路径放在 tooltip 里。",
	"- 代码块里的路径芯片有统一的最大宽度，太长就在芯片里收住。",
	"- 侧栏会话标题碰到按钮时，字会虚化，而不是被裁成一条硬边。",
	"- 标注工具条的提示能显示出来了。",
	"- 图片预览的放大从第一帧就是对的，不再量到自己变过形的盒子。",
	"- 市场卡片的远程图标能画出来。",
	"- 面板展开是同一块在动，不会卸掉再装上、过渡直接没了。",
	"",
	"### 安装与更新",
	"",
	"- 下载中的进度写在说明上面，不在按钮那一行。",
	"- 关掉弹窗不会停下载，角标还在。",
	"- 暂停之后主按钮是继续下载。",
	"- 准备安装的那一会儿，主按钮会暂时按不了。",
	"",
	"### 给用的人看的",
	"",
	"- 一条说明先讲你遇到过的现象，再讲现在会怎样。",
	"- 不写「体验升级」「全面优化」这种没有数字的句子。",
	"- 七种语言各自写一遍，产品名词跟该语言的界面一致。",
	"</details>",
].join("\n");

const INFO = {
	current: "0.9.14",
	latest: "0.9.15",
	available: true,
	checked: true,
	notes: NOTES,
	url: "https://github.com/kittors/Lyra/releases/tag/v0.9.15",
	publishedAt: Date.parse("2026-09-17T03:39:53Z"),
	asset: { name: "Lyra-0.9.15-arm64.zip", url: "https://example.invalid/Lyra.zip", size: 214_537_161 },
	checksums: "https://example.invalid/SHA256SUMS",
};

let app: RunningApp;
const checks: { ok: boolean; what: string; saw: string }[] = [];
function check(what: string, ok: boolean, saw: string) {
	checks.push({ ok, what, saw });
	console.log(`   ${ok ? "✅" : "❌"} ${what}${ok ? "" : `  —— 看到的是：${saw}`}`);
}

async function seed(home: string): Promise<void> {
	await mkdir(home, { recursive: true });
	await writeFile(join(home, "window.json"), JSON.stringify({ width: 1180, height: 820, x: 40, y: 40 }));
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
			pluginRegistries: [],
			skillRegistries: [],
			alwaysAllow: [],
			sync: { enabled: false, port: 4517, token: null },
			uiLocale: "zh-CN",
			appearance: { theme: "light" },
		}),
	);
}

async function preview(phase: Record<string, unknown>): Promise<void> {
	await app.evaluate(
		`(() => {
			const set = window.__lyraUpdatePreview;
			if (!set) throw new Error("没有 __lyraUpdatePreview");
			set(${JSON.stringify({ info: INFO, phase })});
			return true;
		})()`,
	);
}

async function dialogText(): Promise<string> {
	return app.evaluate<string>(
		`document.querySelector("[data-ly-update-dialog]")?.innerText ?? ""`,
	);
}

async function dialogHeight(): Promise<number> {
	return app.evaluate<number>(
		`Math.round(document.querySelector("[data-ly-update-dialog]")?.getBoundingClientRect().height ?? 0)`,
	);
}

async function actionsTop(): Promise<number> {
	return app.evaluate<number>(
		`Math.round(document.querySelector("[data-ly-dialog-actions]")?.getBoundingClientRect().top ?? 0)`,
	);
}

async function notesMetrics(): Promise<{ overflow: number; fadeTop: number; fadeBottom: number; scrollTop: number }> {
	return app.evaluate(`(() => {
		const view = document.querySelector("[data-ly-update-dialog] .ly-scroll-view");
		if (!(view instanceof HTMLElement)) return { overflow: 0, fadeTop: 0, fadeBottom: 0, scrollTop: 0 };
		const style = getComputedStyle(view);
		return {
			overflow: view.scrollHeight - view.clientHeight,
			fadeTop: parseFloat(style.getPropertyValue("--ly-fade-top")) || 0,
			fadeBottom: parseFloat(style.getPropertyValue("--ly-fade-bottom")) || 0,
			scrollTop: view.scrollTop,
		};
	})()`);
}

async function scrollNotes(top: number): Promise<void> {
	await app.evaluate(`(() => {
		const view = document.querySelector("[data-ly-update-dialog] .ly-scroll-view");
		if (!(view instanceof HTMLElement)) throw new Error("没有说明滚动面");
		view.scrollTo({ top: ${top}, behavior: "smooth" });
	})()`);
	await pause(900);
}

async function shot(name: string): Promise<void> {
	const picture = await app.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
	await writeFile(join(OUT_DIR, `${STAMP}_${name}.png`), Buffer.from(picture.data, "base64"));
	console.log(`   → ${STAMP}_${name}.png`);
}

const press = (text: string) =>
	app.evaluate(`(() => {
		const button = [...document.querySelectorAll("button")].find((b) => b.textContent?.includes(${JSON.stringify(text)}));
		if (!button) throw new Error("没有找到按钮：" + ${JSON.stringify(text)});
		button.click();
		return true;
	})()`);

async function main(): Promise<void> {
	await mkdir(OUT_DIR, { recursive: true });
	app = await startApp({ port: PORT, seed });
	const frames: Frame[] = [];
	const stop = await startRecording(PORT, frames);
	const d = driver(app);

	try {
		await pause(2500);
		await preview({ at: "idle" });
		await pause(600);
		await preview({ at: "idle" });

		console.log("\n【一】设置 → 关于，打开空闲弹窗");
		await d.click(".ly-sidebar-foot button");
		await pause(800);
		await press("关于");
		await pause(1000);
		await preview({ at: "idle" });
		await pause(400);
		const opened = await app.evaluate<boolean>(`(() => {
			const labeled = [...document.querySelectorAll("button")].find((b) => (b.getAttribute("aria-label") ?? "").includes("立即更新"));
			if (labeled) { labeled.click(); return true; }
			const badge = document.querySelector(".ly-update-dot");
			if (badge instanceof HTMLElement) { badge.click(); return true; }
			return false;
		})()`);
		if (!opened) throw new Error("关于页和角标都打不开更新弹窗");
		await pause(1200);

		const idle = await dialogText();
		check("标题是一句话，版本写在说明里", idle.includes("有新版本可以更新") && idle.includes("0.9.15") && idle.includes("当前 0.9.14"), idle.slice(0, 80));
		check("体积和日期还在", idle.includes("204.6MB") && /2026/.test(idle), idle.slice(0, 120));
		check("主按钮写着「下载安装」", idle.includes("下载安装"), idle);
		check("关是「关闭」，不是一个叉", idle.includes("关闭"), idle);
		check("说明抽掉了「中文（简体）」那层壳", !idle.includes("中文（简体）") && idle.includes("这个版本改了什么") && idle.includes("mermaid"), idle.slice(0, 200));
		const idleH = await dialogHeight();
		const idleActions = await actionsTop();
		const radius = await app.evaluate<string>(`getComputedStyle(document.querySelector("[data-ly-modal]")).borderRadius`);
		const headerBorder = await app.evaluate<string>(`getComputedStyle(document.querySelector("[data-ly-update-dialog] > div")).borderTopWidth`);
		const footerBorder = await app.evaluate<string>(`getComputedStyle(document.querySelector("[data-ly-dialog-actions]")).borderTopWidth`);
		check("空闲时弹窗是固定高度", idleH === 480, `${idleH}px`);
		check("外壳圆角是 22px", radius.startsWith("22px"), radius);
		check("没有顶部分割线", headerBorder === "0px" && footerBorder === "0px", `header ${headerBorder} / footer ${footerBorder}`);
		const idleNotes = await notesMetrics();
		check("说明超出一屏", idleNotes.overflow > 80, `多出 ${idleNotes.overflow}px`);
		check("开头底下有虚化", idleNotes.fadeBottom > 8, `${idleNotes.fadeBottom}px`);
		await pause(1400);
		await shot("1-idle");

		console.log("\n【二】把说明往下滚，顶底虚化");
		await scrollNotes(180);
		await shot("1b-scrolled");
		const midNotes = await notesMetrics();
		check("滚过之后上头有虚化", midNotes.fadeTop > 8, `${midNotes.fadeTop}px`);
		await scrollNotes(420);
		await pause(800);
		await scrollNotes(80);

		console.log("\n【三】下载到一半，进度在内容区");
		await preview({ at: "downloading", received: 109_700_000, total: 214_537_161 });
		await pause(1400);
		const down = await dialogText();
		const downH = await dialogHeight();
		const downActions = await actionsTop();
		const progressInActions = await app.evaluate<boolean>(
			`Boolean(document.querySelector("[data-ly-dialog-actions] [data-ly-update-progress]"))`,
		);
		const progressAbove = await app.evaluate<boolean>(`(() => {
			const progress = document.querySelector("[data-ly-update-progress]");
			const actions = document.querySelector("[data-ly-dialog-actions]");
			if (!(progress instanceof HTMLElement) || !(actions instanceof HTMLElement)) return false;
			return progress.getBoundingClientRect().bottom <= actions.getBoundingClientRect().top;
		})()`);
		check("进度在内容区", (down.includes("51%") || down.includes("50%")) && down.includes("正在下载") && progressAbove, down.slice(0, 160));
		check("进度不在按钮行", !progressInActions, "进度跑到按钮里了");
		check("主按钮是「暂停」，旁边还有关闭和取消", down.includes("暂停") && down.includes("取消下载") && down.includes("关闭"), down.slice(-80));
		check("点下载之后外框高度不变", downH === idleH, `空闲 ${idleH}px，下载中 ${downH}px`);
		check("按钮行没有被进度条撑下去", downActions === idleActions, `空闲 top ${idleActions}，下载中 ${downActions}`);
		await scrollNotes(260);
		await pause(1000);
		await shot("2-downloading");

		console.log("\n【四】暂停");
		await preview({ at: "paused", received: 109_700_000, total: 214_537_161 });
		await pause(1400);
		const paused = await dialogText();
		check("暂停后主按钮是继续，进度还在内容区", paused.includes("继续下载") && paused.includes("已暂停") && paused.includes("关闭"), paused);
		await pause(1400);
		await shot("3-paused");

		console.log("\n【四】失败，说明在内容区，不在按钮边上");
		await preview({
			at: "failed",
			error: "UNKNOWN: unknown error, open 'C:\\\\Users\\\\250377\\\\AppData\\\\Roaming\\\\@lyra\\\\desktop\\\\updates\\\\Lyra-0.9.15-x64.exe.part'",
			received: 109_700_000,
			total: 214_537_161,
		});
		await pause(1400);
		const failed = await dialogText();
		check("失败标题在说明里", failed.includes("这次没能写完"), failed);
		check("按钮区没有磁盘路径", !failed.includes("C:") && !failed.includes("exe.part"), failed);
		check("失败时仍能看见「重试」和「关闭」", failed.includes("重试") && failed.includes("关闭"), failed);
		await pause(1600);
		await shot("4-failed");

		await press("关闭");
		await pause(900);
		check("关闭之后弹窗走了", !(await app.evaluate<boolean>(`Boolean(document.querySelector("[data-ly-update-dialog]"))`)), "还在");
	} finally {
		await stop();
		console.log(`\n采到 ${frames.length} 帧，正在合成 60fps…`);
	}

	if (frames.length === 0) throw new Error("一帧都没采到");
	const passed = checks.filter((c) => c.ok).length;
	const out = join(OUT_DIR, `${STAMP}_更新弹窗_${passed}of${checks.length}.mp4`);
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
