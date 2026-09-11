/**
 * Chat Completions 链的出站编码：助手消息的 `content`、推理回发用的键、看不了图的模型。
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { toChatCompletionsMessages } from "../src/ai/openai-chat-completions-request.ts";
import { emptyUsage } from "../src/types.ts";
import type { AssistantMessage, Message, ToolResultMessage, UserMessage } from "../src/types.ts";

/** 一张 1x1 的透明 png，真的能解码。图片路径上的 bug 全跟这串字符的去向有关。 */
const PNG_1PX =
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

const user = (text: string): UserMessage => ({ role: "user", content: [{ type: "text", text }], timestamp: 1 });

const toolCallAssistant = (extra: Partial<AssistantMessage> = {}): AssistantMessage => ({
	role: "assistant",
	content: [
		{
			type: "toolCall",
			id: "call_9xKpLm2QsRtVwYz",
			name: "read",
			arguments: { file_path: "/tmp/a.txt" },
			argumentsText: '{"file_path":"/tmp/a.txt"}',
		},
	],
	api: "openai-chat-completions",
	provider: "deepseek",
	model: "deepseek-chat",
	usage: emptyUsage(),
	stopReason: "toolUse",
	timestamp: 2,
	...extra,
});

const toolResult = (): ToolResultMessage => ({
	role: "toolResult",
	toolCallId: "call_9xKpLm2QsRtVwYz",
	toolName: "read",
	content: [{ type: "text", text: "第一行\n第二行" }],
	isError: false,
	timestamp: 3,
});

const wireOf = (messages: Message[], ...rest: Parameters<typeof toChatCompletionsMessages> extends [string, Message[], ...infer R] ? R : never) =>
	toChatCompletionsMessages("", messages, ...rest) as Array<Record<string, unknown>>;

// ---------------------------------------------------------------------------
// P0-5 content: null
// ---------------------------------------------------------------------------

test("CC：带 tool_calls 的助手消息发空字符串，不发 null", () => {
	const wire = wireOf([user("读一下"), toolCallAssistant(), toolResult()]);
	const assistant = wire.find((m) => m.role === "assistant");
	assert.ok(assistant);
	assert.equal(assistant.content, "");
	assert.notEqual(assistant.content, null);
	// `content` 这个键要在，不能整个省掉——省掉和 null 一样会绊倒挑剔的实现。
	assert.equal("content" in assistant, true);
	assert.equal((assistant.tool_calls as unknown[]).length, 1);
	// 工具结果紧跟在后面，这是协议要求的唯一排法。
	assert.equal(wire[wire.length - 1].role, "tool");
});

test("CC：有文本时照发文本，空字符串只用在没有文本的那一格", () => {
	const withText = toolCallAssistant({
		content: [{ type: "text", text: "我来读一下这个文件。" }, ...toolCallAssistant().content],
	});
	const wire = wireOf([user("读一下"), withText, toolResult()]);
	const assistant = wire.find((m) => m.role === "assistant");
	assert.equal(assistant?.content, "我来读一下这个文件。");
});

// ---------------------------------------------------------------------------
// P0-3 的另一半：推理回发用进来时那个键
// ---------------------------------------------------------------------------

test("CC：思考块上记着 reasoning 时，回发也用 reasoning", () => {
	const assistant = toolCallAssistant({
		content: [
			{ type: "thinking", thinking: "用户要我读文件。", reasoningField: "reasoning" },
			...toolCallAssistant().content,
		],
	});
	const wire = wireOf([user("读一下"), assistant, toolResult()]);
	const out = wire.find((m) => m.role === "assistant");
	assert.ok(out);
	assert.equal(out.reasoning, "用户要我读文件。");
	assert.equal("reasoning_content" in out, false, "发错键等于没发");
});

test("CC：没有记字段名的思考块（旧会话、别的协议）仍然回发 reasoning_content", () => {
	const assistant = toolCallAssistant({
		content: [{ type: "thinking", thinking: "想过了。" }, ...toolCallAssistant().content],
	});
	const out = wireOf([user("读一下"), assistant, toolResult()]).find((m) => m.role === "assistant");
	assert.equal(out?.reasoning_content, "想过了。");
	assert.equal("reasoning" in (out ?? {}), false);
});

