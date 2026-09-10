/* oxlint-disable no-console -- probe CLI that prints what the real window did */
/**
 * 换个项目之后，终端面板里是哪一个终端、它开在哪个目录。
 *
 * 客户说：选了项目 A 开终端，再选项目 B 开终端，还是 A 的那个；而且「一个会话一个终端」这件事
 * 好像没了。这个探针不猜，去真窗口里问：`pwd` 的输出就是答案。
 *
 * 两个项目都放在临时 profile 里，各自有个好认的名字。
 */

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { startApp, type RunningApp } from "./app.ts";

const REAL_HOME = join(homedir(), ".lyra");

async function seed(home: string): Promise<void> {
	await mkdir(home, { recursive: true });
	const projects = [];
	for (const name of ["alpha", "beta"]) {
		const cwd = join(home, name);
		await mkdir(cwd, { recursive: true });
		await writeFile(join(cwd, "README.md"), `# ${name}\n`);
		const id = createHash("sha256").update(cwd).digest("hex").slice(0, 16);
		await mkdir(join(home, "sessions", id), { recursive: true });
		projects.push({ id, path: cwd, name, pinned: true, lastOpenedAt: Date.now() });
	}
	// 供应商原样带过来，但这个探针不发任何模型请求——只看终端。
	const real = JSON.parse(await readFile(join(REAL_HOME, "settings.json"), "utf8"));
	await writeFile(
		join(home, "settings.json"),
		JSON.stringify({ ...real, projects, pinnedSessionIds: [], sync: { enabled: false } }),
	);
	await writeFile(join(home, "window.json"), JSON.stringify({ width: 1400, height: 900 }));
}

let app: RunningApp;
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function until(expression: string, ms = 30000) {
	const end = Date.now() + ms;
	while (Date.now() < end) {
		if (await app.evaluate<boolean>(`Boolean(${expression})`)) return;
		await pause(200);
	}
	throw new Error(`等不到：${expression}`);
}

/** 面板里那个终端当前在哪个目录——问它自己。 */
async function pwd(): Promise<string> {
	await app.evaluate(`(async () => {
		const tabs = await window.lyra.terminal.listAll();
		// 写给**每一个**终端：面板上只画活动的那一个，所以谁显示出来了，谁就是活动的。
		// 挑 tabs[0] 会去问一个根本没在看的终端——那是上一版读数为空的原因。
		for (const tab of tabs) {
			await window.lyra.terminal.write(tab.id, "echo DIR=" + String.fromCharCode(36) + "{PWD##*/}" + String.fromCharCode(13));
		}
	})()`);
	await pause(1500);
	// xterm 把每一行画成一个 .xterm-rows 的子元素；找我们自己打的那个记号。
	return app.evaluate<string>(`(() => {
		const rows = [...document.querySelectorAll(".xterm-rows > div")].map((r) => r.textContent.trim()).filter(Boolean);
		const hit = [...rows].reverse().find((line) => /^DIR=/.test(line));
		return hit ? hit.slice(4) : rows.slice(-3).join(" | ");
	})()`);
}

async function tabs(): Promise<Array<{ id: string; title: string }>> {
	return app.evaluate(`window.lyra.terminal.listAll()`);
}

/** 输入框上那个项目名——切项目到底有没有生效，看它。 */
async function project(): Promise<string> {
	return app.evaluate<string>(`(() => {
		const chip = [...document.querySelectorAll("main button")].find((b) => /^(alpha|beta)$/.test(b.textContent.trim()));
		return chip?.textContent.trim() ?? "?";
	})()`);
}

/** 幂等：已经开着就什么都不做——那个按钮是开关，再点一次会把它关上。 */
async function openTerminalPane() {
	await app.evaluate(`(() => {
		if (document.querySelector(".xterm-rows")) return;
		const b = [...document.querySelectorAll("button")].find((e) => /终端/.test(e.getAttribute("aria-label") ?? e.getAttribute("data-ly-tip") ?? ""));
		b?.click();
	})()`);
	await until(`document.querySelector(".xterm-rows")`);
	await pause(1200);
}

