import assert from "node:assert/strict";
import { test } from "node:test";

import { buildContextBreakdown } from "../src/runtime/context.ts";
import type { AssistantMessage, Message, ModelConfig, Tool } from "../src/types.ts";

const model = { contextWindow: 100_000 } as ModelConfig;

function tool(name: string, description: string): Tool {
	return { name, description, parameters: { type: "object", properties: {} }, snippet: "", execute: async () => ({ output: "" }) } as unknown as Tool;
}

function reply(usage: { input: number; cacheRead: number; output: number }): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text: "好的" }],
		stopReason: "stop",
		timestamp: 1,
		usage: { ...usage, cacheWrite: 0, total: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
	};
}

const asked: Message = { role: "user", content: [{ type: "text", text: "在吗" }], timestamp: 0 };

const fixed = {
	model,
	systemPrompt: "x".repeat(3500), // 1000 tokens, before the carve-outs below
	builtinTools: [tool("read", "y".repeat(700))],
	mcpTools: [tool("mcp__search", "z".repeat(350))],
	skillCatalogue: "s".repeat(700), // 200 tokens
	projectInstructions: [{ path: "CLAUDE.md", content: "m".repeat(350) }], // 100 tokens
};

test("the segments add up to the reported total", () => {
	const result = buildContextBreakdown({ ...fixed, messages: [asked, reply({ input: 9000, cacheRead: 500, output: 500 })] });
	const summed = result.segments.reduce((sum, s) => sum + s.tokens, 0);
	assert.equal(summed, result.used, "a breakdown whose parts do not sum to its total is lying about one of them");
});

test("the measured total is not double-counted as the conversation's own size", () => {
	// 10k measured. Overhead is the tools, the skills, the memory file and what is left of the
	// prompt — the conversation is the remainder, never the full 10k on top of all of that.
	const result = buildContextBreakdown({ ...fixed, messages: [asked, reply({ input: 9000, cacheRead: 500, output: 500 })] });
	const messages = result.segments.find((s) => s.key === "messages");

	assert.equal(result.used, 10_000, "the provider's figure is the total, so the total is its figure");
	assert.ok(messages && messages.tokens < 10_000, "the conversation cannot be the whole total once there is overhead");
	assert.equal(result.measured, true);
});

test("the skill catalogue and the memory file are carved out of the prompt, not added to it", () => {
	const result = buildContextBreakdown({ ...fixed, messages: [] });
	const at = (key: string) => result.segments.find((s) => s.key === key)?.tokens ?? 0;

	assert.equal(at("skills"), 200);
	assert.equal(at("memory"), 100);
	// The prompt is 1000 tokens in total and embeds both, so what remains is 700.
	assert.equal(at("systemPrompt"), 700);
});

test("tool schemas are split by where the tool came from", () => {
	const result = buildContextBreakdown({ ...fixed, messages: [] });
	const at = (key: string) => result.segments.find((s) => s.key === key)?.tokens ?? 0;

	assert.ok(at("systemTools") > at("mcpTools"), "the builtin tool here has twice the description");
	assert.ok(at("mcpTools") > 0, "an MCP server's schemas cost the same window as anyone else's");
});

test("with no reply yet the whole thing is an estimate", () => {
	const result = buildContextBreakdown({ ...fixed, messages: [asked] });
	assert.equal(result.measured, false);
	assert.ok(result.used > 0);
});

test("a segment that costs nothing is left out rather than shown as zero", () => {
	const result = buildContextBreakdown({
		...fixed,
		mcpTools: [],
		skillCatalogue: "",
		projectInstructions: [],
		messages: [],
	});
	const keys = new Set(result.segments.map((s) => s.key));

	assert.ok(!keys.has("mcpTools"), "no MCP servers configured is not a row worth a line");
	assert.ok(!keys.has("skills"));
	assert.ok(!keys.has("memory"));
});

test("segments are ordered by size, because the first row is the one worth acting on", () => {
	const result = buildContextBreakdown({ ...fixed, messages: [asked, reply({ input: 9000, cacheRead: 500, output: 500 })] });
	const sizes = result.segments.map((s) => s.tokens);
	assert.deepEqual(sizes, [...sizes].sort((a, b) => b - a));
});

test("project memory is accounted for separately without double-counting the system prompt", () => {
	const result = buildContextBreakdown({ ...fixed, messages: [], projectMemory: "p".repeat(350) });
	assert.equal(result.segments.find((segment) => segment.key === "projectMemory")?.tokens, 100);
	assert.equal(result.segments.find((segment) => segment.key === "systemPrompt")?.tokens, 600);
	assert.equal(result.used, result.segments.reduce((sum, segment) => sum + segment.tokens, 0));
});

test("cache creation tokens count toward the context window", () => {
	const response = reply({ input: 100, cacheRead: 500, output: 200 });
	response.usage.cacheWrite = 9000;
	const result = buildContextBreakdown({ ...fixed, messages: [asked, response] });
	assert.equal(result.used, 9800);
});
