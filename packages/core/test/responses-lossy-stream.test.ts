/**
 * 残缺的 Responses 流：只发 `output_item.done`，不发 `output_item.added`。
 *
 * 守规矩的端点每一项都是 `added` 开头、`done` 收尾，所以解码那边「没开过的块就跳过」看起来一直没问题。
 * 把 Responses 翻译成别的协议的中转做不到这么整齐——oh-my-pi 管这类叫 lossy proxy，它的解码器专门为此
 * 合成缺失的块（`packages/ai/src/providers/openai-shared.ts` 约 3252/3284/3308 行，注释原话
 * "`output_item.added` never arrived (lossy proxy) — synthesize the block"）。
 *
 * 我们原来是 `if (!tracked) break;`——整项丢掉。后果按内容类型分三档：
 *
 *   - 文本丢了：界面空白，用户会来报，至少看得见。
 *   - 推理丢了：思考面板空着，也看得见。
 *   - **工具调用丢了：最阴险。** `agent/loop.ts` 按 content 里的 toolCall 决定执行什么，块没了工具就
 *     静默不跑，而模型下一轮以为自己调过了，于是原地打转——没有报错，没有任何迹象。
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { openaiResponsesProvider } from "../src/ai/openai-responses.ts";
import { toResponsesInput } from "../src/ai/openai-responses-request.ts";
import type { AssistantMessage, Message } from "../src/types.ts";

/** 一段只有 `done`、没有 `added` 的流。每个 `done` 里带着这一项的全部内容。 */
function lossyStream(items: unknown[]): string {
	const frames = items.map(
		(item, index) => `event: response.output_item.done\ndata: ${JSON.stringify({ type: "response.output_item.done", output_index: index, item })}\n\n`,
	);
	frames.push(
		`event: response.completed\ndata: ${JSON.stringify({
			type: "response.completed",
			response: { usage: { input_tokens: 10, output_tokens: 5 } },
		})}\n\n`,
	);
	return frames.join("");
}

const provider = {
	id: "lossy",
	name: "lossy",
	baseUrl: "https://example.invalid",
	api: "openai-responses" as const,
	apiKey: "test",
	enabled: true,
	models: [],
};

const model = {
	modelId: "test-model",
	contextWindow: 128000,
	maxOutputTokens: 4096,
	pricing: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 1.25 },
};

async function run(sse: string): Promise<AssistantMessage> {
	const stream = openaiResponsesProvider.stream(
		provider,
		model,
		{ systemPrompt: "", messages: [{ role: "user", content: [{ type: "text", text: "hi" }], timestamp: 0 }], tools: [] },
		{
			// oxlint-disable-next-line no-explicit-any -- 测试里塞一个假 fetch
			fetch: (async () => new Response(sse, { status: 200, headers: { "content-type": "text/event-stream" } })) as any,
			/*
			 * 关掉重试。
			 *
			 * 零内容的回复会被判成「中转发来一团我们看不懂的东西」并重试——那是对的行为（见
			 * `openai-responses.ts` 里 `framesSeen` 那段），但这里的假 fetch 每次都返回同一段流，于是它
			 * 会一路退避到超时：不关的话，「不认识的项该跳过」那条测试要跑 50 秒。
			 */
			retryAttempts: 1,
		},
	);
	let last: AssistantMessage | undefined;
	while (true) {
		const next = await stream.next();
		if (next.done) {
			last = next.value;
			break;
		}
	}
	assert.ok(last, "没拿到消息");
	return last;
}

test("只发 done 不发 added 时，工具调用照样被接住——丢了它会静默不执行", async () => {
	const message = await run(
		lossyStream([
			{ type: "function_call", call_id: "call_abc", name: "bash", arguments: '{"command":"ls"}' },
		]),
	);

	const calls = message.content.filter((c) => c.type === "toolCall");
	assert.equal(calls.length, 1, "工具调用不能丢");
	const [call] = calls;
	assert.equal(call.type === "toolCall" && call.name, "bash");
	assert.equal(call.type === "toolCall" && call.id, "call_abc");
	assert.deepEqual(call.type === "toolCall" ? call.arguments : undefined, { command: "ls" }, "参数来自 done 事件里的那一份");
});

test("只发 done 不发 added 时，文本照样被接住", async () => {
	const message = await run(lossyStream([{ type: "message", role: "assistant", content: [{ type: "output_text", text: "你好" }] }]));

	const texts = message.content.filter((c) => c.type === "text");
	assert.equal(texts.length, 1, "文本不能丢");
	assert.equal(texts[0].type === "text" && texts[0].text, "你好");
});

