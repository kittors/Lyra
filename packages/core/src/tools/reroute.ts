/**
 * 把 `cat a.txt` 改道到 `read`，而不是在提示词里说第十遍。
 *
 * 提示词是建议，拦截是保证。`bash` 的 guidelines 早就写着「用 read 别用 cat」，而模型照样
 * `cat`——不是没读到，是 `cat` 更顺手。一个错误结果比一句劝告有效得多：模型看见错误会改，
 * 看见劝告只会记一会儿。
 *
 * 只拦**纯粹的等价调用**。`cat a.txt | wc -l` 在算行数，那是 bash 的正当用途；`cat a > b` 在
 * 复制；`cat a && echo done` 在组合。任何管道、重定向、串联出现，都说明这条命令有 `read` 给
 * 不了的东西，放行。
 *
 * 建议的工具必须在当前会话里可用。一个被收窄了工具集的技能会话（`allowed-tools: [bash]`）
 * 里说「用 read」，是把它推向一个不存在的门。
 */

export interface Reroute {
	/** 该用哪个工具。 */
	tool: string;
	/** 给模型看的那句话——它就是工具结果。 */
	message: string;
}

/** 当前会话有哪些工具，`SessionCapabilities.load` 填进 state。没有这个 key 就是关了。 */
export const TOOL_NAMES_KEY = "toolNames";

/**
 * 命中一条就是等价调用；`[^|<>;&`$]*$` 是「后面没有任何组合」。
 *
 * 表按命令名匹配行首，不试图解析 shell——一个 shell 解析器是另一个项目，而这里要挡的只是
 * 最常见的那四五个字。
 */
const REROUTES: { pattern: RegExp; tool: string; message: string }[] = [
	{
		pattern: /^\s*(?:cat|head|tail)\s+[^|<>;&`$]+$/,
		tool: "read",
		message: "用 `read` 读文件——它带行号、有结构视图、大文件会给摘要，而且下一次 `edit` 会认得这份快照。`cat` 只在管道里用。",
	},
	{
		pattern: /^\s*(?:rg|grep|egrep|fgrep)\s+[^|<>;&`$]+$/,
		tool: "grep",
		message: "用 `grep` 工具搜——它不受 shell 引号转义的折磨，结果带文件名和行号，而且会跳过 node_modules。",
	},
	{
		pattern: /^\s*(?:find|fd)\s+[^|<>;&`$]+$/,
		tool: "glob",
		message: "用 `glob` 找文件——按模式匹配，结果是干净的路径列表。",
	},
	{
		pattern: /^\s*ls\s+[^|<>;&`$]+$/,
		tool: "ls",
		message: "用 `ls` 工具列目录——它会标出目录和文件，而且不会把颜色转义码带进结果。",
	},
];

/**
 * 这条命令该不该改道。null 就是照常跑。
 *
 * `available` 是 undefined 时一律放行：那意味着这个会话没填工具名（开关关了，或者是个没有
 * 能力层的裸调用），而在不知道有没有 `read` 的情况下让模型去用 `read`，比让它 `cat` 更糟。
 */
export function rerouteShellCommand(command: string, available: ReadonlySet<string> | undefined): Reroute | null {
	if (!available) return null;
	/*
	 * 只看第一行。多行命令是脚本，不是「一次 cat」——而第一行匹配到 `cat` 的多行脚本，
	 * 后面多半跟着别的东西。
	 */
	const first = command.split("\n")[0];
	if (command.includes("\n") && command.trim().split("\n").filter((l) => l.trim()).length > 1) return null;

	for (const { pattern, tool, message } of REROUTES) {
		if (!pattern.test(first)) continue;
		if (!available.has(tool)) return null;
		return { tool, message };
	}
	return null;
}
