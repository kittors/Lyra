/* oxlint-disable no-console -- probe CLI that prints what the real window did */
/**
 * 切换会话卡多久，卡在哪一步。
 *
 * 用**本机真实的会话**，不是造出来的：合成数据压不出这个问题——手写的转录每条都短、结构都一样，
 * 而真实的大会话里有几万条工具调用、几百个代码块、上千条思考行，解析和渲染的形状完全不同。这台
 * 机器上最大的那个 jsonl 有 25MB。
 *
 * 量三样，按绘制帧记：
 *
 *   1. **点下去到转录第一次画出来**，也就是人眼看到的等待时长
 *   2. **最长的一次掉帧**，也就是「鼠标转圈」实际转了多久——主线程被占住的那一段
 *   3. 主进程读文件花了多久（IPC 往返），和渲染那一段分开算
 *
 * 第 2 条是真正的判据。总耗时长但每帧都在走，界面是「慢」；一帧卡住 800ms，界面是「死了」，
 * 而后者才是鼠标变转圈的那个症状。
 *
 * 会话是复制进临时 profile 的，原始数据只读不动。
 *
 * 用法：node --experimental-strip-types e2e/session-switch-perf.ts [要测几个会话，默认 4]
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { startApp, type RunningApp } from "./app.ts";

const _HOW_MANY = Number(process.argv[2] ?? 4);
const PORT = 9695;
const REAL = join(homedir(), ".lyra", "sessions");

let app: RunningApp;

/** 本机最大的那几个会话，连同它们的 meta。 */
async function _biggest(count: number): Promise<{ file: string; dir: string; bytes: number }[]> {
	const found: { file: string; dir: string; bytes: number }[] = [];
	for (const dir of await readdir(REAL, { withFileTypes: true })) {
		if (!dir.isDirectory()) continue;
		for (const name of await readdir(join(REAL, dir.name))) {
			if (!name.endsWith(".jsonl")) continue;
			const file = join(REAL, dir.name, name);
			found.push({ file, dir: dir.name, bytes: (await stat(file)).size });
		}
	}
	return found.sort((a, b) => b.bytes - a.bytes).slice(0, count);
}

/**
 * 把**整个 `~/.lyra` 复制一份**进临时 profile，然后剔掉凭据。
 *
 * 前面试过只挑几个会话文件再手搓 meta 和 settings，连着六轮都卡在「还没有会话」——项目要登记、
 * 目录要是 git 仓库、meta 不能取第一行那条（`seq: 0` 会被静默丢掉）……每一条都是真的，而凑齐它们
 * 等于把应用读取侧的全部隐含约定重写一遍。真实环境里这些本来就是对的。
 *
 * 复制而不是直接指过去：探针跑起来的应用会写这个目录（窗口位置、索引、缓存），原始数据必须一个字
 * 节都不动。
 *
 * **凭据不带过来。** `credentials.json`、`vault.key`、`forges.json` 里是 API key 和代码托管令牌，
 * 一个压测探针没有任何理由碰它们；`settings.json` 里每个 provider 的 key 也一并清空。少了它们
 * 应用照常起，只是发不出请求——而这个探针本来也不发请求。
 */
export function seedFromReal(home: string): Promise<void> {
	return (async () => {
		const env = { ...process.env, DEVELOPER_DIR: "/Library/Developer/CommandLineTools" };
		// `-R` 连目录结构一起，`.` 是为了把内容复制进去而不是复制成一个子目录。
		await promisify(execFile)("cp", ["-R", `${join(homedir(), ".lyra")}/.`, home], { env, maxBuffer: 64 * 1024 * 1024 });

		for (const secret of ["credentials.json", "vault.key", "forges.json"]) {
			await rm(join(home, secret), { force: true });
		}

		const file = join(home, "settings.json");
		try {
			const settings = JSON.parse(await readFile(file, "utf8")) as {
				providers?: { apiKey?: string; models?: unknown[] }[];
				sync?: { enabled?: boolean; port?: number };
			};
			for (const provider of settings.providers ?? []) provider.apiKey = "";
			// 同步服务换个端口，免得撞上用户自己正开着的那个 Lyra。
			if (settings.sync) settings.sync = { ...settings.sync, enabled: false, port: 4523 };
			await writeFile(file, JSON.stringify(settings));
		} catch {
			/* 读不出就让它按默认起，会话照样在 */
		}
	})();
}

async function evaluate<T>(expression: string): Promise<T> {
	return app.evaluate<T>(expression);
}

