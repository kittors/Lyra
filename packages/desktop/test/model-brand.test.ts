/**
 * Which logo goes beside which model, as rules rather than as a rendering.
 *
 * The failure this guards against is silent: a model that matches the wrong house gets somebody
 * else's trademark drawn next to it, and nothing about the app looks broken. Substrings are the
 * whole risk — `o3` inside an unrelated id, `gpt` inside a proxy's naming scheme — so the cases
 * below are mostly about what must *not* match.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { brandOf } from "../src/lib/model-brand.ts";

test("recognises each house from an ordinary model id", () => {
	assert.equal(brandOf("deepseek-v4-flash"), "deepseek");
	assert.equal(brandOf("gpt-5.2"), "openai");
	assert.equal(brandOf("claude-opus-5"), "claude");
	assert.equal(brandOf("gemini-3-pro"), "gemini");
	assert.equal(brandOf("qwen3-max"), "qwen");
	assert.equal(brandOf("grok-4"), "grok");
	assert.equal(brandOf("mistral-large-latest"), "mistral");
	assert.equal(brandOf("hunyuan-turbos"), "hunyuan");
});

test("reads the display name when the id says nothing", () => {
	// A relay names its models after its own tiers; the label is where the house survives.
	assert.equal(brandOf("fast", "DeepSeek V4 Flash"), "deepseek");
	assert.equal(brandOf("model-a", "GPT-5.2"), "openai");
	assert.equal(brandOf("默认", "通义千问 Max"), "qwen");
	assert.equal(brandOf("t1", "混元 Turbo"), "hunyuan");
});

test("survives a gateway's vendor prefix", () => {
	assert.equal(brandOf("anthropic/claude-sonnet-4.5"), "claude");
	assert.equal(brandOf("openai/gpt-5-mini"), "openai");
	assert.equal(brandOf("google/gemini-2.5-flash"), "gemini");
});

test("short OpenAI aliases only match as whole words", () => {
	assert.equal(brandOf("o3-mini"), "openai");
	assert.equal(brandOf("o4-mini-high"), "openai");
	// The trap: two characters that appear inside plenty of ids belonging to other houses.
	assert.equal(brandOf("qwen-o3x"), "qwen");
	assert.equal(brandOf("nemo3"), null);
	assert.equal(brandOf("solar-pro3"), null);
});

test("an unambiguous vendor wins over a version that looks like an alias", () => {
	assert.equal(brandOf("deepseek-v3"), "deepseek");
	assert.equal(brandOf("deepseek-r1-0528"), "deepseek");
	assert.equal(brandOf("mistral-o1-test"), "mistral");
});

test("families count as their house", () => {
	assert.equal(brandOf("gemma-3-27b"), "gemini");
	assert.equal(brandOf("codestral-latest"), "mistral");
	assert.equal(brandOf("qwq-32b"), "qwen");
	assert.equal(brandOf("claude-3-5-haiku-latest"), "claude");
});

test("an unknown model is null rather than a guess", () => {
	assert.equal(brandOf("llama-3.3-70b"), null);
	assert.equal(brandOf("my-finetune-v2"), null);
	assert.equal(brandOf(""), null);
	assert.equal(brandOf(null), null);
	assert.equal(brandOf(undefined, undefined), null);
});
