/**
 * Anthropic Messages 链上「思考块怎么还回去」的那一组形状。
 *
 * 这条链上的失败有个共同点：**历史本身就是请求**。某一轮编出了坏形状之后，那个会话之后每一轮都会用
 * 同样的方式失败，重试和切回去都救不了。所以每条都在这里守住，而不是等用户的会话再也说不了话。
 *
 * 每条测试名里带着复现原文或者出处。指不出出处的地方写着「推断，未验证」。
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
	anthropicMessagesProvider,
	learnThinkingReplay,
	resetThinkingReplay,
	samplingFor,
	signsThinkingSignatures,
	thinkingReplay,
} from "../src/ai/anthropic-messages.ts";
import { toAnthropicMessages } from "../src/ai/anthropic-messages-request.ts";
import { emptyUsage, type AssistantMessage, type Message, type ModelConfig, type ProviderConfig, type StopReason } from "../src/types.ts";

/**
 * 一个真实形状的 Anthropic thinking 签名。
 *
 * 真东西是一长串 base64（实测几百字符），不是 `"sig"`。长度在这里是有意义的：`stripStaleHandles`、
 * 缓存前缀、以及「送空串」和「送真签名」的区别，都只在真实形状下才看得出来。
 */
const SIGNATURE = `ErUBCkYIBRgCKkDh${"dGhpcyBibG9jayBtdXN0IGJlIHJlcGxheWVkIHZlcmJhdGltIG9uIHRoZSBuZXh0IHR1cm4".repeat(5)}EgxK9vRk8yZ1BxUXo9GhhD`;
const OTHER_SIGNATURE = `ErUBCkYIBRgCKkDh${"YW5vdGhlciBibG9jaywgc2lnbmVkIGJlZm9yZSB0aGUgc3RyZWFtIHdhcyBjdXQgb2Zm".repeat(5)}EgxQ2xhdWRlOTk9GhhD`;

const model: ModelConfig = {
	id: "qa/claude", providerId: "qa", modelId: "claude-test", name: "Claude Test",
	contextWindow: 200_000, maxOutputTokens: 8192, supportsThinking: true, supportsImages: true, supportsTools: true,
};

function assistant(content: AssistantMessage["content"], stopReason: StopReason = "toolUse"): AssistantMessage {
	return { role: "assistant", content, api: "anthropic-messages", provider: "qa", model: "claude-test", usage: emptyUsage(), stopReason, timestamp: 2 };
}

/** 一轮「想过（没签上名）→ 说了句话」。换模型或者接非签名端点之后，历史里就是这个形状。 */
const unsigned: Message[] = [
	{ role: "user", content: [{ type: "text", text: "帮我看下这段代码" }], timestamp: 1 },
	assistant([{ type: "thinking", thinking: "先看调用点，再看类型。" }, { type: "text", text: "看完了。" }], "stop"),
	{ role: "user", content: [{ type: "text", text: "继续" }], timestamp: 3 },
];

const thinkingBlocks = (messages: Message[], replay: Parameters<typeof toAnthropicMessages>[1]) =>
	toAnthropicMessages(messages, replay).flatMap((m) => m.content).filter((b) => b.type === "thinking" || b.type === "redacted_thinking");

// ---------------------------------------------------------------------------
// 缺口 1：回放无签名思考
// ---------------------------------------------------------------------------

test("非签名端点上，没签名的思考块带 signature: \"\" 回放，而不是整块消失", () => {
	// 出处：oh-my-pi `packages/ai/src/providers/anthropic.ts:4357-4364`（无签名时送 `signature: ""`）。
	// 故障：DeepSeek / Z.AI / Moonshot 的 Anthropic 兼容端点不签名，但推理模型要求把推理带回来；从前
	// 这里整块丢掉，第二轮开始端点就说推理没带回来。
	const blocks = thinkingBlocks(unsigned, { thinkingReplay: "unsigned" });
	assert.equal(blocks.length, 1);
	assert.equal(blocks[0].type, "thinking");
	assert.equal(blocks[0].thinking, "先看调用点，再看类型。");
	assert.equal(blocks[0].signature, "", "空串是「我没有签名」的说法，不是「这里没有块」");
});

