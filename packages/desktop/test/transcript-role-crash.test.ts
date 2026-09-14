/**
 * 转录那几个纯函数，喂它们真实世界能递过来的那些畸形输入。
 *
 * 找的是这一句：`Cannot read properties of undefined (reading 'role')`——它在打包版里把整个界面掀
 * 翻过，组件栈最内层是 `Conversation`，也就是说崩在它自己的渲染里（含那几个 `useMemo`）。
 *
 * `Conversation` 把 `messages` 过了 `intact`，所以数组里每一格都是完整的记录。剩下能带毒进来的
 * 就是另外三条：压缩标记、命令、抖动——它们都带着一个 `at`，而 `at` 是**当时**的消息索引。转录会
 * 变短（压缩就是干这个的），旧的索引于是指向不存在的位置。
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import type { Message } from "@lyra/core";
import { runs } from "../src/features/conversation/grouping.ts";
import { questionsIn, timeSeparators } from "../src/features/conversation/question-navigation.ts";
import { tailSignature } from "../src/ui/scroll/signature.ts";

const user = (text: string, timestamp = 1): Message =>
	({ role: "user", content: [{ type: "text", text }], timestamp }) as Message;
const reply = (text: string, timestamp = 2): Message =>
	({ role: "assistant", content: [{ type: "text", text }], timestamp }) as Message;

const transcript: Message[] = [user("问", 1), reply("答", 2), user("再问", 3), reply("再答", 4)];

/** 一条转录能被喂进来的各种越界标记。`at` 是索引，而索引会过期。 */
const OUT_OF_RANGE = [-1, 0, 3, 4, 5, 99, 1e6];

test("压缩标记指向不存在的位置时，转录仍然画得出来", () => {
	for (const at of OUT_OF_RANGE) {
		assert.doesNotThrow(() => runs(transcript, [{ at }]), `压缩标记 at=${at}`);
		assert.doesNotThrow(() => runs([], [{ at }]), `空转录 + 压缩标记 at=${at}`);
	}
});

test("命令和抖动的位置过期了也一样", () => {
	for (const at of OUT_OF_RANGE) {
		const command = { at, id: `c${at}`, name: "compact", status: "done" } as never;
		const hiccup = { at, id: `h${at}`, attempts: 2 } as never;
		assert.doesNotThrow(() => runs(transcript, [], [command], []), `命令 at=${at}`);
		assert.doesNotThrow(() => runs(transcript, [], [], [hiccup]), `抖动 at=${at}`);
		assert.doesNotThrow(() => runs([], [], [command], [hiccup]), `空转录 at=${at}`);
	}
});

test("一条都没有的转录，四个消费者都得答得出来", () => {
	assert.doesNotThrow(() => runs([]));
	assert.doesNotThrow(() => timeSeparators([]));
	assert.doesNotThrow(() => questionsIn([]));
	assert.doesNotThrow(() => tailSignature([]));
});

test("数组里有窟窿时，闸门把它换成占位而不是让它穿过去", () => {
	// `intact` 之前的形状：同步过来的一份、从磁盘读回来的一份，都可能缺格。
	const holed = [user("问"), undefined, reply("答")] as unknown as Message[];
	assert.doesNotThrow(() => runs(holed));
	assert.doesNotThrow(() => timeSeparators(holed));
	assert.doesNotThrow(() => questionsIn(holed));
	assert.doesNotThrow(() => tailSignature(holed));
});
