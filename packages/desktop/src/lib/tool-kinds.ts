/**
 * 一次工具调用、一段工具调用，用人话怎么说。
 *
 * 从 `conversation/ToolGroup.tsx` 搬来：对话里那一行「读取文件 3 个」、子智能体输入框上方那条和
 * 面板顶上的「此刻在做什么」，说的是同一件事，应该是同一种说法。子智能体那几处从前直接摆 core 给的
 * 英文摘要（`Read README.md`、`Search "signIn"`），和旁边转录里的「读取文件 README.md」对不上。
 */

import { formatList } from "../i18n/list.ts";
import { translate } from "../i18n/translate.ts";
import type { MessageKey } from "../i18n/messages/index.ts";
import { baseName } from "./paths.ts";

/**
 * What a run of calls did, in the words someone would use to describe it afterwards.
 *
 * Grouped by the kind of action rather than by tool name, because "读取" is what three different
 * tools amount to from the outside. One action of one kind names its subject — that is the case
 * where the detail fits and is worth having; anything more is counted.
 */
export function describeRun(calls: { toolName: string; subject?: string }[]): string {
	const buckets = new Map<string, string[]>();
	for (const call of calls) {
		const kind = KIND[call.toolName] ? translate(KIND[call.toolName]) : translate("tools.using");
		const list = buckets.get(kind) ?? [];
		if (call.subject) list.push(call.subject);
		buckets.set(kind, list);
	}

	const counts = new Map<string, number>();
	for (const call of calls) {
		const kind = KIND[call.toolName] ? translate(KIND[call.toolName]) : translate("tools.using");
		counts.set(kind, (counts.get(kind) ?? 0) + 1);
	}

	const parts: string[] = [];
	for (const [kind, count] of counts) {
		const subjects = buckets.get(kind) ?? [];
		// One of a kind, with a name worth saying: say it.
		if (count === 1 && subjects.length === 1) parts.push(`${kind} ${subjects[0]}`);
		// One of a kind with nothing to name — "执行命令 1 个" counts to one, which is just noise.
		else if (count === 1) parts.push(kind);
		else parts.push(translate("tools.countOf", { kind, count }));
	}
	return formatList(parts);
}

/*
 * 工具名到「它在做什么」的那个说法，存 key。
 *
 * 这张表在模块加载时成型，那会儿窗口还没说自己是哪种语言。译发生在读它的地方。
 */
const KIND: Record<string, MessageKey> = {
	write: "tools.create",
	edit: "tools.edit",
	read: "tools.read",
	bash: "tools.bash",
	bash_output: "tools.output",
	glob: "tools.find",
	grep: "tools.grep",
	ls: "tools.ls",
	todo_write: "tools.todo",
	web_fetch: "tools.fetch",
	web_search: "tools.webSearch",
	task: "tools.delegate",
	preview: "tools.preview",
	symbol: "tools.symbol",
	/*
	 * 技能、学习、回忆、语言服务、问一句——这五个从前不在表里，一律落到「使用 …」。
	 *
	 * 于是一行摘要读作「使用 3 个」，而那三个各是各的事。表里缺一项的代价不是报错，是那一行悄悄
	 * 变成一句废话——`describeRun` 的兜底本来就是给真正没见过的工具准备的，不是给自家工具的。
	 */
	skill: "tools.skill",
	learn: "tools.learn",
	recall: "tools.recall",
	lsp: "tools.lsp",
	ask_user: "tools.askUser",
	// 侧边聊天翻主对话用的那一个——它的工具组从前一律读作「使用工具 3 个」。
	read_main_chat: "tools.readMainChat",
};

/**
 * core 给的那句英文摘要（`Read src/a.ts`、`Search "x"`、`List .`），换成和转录里同一种说法。
 *
 * 那句话是每个工具的 `summarize` 写的，只有这几种固定的开头；认不出来的（命令的描述、网页的标题）
 * 原样留着——它们本来就是人写的话。
 */
const ACTIVITY: [RegExp, string, (match: RegExpMatchArray) => string][] = [
	[/^Read (.+)$/, "read", (m) => baseName(m[1])],
	[/^Write (.+)$/, "write", (m) => baseName(m[1])],
	[/^Edit (.+)$/, "edit", (m) => baseName(m[1])],
	[/^List (.+)$/, "ls", (m) => m[1]],
	[/^Find definition of (.+)$/, "symbol", (m) => m[1]],
	[/^Find (.+)$/, "glob", (m) => m[1]],
	[/^Search "(.+)"$/, "grep", (m) => m[1]],
	[/^Fetch (.+)$/, "web_fetch", (m) => m[1]],
];

export function describeActivity(summary: string): string {
	for (const [pattern, toolName, subject] of ACTIVITY) {
		const match = summary.match(pattern);
		if (match) return describeRun([{ toolName, subject: subject(match) }]);
	}
	return summary;
}
