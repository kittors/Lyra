/**
 * Anthropic Messages 链上的内容块形状：图片、错误结果、UTF-8、缓存断点。
 *
 * 这几条的共同点还是「历史本身就是请求」：一张 `.bmp` 的截图一旦进了会话记录，之后每一轮都带着它，
 * 每一轮都 400。所以在这里守住。
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeImageMediaType, toAnthropicMessages, wellFormedDeep } from "../src/ai/anthropic-messages-request.ts";
import { emptyUsage, type AssistantMessage, type Message, type ToolResultMessage } from "../src/types.ts";

/** 一小张真的 PNG（1×1 透明）。用真数据而不是 `"..."`，因为 base64 的合法性本身也在被传下去。 */
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==";

const user = (text: string): Message => ({ role: "user", content: [{ type: "text", text }], timestamp: 1 });

function assistantWithCall(id: string, name = "read"): AssistantMessage {
	return {
		role: "assistant", api: "anthropic-messages", provider: "qa", model: "claude-test", usage: emptyUsage(), stopReason: "toolUse", timestamp: 2,
		content: [{ type: "toolCall", id, name, arguments: { path: "shot.bmp" } }],
	};
}

function result(id: string, content: ToolResultMessage["content"], isError = false): ToolResultMessage {
	return { role: "toolResult", toolCallId: id, toolName: "read", content, isError, timestamp: 3 };
}

const blocksOf = (out: ReturnType<typeof toAnthropicMessages>) => out.flatMap((m) => m.content);

// ---------------------------------------------------------------------------
// 缺口 5：图片 media_type 白名单
// ---------------------------------------------------------------------------

test("Anthropic 只收四种图片，别的换成一行文字而不是原样透传", () => {
	/*
	 * 出处：oh-my-pi `anthropic.ts:1119-1124` 的 `normalizeAnthropicImageMediaType`。
	 * 可达性：`tools/paths.ts:61` 的 `IMAGE_EXTENSIONS` 里有 `.bmp` → `image/bmp`；MCP 那边
	 * （`mcp/client.ts:280`）原样透传服务器给的 mimeType，什么都可能是。
	 */
	assert.equal(normalizeImageMediaType("image/png"), "image/png");
	assert.equal(normalizeImageMediaType("image/gif"), "image/gif");
	assert.equal(normalizeImageMediaType("image/webp"), "image/webp");
	assert.equal(normalizeImageMediaType("image/bmp"), undefined);
	assert.equal(normalizeImageMediaType("image/svg+xml"), undefined);
	assert.equal(normalizeImageMediaType("image/tiff"), undefined);
	assert.equal(normalizeImageMediaType("application/pdf"), undefined);
});

test("`image/jpg` 是个常见写法，改成 `image/jpeg` 而不是判死刑", () => {
	assert.equal(normalizeImageMediaType("image/jpg"), "image/jpeg");
	assert.equal(normalizeImageMediaType("  IMAGE/JPG  "), "image/jpeg");
	assert.equal(normalizeImageMediaType("IMAGE/PNG"), "image/png");
});

test("读到一张 .bmp 之后，那个 tool_result 里是说明文字，不是一个会 400 的 image 块", () => {
	const out = toAnthropicMessages([user("看下这张图"), assistantWithCall("toolu_01A"), result("toolu_01A", [{ type: "image", data: PNG, mimeType: "image/bmp" }])]);
	const toolResult = blocksOf(out).find((b) => b.type === "tool_result");
	assert.deepEqual(toolResult?.content, [{ type: "text", text: "[unsupported image: image/bmp]" }]);
});

test("用户自己贴进来的不认识的图片也一样", () => {
	const out = toAnthropicMessages([{ role: "user", content: [{ type: "text", text: "这个图" }, { type: "image", data: PNG, mimeType: "image/tiff" }], timestamp: 1 }]);
	assert.deepEqual(out[0].content.map((b) => b.type), ["text", "text"]);
	assert.equal(out[0].content[1].text, "[unsupported image: image/tiff]");
});

// ---------------------------------------------------------------------------
// 缺口 6：图片要看模型支不支持
// ---------------------------------------------------------------------------

test("模型读不了图片时，图片换成一行说明——丢掉会让模型以为工具什么都没返回", () => {
	// 出处：oh-my-pi `anthropic.ts:1110-1113`（`convertContentBlocks(content, model.input.includes("image"))`）。
	const history = [user("看图"), assistantWithCall("toolu_01A"), result("toolu_01A", [{ type: "text", text: "截图如下" }, { type: "image", data: PNG, mimeType: "image/png" }])];
	const blind = blocksOf(toAnthropicMessages(history, { supportsImages: false })).find((b) => b.type === "tool_result");
	assert.deepEqual(blind?.content, [{ type: "text", text: "截图如下" }, { type: "text", text: "[image omitted: model does not support vision]" }]);
	const seeing = blocksOf(toAnthropicMessages(history, { supportsImages: true })).find((b) => b.type === "tool_result");
	assert.ok(seeing);
	assert.equal((seeing.content as Array<{ type: string }>)[1].type, "image");
});

