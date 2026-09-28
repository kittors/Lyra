/**
 * 请求参数那一轴：哪个字段这个端点不吃，撞出来之后记住。
 *
 * 这几条在作者手上两个端点全是 200（2026-09-11，`test/responses-params-probe.ts`，落盘
 * `~/.lyra/scratch/responses-params.txt`），也就是**没有能复现它们的端点**。所以这里全部是离线测：
 * 单测是这套机制唯一的保障，少了它，这些代码路径从来没有被执行过。
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { droppedParams, learnDroppedParam, resetRequestParamsCompat } from "../src/ai/request-params-compat.ts";

test("默认一个参数都不省", () => {
	resetRequestParamsCompat();
	assert.equal(droppedParams("qa", "m").size, 0);
});

test("端点说不认 effort=none 就别再发 reasoning", () => {
	resetRequestParamsCompat();
	// Google Gemini/Vertex 的实测原话，记在 `openai-responses.ts` 关思考那段注释里。
	assert.equal(learnDroppedParam("qa", "m", "none is not a valid ThinkingLevel enum value"), true);
	assert.ok(droppedParams("qa", "m").has("reasoning-off"));

	assert.equal(learnDroppedParam("qa", "m", "none is not a valid ThinkingLevel enum value"), false, "撤过一次就别再重发");
});

test("OpenAI 系对枚举外取值的通用说法也认", () => {
	resetRequestParamsCompat();
	assert.equal(learnDroppedParam("qa", "m", "Invalid value: 'none'. Supported values are: 'low', 'medium', 'high'."), true);
	assert.ok(droppedParams("qa", "m").has("reasoning-off"));
});

test("端点点名 tool_choice 就别再发它", () => {
	resetRequestParamsCompat();
	assert.equal(learnDroppedParam("qa", "m", "Unsupported parameter: 'tool_choice' is not supported with this model."), true);
	assert.ok(droppedParams("qa", "m").has("tool-choice"));
});

test("端点拒采样参数就整组撤掉", () => {
	resetRequestParamsCompat();
	// OpenAI 官方对 o 系列/gpt-5.x 的原话。
	assert.equal(
		learnDroppedParam("qa", "m", "Unsupported value: 'temperature' does not support 0.7 with this model. Only the default (1) is supported."),
		true,
	);
	assert.ok(droppedParams("qa", "m").has("sampling"));
});

test("端点不认 include 里的密文项就别再要", () => {
	resetRequestParamsCompat();
	assert.equal(learnDroppedParam("qa", "m", "Invalid value for include: reasoning.encrypted_content"), true);
	assert.ok(droppedParams("qa", "m").has("include-encrypted"));
});

test("Vertex behind a Chat Completions relay names thinking_level and the value — that is claimed", () => {
	resetRequestParamsCompat();
	// Measured 2026-09-28 on the user's relay with gemini-3.8-flash-high and `reasoning_effort: "none"`.
	const said = `Invalid value at 'request.generation_config.thinking_config.thinking_level' (type.googleapis.com/google.cloud.aiplatform.master.GenerationConfig.ThinkingConfig.ThinkingLevel), "none"`;
	assert.equal(learnDroppedParam("qa", "vertex", said), true);
	assert.ok(droppedParams("qa", "vertex").has("reasoning-off"));
	// The failure detail can be the raw body, where the same quotes arrive escaped.
	assert.equal(learnDroppedParam("qa", "raw", JSON.stringify({ error: { message: said } })), true);
	assert.ok(droppedParams("qa", "raw").has("reasoning-off"));
});

test("a thinking_level complaint about another value, or Gemini 2.5's sentence that names nothing, is not claimed", () => {
	resetRequestParamsCompat();
	// Dropping `reasoning_effort: "none"` cannot fix a rejected "minimal": the resend would fail the same way.
	assert.equal(learnDroppedParam("qa", "m", `Invalid value at 'request.generation_config.thinking_config.thinking_level' (…ThinkingLevel), "minimal"`), false);
	// What gemini-2.5-flash answers on the same relay. `refusesReasoningNone` covers it; learning cannot.
	assert.equal(learnDroppedParam("qa", "m", "Request contains an invalid argument."), false);
	assert.equal(droppedParams("qa", "m").size, 0);
});

test("认不出来的 400 一个参数都不动——削过的请求比原样发出去更糟", () => {
	resetRequestParamsCompat();
	assert.equal(learnDroppedParam("qa", "m", "Rate limit exceeded"), false);
	assert.equal(learnDroppedParam("qa", "m", "Invalid API key provided"), false);
	assert.equal(learnDroppedParam("qa", "m", "context_length_exceeded"), false);
	assert.equal(droppedParams("qa", "m").size, 0);
});

test("顺口提到参数名的长错误不算——要求「不支持」紧跟在名字后面", () => {
	resetRequestParamsCompat();
	// 这句话在说别的事，只是恰好提到了 temperature。
	assert.equal(
		learnDroppedParam("qa", "m", "The request was rejected. Your temperature setting looks fine. The model is overloaded."),
		false,
	);
	assert.equal(droppedParams("qa", "m").size, 0);
});

test("撞过几个就撤几个，互不影响", () => {
	resetRequestParamsCompat();
	learnDroppedParam("qa", "m", "none is not a valid ThinkingLevel enum value");
	learnDroppedParam("qa", "m", "Unsupported parameter: 'tool_choice' is not supported with this model.");
	const set = droppedParams("qa", "m");
	assert.equal(set.size, 2);
	assert.ok(set.has("reasoning-off") && set.has("tool-choice"));
	assert.ok(!set.has("sampling"), "没撞过的不该被牵连");
});

test("结论按模型记，不串到别的模型上", () => {
	resetRequestParamsCompat();
	learnDroppedParam("qa", "picky", "none is not a valid ThinkingLevel enum value");
	assert.ok(droppedParams("qa", "picky").has("reasoning-off"));
	assert.equal(droppedParams("qa", "other").size, 0);
	assert.equal(droppedParams("other-provider", "picky").size, 0);
});
