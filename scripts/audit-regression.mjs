/**
 * 这次审计整改修过的每一条，各自的守卫跑一遍。
 *
 * 为什么要有这个文件：整改摊在十几个提交里，每一条都配了测试，但那些测试散在七个包的 `test/`
 * 下面。`pnpm test` 全绿只说明「三千八百条里没有红的」，说不出「C1 那五个工具还在吗」——而问
 * 「那一条还在吗」才是回归测试要回答的问题。这里把问题和守它的东西写成一张表，跑完逐条报。
 *
 * 一条没有守卫的修复等于没修：下一个人重构到那里，没有任何东西会告诉他。所以这张表也是一份
 * 检查——某条修复在这里找不到守卫，那是需要补测试，不是需要放过。
 *
 * 用法：
 *   node scripts/audit-regression.mjs          单测与门禁，约一分钟，不弹窗口
 *   node scripts/audit-regression.mjs --window  再加上要真窗口的那几条（会抢焦点几分钟）
 *
 * 真窗口那几条默认不跑，理由是它们会把窗口摆到屏幕上抢焦点，而其中依赖真实指针位置的探针在
 * 人正在用电脑时结果不可信（`screenshot-probe` 实测在 1 到 11 个问题之间跳，基线同样跳）。
 */

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const withWindow = process.argv.includes("--window");

/**
 * 一条修复，和证明它还在的那个东西。
 *
 * `id` 是审计报告里的编号，`what` 是当初错在哪——写成「症状」而不是「改了什么」，因为回归的时候
 * 人看见的是症状。
 */
