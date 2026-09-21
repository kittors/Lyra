/**
 * 主会话被撤空时，把旁边那场对话一起收掉。
 *
 * 侧边聊天讲的全是主会话里发生的事——它读主记录、分析、下结论。主会话一条不剩之后，那些结论
 * 悬在一段不再存在的历史上：面板上还写着「所有单测都过了、只剩推送超时」，而那整轮已经被撤掉
 * 了。它也不只是留在屏幕上——上一轮 `read_main_chat` 读到的旧记录、和基于它写出的结论，都还在
 * 侧边 agent 的上下文里，下一轮会被当成事实带进去（每次提问只换掉主会话快照，见 `sidechat.ts`）。
 *
 * 只在撤空时收，撤到中间不碰：那时主会话还在，那场讨论也还有依附的对象，它提到的事多半就在
 * 剩下的那一截里。收掉是有代价的——人在侧边问过的话一起没了，撤回主消息至少还把文本放回输入
 * 框，这个不会——所以只在「讨论的对象整个没了」这一种情形下才值当。走的是面板上那颗「重置」
 * 按钮的同一条路，包括把模型放回默认。
 *
 * 这条规则连同它的判断写在这里，而不是留在 `session-hub` 的调用处：那个文件一被 import 就拉起
 * Electron 和半个主进程，写在那儿的规则没有任何测试够得着。
 */

import type { SideChatUpdate } from "@lyra/core";
import { loadSideChatSnapshot, saveSideChat } from "./sidechat-store.ts";

/** 只用到侧边聊天的这两件事：它手上有没有东西，以及把它推倒重来。 */
interface LiveSideChat {
	state(): { messages: unknown[] };
	restart(): Promise<void>;
}

export interface DiscardSideChatIO {
	/** 撤回之后主会话还剩几条。一条不剩才收，见上面那段。 */
	mainMessagesLeft: number;
	/** 这个会话的侧边聊天实例，没建起来过就是 `undefined`。 */
	live: LiveSideChat | undefined;
	/** 重置之后它该用的模型，和「重置」按钮给的是同一个。 */
	defaultModelId: string | null;
	broadcast(event: SideChatUpdate): void;
}

export async function discardSideChat(sessionId: string, io: DiscardSideChatIO): Promise<void> {
	if (io.mainMessagesLeft > 0) return;
	if (io.live) {
		// 空的就别走一趟：`restart` 会中止、写存档、发三个事件，而这里什么都没有可收。
		if (io.live.state().messages.length > 0) await io.live.restart();
		return;
	}
	/*
	 * 面板开着、内存里却没有实例，这是重开应用之后的常态：面板是照着磁盘快照画出来的，而
	 * `sideChatState` 读快照并不建实例。只清内存那一份，重开之后第一次撤回会看着像什么都没发生。
	 */
	const archived = await loadSideChatSnapshot(sessionId).catch(() => null);
	if (!archived || archived.messages.length === 0) return;
	/*
	 * 不为了清空而把一个 `SideChat` 叫起来——那会连带拉起主会话的整套东西。存档抹平、面板抹平，
	 * `restart` 做的也正是这两件事。
	 */
	await saveSideChat(sessionId, [], io.defaultModelId);
	io.broadcast({ type: "rewound", messageCount: 0 });
	io.broadcast({ type: "side_model", modelId: io.defaultModelId });
}
