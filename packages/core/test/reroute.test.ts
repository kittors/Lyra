/**
 * `cat a.txt` 被拦，`cat a.txt | wc -l` 放行——计划 06 §9 那一行验收。
 *
 * 前半是纯函数，测判据本身：什么算「纯粹的等价调用」，什么算「真的在组合」。后半是接线：
 * 会话真的把工具名填进了 state，`bash` 真的会去查——否则这个纯函数再对也永远不会被调到。
 */

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { DEFAULT_SETTINGS } from "../src/config/settings.ts";
import { rerouteShellCommand, TOOL_NAMES_KEY } from "../src/tools/reroute.ts";
import { bashTool } from "../src/tools/bash.ts";
import { SessionCapabilities } from "../src/runtime/session-capabilities.ts";
import type { ToolResult } from "../src/types.ts";

let root: string;
before(async () => {
	root = await mkdtemp(join(tmpdir(), "ly-reroute-"));
});
after(async () => {
	await rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 25 });
});

const ALL = new Set(["read", "grep", "glob", "ls", "bash"]);

// ---------------------------------------------------------------------------
// 判据
// ---------------------------------------------------------------------------

test("裸的 cat/head/tail 改道到 read", () => {
	assert.equal(rerouteShellCommand("cat src/a.ts", ALL)?.tool, "read");
	assert.equal(rerouteShellCommand("head -20 README.md", ALL)?.tool, "read");
	assert.equal(rerouteShellCommand("  tail -n 50 log.txt", ALL)?.tool, "read");
});

test("裸的 grep/rg、find/fd、ls 各改道到对应工具", () => {
	assert.equal(rerouteShellCommand("grep -rn foo src", ALL)?.tool, "grep");
	assert.equal(rerouteShellCommand("rg 'TODO' .", ALL)?.tool, "grep");
	assert.equal(rerouteShellCommand("find . -name '*.ts'", ALL)?.tool, "glob");
	assert.equal(rerouteShellCommand("ls -la src", ALL)?.tool, "ls");
});

test("有管道、重定向、串联就放行——那是真的在组合", () => {
	/*
	 * `cat a | wc -l` 在算行数，`cat a > b` 在复制，`cat a && echo` 在串联。每一种都有 `read`
	 * 给不了的东西。拦了它们，模型下一步就是把同一件事拆成三次调用。
	 */
	for (const composed of [
		"cat a.txt | wc -l",
		"cat a.txt > b.txt",
		"cat a.txt >> b.txt",
		"cat a.txt && echo done",
		"cat a.txt; echo done",
		"grep foo src | head",
		"find . -name x | xargs rm",
		"ls -la | grep ts",
		"cat $(ls | head -1)",
		"cat `ls | head -1`",
		"sort < a.txt",
	]) {
		assert.equal(rerouteShellCommand(composed, ALL), null, composed);
	}
});

test("不在表里的命令不管", () => {
	for (const other of ["echo hi", "pnpm test", "git status", "node x.js", "cat"]) {
		assert.equal(rerouteShellCommand(other, ALL), null, other);
	}
});

test("多行脚本放行", () => {
	// 第一行是 cat 的多行脚本，后面多半跟着别的东西；那是脚本，不是「一次 cat」。
	assert.equal(rerouteShellCommand("cat a.txt\necho done", ALL), null);
});

test("建议的工具不在这个会话里就放行", () => {
	/*
	 * 一个 `allowed-tools: [bash]` 的技能会话里说「用 read」，是把模型推向一个不存在的门。
	 * 它会照着做、被拒、再试 cat、再被拦——直到轮次用完。
	 */
	const bashOnly = new Set(["bash"]);
	assert.equal(rerouteShellCommand("cat a.txt", bashOnly), null);
	assert.equal(rerouteShellCommand("grep x .", new Set(["bash", "read"])), null, "有 read 没 grep");
});

test("没有工具名集合就一律放行——那是开关关了", () => {
	assert.equal(rerouteShellCommand("cat a.txt", undefined), null);
});

test("改道的话里说的是建议的那个工具", () => {
	// 消息就是工具结果，模型靠它决定下一步。说错工具名等于指错路。
	assert.match(rerouteShellCommand("cat a.txt", ALL)?.message ?? "", /`read`/);
	assert.match(rerouteShellCommand("find . -name x", ALL)?.message ?? "", /`glob`/);
});

// ---------------------------------------------------------------------------
// 接线
// ---------------------------------------------------------------------------

test("bash 工具真的会查这个 key", async () => {
	/*
	 * 纯函数测再多，`bash` 不调它也是零。这条直接调 `bash.execute`，不起沙箱——改道发生在
	 * 沙箱之前，命令根本不会跑。
	 */
	const state = new Map<string, unknown>([[TOOL_NAMES_KEY, ALL]]);
	const result = (await bashTool.execute({ command: "cat package.json" }, { cwd: root, sessionId: "t", state })) as ToolResult;
	assert.equal(result.isError, true, "该是一个错误结果");
	assert.match(result.content.map((c) => (c.type === "text" ? c.text : "")).join(""), /`read`/);
});

test("会话加载时把工具名填进 state；开关关了就不填", async () => {
	const on = new SessionCapabilities();
	await on.load(root, { ...DEFAULT_SETTINGS, mcpServers: [] });
	const names = on.state.get(TOOL_NAMES_KEY) as Set<string> | undefined;
	assert.ok(names instanceof Set, "默认开：该有集合");
	assert.ok(names.has("read") && names.has("bash"), `集合里该有内置工具：${[...names].join("、")}`);

	const off = new SessionCapabilities();
	await off.load(root, { ...DEFAULT_SETTINGS, mcpServers: [], rerouteShellCommands: false });
	assert.equal(off.state.get(TOOL_NAMES_KEY), undefined, "关了：不填，让 bash 一律放行");
});