/**
 * 换项目，走真实的那个入口。
 *
 * 侧边栏里点项目那一行是展开它的会话列表，**不切工作区**——切工作区走的是输入框上那个项目芯片
 * （`ProjectPicker`）。第一版探针点的是前者，于是「切到 beta」根本没发生，②③两步都是空的。
 */
async function switchProject(name: string) {
	await app.evaluate(`(() => {
		const chip = [...document.querySelectorAll("main button")].find((b) => /^(alpha|beta|选择项目)$/.test(b.textContent.trim()));
		chip?.click();
	})()`);
	await until(`document.querySelector('[data-ly-overlay], [role="dialog"], [data-ly-popover]')`, 10000);
	await pause(400);
	await app.evaluate(`(() => {
		const row = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === ${JSON.stringify(name)} && b.closest('[data-ly-overlay], [role="dialog"], [data-ly-popover]'));
		row?.click();
	})()`);
	await pause(2500);
}

async function main() {
	app = await startApp({ port: 9418, seed });
	const home = app.home;
	try {
		const alpha = join(home, "alpha");
		const beta = join(home, "beta");

		console.log("① 打开项目 alpha，开终端（客户描述的顺序：先有项目，再开终端）");
		await switchProject("alpha");
		await openTerminalPane();
		const first = await pwd();
		console.log(`   当前项目 = ${await project()}；面板里的终端目录 = ${first}`);
		console.log(`   现有终端 ${JSON.stringify(await tabs())}`);

		console.log("\n② 切到项目 beta，再看终端面板");
		await switchProject("beta");
		await openTerminalPane();
		const second = await pwd();
		const after = await tabs();
		console.log(`   当前项目 = ${await project()}；面板里的终端目录 = ${second}`);
		console.log(`   现有终端 ${JSON.stringify(after)}`);

		console.log("\n③ 在 beta 里按「+」开一个新终端");
		await app.evaluate(`(async () => {
			const cwd = window.lyra ? null : null;
			const b = [...document.querySelectorAll("button")].find((e) => /新建终端|新终端/.test(e.getAttribute("aria-label") ?? e.getAttribute("data-ly-tip") ?? "")) ?? [...document.querySelectorAll("button")].find((e) => e.textContent.trim() === "+");
			b?.click();
			return Boolean(b);
		})()`);
		await pause(2000);
		const third = await pwd();
		console.log(`   新终端 pwd = ${third}`);
		console.log(`   现有终端 ${JSON.stringify(await tabs())}`);

		console.log("\n④ 再切回 alpha —— 应当回到原来那个终端，而不是再开一个");
		await switchProject("alpha");
		await openTerminalPane();
		const fourth = await pwd();
		const finalTabs = await tabs();
		console.log(`   当前项目 = ${await project()}；面板里的终端目录 = ${fourth}`);
		console.log(`   现有终端 ${JSON.stringify(finalTabs)}`);

		console.log("\n———— 判定 ————");
		console.log(`alpha 目录 = ${alpha}`);
		console.log(`beta  目录 = ${beta}`);
		console.log(`切到 beta 后，面板显示的仍是 alpha 的那个终端？ ${second === "alpha"}`);
		console.log(`beta 里新开的终端确实开在 beta？            ${third === "beta"}`);
		console.log(`切到 beta 后面板自动落在 beta 的终端？        ${second === "beta"}`);
		console.log(`切回 alpha 后回到 alpha 的终端？             ${fourth === "alpha"}`);
		console.log(`切回 alpha 有没有重复开？（alpha 的终端只该有一个）${new Set(finalTabs.map((t) => t.id)).size} 个标签`);
	} finally {
		await app.stop();
		await rm(home, { recursive: true, force: true });
	}
}

await main();
