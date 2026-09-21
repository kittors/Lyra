/**
 * 没有运行记录的工具卡，该说自己在跑还是出了错。
 *
 * 这条判据要同时挡住两个方向的错：记录丢了的卡片永远转圈，和记录还没建立的卡片谎称失败。
 * 后者是实测出来的——侧边聊天里工具卡会闪一下红叉再变成打勾，约一半概率，停留 27–85ms，
 * 复现与取证见 `e2e/sidechat-tool-status-probe.ts`。
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { toolCardFallback } from "../src/features/conversation/tool-status.ts";

test("还在流式输出的时候，卡片在跑", () => {
	assert.equal(toolCardFallback("pending", true), "running");
	// 即使这一轮的 running 还没翻上来，pending 自己就说明了一切。
	assert.equal(toolCardFallback("pending", false), "running");
});

test("定稿成 toolUse 而这一轮还在跑：在跑，不是失败", () => {
	/*
	 * 这条就是修复本身。
	 *
	 * 事件顺序是 `message_end` 先于 `tool_start`：消息先定稿成 toolUse，工具才开跑并建立记录。
	 * 旧判据只问「是不是 pending」，于是这中间的每一帧都被判成 error，画出红叉。
	 * 而 toolUse 的字面意思是「我要调这些工具」——这一轮非但没结束，正要开始干活。
	 */
	assert.equal(toolCardFallback("toolUse", true), "running");
});

test("定稿成 toolUse 但这一轮已经停了：记录是真丢了", () => {
	/*
	 * 防的是原来那条注释说的事：provider 没给 id、会话在命令中途重载，卡片坐在那儿一直数秒数。
	 * `turnRunning` 就是这把锁——轮次一停，卡片立刻给结论，不会永远转圈。
	 */
	assert.equal(toolCardFallback("toolUse", false), "error");
});

test("轮次正常收尾却没有记录，仍然是错", () => {
	for (const reason of ["stop", "length", "error", "aborted"] as const) {
		// 连 running 为真也不改判：这条消息自己说了它不是在等工具。
		assert.equal(toolCardFallback(reason, true), "error", reason);
		assert.equal(toolCardFallback(reason, false), "error", reason);
	}
});
