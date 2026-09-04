/**
 * 找「代码在、功能不在」。
 *
 *   node --experimental-strip-types test/tool-eval/wiring-scan.ts [base-ref]
 *
 * 这个分支上出现了八次同一个模式：一个字段解析得很仔细、一个模块测得很全，而产品里没有任何
 * 东西调用它。八次里没有一次是查出来的——全是碰上的，而且每次都是在做别的事的时候。
 *
 * 前五次是某个可选字段没人读（`source: "auto"`、`allowed-tools`、`AgentDefinition.model`、
 * agent 优先级方向反了、身份覆盖那一行）。后三次更彻底：
 *
 *   `extractMemory` 整个执行侧不存在——读结果的那条线接好了，写它的那条从不运行
 *   `refuseDispatch` 零引用，而提示词一直在向模型承诺那个层数
 *   `.lyra/config.json` 从来没被打开过，「项目级配置」只是一段注释
 *
 * 判据很粗，也只能粗：一个导出的**值**（函数、常量、类），如果在产品代码里没有任何引用——
 * 测试不算，`index.ts` 的再导出也不算（把东西摆上货架不等于有人用）——那它就值得看一眼。
 *
 * 它会误报，而且误报的方向是固定的：同文件内部用的辅助函数、留给以后的 API、诊断工具。所以
 * 输出里标了「同文件也在用」——那一类基本可以跳过，剩下的才是要一个个看的。
 */

import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const run = promisify(execFile);
const ROOT = fileURLToPath(new URL("../..", import.meta.url));

const say = (line = "") => process.stderr.write(`${line}\n`);
const DIM = "\x1b[2m";
const RED = "\x1b[31m";
const OFF = "\x1b[0m";

/**
 * 只看值：函数、常量、类。
 *
 * `interface` 和 `type` 会把结果淹掉，而且淹得没有信息量——一个只在自己文件里当参数类型用的
 * 导出接口是完全正常的。这里要找的是「有人写了一段会跑的代码，而没有任何东西会去跑它」。
 */
const EXPORT = /^export\s+(?:async\s+)?(?:function|const|class)\s+([A-Za-z_$][\w$]*)/gm;

async function sourceFiles(dir: string): Promise<string[]> {
	const out: string[] = [];
	for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
		if (entry.name === "node_modules" || entry.name === "out" || entry.name === "dist" || entry.name.startsWith(".")) continue;
		const path = join(dir, entry.name);
		if (entry.isDirectory()) out.push(...(await sourceFiles(path)));
		else if (/\.(ts|tsx|mts)$/.test(entry.name)) out.push(path);
	}
	return out;
}

const isTestPath = (path: string) => path.includes("/test/") || path.endsWith(".test.ts");

async function main(): Promise<void> {
	const base = process.argv[2] ?? "main";
	const { stdout } = await run("git", ["diff", "--name-only", `${base}...HEAD`], { cwd: ROOT });
	const changed = stdout
		.split("\n")
		.filter((path) => /\.(ts|tsx)$/.test(path) && path.startsWith("packages/") && !isTestPath(path));

	/*
	 * 再导出的那几行先去掉，而不是把整个文件跳过。
	 *
	 * 第一版是按文件跳的：只要一个 `index.ts` 里有 `export { x } from`，整份就不算引用了。
	 * 于是 `tools/index.ts` 这种既是货架、又真的在 `builtinTools()` 里组装工具表的文件，
	 * 它里面的每一次真实使用都被一起丢掉了——扫描器报出了一个注册得好好的工具。
	 *
	 * 一个查「有没有人用」的工具，自己先漏报，是最不该发生的事。
	 */
	const bodies = new Map<string, string>();
	for (const path of await sourceFiles(join(ROOT, "packages"))) {
		const raw = await readFile(path, "utf8");
		bodies.set(path, raw.replace(/^export\s+(?:type\s+)?\{[^}]*\}\s*from\s*["'][^"']+["'];?\s*$/gm, ""));
	}

	const suspects: { name: string; file: string; testOnly: boolean; sameFile: boolean }[] = [];
	for (const rel of changed) {
		const abs = join(ROOT, rel);
		const source = bodies.get(abs);
		if (!source) continue;

		for (const match of source.matchAll(EXPORT)) {
			const name = match[1];
			const word = new RegExp(`\\b${name}\\b`, "g");

			let testOnly = false;
			let used = false;
			for (const [path, body] of bodies) {
				if (path === abs || !word.test(body)) continue;
				word.lastIndex = 0;
				const where = relative(ROOT, path);
				if (isTestPath(where)) testOnly = true;
				else {
					used = true;
					break;
				}
			}
			if (used) continue;

			// 定义之外还出现过 = 同文件自己在用，多半是顺手导出的内部辅助。
			const inOwnFile = (source.match(word) ?? []).length > 1;
			suspects.push({ name, file: rel, testOnly, sameFile: inOwnFile });
		}
	}

	const real = suspects.filter((s) => !s.sameFile);
	say(`\n扫了 ${changed.length} 个相对 ${base} 改动过的源文件\n`);

	if (real.length === 0) {
		say("没有找到产品代码里无人调用的导出。\n");
	} else {
		say(`${RED}${real.length} 个导出，产品代码里没有调用者${OFF}：\n`);
		for (const item of real) say(`  ${item.name.padEnd(28)} ${item.file}  ${item.testOnly ? "（只有测试用）" : "（连测试都没有）"}`);
		say("");
	}

	const skipped = suspects.length - real.length;
	if (skipped > 0) say(`${DIM}另有 ${skipped} 个只在自己文件里用（内部辅助顺手导出的，通常不是问题）。${OFF}\n`);
}

await main();
