/**
 * `grep` against the two things a real disk throws at it: paths it may not read, and CRLF files.
 *
 * ripgrep is driven through a stand-in here, a shell script put first on `PATH`, because the
 * failures are about the process rather than the search — a stderr nobody drained, an exit code read
 * too strictly — and a real ripgrep only produces them on a tree like `/proc` or `C:\Windows`. The
 * stand-in reports a file that does not exist (`rg-only.txt`), so a result naming it can only have
 * come from ripgrep, and one naming `sample.txt` from the built-in scanner redoing the search.
 *
 * The CRLF cases run through whichever ripgrep is installed and through the built-in scanner.
 */

import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { test, type TestContext } from "node:test";
import { grepTool } from "../src/tools/grep.ts";

const FAKE_RG = `#!/bin/sh
printf '%s\\n' "$@" >> "$FAKE_RG_ARGV"
root=""
for arg in "$@"; do root="$arg"; done
i=0
while [ "$i" -lt "\${FAKE_RG_ERRORS:-0}" ]; do
	echo "rg: $root/denied-$i: Permission denied (os error 13)" >&2
	i=$((i + 1))
done
if [ -n "$FAKE_RG_STDERR" ]; then echo "$FAKE_RG_STDERR" >&2; fi
case " $* " in
	*" --json "*)
		if [ "$FAKE_RG_MATCH" = 1 ]; then
			printf '{"type":"match","data":{"path":{"text":"%s/rg-only.txt"},"lines":{"text":"from-ripgrep\\\\n"},"line_number":1,"submatches":[{"match":{"text":"from"},"start":0,"end":4}]}}\\n' "$root"
		fi
		if [ "$FAKE_RG_SUMMARY" = 1 ]; then printf '{"type":"summary","data":{}}\\n'; fi
		;;
	*" --files-with-matches "*)
		if [ "$FAKE_RG_MATCH" = 1 ]; then printf '%s/rg-only.txt\\n' "$root"; fi
		;;
	*)
		if [ "$FAKE_RG_MATCH" = 1 ]; then printf '%s/rg-only.txt:1:from-ripgrep\\n' "$root"; fi
		;;
esac
exit "\${FAKE_RG_EXIT:-0}"
`;

interface FakeRg {
	errors?: number;
	stderr?: string;
	match: boolean;
	summary: boolean;
	exit: number;
}

const NO_SHELL_SPAWN = process.platform === "win32" ? "a shell script cannot stand in for rg.exe without spawning through a shell" : false;

/** A workspace whose only file the built-in scanner can find, and a stand-in rg first on PATH. */
async function withFakeRg(t: TestContext, behaviour: FakeRg): Promise<{ dir: string; argv: () => Promise<string[]> }> {
	const dir = await mkdtemp(join(tmpdir(), "lyra-grep-rg-"));
	const bin = await mkdtemp(join(tmpdir(), "lyra-grep-bin-"));
	await writeFile(join(dir, "sample.txt"), "from-fallback\n");
	await writeFile(join(bin, "rg"), FAKE_RG);
	await chmod(join(bin, "rg"), 0o755);
	const argvLog = join(bin, "argv.log");
	await writeFile(argvLog, "");

	const saved = { ...process.env };
	process.env.PATH = `${bin}${delimiter}${saved.PATH ?? ""}`;
	process.env.FAKE_RG_ARGV = argvLog;
	process.env.FAKE_RG_ERRORS = String(behaviour.errors ?? 0);
	process.env.FAKE_RG_STDERR = behaviour.stderr ?? "";
	process.env.FAKE_RG_MATCH = behaviour.match ? "1" : "0";
	process.env.FAKE_RG_SUMMARY = behaviour.summary ? "1" : "0";
	process.env.FAKE_RG_EXIT = String(behaviour.exit);
	t.after(async () => {
		for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
		Object.assign(process.env, saved);
		await rm(dir, { recursive: true, force: true });
		await rm(bin, { recursive: true, force: true });
	});
	return { dir, argv: async () => (await readFile(argvLog, "utf8")).split("\n").filter(Boolean) };
}

const ctx = (cwd: string, signal?: AbortSignal) => ({ cwd, sessionId: "s", state: new Map<string, unknown>(), signal });
const textOf = (res: Awaited<ReturnType<typeof grepTool.execute>>) => res.content.map((part) => ("text" in part ? part.text : "")).join("");

