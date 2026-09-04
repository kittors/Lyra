/**
 * 每天都会变的那点东西，放在前缀的末尾而不是开头。
 *
 * 日期本来写在 system prompt 里。而 provider 的前缀缓存是从**最前面**开始逐段匹配的，
 * system prompt 又正好是最前面那一段——里面有一个每天变一次的字符串，意味着每天头一次请求，
 * 整个对话（system prompt、工具定义、全部历史）一个字节都用不上缓存。
 *
 * 一个几十万 token 的长会话，为了一句「今天是几号」重付一次全额。
 *
 * 把它挪到消息末尾，跨天时失效的就只有末尾这一小块，前面全部照旧命中。
 *
 * **不进转录。** 它在请求拼装的时候产生，`log` 里没有它——一条「今天是几号」每轮都出现在
 * 对话里，是在给读转录的人添一行永远不用读的东西。
 */

import type { Message } from "../types.ts";

/** 今天，按本地时区。模型的训练截止日期不是今天，这是它唯一的来源。 */
export function today(now = new Date()): string {
	return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

/**
 * 把环境信息接在消息末尾。
 *
 * 用 `<env>` 包起来并且说明它是什么：这条消息在结构上占的是「用户最后说的话」那个位置，
 * 不说清楚的话，模型会把它当成刚收到的指令。
 *
 * `synthetic` 标着它不是人说的——`clearActiveSkill`、纠正分类器、记忆抽取都按这个字段
 * 区分「谁在说话」，漏标会让一条日期播报被当成用户的一次发言。
 */
export function withEnvironment(messages: Message[], date = today()): Message[] {
	if (messages.length === 0) return messages;
	return [
		...messages,
		{
			role: "user",
			content: [{ type: "text", text: `<env>\n今天是 ${date}。这是环境信息，不是用户的请求。\n</env>` }],
			timestamp: Date.now(),
			synthetic: true,
		},
	];
}
