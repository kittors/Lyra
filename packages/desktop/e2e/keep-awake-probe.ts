/* oxlint-disable no-console -- probe CLI that prints what the real system reported */
/**
 * 「运行期间不让电脑休眠」那个开关，系统那边真的收到声明了没有。
 *
 * 单测（`test/keep-awake.test.ts`）能证明这个模块不会攒出一串声明，但它测的是一个假 blocker——
 * 「`powerSaveBlocker.start` 真的让 macOS 记下了一条 assertion」这件事，假的那个一个字也说不了。
 * 这正是 memory 里反复踩的那类：量写进去的值，不量画出来的结果。
 *
 * 所以这里问系统本人：`pmset -g assertions` 列的是内核当下持有的全部电源声明，Lyra 发的那条会
 * 以进程名出现在里面。开关一开一关，那一条要跟着出现和消失。
 *
 * 开关是通过渲染层的 `saveSettings` 打开的，走的是和点设置页那个 Toggle 完全同一条链路：
 * `applySettings` → `onSettingsChanged` → `keeper.set`。
 *
 * macOS 专属：Windows 那边对应的是 `powercfg /requests`，但它要管理员权限才列得全，而且本机不是
 * Windows。Windows 上这条只能靠 `powerSaveBlocker` 自己的 `isStarted` 加人工确认。
 *
 * 用法：node --experimental-strip-types e2e/keep-awake-probe.ts
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { startApp, type RunningApp } from "./app.ts";
import { seedInteractions } from "./interaction-fixture.ts";

const run = promisify(execFile);
const PORT = 9679;

let app: RunningApp;
const checks: { ok: boolean; what: string; saw: string }[] = [];

function check(what: string, ok: boolean, saw: string): void {
	checks.push({ ok, what, saw });
	console.log(`   ${ok ? "✅" : "❌"} ${what}${ok ? "" : `  —— ${saw}`}`);
}

/**
 * 系统现在持有的、按进程列出来的那些电源声明。
 *
 * 类型名要看准：`pmset` 上半截「Assertion status system-wide」用的是 `PreventUserIdleDisplaySleep`
 * 这套名字，下半截「Listed by owning process」用的却是 `NoDisplaySleepAssertion` / `NoIdleSleepAssertion`。
 * 第一版只认了上半截那套，于是开关明明生效、探针却报「一条都没有」——不是量不到，是给了一个看着
 * 很合理的错答案。
 *
 * 不按进程名过滤，改成和基线取差集。因为跑这个探针的时候机器上通常还有别的东西在拦，其中就包括
 * 跑探针的这个 Claude 进程自己，而它发的那条也叫 "Electron"——按名字过滤会把它算进来。
 */
async function assertions(): Promise<string[]> {
	const { stdout } = await run("pmset", ["-g", "assertions"]);
	return stdout
		.split("\n")
		.filter((line) => /NoDisplaySleepAssertion|NoIdleSleepAssertion|PreventUserIdleDisplaySleep/.test(line))
		.filter((line) => /^\s*pid \d+\(/.test(line))
		.map((line) => line.trim());
}

/**
 * 比基线多出来的那些，也就是这个应用刚刚发的。
 *
 * 按 assertion 的 id（行里那个 `[0x…]`）比，不按整行比。整行里带着这条声明已经持续了多久，那个
 * 数每秒都在涨——拿整行做差集，机器上所有长期存在的声明每一轮都会被算成「新增」，而真正新增的
 * 那条就淹在里面了。第一版就是这么报的：三条「新增」，其中两条是别人挂了 142 小时的。
 */
const idOf = (line: string) => /\[(0x[0-9a-f]+)\]/i.exec(line)?.[1] ?? line;

function added(before: string[], now: string[]): string[] {
	const seen = new Set(before.map(idOf));
	return now.filter((line) => !seen.has(idOf(line)));
}

/**
 * 改那个开关，走的是点设置页那个 Toggle 完全同一条链路。
 *
 * `settings.save` 就是 Toggle 的 `onChange` 最终调到的东西：主进程收到之后进 `applySettings`，
 * 它再喊 `onSettingsChanged`，`installKeepAwake` 注册的监听器在那里接住。中间一步都没有绕开。
 */
async function setSwitch(on: boolean): Promise<void> {
	const saved = await app.evaluate<boolean>(
		`(async () => { const s = await window.lyra.settings.get(); await window.lyra.settings.save({ ...s, keepAwake: ${on} }); const back = await window.lyra.settings.get(); return back.keepAwake === ${on}; })()`,
	);
	if (!saved) throw new Error(`设置没存进去：keepAwake 应该是 ${on}`);
	// 声明是主进程发的，给它一点时间——但落没落到系统上由 pmset 说了算，不由这个等待说了算。
	await new Promise((r) => setTimeout(r, 900));
}

async function main(): Promise<void> {
	app = await startApp({ port: PORT, seed: seedInteractions });
	try {
		await app.evaluate(
			`new Promise((resolve,reject)=>{const end=performance.now()+20000;function tick(){if(document.querySelector('[data-ly-row="qa-short"] > button'))resolve();else if(performance.now()>end)reject(Error("boot"));else requestAnimationFrame(tick)}tick()})`,
		);

		const before = await assertions();
		console.log(`\n【基线】系统里已有 ${before.length} 条声明（含跑探针的这个进程自己的）`);

		console.log("\n【开】把开关打开");
		await setSwitch(true);
		const on = added(before, await assertions());
		console.log(`   比基线多出来：${on.length ? on.join("\n                 ") : "（没有）"}`);
		check("开关打开之后，系统多了一条本应用的声明", on.length > 0, "pmset 里没有新增——开关没有真的作用到系统");
		check(
			"多出来的那条正是「别让屏幕睡」",
			on.some((line) => /NoDisplaySleepAssertion/.test(line)),
			`多出来的是 ${on.join(" | ")}——不是 prevent-display-sleep 那一档`,
		);

		console.log("\n【关】再关掉");
		await setSwitch(false);
		const off = added(before, await assertions());
		console.log(`   比基线多出来：${off.length ? off.join("\n                 ") : "（没有）"}`);
		check("开关关掉之后，那条声明消失了", off.length === 0, `还剩 ${off.join(" | ")}——关掉之后电脑仍然不会睡`);
	} finally {
		await app?.stop().catch(() => {});
	}

	const passed = checks.filter((c) => c.ok).length;
	console.log(`\n${passed}/${checks.length} 项通过`);
	if (passed !== checks.length) process.exitCode = 1;
}

main().catch(async (error) => {
	console.error(error);
	await app?.stop().catch(() => {});
	process.exitCode = 1;
});