test("stderr 写满管道也不会把 rg 卡住", { skip: NO_SHELL_SPAWN }, async (t) => {
	// ~200KB of permission errors, well past a pipe's buffer. Undrained, the stand-in blocks on the
	// write and never exits; the timeout is what turns that hang into a failure instead of a stuck run.
	const { dir } = await withFakeRg(t, { errors: 3000, match: true, summary: true, exit: 0 });
	const started = Date.now();
	const res = await grepTool.execute({ pattern: "from" }, ctx(dir, AbortSignal.timeout(5_000)));
	assert.match(textOf(res), /rg-only\.txt:1:from-ripgrep/, "ripgrep 找到的结果要原样交回来");
	assert.ok(Date.now() - started < 4_000, `不该等到超时才结束，实际 ${Date.now() - started}ms`);
});

test("rg 出过错（退出码 2）但找到了匹配：结果照用，错误附在后面", { skip: NO_SHELL_SPAWN }, async (t) => {
	const { dir } = await withFakeRg(t, { errors: 5, match: true, summary: true, exit: 2 });
	const text = textOf(await grepTool.execute({ pattern: "from" }, ctx(dir)));
	assert.match(text, /rg-only\.txt:1:from-ripgrep/, "退出码 2 时 ripgrep 的匹配不能被丢掉");
	assert.doesNotMatch(text, /from-fallback/, "不该再让内置扫描器重搜一遍");
	assert.match(text, /5 errors/, "要说清楚有多少处读不了");
	assert.match(text, /denied-0: Permission denied/, "要给出错误原文，模型才知道缺的是哪里");
	assert.match(text, /2 more/, "只列前几条，其余给个数");
});

test("只列文件时同样：退出码 2 带着匹配不算失败", { skip: NO_SHELL_SPAWN }, async (t) => {
	const { dir } = await withFakeRg(t, { errors: 1, match: true, summary: false, exit: 2 });
	const text = textOf(await grepTool.execute({ pattern: "from", files_only: true }, ctx(dir)));
	assert.match(text, /rg-only\.txt/);
	assert.doesNotMatch(text, /sample\.txt/);
});

test("rg 搜完了（有 summary）但没找到、只是有路径读不了：直接回答没有，不再慢扫一遍", { skip: NO_SHELL_SPAWN }, async (t) => {
	const { dir } = await withFakeRg(t, { errors: 2, match: false, summary: true, exit: 2 });
	const res = await grepTool.execute({ pattern: "from" }, ctx(dir));
	const text = textOf(res);
	assert.doesNotMatch(text, /from-fallback/, "ripgrep 已经搜完了，内置扫描器不该接手");
	assert.match(text, /No matches/);
	assert.match(text, /2 errors/);
});

test("正则 rg 编不过（退出码 2、没有任何输出）：仍然交给内置扫描器", { skip: NO_SHELL_SPAWN }, async (t) => {
	// ripgrep's engine lacks look-around; the JavaScript one has it. That hand-off must survive.
	const { dir } = await withFakeRg(t, { stderr: "rg: regex parse error:", match: false, summary: false, exit: 2 });
	const text = textOf(await grepTool.execute({ pattern: "(?<=from-)fallback" }, ctx(dir)));
	assert.match(text, /sample\.txt:1:from-fallback/);
});

test("调用 rg 时带上 --crlf", { skip: NO_SHELL_SPAWN }, async (t) => {
	const { dir, argv } = await withFakeRg(t, { match: false, summary: true, exit: 1 });
	await grepTool.execute({ pattern: "x$" }, ctx(dir));
	await grepTool.execute({ pattern: "x$", files_only: true }, ctx(dir));
	const log = await argv();
	assert.equal(log.filter((arg) => arg === "--crlf").length, 2, `两次调用都要带 --crlf，实际参数：${log.join(" ")}`);
});

for (const fallback of [false, true]) {
	test(`CRLF 与 BOM 文件：$ 与 ^ 照常锚定，输出里不带 \\r (fallback=${fallback})`, async (t) => {
		const dir = await mkdtemp(join(tmpdir(), "lyra-grep-crlf-"));
		t.after(() => rm(dir, { recursive: true, force: true }));
		await writeFile(join(dir, "crlf.txt"), "\uFEFFhead foo\r\nbeta\r\nfoo\r\n");
		const path = process.env.PATH;
		if (fallback) process.env.PATH = "";
		t.after(() => { process.env.PATH = path; });

		const tail = textOf(await grepTool.execute({ pattern: "foo$" }, ctx(dir)));
		assert.match(tail, /crlf\.txt:1:head foo$/m, "行尾是 \\r\\n 的行，foo$ 也要匹配");
		assert.match(tail, /crlf\.txt:3:foo$/m);
		assert.ok(!tail.includes("\r"), "输出给模型的行不能带 \\r");

		const head = textOf(await grepTool.execute({ pattern: "^head" }, ctx(dir)));
		assert.match(head, /crlf\.txt:1:head foo$/m, "第一行前面的 BOM 不能挡住 ^");
		assert.ok(!head.includes("\uFEFF"), "输出里不能带 BOM");
	});
}
