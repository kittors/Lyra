/* oxlint-disable no-console -- probe CLI that prints what the real window did */
/**
 * 一份**磁盘上真的坏了的会话**，在真窗口里打开——界面该画出来，不该白掉。
 *
 * 单测证明了 `runs()` 不再抛。但用户失去的不是一个函数的返回值，是整个窗口：React 的错误边界接住
 * 抛出去的东西，把转录换成一张「这个界面崩了」。那张卡片才是要验的东西，而它只在真窗口里存在。
 *
 * 用的损坏形状是**真的穿得过去的那一种**：`{"type":"message","message":{"role":"assistant"}}`。
 * core 的校验是 `if (record.message)`——只问在不在，不问长什么样，所以一条缺 `content` 的消息会被
 * 原样读出来交给窗口。这不是手搓出来为难自己的输入，是现有代码真的会放行的东西。
 *
 * 用法：node --experimental-strip-types e2e/damaged-transcript-probe.ts
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { startApp, type RunningApp } from "./app.ts";
import { driver, pause } from "./record.ts";

const PORT = 9424;
const SESSION = "dddddddd-cccc-bbbb-aaaa-999999999999";

async function seed(home: string): Promise<void> {
	await mkdir(home, { recursive: true });
	const cwd = join(home, "project");
	await mkdir(cwd, { recursive: true });
	await writeFile(join(cwd, "README.md"), "# 演示工程\n");
	const projectId = createHash("sha256").update(cwd).digest("hex").slice(0, 16);
	const dir = join(home, "sessions", projectId);
	await mkdir(dir, { recursive: true });

	const now = Date.now();
	const meta = {
		id: SESSION, title: "坏记录", cwd, projectId, projectName: "演示工程",
		createdAt: now, updatedAt: now, modelId: "qa/qa", messageCount: 4,
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
		seq: 0,
	};
	const good = (role: string, text: string) => ({ role, content: [{ type: "text", text }], timestamp: now });

	/*
	 * 四条记录，中间两条是坏的。
	 *
	 * 前后各留一条好的，因为要验的不只是「不崩」，还有「好的那些照样画得出来、位置没错」——一个把
	 * 整条转录吞掉的「不崩」，和白屏没有区别。
	 */
	// `CLEAN=1` 跑一遍全好的同一份数据——不做这个对照，就分不清「坏记录打不开会话」和「我这份
	// seed 本来就打不开」。
	const clean = process.env.CLEAN === "1";
	const lines = [
		{ seq: 1, ts: now, type: "meta", meta },
		{ seq: 2, ts: now, type: "message", message: good("user", "第一条，好的") },
		// 缺 content：core 放行，渲染端从前在这里抛 `content is not iterable`。
		{ seq: 3, ts: now, type: "message", message: clean ? good("assistant", "第二条") : { role: "assistant", timestamp: now } },
		// 缺 role：从前抛的正是用户报的那句 `reading 'role'`。
		{ seq: 4, ts: now, type: "message", message: clean ? good("user", "第三条") : { content: [{ type: "text", text: "无主" }], timestamp: now } },
		{ seq: 5, ts: now, type: "message", message: good("assistant", "第四条，也是好的") },
		{ seq: 6, ts: now, type: "meta", meta: { ...meta, messageCount: 4 } },
	];
	await writeFile(join(dir, `${SESSION}.jsonl`), lines.map((l) => JSON.stringify(l)).join("\n") + "\n");

	const real = JSON.parse(await readFile(join(homedir(), ".lyra", "settings.json"), "utf8"));
	await writeFile(
		join(home, "settings.json"),
		JSON.stringify({
			...real, permissionMode: "full",
			projects: [{ id: projectId, path: cwd, name: "演示工程", pinned: true, lastOpenedAt: now }],
			pinnedSessionIds: [], sync: { enabled: false },
		}),
	);
	await writeFile(join(home, "window.json"), JSON.stringify({ width: 1280, height: 820 }));
}

let app: RunningApp;
const checks: { ok: boolean; what: string; saw: string }[] = [];
function check(what: string, ok: boolean, saw: string) {
	checks.push({ ok, what, saw });
	console.log(`  ${ok ? "✅" : "❌"} ${what}${ok ? "" : `  —— ${saw}`}`);
}

async function main() {
	app = await startApp({ port: PORT, seed, scaleFactor: 2 });
	const { click, mark } = driver(app);
	try {
		await pause(1500);
		await mark(".group\\/session", "data-probe");
		await click("[data-probe]").catch(() => {});
		// 等它真的画完，而不是等一个固定的秒数——「正在加载」和「加载不出来」要分得开。
		for (let waited = 0; waited < 20000; waited += 500) {
			const loading = await app.evaluate<boolean>(`document.body.innerText.includes("正在加载对话")`);
			if (!loading) break;
			await pause(500);
		}
		await pause(1200);

		const page = await app.evaluate<string>(`document.body.innerText.replace(/\\s+/g, " ").trim()`);

		// 一、错误边界那张卡片不该出现。这就是用户看到的东西。
		check("没有出现「这个界面崩了」", !page.includes("这个界面崩了"), page.slice(0, 140));
		check("没有那句报错", !page.includes("Cannot read properties"), page.slice(0, 140));

		// 二、好的记录照样在，而且两条都在——把整条转录吞掉的「不崩」等于白屏。
		check("第一条好记录画出来了", page.includes("第一条，好的"), page.slice(0, 140));
		check("第四条好记录也画出来了", page.includes("第四条，也是好的"), page.slice(0, 140));

		// 三、坏的那两条有交代，不是悄悄消失。
		const damagedRows = await app.evaluate<number>(
			`(() => (document.body.innerText.match(/这条记录读不出来/g) || []).length)()`,
		);
		/*
		 * 对照组（`CLEAN=1`）跑的是同一份数据、全是好记录，那时候一行交代都不该有。
		 *
		 * 这一条两边都要断言，方向相反：少了对照那半边，「画出一行交代」就可能是它对任何输入都画一行，
		 * 那种检测器永远通过。
		 */
		const expected = process.env.CLEAN === "1" ? 0 : 2;
		check(
			process.env.CLEAN === "1"
				? `全好的记录一行交代都不该有（数到 ${damagedRows} 行）`
				: `两条坏记录各有一行交代（数到 ${damagedRows} 行）`,
			damagedRows === expected,
			`数到 ${damagedRows}，该是 ${expected}`,
		);

		// 四、控制台留下了形状，下次报上来的不再只有一句报错。
		const logged = await app.evaluate<string>(
			`(() => window.__lyraDamagedLog || "")()`,
		).catch(() => "");
		if (logged) console.log(`     控制台诊断：${logged.slice(0, 160)}`);
	} finally {
		const passed = checks.filter((c) => c.ok).length;
		console.log(`\n${passed}/${checks.length} 项通过`);
		if (passed !== checks.length) process.exitCode = 1;
		await app.stop();
	}
}

await main();
