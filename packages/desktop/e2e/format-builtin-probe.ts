/* oxlint-disable no-console -- a picture-taker that says what it found and where it put the files */
/**
 * 内置格式化，走完整条链：界面 → IPC → 主进程 → WASM 引擎 → 回到界面。
 *
 * 单测只跑到引擎那一层，而那一层在 `node --test` 里是直连的。真实路径上还隔着 preload 的白名单、
 * 一次 IPC 往返、以及 Electron 主进程里的模块解析——这三处任何一处断了，表现都是「点了格式化，
 * 什么也没发生」，而单测照样全绿。
 *
 * 顺带验一件只有真窗口能验的事：这些引擎是**打包在应用里**的。探针跑的是 `out/` 产物，主进程
 * 从应用自己的 `node_modules` 里加载它们——不是从我的开发机器的 PATH 上找 `ruff`、`gofmt`。
 *
 * `node e2e/format-builtin-probe.ts`，改完先 `pnpm build`。
 */

import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { startApp } from "./app.ts";
import { frameGrabber } from "./record.ts";

const PORT = 9647;
const OUT = join(homedir(), ".lyra/scratch/format-builtin");

/** 每种语言一段丑代码，和一个「排好之后必须出现」的片段。 */
const CASES: [ext: string, label: string, ugly: string, expect: string][] = [
	["py", "Python", "def  f( a,b ):\n  x=[1,2,  3]\n  if a>b :\n        return   x\n  return None\n", "def f(a, b):"],
	["go", "Go", 'package main\nimport "fmt"\nfunc main(){x:=1\nfmt.Println( x )}\n', "func main() {"],
	["c", "C", "int main(){int x=1;if(x>0){return  x;}return 0;}\n", "int main() {"],
	["cpp", "C++", "#include <vector>\nint main(){std::vector<int> v={1,2,3};return 0;}\n", "int main() {"],
	["cs", "C#", "class A{public int F(){int x=1;return x;}}\n", "class A {"],
	["java", "Java", "class A{public static void main(String[] a){int x=1;}}\n", "class A {"],
	["proto", "Protobuf", 'syntax="proto3";message User{string id=1;}\n', 'syntax = "proto3";'],
	["m", "Objective-C", "@implementation A\n-(void)f{int x=1;}\n@end\n", "- (void)f {"],
	["dart", "Dart", "void main(){var x=[1,2,3];print( x );}\n", "void main() {"],
	["lua", "Lua", "local function f(a,b)\nif a>b then\nreturn a\nend\nreturn b\nend\n", "local function f(a, b)"],
	["swift", "Swift", "func f(a:Int,b:Int)->Int{if a>b{return a}\nreturn b}\n", "func f(a: Int, b: Int) -> Int {"],
	["php", "PHP", "<?php\nfunction f($a,$b){if($a>$b){return $a;}return $b;}\n", "function f($a, $b)"],
	["toml", "TOML", "[a]\nx=1\ny   =    2\n", "x = 1"],
	["sh", "Shell", "if [ 1 -gt 0 ];then\necho hi\nfi\n", "if [ 1 -gt 0 ]; then"],
	["clj", "Clojure", "(defn f[a b](if(> a b) a b))\n", "(defn f"],
	["tex", "LaTeX", "\\documentclass{article}\n\\begin{document}\nhi\n\\end{document}\n", "\\begin{document}"],
];

const app = await startApp({
	port: PORT,
	seed: async (home) => {
		const root = join(home, "project");
		await mkdir(root, { recursive: true });
		await writeFile(join(home, "window.json"), JSON.stringify({ x: 0, y: 0, width: 1440, height: 900 }));
		await writeFile(
			join(home, "settings.json"),
			JSON.stringify({
				version: 1, providers: [], mcpServers: [],
				projects: [{ path: root, name: "project", pinned: false, lastOpenedAt: Date.now() }],
				defaultModelId: null, permissionMode: "auto", thinking: "medium", retryAttempts: 3,
				hooks: [], scheduledTasks: [], disabledPlugins: [], pluginRegistries: [], skillRegistries: [],
				alwaysAllow: [], sync: { enabled: false, port: 4519, token: null },
			}),
		);
	},
});

const wire = await frameGrabber(PORT);
const settle = (ms: number) => new Promise((done) => setTimeout(done, ms));

try {
	await mkdir(OUT, { recursive: true });
	await settle(2500);

	console.log("=== 走真实 IPC，每种语言排一遍 ===");
	let bad = 0;
	for (const [ext, label, ugly, expect] of CASES) {
		/*
		 * 从渲染进程调，就是界面上那颗按钮调的同一条路。
		 *
		 * 不在这里直接 import 引擎——那样验的是引擎，而引擎单测已经验过了。这里要验的是
		 * preload 有没有放行、IPC 到不到得了、主进程能不能解析出那个包。
		 */
		const result = await wire.evaluate<{ ok: boolean; tool?: string; text?: string; reason?: string; message?: string }>(
			`window.lyra.format.external(${JSON.stringify(ext)}, ${JSON.stringify(ugly)}, { tabWidth: 2, useTabs: false, printWidth: 100 })`,
		);
		const ok = result.ok === true && typeof result.text === "string" && result.text.includes(expect);
		if (!ok) bad++;
		const detail = result.ok
			? `by=${result.tool}  ${result.text?.includes(expect) ? "" : `← 输出里没有 ${JSON.stringify(expect)}`}`
			: `${result.reason}${result.message ? ": " + result.message.slice(0, 60) : ""}`;
		console.log(`${ok ? "✅" : "❌"} ${label.padEnd(14)} .${ext.padEnd(6)} ${detail}`);
	}

	/*
	 * 「这台机器上装了什么」不该影响结果——这正是整件事的重点。
	 *
	 * 这里只报告一下开发机上有没有这些二进制：如果有，说明上面的结果**可能**是它们给的；
	 * 这就是为什么内置引擎排在外部工具前面（见 `format-external.ts`），也是为什么 `by` 必须是
	 * 「内置」而不是 `ruff`。
	 */
	const toolReport = await wire.evaluate<string>(
		`window.lyra.format.external("py", "x=1\\n", { tabWidth: 2, useTabs: false, printWidth: 100 }).then((r) => r.ok ? String(r.tool) : "失败")`,
	);
	console.log(`\n格式化 Python 的是：「${toolReport}」（必须是「内置」——若是 ruff 就说明走的还是 PATH）`);

	// 设置页截图：语言列表现在应当标着「内置」而不是「需要安装」。
	const openedSettings = await wire.evaluate<boolean>(
		`(() => { const b = document.querySelector(".ly-sidebar-foot button"); if (!b) return false; b.click(); return true; })()`,
	);
	await settle(1600);
	if (openedSettings) {
		await wire.evaluate<boolean>(
			`(() => {
				const item = [...document.querySelectorAll("nav button")].find((b) => b.innerText.trim() === "代码格式化");
				if (!item) return false;
				item.scrollIntoView({ block: "center" });
				item.click();
				return true;
			})()`,
		);
		await settle(1600);
		await writeFile(join(OUT, "01-settings.png"), await wire.shot());
		console.log(`截图 → ${join(OUT, "01-settings.png")}`);
	}

	console.log(bad === 0 ? `\n全部通过：${CASES.length} 种语言走完整链路都被真的格式化了` : `\n有 ${bad} 种没通过`);
} finally {
	wire.close();
	await app.stop();
}