test("官方端点上，没签名的思考块还是整块丢掉——它会验签，空串过不去", () => {
	// 复现原文：400 Invalid `signature` in `thinking` block。
	// 这一档就是这个文件一直以来的行为，官方 api.anthropic.com 上什么都没变。
	assert.deepEqual(thinkingBlocks(unsigned, { thinkingReplay: "signed-only" }), []);
});

test("丢掉而不是降级成文本块：官方端点上把推理改写成普通文本会撞上安全分类器", () => {
	// 出处：oh-my-pi `transform-messages.ts:822-828`（`Demotion would cause the reasoning_extraction
	// safety classifier to refuse the response`）。
	const out = toAnthropicMessages(unsigned, { thinkingReplay: "signed-only" });
	const texts = out.flatMap((m) => m.content).filter((b) => b.type === "text").map((b) => b.text);
	assert.deepEqual(texts, ["帮我看下这段代码", "看完了。", "继续"], "不该多出一段由思考改写来的文本");
});

test("最底那一档一块都不发，连有签名的也不发", () => {
	const signed = [unsigned[0], assistant([{ type: "thinking", thinking: "想过", signature: SIGNATURE }], "stop")] as Message[];
	assert.deepEqual(thinkingBlocks(signed, { thinkingReplay: "none" }), []);
});

test("有签名的块，三档里有两档都原样带回——那条路本来就是通的", () => {
	const signed = [unsigned[0], assistant([{ type: "thinking", thinking: "想过", signature: SIGNATURE }], "stop")] as Message[];
	for (const replay of ["unsigned", "signed-only"] as const) {
		const blocks = thinkingBlocks(signed, { thinkingReplay: replay });
		assert.equal(blocks.length, 1, replay);
		assert.equal(blocks[0].signature, SIGNATURE, replay);
	}
});

test("加密的 redacted 块跟签名无关：它本身就是可回放的那一份", () => {
	const redacted = [unsigned[0], assistant([{ type: "thinking", thinking: "", redacted: true, encrypted: SIGNATURE }], "stop")] as Message[];
	assert.equal(thinkingBlocks(redacted, { thinkingReplay: "signed-only" })[0]?.type, "redacted_thinking");
	assert.deepEqual(thinkingBlocks(redacted, { thinkingReplay: "none" }), [], "最底那一档也包括它");
});

test("默认那一档是「只发带签名的」——不传参数的调用点行为一个字都没变", () => {
	assert.deepEqual(thinkingBlocks(unsigned, undefined), []);
});

// ---------------------------------------------------------------------------
// 缺口 1：默认值按端点算
// ---------------------------------------------------------------------------

test("官方地址算签名端点，长得像官方的不算", () => {
	assert.equal(signsThinkingSignatures("https://api.anthropic.com"), true);
	assert.equal(signsThinkingSignatures("https://api.anthropic.com/v1"), true);
	assert.equal(signsThinkingSignatures("HTTPS://API.ANTHROPIC.COM/"), true);
	// 前缀匹配会把这个当成官方。出处：oh-my-pi `catalog/src/compat/anthropic.ts:13-23` 记着同一件事。
	assert.equal(signsThinkingSignatures("https://api.anthropic.com.evil.com"), false);
	assert.equal(signsThinkingSignatures("https://api.anthropic.company/v1"), false);
	// 没填地址按官方算：那是配置没填好，而按官方算等于保持现状。
	assert.equal(signsThinkingSignatures(undefined), true);
	assert.equal(signsThinkingSignatures(""), true);
});

test("把 Claude 转在自己身份后面、但照样执行签名协议的那几个网关也算", () => {
	// 出处：oh-my-pi `catalog/src/compat/anthropic.ts:25-48`（Cloudflare AI Gateway、Vertex
	// publishers/anthropic、Bedrock、Azure Foundry）。
	assert.equal(signsThinkingSignatures("https://gateway.ai.cloudflare.com/v1/acct/gw/anthropic"), true);
	assert.equal(signsThinkingSignatures("https://us-central1-aiplatform.googleapis.com/v1/projects/p/locations/l/publishers/anthropic/models"), true);
	assert.equal(signsThinkingSignatures("https://bedrock-runtime.us-east-1.amazonaws.com"), true);
	assert.equal(signsThinkingSignatures("https://my-res.services.ai.azure.com"), true);
});

