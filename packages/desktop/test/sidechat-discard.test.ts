/**
 * 主会话被撤空之后，旁边那场对话不该还留在那儿。
 *
 * 用户报的样子：主对话整个撤销了，侧边面板还写着「所有单测都过了、只剩推送超时」——那段汇报
 * 说的是一段已经不存在的历史。它也不只是留在屏幕上：上一轮 `read_main_chat` 读到的旧记录还在
 * 侧边 agent 的上下文里，下一轮会被当成事实带进去。
 *
 * 界线也要守住：撤到中间不碰它。那时主会话还在，那场讨论也还有依附的对象，而收掉是要付代价的
 * ——人在侧边问过的话一起没了，且不像撤回主消息那样还把文本放回输入框。
 *
 * 剩下两条分支各对应一种真实处境：面板开着、内存里有实例；以及重开应用之后面板照着磁盘快照画
 * 出来、内存里一个实例都没有——后者只要漏了，重开之后第一次撤空就什么都不会发生。
 */

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import type { Message, SideChatUpdate } from "@lyra/core";

let home = "";
before(async () => {
	home = await mkdtemp(join(tmpdir(), "lyra-side-discard-"));
	process.env.LYRA_HOME = home;
});
after(async () => {
	delete process.env.LYRA_HOME;
	await rm(home, { recursive: true, force: true });
});

const said = (text: string): Message => ({ role: "user", content: [{ type: "text", text }], timestamp: 1 });

/** 手边那个实例：只记下被不被推倒重来。 */
function liveChat(messages: Message[]) {
	let restarted = 0;
	return {
		state: () => ({ messages }),
		restart: async () => { restarted += 1; messages.length = 0; },
		get restarted() { return restarted; },
	};
}

test("撤到中间：主会话还在，那场讨论也还有对象", async () => {
	const { discardSideChat } = await import("../electron/sidechat-discard.ts");
	const live = liveChat([said("预计要多久？")]);
	const events: SideChatUpdate[] = [];

	await discardSideChat("mid-1", { mainMessagesLeft: 2, live, defaultModelId: "qa/model", broadcast: (event) => events.push(event) });

	assert.equal(live.restarted, 0, "只撤掉了后面那一截，不该连人在侧边问过的话一起收走");
	assert.deepEqual(events, []);
});

test("撤到中间时，磁盘上那份也一样不碰", async () => {
	const { loadSideChat, saveSideChat } = await import("../electron/sidechat-store.ts");
	const { discardSideChat } = await import("../electron/sidechat-discard.ts");
	await saveSideChat("mid-2", [said("主会话现在到哪一步了？")], "old/model");

	await discardSideChat("mid-2", { mainMessagesLeft: 1, live: undefined, defaultModelId: "default/model", broadcast: () => {} });

	assert.equal((await loadSideChat("mid-2")).length, 1, "存档原样留着");
});

test("撤空时，面板开着就推倒手边那一个", async () => {
	const { discardSideChat } = await import("../electron/sidechat-discard.ts");
	const live = liveChat([said("预计要多久？"), said("有没有遇到啥问题")]);
	const events: SideChatUpdate[] = [];

	await discardSideChat("live-1", { mainMessagesLeft: 0, live, defaultModelId: "qa/model", broadcast: (event) => events.push(event) });

	assert.equal(live.restarted, 1, "走的是「重置」那条路");
	assert.deepEqual(events, [], "事件由 restart 自己发，这里不能再补一份——面板会收到两次");
});

test("手边那个本来就是空的，就不必惊动它", async () => {
	const { discardSideChat } = await import("../electron/sidechat-discard.ts");
	const live = liveChat([]);

	await discardSideChat("live-2", { mainMessagesLeft: 0, live, defaultModelId: null, broadcast: () => {} });

	assert.equal(live.restarted, 0, "没有可收的东西，撤空一个会话不该顺手写一次存档");
});

test("重开应用之后：内存里没有实例，磁盘上那份也要抹平", async () => {
	const { loadSideChat, saveSideChat } = await import("../electron/sidechat-store.ts");
	const { discardSideChat } = await import("../electron/sidechat-discard.ts");
	await saveSideChat("cold-1", [said("主会话现在到哪一步了？")], "old/model");
	const events: SideChatUpdate[] = [];

	await discardSideChat("cold-1", { mainMessagesLeft: 0, live: undefined, defaultModelId: "default/model", broadcast: (event) => events.push(event) });

	assert.deepEqual(await loadSideChat("cold-1"), [], "存档空了，下次打开不会再把它读回来");
	assert.deepEqual(
		events,
		[{ type: "rewound", messageCount: 0 }, { type: "side_model", modelId: "default/model" }],
		"面板此刻正画着那份快照，要收到消息才会跟着清空",
	);
});

test("从没聊过的会话，撤空不会凭空造出一份存档", async () => {
	const { discardSideChat } = await import("../electron/sidechat-discard.ts");
	const events: SideChatUpdate[] = [];

	await discardSideChat("cold-2", { mainMessagesLeft: 0, live: undefined, defaultModelId: null, broadcast: (event) => events.push(event) });

	const { readdir } = await import("node:fs/promises");
	const files = await readdir(join(home, "sidechats")).catch(() => [] as string[]);
	assert.ok(!files.includes("cold-2.json"), "没有的东西不需要清空");
	assert.deepEqual(events, [], "也没有什么要告诉面板");
});
