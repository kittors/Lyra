/**
 * 一张还没有运行记录的工具卡，该说自己在跑，还是说自己出了错。
 *
 * 两条路都要照顾，而它们互相拉扯：
 *
 *   - 记录**丢了**的卡片不能永远转圈。provider 没给 id、会话在命令中途重载，这种卡从前默认
 *     `running`，于是坐在那里一直数秒数，数到天荒地老。
 *   - 记录**还没建立**的卡片不能说自己失败了。这是后加的一条：事件顺序是 `message_end` 先于
 *     `tool_start`——消息先定稿成 `toolUse`，工具才开跑并建立记录。中间那个窗口里，旧判据
 *     （`stopReason === "pending" ? "running" : "error"`）两头不靠，直接落到 `error`，于是卡片
 *     闪一下红叉再变成打勾。实测约一半概率出现，停留 27–85ms，一次返回多个工具调用时更容易撞上。
 *
 * 旧判据错在前提：它把「消息定稿了」当成「这一轮结束了」。而 `toolUse` 的字面意思就是
 * **我要调这些工具**——这一轮非但没结束，正要开始干活。
 *
 * 所以分三种：还在流式的，在跑；定稿成 `toolUse` **且这一轮确实还在跑**的，在跑；其余的——
 * 包括那条 `toolUse` 消息所属的会话早就停了（重载、崩溃、被中止）——才是记录丢了，报错。
 * 第二条里的 `turnRunning` 就是防止永远转圈的那把锁：轮次一停，卡片立刻给出结论。
 */

import type { AssistantMessage } from "@lyra/core";

export function toolCardFallback(
	stopReason: AssistantMessage["stopReason"],
	turnRunning: boolean,
): "running" | "error" {
	if (stopReason === "pending") return "running";
	if (stopReason === "toolUse" && turnRunning) return "running";
	return "error";
}