test("非签名端点 + 推理模型默认回放；不推理的模型留在保守那一格", () => {
	// 出处：oh-my-pi `catalog/src/compat/resolve.ts:861`
	// （`!signingEndpoint && (Boolean(spec.reasoning) || ...)`）。
	resetThinkingReplay();
	const deepseek: ProviderConfig = { id: "ds", name: "DeepSeek", api: "anthropic-messages", apiKey: "k", baseUrl: "https://api.deepseek.com/anthropic", enabled: true, models: [] };
	const official: ProviderConfig = { ...deepseek, id: "an", baseUrl: "https://api.anthropic.com" };
	assert.equal(thinkingReplay(deepseek, model), "unsigned");
	assert.equal(thinkingReplay(official, model), "signed-only", "官方端点上默认没变");
	assert.equal(thinkingReplay(deepseek, { ...model, id: "ds/plain", supportsThinking: false }), "signed-only");
});

// ---------------------------------------------------------------------------
// 缺口 2：识别签名拒绝的原话
// ---------------------------------------------------------------------------

test("官方 Anthropic 拒绝空签名的原话被认出来，档位往下走一格", () => {
	// 复现原文（出处 oh-my-pi `anthropic.ts:1862`）：
	//     400 Invalid `signature` in `thinking` block
	resetThinkingReplay();
	assert.equal(learnThinkingReplay("qa", "m", "请求不被接受：Invalid `signature` in `thinking` block", "unsigned"), true);
	const deepseek: ProviderConfig = { id: "qa", name: "x", api: "anthropic-messages", apiKey: "k", baseUrl: "https://api.deepseek.com/anthropic", enabled: true, models: [] };
	assert.equal(thinkingReplay(deepseek, { ...model, id: "m" }), "signed-only");
});

test("反引号被中转吃掉的那种写法也认，大小写也认", () => {
	resetThinkingReplay();
	assert.equal(learnThinkingReplay("qa", "m", "invalid signature in thinking block", "unsigned"), true);
	resetThinkingReplay();
	assert.equal(learnThinkingReplay("qa", "m", "Invalid `signature` in `thinking`", "unsigned"), true);
});

test("Bedrock 系中转的另一种说法也认：空串在它那边先过不了 schema 校验", () => {
	// 复现原文（出处 oh-my-pi `anthropic.ts:1863`）：
	//     ValidationException: ... messages.1.content.0.thinking.signature: Field required
	resetThinkingReplay();
	assert.equal(learnThinkingReplay("qa", "m", "ValidationException: The model returned the following errors: messages.1.content.0.thinking.signature: Field required", "unsigned"), true);
});

test("不相干的 400 不被认领——认多了会拿一个改坏了的请求去重发", () => {
	resetThinkingReplay();
	for (const said of [
		"messages.1.content.0.tool_use.id: String should match pattern '^[a-zA-Z0-9_-]+$'",
		"The reasoning_text in the thinking mode must be passed back to the API.",
		"max_tokens: Field required",
		"all content must be type `text` if `is_error` is true",
	]) {
		assert.equal(learnThinkingReplay("qa", "m", said, "unsigned"), false, said);
	}
});

test("`required` 隔着引号或换行的另一件事不被当成签名问题", () => {
	// `[^"\n]{0,32}` 这一段就是为了这个收紧的。
	resetThinkingReplay();
	assert.equal(learnThinkingReplay("qa", "m", 'thinking.signature": "ok", "max_tokens": "required"', "unsigned"), false);
	assert.equal(learnThinkingReplay("qa", "m", "thinking.signature is fine\nbut max_tokens is required", "unsigned"), false);
});

test("走到梯子最底下还被顶回来就不再重发——再往下没有格子了", () => {
	resetThinkingReplay();
	const said = "Invalid `signature` in `thinking` block";
	assert.equal(learnThinkingReplay("qa", "m", said, "unsigned"), true, "unsigned → signed-only");
	assert.equal(learnThinkingReplay("qa", "m", said, "unsigned"), true, "signed-only → none");
	assert.equal(learnThinkingReplay("qa", "m", said, "unsigned"), false, "到底了");
});