const CHECKS = [
	{
		id: "C1",
		what: "recall/rule/learn/lsp/web_search 五个工具没被告知给模型",
		run: ["node", ["--experimental-strip-types", "--test", "packages/core/test/tool-registry.test.ts"]],
	},
	{
		id: "S2",
		what: "压缩缝只转四个参数，桌面端丢了 overhead/artifacts/summarizer",
		run: ["node", ["--experimental-strip-types", "--test", "packages/core/test/compaction-seam.test.ts", "packages/core/test/compaction-outline.test.ts"]],
	},
	{
		id: "S1",
		what: "主进程的 ipcMain.handle 没有任何东西和契约比对",
		run: ["pnpm", ["--filter", "@lyra/contract", "test"]],
	},
	{
		id: "H1",
		what: "命令分类器的七条绕过（env 包装、bash -c、git 全局选项、长选项、任意解释器管道、双引号里的 $()、换行）",
		run: ["node", ["--experimental-strip-types", "--test", "packages/core/test/risk-bypass.test.ts", "packages/core/test/risk.test.ts"]],
	},
	{
		id: "H2",
		what: "密钥读侧无审批，以及沙箱网络轴配了传不下去",
		run: ["node", ["--experimental-strip-types", "--test", "packages/core/test/sandbox-bash.test.ts"]],
	},
	{
		id: "H3",
		what: "七条 HTTP 写路由绕过手机白名单，sessions.create 的 cwd 不限项目",
		run: ["node", ["--test", "--import", "./packages/desktop/test/setup.ts", "--experimental-strip-types", "packages/desktop/test/sync-rpc.test.ts"]],
	},
	{
		id: "S3",
		what: "Anthropic 把半截流当完整回答；空闲闸只挂在一条链上",
		run: ["node", ["--experimental-strip-types", "--test", "packages/core/test/anthropic-truncated-stream.test.ts", "packages/core/test/anthropic-wire-stream.test.ts"]],
	},
	{
		id: "I3",
		what: "YAML 解析失败时把解析器的原话丢了",
		run: ["node", ["--experimental-strip-types", "--test", "packages/core/test/skill-frontmatter.test.ts"]],
	},
	{
		id: "I4-relay",
		what: "中转单连接内存无上限（超大帧头让缓冲永不清空）",
		run: ["node", ["--experimental-strip-types", "--test", "packages/relay/test/relay-security.test.ts"]],
	},
	{
		id: "I4-worktree",
		what: "删工作树失败后无条件 rm -rf，而那个 IPC 没有路径守卫",
		run: ["node", ["--test", "--import", "./packages/desktop/test/setup.ts", "--experimental-strip-types", "packages/desktop/test/git-worktrees.test.ts"]],
	},
	{
		id: "I1-i18n",
		what: "i18n 检查器的两个盲点（字符串里的 // 当注释、JSX 文本遇 > 就断）",
		run: ["node", ["--experimental-strip-types", "--test", "test/check-i18n.test.ts"]],
	},
	{
		id: "I1-scan",
		what: "硬编码中文（那四条漏网的）",
		run: ["node", ["scripts/check-i18n.mjs"]],
	},
	{
		id: "I2",
		what: "文档里七处过期数字",
		run: ["node", ["--experimental-strip-types", "--test", "test/docs-numbers.test.ts"]],
	},
	{
		id: "S5+I4-arch",
		what: "循环依赖没有棘轮；store 伸进功能域点名文件没人管",
		run: ["pnpm", ["arch"]],
	},
	{
		id: "S6",
		what: "十一条 React 编译器规则整块关掉且没有理由",
		run: ["pnpm", ["lint"]],
	},
	{
		id: "knip",
		what: "191 个未用导出，而 CI 里那条检查永远不会红",
		run: ["pnpm", ["knip"]],
	},
	{
		id: "S7-annotate",
		what: "标注拆成三个文件之后还画得出来吗",
		window: true,
		run: ["node", ["--experimental-strip-types", "packages/desktop/e2e/annotator-probe.ts", "/tmp/regression-annot"]],
	},
	{
		id: "S7-capture",
		what: "截图浮层拆出两个 hook 之后，退出与连续两次捕获还对吗",
		window: true,
		run: ["node", ["--experimental-strip-types", "packages/desktop/e2e/screenshot-exit-probe.ts", "/tmp/regression-exit"]],
	},
	{
		id: "C1-window",
		what: "那五个工具在跑起来的桌面端里真的出现在工具清单上吗",
		window: true,
		run: ["node", ["--experimental-strip-types", "packages/desktop/e2e/audit-fixes-demo.ts", "/tmp/regression-tools"]],
	},
];

const pass = [];
const fail = [];
const skipped = [];

for (const check of CHECKS) {
	if (check.window && !withWindow) {
		skipped.push(check);
		continue;
	}
	const [cmd, args] = check.run;
	process.stdout.write(`  ${check.id} … `);
	const result = spawnSync(cmd, args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
	const ok = result.status === 0;
	(ok ? pass : fail).push({ ...check, output: `${result.stdout ?? ""}${result.stderr ?? ""}` });
	console.log(ok ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m");
}

console.log("");
for (const check of pass) console.log(`\x1b[32m✓\x1b[0m ${check.id.padEnd(14)} ${check.what}`);
for (const check of skipped) console.log(`\x1b[33m—\x1b[0m ${check.id.padEnd(14)} ${check.what}（要真窗口，加 --window）`);
for (const check of fail) {
	console.log(`\n\x1b[31m✗ ${check.id}\x1b[0m ${check.what}`);
	// 尾部够看出哪条断言红了，而不是把一整份测试输出倒出来。
	console.log(
		check.output
			.split("\n")
			.filter((line) => line.trim())
			.slice(-14)
			.map((line) => `    ${line}`)
			.join("\n"),
	);
}

console.log(
	`\n${fail.length === 0 ? "\x1b[32m" : "\x1b[31m"}${pass.length} 条守住，${fail.length} 条回归${
		skipped.length ? `，${skipped.length} 条没跑` : ""
	}\x1b[0m`,
);
process.exitCode = fail.length === 0 ? 0 : 1;
