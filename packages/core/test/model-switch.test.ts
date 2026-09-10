/**
 * Dropping one provider's reasoning handles when the conversation moves to another.
 *
 * The switch itself is allowed; this is what makes it safe. A handle replayed to the wrong provider
 * is not degraded output, it is a rejected request — so the interesting cases are the ones where
 * something is left behind by accident.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { stripStaleHandles } from "../src/runtime/model-switch.ts";
import type { Message } from "../src/types.ts";

function thought(text: string, handles: { signature?: string; encrypted?: string; redacted?: boolean } = {}): Message {
	return {
		role: "assistant",
		content: [
			{ type: "thinking", thinking: text, ...handles },
			{ type: "text", text: "答案" },
		],
	} as Message;
}

const user = (text: string): Message => ({ role: "user", content: text }) as Message;

test("a session that never switched is returned untouched, same array", () => {
	const messages = [user("你好"), thought("想了想", { signature: "sig-a" })];
	// Identity, not deep equality: the ordinary path should not be rebuilding the transcript.
	assert.equal(stripStaleHandles(messages, undefined), messages);
	assert.equal(stripStaleHandles(messages, 0), messages);
});

test("handles written before the switch are dropped", () => {
	const messages = [user("你好"), thought("旧模型想的", { signature: "sig-a", encrypted: "enc-a" })];
	const cleaned = stripStaleHandles(messages, 2);
	const block = (cleaned[1] as { content: Record<string, unknown>[] }).content[0];
	assert.equal(block.signature, undefined);
	assert.equal(block.encrypted, undefined);
	// The reasoning text itself stays: it is readable by any model, and it is what is on screen.
	assert.equal(block.thinking, "旧模型想的");
});

test("a redacted block loses the flag along with the payload", () => {
	/*
	 * `redacted` means the text was filtered but the payload is still replayable. Once the payload
	 * is gone the flag describes nothing, and a redacted block with no data is what the Anthropic
	 * encoder drops and the others send as empty.
	 */
	const messages = [user("你好"), thought("", { encrypted: "enc-a", redacted: true })];
	const block = (stripStaleHandles(messages, 2)[1] as { content: Record<string, unknown>[] }).content[0];
	assert.equal(block.redacted, undefined);
	assert.equal(block.encrypted, undefined);
});

test("handles written after the switch are kept", () => {
	const messages = [
		user("你好"),
		thought("旧的", { signature: "sig-a" }),
		user("换个模型"),
		thought("新的", { signature: "sig-b" }),
	];
	const cleaned = stripStaleHandles(messages, 2);
	assert.equal((cleaned[1] as { content: Record<string, unknown>[] }).content[0].signature, undefined);
	assert.equal((cleaned[3] as { content: Record<string, unknown>[] }).content[0].signature, "sig-b");
});

test("everything other than the handles survives", () => {
	const messages = [user("你好"), thought("想了想", { signature: "sig-a" })];
	const cleaned = stripStaleHandles(messages, 2);
	assert.equal(cleaned.length, 2);
	assert.equal(cleaned[0], messages[0]);
	const content = (cleaned[1] as { content: Record<string, unknown>[] }).content;
	assert.equal(content.length, 2);
	assert.deepEqual(content[1], { type: "text", text: "答案" });
});

test("a switch point past the end of the transcript is harmless", () => {
	const messages = [user("你好"), thought("想了想", { signature: "sig-a" })];
	const cleaned = stripStaleHandles(messages, 99);
	assert.equal((cleaned[1] as { content: Record<string, unknown>[] }).content[0].signature, undefined);
});

test("a message with no handles to strip is not copied", () => {
	const plain = [user("你好"), thought("没有句柄")];
	assert.equal(stripStaleHandles(plain, 2), plain);
});

/*
 * 文本块和工具调用块也带着句柄，而这里一度只洗推理块。
 *
 * `openai-responses.ts` 把上游的 item id 存在三种块上，不只是推理块。于是一份「洗干净」的历史
 * 仍然带着 `id: "msg-2026…"` 发出去，被整个拒绝：`Invalid 'input[14].id'`。因为那个 id 就存在
 * 会话日志里，重试和切回原模型都清不掉，对话从此不能继续。
 */
test("一段文本上的句柄也要洗掉", () => {
	const messages = [
		user("你好"),
		{
			role: "assistant",
			content: [{ type: "text", text: "答案", signature: "msg-2026091002063385" }],
		} as Message,
	];
	const block = (stripStaleHandles(messages, 2)[1] as { content: Record<string, unknown>[] }).content[0];
	assert.equal(block.signature, undefined);
	assert.equal(block.text, "答案", "正文要留下——屏幕上显示的就是它");
});

test("工具调用洗掉 item id，但保留配对用的 call_id", () => {
	const messages = [
		user("你好"),
		{
			role: "assistant",
			content: [{ type: "toolCall", id: "call_abc", name: "bash", arguments: {}, signature: "fc-2026" }],
		} as Message,
	];
	const block = (stripStaleHandles(messages, 2)[1] as { content: Record<string, unknown>[] }).content[0];
	assert.equal(block.signature, undefined);
	assert.equal(block.id, "call_abc", "结果靠它找到自己的调用，掉了这条历史就配不上对");
	assert.equal(block.name, "bash");
});