test("签名端点上的默认值是第二格，所以它第一次被顶回来就直接走到底", () => {
	// 官方端点上会走到这条路的是「签名是别的部署签的」——剥不掉也验不过，只能一块都不发。
	resetThinkingReplay();
	const said = "Invalid `signature` in `thinking` block";
	assert.equal(learnThinkingReplay("qa", "m", said, "signed-only"), true);
	assert.equal(learnThinkingReplay("qa", "m", said, "signed-only"), false);
});

test("撞上签名拒绝之后，一份一份换形状重发，整条梯子都走得通", async () => {
	// 这条守的是「自愈接上了」这件事本身：`withReasoningRetry` 从前只套在两条 OpenAI 链上，
	// Anthropic 这边撞上形状问题就是死路——而缺口 1 一修成送空串，官方端点上立刻就会撞。
	resetThinkingReplay();
	const provider: ProviderConfig = { id: "ds", name: "DeepSeek", api: "anthropic-messages", apiKey: "k", baseUrl: "https://api.deepseek.com/anthropic", enabled: true, models: [model] };
	// 一个带签名、一个没签名——这样三档各自发出去的形状互不相同，看得出走到了哪一格。
	const mixed: Message[] = [
		unsigned[0],
		assistant([{ type: "thinking", thinking: "签上了", signature: SIGNATURE }, { type: "thinking", thinking: "没签上" }, { type: "text", text: "说完了" }], "stop"),
		unsigned[2],
	];
	const bodies: Array<Record<string, any>> = [];
	const stream = anthropicMessagesProvider.stream(provider, model, { messages: mixed, tools: [] }, {
		retryAttempts: 1,
		fetch: async (_input, init) => {
			bodies.push(JSON.parse(String(init?.body)));
			return new Response(JSON.stringify({ error: { message: "Invalid `signature` in `thinking` block" } }), { status: 400 });
		},
	});
	for await (const _event of stream) { /* 走到 fetch 为止。 */ }

	const signaturesOf = (body: Record<string, any>) =>
		body.messages.flatMap((m: any) => m.content).filter((b: any) => b.type === "thinking").map((b: any) => b.signature);
	assert.equal(bodies.length, 3, "梯子三格，两步，所以一共三份请求");
	assert.deepEqual(signaturesOf(bodies[0]), [SIGNATURE, ""], "第一档：非签名端点 + 推理模型 → 连没签名的也发");
	assert.deepEqual(signaturesOf(bodies[1]), [SIGNATURE], "第二档：只发带签名的");
	assert.deepEqual(signaturesOf(bodies[2]), [], "第三档：一块都不发");
});

test("不相干的 400 不会引出一次重发", async () => {
	resetThinkingReplay();
	const provider: ProviderConfig = { id: "ds2", name: "DeepSeek", api: "anthropic-messages", apiKey: "k", baseUrl: "https://api.deepseek.com/anthropic", enabled: true, models: [model] };
	let calls = 0;
	const stream = anthropicMessagesProvider.stream(provider, model, { messages: unsigned, tools: [] }, {
		retryAttempts: 1,
		fetch: async () => {
			calls++;
			return new Response(JSON.stringify({ error: { message: "credit balance is too low" } }), { status: 400 });
		},
	});
	for await (const _event of stream) { /* 同上。 */ }
	assert.equal(calls, 1);
});

// ---------------------------------------------------------------------------
// 缺口 3：中断轮和弃用工具轮的签名
// ---------------------------------------------------------------------------

test("中断的一轮：只有最后一个块的签名不可信，前面那个完好的留着", () => {
	/*
	 * 出处：oh-my-pi `transform-messages.ts:716-735`。Anthropic 在 `content_block_stop` 才发签名，而那
	 * 必然发生在下一个块开始之前——所以流停在半路时，只有当时正在流的那个块（永远是最后一个）可能拿到
	 * 半截签名。一起剥掉是白扔一条能回放的思维链，而且换来的是另一个
	 * `400 Invalid \`signature\` in \`thinking\` block`。
	 */
	const history: Message[] = [
		unsigned[0],
		assistant([
			{ type: "thinking", thinking: "第一段想完了，签名是完整的。", signature: OTHER_SIGNATURE },
			{ type: "thinking", thinking: "第二段正在流的时候被按停", signature: SIGNATURE },
		], "aborted"),
		{ role: "user", content: [{ type: "text", text: "接着说" }], timestamp: 4 },
	];
	const blocks = thinkingBlocks(history, { thinkingReplay: "signed-only" });
	assert.equal(blocks.length, 1, "前面那个留着，最后那个的签名被剥掉之后无处可去");
	assert.equal(blocks[0].signature, OTHER_SIGNATURE);
});