test("只发 done 不发 added 时，推理照样被接住", async () => {
	const message = await run(
		lossyStream([
			{ type: "reasoning", id: "rs_1", summary: [{ type: "summary_text", text: "先看看目录" }], encrypted_content: "ENC_BLOB" },
		]),
	);

	const thoughts = message.content.filter((c) => c.type === "thinking");
	assert.equal(thoughts.length, 1, "推理不能丢");
	assert.equal(thoughts[0].type === "thinking" && thoughts[0].thinking, "先看看目录", "非流式的 summary 只在 done 里");
	assert.equal(thoughts[0].type === "thinking" && thoughts[0].encrypted, "ENC_BLOB");
	assert.equal(thoughts[0].type === "thinking" && thoughts[0].signature, "rs_1");
});

test("认不出来的 item 类型仍然跳过，不凭空造块", async () => {
	const message = await run(lossyStream([{ type: "web_search_call", id: "ws_1" }]));
	assert.equal(message.content.length, 0, "不认识的项不该变出一个块来");
});

test("一条流里三种项都残缺时，顺序和数量都对", async () => {
	const message = await run(
		lossyStream([
			{ type: "reasoning", id: "rs_1", summary: [{ type: "summary_text", text: "想想" }] },
			{ type: "message", role: "assistant", content: [{ type: "output_text", text: "我来查" }] },
			{ type: "function_call", call_id: "call_1", name: "glob", arguments: "{}" },
		]),
	);

	assert.deepEqual(
		message.content.map((c) => c.type),
		["thinking", "text", "toolCall"],
	);
});

/*
 * 图片门禁。放在这个文件里，因为它和上面几条是同一类问题：**一次误读让整个会话永久报废**。
 *
 * 区别只在触发点——上面是解码丢东西，这里是编码多发东西。共同点是错误进了历史之后，之后每一轮都带着它
 * 重犯一次，重试和切回去都救不了。
 */

test("模型读不了图时，图片换成一行说明而不是发出去", () => {
	const input = toResponsesInput(
		[
			{
				role: "user",
				content: [
					{ type: "text", text: "看这张图" },
					{ type: "image", mimeType: "image/png", data: "AAAABBBB" },
				],
				timestamp: 0,
			} as Message,
		],
		{ provider: "qa", model: "text-only", supportsImages: false },
	);

	const [message] = input as Array<{ content: Array<Record<string, unknown>> }>;
	assert.equal(message.content.length, 2, "两个块都还在");
	assert.equal(message.content[0].type, "input_text");
	assert.equal(message.content[1].type, "input_text", "图片块换成了文本");
	assert.match(String(message.content[1].text), /不支持读图/);
	assert.match(String(message.content[1].text), /image\/png/, "说明里要带格式，模型才知道这儿本来有什么");
	assert.ok(!JSON.stringify(input).includes("input_image"), "不能有任何 input_image 漏出去");
});

test("模型能读图时原样发出去", () => {
	const input = toResponsesInput(
		[
			{
				role: "user",
				content: [{ type: "image", mimeType: "image/png", data: "AAAABBBB" }],
				timestamp: 0,
			} as Message,
		],
		{ provider: "qa", model: "vision", supportsImages: true },
	);

	assert.ok(JSON.stringify(input).includes("input_image"));
	assert.ok(JSON.stringify(input).includes("data:image/png;base64,AAAABBBB"));
});

test("不知道支不支持时按「能读」算——把不知道当成不收会抹掉本来好好的图片", () => {
	const input = toResponsesInput(
		[{ role: "user", content: [{ type: "image", mimeType: "image/png", data: "AA" }], timestamp: 0 } as Message],
		{ provider: "qa", model: "unknown" },
	);

	assert.ok(JSON.stringify(input).includes("input_image"));
});

/*
 * 流的收尾：三种「看起来正常结束、其实不是」。
 *
 * 共同点是它们都不报错，只是安静地把一条残缺或被拦下的回复标成 `stop` 交给 `agent/loop.ts` 往下跑。
 * 用户看到的是一个无声截断的回答，或者一条空白回复，而日志里什么都没有。
 */

/** 一段吐了内容但没有收尾事件的流——中间设备在长回答上掐断连接时就是这个形状。 */
function truncatedStream(): string {
	return [
		`event: response.output_item.added\ndata: ${JSON.stringify({ type: "response.output_item.added", output_index: 0, item: { type: "message", id: "m1" } })}\n\n`,
		`event: response.output_text.delta\ndata: ${JSON.stringify({ type: "response.output_text.delta", output_index: 0, delta: "说到一半" })}\n\n`,
	].join("");
}

test("吐了一半就断掉要当失败，不能标成正常结束", async () => {
	// `streamResponses` 不往外抛，它把失败收进消息里（`stopReason: "error"`），由上层决定怎么显示。
	const message = await run(truncatedStream());
	assert.equal(message.stopReason, "error", "不能是 stop —— 那会让 agent loop 拿着半截回答继续跑");
	assert.match(String(message.errorMessage ?? ""), /没有收尾|response\.completed/);
});