test("CC：reasoning_text 记什么回什么", () => {
	const assistant = toolCallAssistant({
		content: [
			{ type: "thinking", thinking: "想过了。", reasoningField: "reasoning_text" },
			...toolCallAssistant().content,
		],
	});
	const out = wireOf([user("读一下"), assistant, toolResult()]).find((m) => m.role === "assistant");
	assert.equal(out?.reasoning_text, "想过了。");
	assert.equal("reasoning_content" in (out ?? {}), false);
});

test("CC：reasoning 为 omit 那一档，记了字段名也不发", () => {
	const assistant = toolCallAssistant({
		content: [
			{ type: "thinking", thinking: "想过了。", reasoningField: "reasoning" },
			...toolCallAssistant().content,
		],
	});
	const out = wireOf([user("读一下"), assistant, toolResult()], "omit").find((m) => m.role === "assistant");
	assert.equal("reasoning" in (out ?? {}), false);
	assert.equal("reasoning_content" in (out ?? {}), false);
});

// ---------------------------------------------------------------------------
// P1-8 看不了图的模型
// ---------------------------------------------------------------------------

const withImage = (): UserMessage => ({
	role: "user",
	content: [
		{ type: "text", text: "这张图里是什么？" },
		{ type: "image", data: PNG_1PX, mimeType: "image/png" },
	],
	timestamp: 1,
});

test("CC：能看图的模型照发 image_url", () => {
	const wire = wireOf([withImage()], "replay", { supportsImages: true });
	const parts = wire[0].content as Array<Record<string, any>>;
	assert.equal(Array.isArray(parts), true);
	assert.equal(parts[0].type, "text");
	assert.equal(parts[1].type, "image_url");
	assert.equal(parts[1].image_url.url, `data:image/png;base64,${PNG_1PX}`);
});

test("CC：看不了图的模型收到的是一句话，不是 image_url——图片一旦进历史会把会话永久搞坏", () => {
	const wire = wireOf([withImage()], "replay", { supportsImages: false });
	assert.equal(wire.length, 1);
	const content = wire[0].content;
	assert.equal(typeof content, "string", "纯文本模型上 content 必须是字符串");
	assert.equal(content, "这张图里是什么？\n[image omitted: model does not support vision]");
	assert.equal(JSON.stringify(wire).includes(PNG_1PX), false, "base64 一个字节都不能出现在请求里");
});

test("CC：只有一张图、没有文字时，占位符自己成一条消息", () => {
	const onlyImage: UserMessage = {
		role: "user",
		content: [{ type: "image", data: PNG_1PX, mimeType: "image/png" }],
		timestamp: 1,
	};
	const wire = wireOf([onlyImage], "replay", { supportsImages: false });
	assert.equal(wire[0].content, "[image omitted: model does not support vision]");
});

test("CC：不传模型能力时行为一字不变——仍然按能看图编", () => {
	const wire = wireOf([withImage()]);
	assert.equal(Array.isArray(wire[0].content), true);
});

test("CC：打断提示和图片占位符能同时出现，顺序不乱", () => {
	const aborted: AssistantMessage = {
		role: "assistant",
		content: [{ type: "text", text: "我正在说……" }],
		api: "openai-chat-completions",
		provider: "relay",
		model: "m",
		usage: emptyUsage(),
		stopReason: "aborted",
		timestamp: 2,
	};
	const wire = wireOf([user("先说点别的"), aborted, withImage()], "replay", { supportsImages: false });
	const last = String(wire[wire.length - 1].content);
	assert.match(last, /^\[System note: Your previous response was interrupted/);
	assert.match(last, /这张图里是什么？\n\[image omitted: model does not support vision\]$/);
});

test("CC：工具结果里的图片走的是另一条路，这次改动没动它", () => {
	const imageResult: ToolResultMessage = {
		role: "toolResult",
		toolCallId: "call_9xKpLm2QsRtVwYz",
		toolName: "read",
		content: [{ type: "image", data: PNG_1PX, mimeType: "image/png" }],
		isError: false,
		timestamp: 3,
	};
	for (const caps of [{ supportsImages: true }, { supportsImages: false }]) {
		const wire = wireOf([user("读那张图"), toolCallAssistant(), imageResult], "replay", caps);
		const tool = wire.find((m) => m.role === "tool");
		assert.equal(tool?.content, `[image ${"image/png"}, ${PNG_1PX.length} base64 chars]`);
		assert.equal(JSON.stringify(wire).includes(PNG_1PX), false);
	}
});