test("不传这个参数时按「能读」算——把不知道当成不能读会抹掉本来好好的图片", () => {
	const out = toAnthropicMessages([{ role: "user", content: [{ type: "image", data: PNG, mimeType: "image/png" }], timestamp: 1 }]);
	assert.equal(out[0].content[0].type, "image");
});

// ---------------------------------------------------------------------------
// 缺口 7：`is_error` 的 tool_result 里不能有图片
// ---------------------------------------------------------------------------

test("失败的工具结果里的图片提升到这一串结果后面，而不是留在块里", () => {
	/*
	 * 复现原文（出处 oh-my-pi `anthropic.ts:4174-4181`）：
	 *     all content must be type `text` if `is_error` is true
	 * 可达性：`mcp/client.ts:257-261` 明确支持 `isError: true` 配 image 块。
	 * 图片不丢，因为「工具失败了，这是失败时的截图」两样都是模型需要的。
	 */
	const out = toAnthropicMessages([
		user("跑一下"),
		assistantWithCall("toolu_01A", "browser"),
		result("toolu_01A", [{ type: "text", text: "点不到那个按钮" }, { type: "image", data: PNG, mimeType: "image/png" }], true),
	]);
	const merged = out[out.length - 1];
	assert.equal(merged.content.length, 2);
	assert.equal(merged.content[0].type, "tool_result");
	assert.equal(merged.content[0].is_error, true);
	assert.deepEqual(merged.content[0].content, [{ type: "text", text: "点不到那个按钮" }]);
	assert.equal(merged.content[1].type, "image", "图片跟在后面，不在块里");
});

test("图片是失败结果的全部内容时，提升之后补一句话而不是留个空块", () => {
	const out = toAnthropicMessages([user("跑一下"), assistantWithCall("toolu_01A", "browser"), result("toolu_01A", [{ type: "image", data: PNG, mimeType: "image/png" }], true)]);
	const merged = out[out.length - 1];
	assert.deepEqual(merged.content[0].content, [{ type: "text", text: "Tool failed with no output." }]);
	assert.equal(merged.content[1].type, "image");
});

test("一轮里多个结果时，提升的图片跟在整串后面，结果本身没被拆进多条消息", () => {
	/*
	 * 一轮里的所有结果必须并在一条消息里——拆开会让模型学着不再并行调工具。提升出来的图片一进去，
	 * 「上一条是不是全是 tool_result」这个判断就不成立了，所以那一串消息必须显式记着。
	 */
	const assistantTwo: AssistantMessage = {
		...assistantWithCall("toolu_01A"),
		content: [
			{ type: "toolCall", id: "toolu_01A", name: "browser", arguments: {} },
			{ type: "toolCall", id: "toolu_01B", name: "read", arguments: {} },
		],
	};
	const out = toAnthropicMessages([
		user("两件事"),
		assistantTwo,
		result("toolu_01A", [{ type: "text", text: "失败了" }, { type: "image", data: PNG, mimeType: "image/png" }], true),
		result("toolu_01B", [{ type: "text", text: "读到了" }]),
	]);
	assert.equal(out.length, 3, "结果不该被拆到两条 user 消息里");
	assert.deepEqual(out[2].content.map((b) => b.type), ["tool_result", "tool_result", "image"]);
});

test("成功的工具结果里的图片一动不动", () => {
	const out = toAnthropicMessages([user("看图"), assistantWithCall("toolu_01A"), result("toolu_01A", [{ type: "image", data: PNG, mimeType: "image/png" }])]);
	const merged = out[out.length - 1];
	assert.equal(merged.content.length, 1, "没有 is_error 就没有提升这回事");
	assert.equal((merged.content[0].content as Array<{ type: string }>)[0].type, "image");
});

// ---------------------------------------------------------------------------
// 缺口 9：孤立代理项
// ---------------------------------------------------------------------------

/** 一个孤立的高位代理项——读过被 emoji 截断的文件、grep 命中半个代理对之后，历史里就是这个。 */
const LONE_HIGH = "\uD83D";
/** 一个孤立的低位代理项。 */
const LONE_LOW = "\uDE00";

test("文本里的孤立代理项被清洗——它流出来时没事，回放时被严格 UTF-8 校验 400", () => {
	// 出处：oh-my-pi `anthropic.ts:4330`（文本）与 `:4404-4408`（工具参数）。
	const out = toAnthropicMessages([{ role: "user", content: [{ type: "text", text: `文件读到一半：真好笑${LONE_HIGH}` }], timestamp: 1 }]);
	const text = String(out[0].content[0].text);
	assert.ok(!/[\uD800-\uDFFF]/.test(text), "不该还剩孤立代理项");
	assert.equal(text, "文件读到一半：真好笑�");
});