test("被内容策略拦下要当失败，不能装作模型无话可说", async () => {
	const sse = [
		`event: response.incomplete\ndata: ${JSON.stringify({
			type: "response.incomplete",
			response: { usage: { input_tokens: 5, output_tokens: 0 }, incomplete_details: { reason: "content_filter" } },
		})}\n\n`,
	].join("");

	const message = await run(sse);
	assert.equal(message.stopReason, "error", "不能是 stop —— 那会显示成一条正常的空回答");
	// `classifyFailure` 认得这一类，把它归成自己的标准文案——这正是我们要的：用户看到的是「为什么」，
	// 而不是一条空白回答。
	assert.match(String(message.errorMessage ?? ""), /安全策略|内容策略|content_filter/);
	assert.equal(message.failure?.kind, "fatal", "同样的输入再发一遍还是同样的结果，不该重试");
});

test("达到输出上限仍然是正常结束——它是唯一一个", async () => {
	const sse = [
		`event: response.output_item.added\ndata: ${JSON.stringify({ type: "response.output_item.added", output_index: 0, item: { type: "message", id: "m1" } })}\n\n`,
		`event: response.output_text.delta\ndata: ${JSON.stringify({ type: "response.output_text.delta", output_index: 0, delta: "很长的回答" })}\n\n`,
		`event: response.incomplete\ndata: ${JSON.stringify({
			type: "response.incomplete",
			response: { usage: { input_tokens: 5, output_tokens: 100 }, incomplete_details: { reason: "max_output_tokens" } },
		})}\n\n`,
	].join("");

	const message = await run(sse);
	assert.equal(message.stopReason, "length", "这一个该照常收下，只是标明被截断了");
	assert.equal(message.content.filter((c) => c.type === "text").length, 1);
});

/*
 * input 的末项不能是助手说的话。
 *
 * 实测（2026-09-11，`api.deepseek.com/v1/responses`）：同一段历史原样发 400，去掉末尾那条助手消息 200，
 * 末尾补一条 user 也 200，**只有 user + assistant 两项照样 400**——跟历史长短、跟推理项都无关。而它报的
 * 还是那句指向推理的 `reasoning_text ... must be passed back`，第三次拿同一句谎话说不同的事。
 */

test("历史以助手的话收尾时，末尾补一条 user——这个形状会被拒", () => {
	const input = toResponsesInput([
		{ role: "user", content: [{ type: "text", text: "在吗" }], timestamp: 0 },
		{
			role: "assistant",
			content: [{ type: "text", text: "在的。" }],
			api: "openai-responses", provider: "qa", model: "m",
			usage: { input: 0, output: 0 }, stopReason: "stop", timestamp: 1,
		},
	] as Message[]) as Array<Record<string, unknown>>;

	const last = input[input.length - 1];
	assert.equal(last.type, "message");
	assert.equal(last.role, "user", "末项必须是 user，否则整个请求被拒");
	assert.equal(input.length, 3, "原来两项，补了一条");
	// 助手那条本身要原样留着——补的是尾巴，不是替换。
	assert.equal((input[1] as { role: string }).role, "assistant");
});

test("末项本来就是工具结果或用户消息时，一个字都不补", () => {
	const withResult = toResponsesInput([
		{ role: "user", content: [{ type: "text", text: "算一下" }], timestamp: 0 },
		{
			role: "assistant",
			content: [{ type: "toolCall", id: "c1", name: "calc", arguments: {} }],
			api: "openai-responses", provider: "qa", model: "m",
			usage: { input: 0, output: 0 }, stopReason: "toolUse", timestamp: 1,
		},
		{ role: "toolResult", toolCallId: "c1", toolName: "calc", content: [{ type: "text", text: "4" }], isError: false, timestamp: 2 },
	] as Message[]) as Array<Record<string, unknown>>;
	assert.equal(withResult[withResult.length - 1].type, "function_call_output", "工具结果收尾，不动");

	const withUser = toResponsesInput([
		{ role: "user", content: [{ type: "text", text: "在吗" }], timestamp: 0 },
	] as Message[]) as Array<Record<string, unknown>>;
	assert.equal(withUser.length, 1, "用户消息收尾，不动");
});

test("助手轮只有工具调用时不算「以助手的话收尾」", () => {
	// 那一项编码出来是 function_call，不是 message/assistant——这个形状端点是收的。
	const input = toResponsesInput([
		{ role: "user", content: [{ type: "text", text: "算一下" }], timestamp: 0 },
		{
			role: "assistant",
			content: [{ type: "toolCall", id: "c1", name: "calc", arguments: {} }],
			api: "openai-responses", provider: "qa", model: "m",
			usage: { input: 0, output: 0 }, stopReason: "toolUse", timestamp: 1,
		},
	] as Message[]) as Array<Record<string, unknown>>;
	assert.equal(input[input.length - 1].type, "function_call", "不该被当成助手发言而补尾巴");
});