async function until(expression: string, ms = 30000): Promise<void> {
	await evaluate(
		`new Promise((resolve,reject)=>{const end=performance.now()+${ms};function tick(){if(${expression})resolve();else if(performance.now()>end)reject(Error(${JSON.stringify(expression)}));else requestAnimationFrame(tick)}tick()})`,
	);
}

/*
 * 注入的代码里不写反引号：这段字符串还要在外层的模板串里活一遍，一个反引号就能把它截断。
 */
const WATCH = `((was) => {
	const out = { frames: [], start: performance.now(), firstPaint: null, longest: 0, was: was };
	window.__perf = out;
	let last = performance.now();
	const signature = () => {
		const runs = document.querySelectorAll('[data-ly-run]');
		return runs.length + '|' + ((document.querySelector('[data-dock-pane="conversation"]') || {}).innerText || '').slice(0, 120);
	};
	const tick = () => {
		const now = performance.now();
		const gap = now - last;
		if (gap > out.longest) out.longest = gap;
		out.frames.push(Math.round(gap));
		last = now;
		/*
		 * 「画出来了」的判据是**内容真的换了**，不是「有转录元素」。
		 *
		 * 第一版用的是后者，于是第二个会话往后每次都报 0ms——上一个会话的转录还挂在那儿没卸载，
		 * 判据一上来就成立。三个会话里只有第一个的数字是真的，而那三个 0ms 看起来非常像「缓存生效
		 * 了」。切换前先记下当前的签名，等它变。
		 */
		if (out.firstPaint === null && signature() !== out.was) out.firstPaint = Math.round(now - out.start);
		if (now - out.start < 15000 && !out.stop) requestAnimationFrame(tick);
	};
	requestAnimationFrame(tick);
	return true;
})(SIGNATURE)`;

/** 当前转录的样子，用来判断切换之后内容有没有真的换掉。 */
const SIGNATURE_EXPR = `(() => {
	const runs = document.querySelectorAll('[data-ly-run]');
	return runs.length + '|' + ((document.querySelector('[data-dock-pane="conversation"]') || {}).innerText || '').slice(0, 120);
})()`;

interface Watch {
	frames: number[];
	firstPaint: number | null;
	longest: number;
}

/**
 * 把 `console.error` 接过来，专门留住那个 Error 对象。
 *
 * 崩溃界面上有错误消息和**组件栈**，但没有 `error.stack`——而组件栈只说「崩在 Conversation 这棵树
 * 里」，那是个有几十个 useMemo 的组件，从它看不出是哪个函数读到了 undefined。同一句报错被报上来
 * 三次、每次都只有组件栈，就是这么三次都没查到根上的。
 *
 * `ErrorBoundary.componentDidCatch` 会 `console.error("[lyra] uncaught render error", error, ...)`，
 * 所以在这里截一道就能拿到 Error 本体。不用改应用代码，也不用重新构建。
 */
const HOOK_CONSOLE = `(() => {
	if (window.__crashHook) return true;
	window.__crashHook = true;
	const orig = console.error.bind(console);
	console.error = (...args) => {
		const err = args.find((a) => a instanceof Error);
		if (err && !window.__crash) window.__crash = { message: err.message, stack: err.stack || "" };
		orig(...args);
	};
	return true;
})()`;

/** 崩没崩——先看拦下来的那个 Error，页面特征只当兜底。 */
const CRASH_EXPR = `(() => {
	if (window.__crash) return window.__crash;
	const pre = document.querySelector('pre.text-danger, pre[class*="text-danger"]');
	const crashed = !!pre && !document.querySelector('[data-dock-pane]');
	return crashed ? { message: (pre.innerText || '').trim().slice(0, 200), stack: "" } : null;
})()`;