test("中断的一轮，最后那个块在非签名端点上还回得去——只是不带签名", () => {
	const history: Message[] = [
		unsigned[0],
		assistant([{ type: "thinking", thinking: "被按停时正在想的那段", signature: SIGNATURE }], "aborted"),
		{ role: "user", content: [{ type: "text", text: "接着说" }], timestamp: 4 },
	];
	const blocks = thinkingBlocks(history, { thinkingReplay: "unsigned" });
	assert.equal(blocks.length, 1);
	assert.equal(blocks[0].signature, "", "半截签名不能带，但推理本身该带回去");
});

test("出错结束的一轮跟按停的一轮同样处理", () => {
	const history: Message[] = [unsigned[0], assistant([{ type: "thinking", thinking: "想到一半连接断了", signature: SIGNATURE }], "error"), unsigned[2]];
	assert.deepEqual(thinkingBlocks(history, { thinkingReplay: "signed-only" }), []);
});

test("中断轮里最后一个块不是思考块时，思考块的签名完好无损", () => {
	// 想完话、正在输出可见文本时被按停——这是最常见的那一种，剥它等于白扔。
	const history: Message[] = [
		unsigned[0],
		assistant([{ type: "thinking", thinking: "想完了", signature: SIGNATURE }, { type: "text", text: "说到一半被打断" }], "aborted"),
		unsigned[2],
	];
	assert.equal(thinkingBlocks(history, { thinkingReplay: "signed-only" })[0]?.signature, SIGNATURE);
});

test("弃用工具的一轮：签名全剥，不只是最后一个", () => {
	/*
	 * 出处：oh-my-pi `transform-messages.ts:727-735`。这一轮里有工具调用但它没要求执行
	 * （`stopReason !== "toolUse"`），`agent/loop.ts:359-370` 会给那些没人答的调用造占位结果好让配对
	 * 成立。这一轮本身是干净结束的，但它的签名绑在那个结束状态上，在一个被续写出来的历史里全都验不过。
	 */
	const history: Message[] = [
		unsigned[0],
		assistant([
			{ type: "thinking", thinking: "想过", signature: OTHER_SIGNATURE },
			{ type: "thinking", thinking: "又想了一段", signature: SIGNATURE },
			{ type: "toolCall", id: "toolu_01ABC", name: "read", arguments: { path: "a.ts" } },
		], "stop"),
		{ role: "toolResult", toolCallId: "toolu_01ABC", toolName: "read", content: [{ type: "text", text: "(占位)" }], isError: false, timestamp: 4 },
		assistant([{ type: "text", text: "接着说" }], "stop"),
	];
	assert.deepEqual(thinkingBlocks(history, { thinkingReplay: "signed-only" }), [], "两个签名都剥掉了，于是两块都无处可去");
});

test("最新那一轮的弃用工具例外：原样带回，连剥签名都不行", () => {
	// 出处：oh-my-pi `transform-messages.ts:745-747`——Anthropic 要求它自己最近那条回复原样带回。
	const history: Message[] = [
		unsigned[0],
		assistant([
			{ type: "thinking", thinking: "想过", signature: SIGNATURE },
			{ type: "toolCall", id: "toolu_01ABC", name: "read", arguments: { path: "a.ts" } },
		], "stop"),
		{ role: "toolResult", toolCallId: "toolu_01ABC", toolName: "read", content: [{ type: "text", text: "(占位)" }], isError: false, timestamp: 4 },
	];
	assert.equal(thinkingBlocks(history, { thinkingReplay: "signed-only" })[0]?.signature, SIGNATURE);
});

