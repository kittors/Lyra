/**
 * Transcript repairs shared by the main store and the side chat's.
 *
 * Lives on its own because the main store already imports the side one; putting this in either
 * would make the pair circular.
 */

import { translate } from "../i18n/translate.ts";
import type { AgentEvent, AssistantMessage, Message } from "@lyra/core";

/**
 * Close out a reply the stream never finished.
 *
 * `message_end` is what normally settles an assistant message, and it does not arrive if the
 * connection drops mid-turn — an upstream socket reset (`UND_ERR_SOCKET`) leaves the last reply
 * marked `pending` forever, so it never gets its usage line and reads as still being written
 * long after the turn died. The run is over by the time this event arrives, so the tail follows.
 */
export function settleTail(messages: Message[], event: Extract<AgentEvent, { type: "agent_end" }>): Message[] {
	const index = messages.findLastIndex((m) => m.role === "assistant" && m.stopReason === "pending");
	if (index === -1) return messages;
	const tail = messages[index] as AssistantMessage;
	const next = [...messages];
	next[index] = {
		...tail,
		stopReason: event.reason === "aborted" ? "aborted" : event.reason === "error" ? "error" : "stop",
		errorMessage: event.reason === "error" ? (event.error ?? tail.errorMessage) : tail.errorMessage,
	};
	return next;
}

/**
 * 一条读不出来的记录，画在它原来的位置上。
 *
 * 用 `assistant` 而不是造一个新门类：这一条要穿过十八个渲染函数、一个分组器和一个虚拟列表，而它们
 * 对门类的判断散在各处。选一个它们全都认得的形状，比在每处加一个分支安全得多——后者正是「加固」
 * 本身引入新崩溃的典型走法。
 */
function damagedRow(): Message {
	return {
		role: "assistant",
		content: [{ type: "text", text: translate("transcript.damagedRecord") }],
		timestamp: 0,
		stopReason: "error",
	} as Message;
}

/**
 * 把一条坏记录挡在渲染之外——**挡住，而不是指望它不出现**。
 *
 * 2026-09-11 修过一次同样的崩溃（`Cannot read properties of undefined (reading 'role')`），那次的
 * 标题是「转录里的一个空位不再掀翻整个界面」，做的却全是堵写入口：core 的三条路各加了一道校验，
 * 渲染端一行没动。于是承诺兑现了一半——空位少了一些来路，可一旦真的出现，界面照样整个白掉。用户
 * 在 Windows 上又撞到了同一句报错。
 *
 * 所以这里补上另一半。空位从哪来仍然没有证实（本机 231 个会话、五万行日志一条畸形都没有），但那是
 * 第二个问题：**一条坏记录不该让人失去整个窗口**，无论它从哪来。两道防线互相独立，缺一道就是现在
 * 这个样子。
 *
 * 位置必须保住，所以是替换不是过滤：`compactions`、`commandRuns`、`hiccups` 全是指进这个数组的下标，
 * 抽掉一条，它们就整体错位一格——一个「不崩」的版本画出一份对不上的转录，比崩更难发现。
 *
 * `Array.from` 而不是 `map`：稀疏数组的空洞会被 `map` **跳过**，原样留在结果里，等于这道闸门对最要
 * 命的那一种输入完全没有作用。
 *
 * 判据是 `role` 加 `content`，两个都要。只看 `role` 是第一版的写法，它漏掉了「role 合法而 content 坏了」
 * 那一种——报出来是 `content is not iterable`，白屏的程度一模一样。三种消息（user / assistant /
 * toolResult）的 `content` 都声明成数组，所以这里可以一视同仁。
 */
export function intact(messages: Message[]): Message[] {
	/*
	 * 没坏就把原来那个数组原样交回去——**同一个引用**。
	 *
	 * 这不是省一次拷贝的事。转录的每一处都靠引用相等来决定要不要重算：`runs`、`timeSeparators`、
	 * `questionsIn` 各自挂在 `useMemo` 上，行本身又是 memo 过的。每次都交出一个新数组，等于让几千条
	 * 消息的转录在每一次渲染里全部重算一遍——一道防线换来一场性能事故，而且正常情况下它什么也没防到。
	 */
	let damaged = 0;
	for (let index = 0; index < messages.length; index++) {
		if (!whole(messages[index])) damaged++;
	}
	if (damaged === 0) return messages;

	reportDamaged(messages, damaged);
	return Array.from({ length: messages.length }, (_, index) => {
		const message = messages[index];
		return whole(message) ? message : damagedRow();
	});
}

/** 一条记录画得出来吗——门类认得出，正文走得通。 */
function whole(message: Message | undefined): message is Message {
	return Boolean(
		message && typeof message === "object" && typeof message.role === "string" && Array.isArray(message.content),
	);
}

/**
 * 让这件事留下痕迹——下一次报上来的就不再只有一句报错。
 *
 * 上一轮查不下去，卡的就是这里：只知道「有个空位」，不知道它在第几条、前后是什么、是空洞还是
 * `undefined`。这几个字段足以把来源缩小到某一条写入路径上，而它们只有在真的发生时才拿得到。
 *
 * 控制台而不是弹窗：这是给拿到日志的人看的，不是给正在用的人看的——对后者来说，界面没白掉就已经是
 * 全部了。
 *
 * 也因此这几句话是英文的，没有走 i18n：读它的人是在翻日志找那条坏记录从哪来，不是在用这个应用。
 * `scripts/check-i18n.mjs` 数的是「界面上会出现的中文」，日志写成中文会被它算作没翻译的文案。
 */
function reportDamaged(messages: Message[], damaged: number): void {
	const spots: string[] = [];
	for (let index = 0; index < messages.length && spots.length < 5; index++) {
		const message = messages[index];
		if (whole(message)) continue;
		const hole = !(index in messages);
		const before = messages[index - 1];
		const after = messages[index + 1];
		spots.push(
			`#${index}${hole ? " (array hole)" : ` (${message === null ? "null" : typeof message})`}` +
				` prev=${before && typeof before === "object" ? before.role : "-"}` +
				` next=${after && typeof after === "object" ? after.role : "-"}`,
		);
	}
	console.error(
		`[transcript] ${damaged} of ${messages.length} records were unreadable and have been replaced in place, so the view stays up:\n  ${spots.join("\n  ")}`,
	);
}
