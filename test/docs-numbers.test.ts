/**
 * 文档里写死的数字，对着仓库数一遍。
 *
 * AGENTS.md 是给 agent 读的，它读到的数字一个都不对：2086 个单元测试（实际三千八）、六个包
 * （七个）、21 个功能域（22）、157 个 IPC 方法（199）、九个目录（10）、53 条循环依赖（159）。
 * 单看每条都是小事，合起来是这份规范一边写着「拿到数，不要拿感觉」，一边自己全是旧数。
 *
 * 所以这里只守**能数出来的**那几个。数不出来的（单元测试条数、e2e 稳定失败是哪几条）已经从文
 * 档里删掉了——一个只会过期又不影响任何决定的数字，正确的做法是不写，而不是写了再守。
 *
 * 数错了改文档，不是改这里的期望值：这个文件里的每个数都是现数的。
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");
const dirsIn = (path: string) =>
	readdirSync(join(root, path)).filter((name) => statSync(join(root, path, name)).isDirectory());

/**
 * 一份文档里所有写着「N 个<名字>」的地方。
 *
 * 找的是数字本身而不是整句话，这样改写句子不会让检查失效——`21 个功能域` 变成
 * `功能域有 21 个` 仍然会被同一条断言抓住。
 */
function counts(markdown: string, noun: string): number[] {
	const found: number[] = [];
	for (const match of markdown.matchAll(new RegExp(`(\\d+)\\s*(?:个|条)?\\s*${noun}`, "g"))) {
		found.push(Number(match[1]));
	}
	for (const match of markdown.matchAll(new RegExp(`${noun}[^。\\n]{0,6}?(\\d+)\\s*(?:个|条)`, "g"))) {
		found.push(Number(match[1]));
	}
	return found;
}

const agents = read("AGENTS.md");
const architecture = read("ARCHITECTURE.md");

test("包的数目", () => {
	const actual = dirsIn("packages").length;
	assert.equal(actual, 7, "先确认现数是多少，再看文档");
	for (const written of counts(agents, "个包")) {
		assert.equal(written, actual, "AGENTS.md 里写的包数和 packages/ 下的目录数对不上");
	}
});

test("功能域的数目", () => {
	const actual = dirsIn("packages/desktop/src/features").length;
	assert.equal(actual, 22);
	for (const source of [agents, architecture, read("docs/adr/0011-renderer-is-nine-directories.md")]) {
		for (const written of counts(source, "个功能域").concat(counts(source, "个用户看得见的域"))) {
			assert.equal(written, actual);
		}
	}
});

test("渲染进程顶层目录的数目", () => {
	const actual = dirsIn("packages/desktop/src").length;
	assert.equal(actual, 10);
	for (const source of [agents, architecture, read("docs/adr/0011-renderer-is-nine-directories.md")]) {
		for (const written of counts(source, "个目录").concat(counts(source, "个顶层目录"))) {
			assert.equal(written, actual);
		}
	}
});

test("契约方法的数目", () => {
	// 数的是 `channel:` 而不是导出的常量：这个文件是一张表，表的行数就是方法数。
	const actual = (read("packages/contract/src/methods.ts").match(/channel: "/g) ?? []).length;
	assert.equal(actual, 199);
	for (const source of [agents, read("docs/adr/0012-one-contract-not-three.md")]) {
		for (const written of counts(source, "个方法").concat(counts(source, "个 invoke"))) {
			assert.equal(written, actual);
		}
	}
});

/*
 * 循环依赖那条不数代码，读基线文件。
 *
 * 真去跑一次 `depcruise` 要二十多秒，而这里要问的本来也不是「现在有几条」——`pnpm arch` 每次
 * 都会把那个数印出来，棘轮也在那边。这里只要求文档说的和基线里的一样多，也就是说，谁重新生成
 * 了基线、谁就得顺手把 ARCHITECTURE.md 改了。
 */
test("循环依赖的数目", () => {
	const baseline = JSON.parse(read(".dependency-cruiser-known-violations.json")) as Array<{ rule: { name: string } }>;
	const actual = baseline.filter((one) => one.rule.name === "no-circular").length;
	assert.equal(actual, 159);
	for (const written of counts(architecture, "条的基线").concat(counts(architecture, "条循环"))) {
		assert.equal(written, actual);
	}
});

/*
 * 最后一条不数数字，查一个说法。
 *
 * ARCHITECTURE.md 从前写着 e2e 的稳定失败「见 testing.md」，而那份文档里没有这个清单——一句
 * 指向空处的话比没有话更糟，它让人以为找过了。现在那里写的是「没有写下来过」；哪天真写了，
 * 这条测试会红，提醒把说法改回去。
 */
test("e2e 稳定失败的清单，要么在 testing.md 里，要么文档承认它不在", () => {
	const testing = read("docs/architecture/testing.md");
	const listed = /稳定失败|已知红|known failures/i.test(testing);
	const admits = architecture.includes("没有写下来过");
	assert.ok(listed || admits, "两边都没有：清单不在 testing.md，而 ARCHITECTURE.md 又说它在");
	assert.equal(listed, false, "清单进了 testing.md，把 ARCHITECTURE.md 那句「没有写下来过」换成指路");
});

/*
 * 版本号那八处已经有 `test/version-sync.test.ts` 守着，这里不重复。
 * 下面这条守的是另一件事：`pnpm arch` 的输出里必须还有那个数，否则棘轮就退回成一句口号。
 */
test("pnpm arch 仍然把循环依赖的数目印出来", () => {
	const out = execFileSync("pnpm", ["arch"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
	assert.match(out, /known violations ignored/, "基线机制没生效，或者输出不再报数");
	assert.match(out, /159 known violations/);
});