test("工具参数里的孤立代理项也被清洗——那是模型自己吐出来的", () => {
	const history: Message[] = [
		user("搜一下"),
		{
			role: "assistant", api: "anthropic-messages", provider: "qa", model: "claude-test", usage: emptyUsage(), stopReason: "toolUse", timestamp: 2,
			content: [{ type: "toolCall", id: "toolu_01A", name: "grep", arguments: { pattern: `${LONE_LOW}笑`, include: ["*.ts"], limit: 20 } }],
		},
		result("toolu_01A", [{ type: "text", text: "没命中" }]),
	];
	const use = blocksOf(toAnthropicMessages(history)).find((b) => b.type === "tool_use");
	assert.deepEqual(use?.input, { pattern: "�笑", include: ["*.ts"], limit: 20 });
});

test("深层清洗保身份：没问题的值返回的是原来那个对象", () => {
	/*
	 * 这是硬要求，不是优化：这个函数在每一轮的整段历史上跑一遍，只要它随手返回新串，请求字节就每轮
	 * 都在变，后面所有的提示缓存全部作废。
	 */
	const clean = { a: "好的", b: ["x", { c: 1 }], d: null, e: true };
	assert.equal(wellFormedDeep(clean), clean);
	assert.equal(wellFormedDeep(clean.b), clean.b);
	assert.equal(wellFormedDeep("好的"), "好的");
	// 有一处要改时，只有到那一处路径上的对象是新的。
	const dirty = { keep: { same: "x" }, bad: LONE_HIGH };
	const fixed = wellFormedDeep(dirty) as typeof dirty;
	assert.notEqual(fixed, dirty);
	assert.equal(fixed.keep, dirty.keep, "没动过的子树该是同一个引用");
	assert.equal(fixed.bad, "�");
});

test("同一段历史编两遍，字节完全一样——不然提示缓存每轮都作废", () => {
	const history: Message[] = [user("你好"), assistantWithCall("toolu_01A"), result("toolu_01A", [{ type: "text", text: `半个表情${LONE_HIGH}` }])];
	assert.equal(JSON.stringify(toAnthropicMessages(history)), JSON.stringify(toAnthropicMessages(history)));
});

// ---------------------------------------------------------------------------
// 缺口 11：消息尾部的缓存断点
// ---------------------------------------------------------------------------

const cacheMarks = (out: ReturnType<typeof toAnthropicMessages>) =>
	out.flatMap((m, at) => m.content.map((b, i) => (b.cache_control ? `${at}.${i}:${b.type}` : undefined))).filter(Boolean);

test("消息尾部滚两个断点——从前一个都没有，整段历史每轮按全价重读", () => {
	/*
	 * 这条不是 400 是钱：加上之后那段历史走 `cache_read`（约 1/10 价）。总共只有四个断点可用（官方
	 * 文档：`Max 4 cache_control breakpoints per request`），system 和工具列表各占一个，这里两个正好
	 * 用满。
	 */
	const history: Message[] = [user("一"), assistantWithCall("toolu_01A"), result("toolu_01A", [{ type: "text", text: "结果" }]), user("二")];
	assert.deepEqual(cacheMarks(toAnthropicMessages(history, { cacheBreakpoints: 2 })), ["2.0:tool_result", "3.0:text"]);
});

test("不传这个参数时一个断点都不放——不传参数的调用点行为一个字没变", () => {
	const history: Message[] = [user("一"), user("二")];
	assert.deepEqual(cacheMarks(toAnthropicMessages(history)), []);
	assert.deepEqual(cacheMarks(toAnthropicMessages(history, { cacheBreakpoints: 0 })), []);
});

test("断点不放在 thinking 块上——官方列的能放的块里没有它", () => {
	/*
	 * 官方文档原话：`cache_control` `Goes on any content block: system text blocks, tool definitions,
	 * message content blocks (text, image, tool_use, tool_result, document)`——`thinking` 和
	 * `redacted_thinking` 都不在里面。oh-my-pi `anthropic.ts:3458-3472` 是同一张禁放清单。
	 */
	const history: Message[] = [
		user("一"),
		{
			role: "assistant", api: "anthropic-messages", provider: "qa", model: "claude-test", usage: emptyUsage(), stopReason: "stop", timestamp: 2,
			content: [{ type: "text", text: "答案" }, { type: "thinking", thinking: "想过", signature: "sigsigsig" }],
		},
	];
	// 最后一个块是 thinking，往前找到那个 text。
	assert.deepEqual(cacheMarks(toAnthropicMessages(history, { cacheBreakpoints: 1 })), ["1.0:text"]);
});

test("整条消息全是不能放的块时跳过它，往前一条找", () => {
	const history: Message[] = [
		user("一"),
		{
			role: "assistant", api: "anthropic-messages", provider: "qa", model: "claude-test", usage: emptyUsage(), stopReason: "stop", timestamp: 2,
			content: [{ type: "thinking", thinking: "只想了想", signature: "sigsigsig" }],
		},
	];
	assert.deepEqual(cacheMarks(toAnthropicMessages(history, { cacheBreakpoints: 1 })), ["0.0:text"]);
});

test("要几个就放几个，历史比它短时放到没得放为止", () => {
	assert.equal(cacheMarks(toAnthropicMessages([user("只有一条")], { cacheBreakpoints: 2 })).length, 1);
	assert.equal(cacheMarks(toAnthropicMessages([user("一"), user("二"), user("三")], { cacheBreakpoints: 2 })).length, 2);
});