test("中断的最新一轮不给例外——那个半截签名留着是必然的 400", () => {
	const history: Message[] = [unsigned[0], assistant([{ type: "thinking", thinking: "被按停", signature: SIGNATURE }], "aborted")];
	assert.deepEqual(thinkingBlocks(history, { thinkingReplay: "signed-only" }), []);
});

test("正常结束、没有工具调用的一轮，签名一个都不剥", () => {
	for (const stopReason of ["stop", "length", "toolUse"] as const) {
		const history: Message[] = [unsigned[0], assistant([{ type: "thinking", thinking: "想过", signature: SIGNATURE }], stopReason), unsigned[2]];
		assert.equal(thinkingBlocks(history, { thinkingReplay: "signed-only" })[0]?.signature, SIGNATURE, stopReason);
	}
});

// ---------------------------------------------------------------------------
// 缺口 10：开着思考时的采样参数
// ---------------------------------------------------------------------------

test("开着思考时，配在 samplingParams 里的 temperature 不发出去", () => {
	/*
	 * 从前 `options.temperature` 被正确地挡在思考关闭那条分支里，紧接着两个 `...samplingParams` 又把
	 * 它放了回来——用户在模型上配 `samplingParams: {temperature: 0.3}` 再开思考，每一轮都 400。
	 *
	 * 证据：Opus 4.7 起这三个键**无论思考开不开**都是 400（官方迁移文档：`The temperature, top_p, and
	 * top_k parameters are no longer accepted on Claude Opus 4.7`），所以摘掉只会少 400 不会多。
	 * 「更早的模型上开了思考就不能改温度」这一条在官方现行文档里没找到原文（**推断，未验证**；与
	 * oh-my-pi `anthropic.ts:4088-4095` 的同一条判断一致）。
	 */
	const sent = samplingFor(true, { samplingParams: { temperature: 0.3, top_p: 0.9, top_k: 40 } }, { temperature: 0.7 });
	assert.deepEqual(sent, {});
});

test("开着思考时只摘那三个键，别的原样合并进去", () => {
	// Lyra 的 `samplingParams` 是个「原样合并进请求体」的口子（`types/provider.ts:79`），里面放的不一定
	// 是采样参数；整块扣掉会顺手扣掉别的东西，而没有证据说别的键在开思考时发不出去。
	const sent = samplingFor(true, { samplingParams: { temperature: 0.3, metadata: { user_id: "u1" } } }, { samplingParams: { stop_sequences: ["</done>"] } });
	assert.deepEqual(sent, { metadata: { user_id: "u1" }, stop_sequences: ["</done>"] });
});

test("关着思考时照发，顺序也和从前一样", () => {
	assert.deepEqual(samplingFor(false, { samplingParams: { top_p: 0.9 } }, { temperature: 0.7 }), { temperature: 0.7, top_p: 0.9 });
	// 显式配在 samplingParams 里的压过 options.temperature——这是从前的顺序，没有改。
	assert.deepEqual(samplingFor(false, { samplingParams: { temperature: 0.3 } }, { temperature: 0.7 }), { temperature: 0.3 });
	assert.deepEqual(samplingFor(false, { samplingParams: { temperature: 0.3 } }, { samplingParams: { temperature: 0.1 } }), { temperature: 0.1 });
});

test("请求体里真的没有那三个键", async () => {
	resetThinkingReplay();
	const provider: ProviderConfig = { id: "an", name: "Anthropic", api: "anthropic-messages", apiKey: "k", baseUrl: "https://api.anthropic.com", enabled: true, models: [model] };
	let body: Record<string, any> = {};
	const stream = anthropicMessagesProvider.stream(
		provider,
		{ ...model, samplingParams: { temperature: 0.3, top_k: 40 } },
		{ messages: [unsigned[0]], tools: [] },
		{
			retryAttempts: 1,
			thinking: "medium",
			fetch: async (_input, init) => {
				body = JSON.parse(String(init?.body));
				return new Response("stop here", { status: 400 });
			},
		},
	);
	for await (const _event of stream) { /* 同上。 */ }
	assert.equal(body.thinking?.type, "enabled", "思考确实是开着的");
	assert.ok(!("temperature" in body), "temperature 不该在");
	assert.ok(!("top_k" in body), "top_k 不该在");
});