async function switchTo(
	title: string,
	label: string,
): Promise<{ firstPaint: number | null; longest: number; over100: number; crash: { message: string; stack: string } | null } | null> {
	// 先记下现在的样子，再挂逐帧记录，最后才点——顺序反了会漏掉最要命的头几帧。
	const was = await evaluate<string>(SIGNATURE_EXPR);
	await evaluate(WATCH.replace("SIGNATURE", JSON.stringify(was)));
	const clicked = await evaluate<boolean>(`(() => {
		const want = ${JSON.stringify(title)};
		const rows = [...document.querySelectorAll('[data-ly-row]')];
		const row = rows.find((r) => (r.innerText || '').includes(want));
		const button = row && row.querySelector('button');
		if (button) button.click();
		return !!button;
	})()`);
	if (!clicked) return null;

	// 等内容真的换掉，而不是等一个固定的帧数，也不是等「有转录元素」。
	await until(`${SIGNATURE_EXPR} !== ${JSON.stringify(was)}`, 25000).catch(() => {});
	await new Promise((r) => setTimeout(r, 700));

	/*
	 * 每切一次都问一句「崩了没」。
	 *
	 * 这个探针同时是崩溃的复现器：`Cannot read properties of undefined (reading 'role')` 在真实
	 * 数据上出现过三次，而本机 245 个会话按 `intact` 的判据扫下来一条畸形都没有——说明触发它的不是
	 * 磁盘上的坏字节，而是某个会话**被渲染时**才出现的形状。逐个切过去，崩的那一个会当场被记下来。
	 */
	const crash = await evaluate<{ message: string; stack: string } | null>(CRASH_EXPR).catch(() => null);
	if (crash) {
		console.log(`\n   💥 ${label} 「${title.slice(0, 30)}」崩了：${crash.message}`);
		if (crash.stack) console.log(`\n${crash.stack}\n`);
		return { firstPaint: null, longest: 0, over100: 0, crash };
	}

	await evaluate(`(() => { if (window.__perf) window.__perf.stop = true; return true; })()`);
	const w = await evaluate<Watch>(
		`(() => ({ frames: window.__perf.frames, firstPaint: window.__perf.firstPaint, longest: Math.round(window.__perf.longest) }))()`,
	);
	const over100 = w.frames.filter((f) => f > 100);
	if (w.longest > 300) {
		console.log(`   ${label} 「${title.slice(0, 28)}」：第一帧 ${w.firstPaint ?? "-"}ms，最长卡顿 ${w.longest}ms`);
	}
	return { firstPaint: w.firstPaint, longest: w.longest, over100: over100.length, crash: null };
}

async function main(): Promise<void> {
	app = await startApp({ port: PORT, seed: seedFromReal });
	try {
		await until(`document.querySelectorAll('[data-ly-row]').length > 0`, 40000);
		await evaluate(HOOK_CONSOLE);
		const titles = await evaluate<string[]>(
			`[...document.querySelectorAll('[data-ly-row]')].map((r) => (r.innerText || '').split('\\n')[0].trim()).filter(Boolean)`,
		);
		console.log(`侧边栏里有 ${titles.length} 行会话，逐个切过去量一遍（只印卡过 300ms 的和崩掉的）\n`);

		/*
		 * 量**每一个**，不是只量文件最大的那几个。
		 *
		 * 文件大小和切换成本不是一回事：25MB 里大半可能是几条工具的长输出，消息数反而不多，而渲染
		 * 贵的是消息条数、工具卡数量、代码块数量。按文件大小挑三个量出来最长才 169ms，那三个根本
		 * 不是慢的那几个。
		 */
		const results: { title: string; firstPaint: number | null; longest: number; crash: { message: string; stack: string } | null }[] = [];
		for (const [index, title] of titles.entries()) {
			const r = await switchTo(title, `${index + 1}/${titles.length}`);
			if (r) results.push({ title, firstPaint: r.firstPaint, longest: r.longest, crash: r.crash });
			if (r?.crash) break; // 崩了就停在现场，后面的量也没意义
		}

		const crashed = results.filter((r) => r.crash);
		console.log(`\n════ 结果 ════`);
		console.log(`量到的会话：${results.length}/${titles.length}`);
		if (crashed.length) {
			console.log(`\n💥 崩溃复现了 ${crashed.length} 次：`);
			for (const c of crashed) console.log(`   「${c.title.slice(0, 40)}」\n   ${c.crash?.message}\n${c.crash?.stack ?? ""}`);
		} else {
			console.log("没有一个会话触发崩溃");
		}

		const slowest = [...results].filter((r) => !r.crash).sort((a, b) => b.longest - a.longest).slice(0, 8);
		console.log("\n单帧卡得最久的八个（这就是鼠标转圈的那一下）：");
		for (const r of slowest) {
			console.log(`   ${String(r.longest).padStart(5)}ms   第一帧 ${String(r.firstPaint ?? "-").padStart(5)}ms   ${r.title.slice(0, 40)}`);
		}
		const bad = results.filter((r) => !r.crash && r.longest > 300);
		console.log(`\n卡过 300ms 以上的：${bad.length}/${results.length} 个会话`);
	} finally {
		await app?.stop().catch(() => {});
	}
}

main().catch(async (error) => {
	console.error(error);
	await app?.stop().catch(() => {});
	process.exitCode = 1;
});
