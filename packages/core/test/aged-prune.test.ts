import assert from "node:assert/strict";
import { test } from "node:test";
import { sessionPruner, AgedToolPruner, PRUNE_AGE_ROUNDS } from "../src/runtime/aged-prune.ts";
import { emptyUsage, type Message } from "../src/types.ts";

const output = (size = 20_000): Message => ({ role: "toolResult", toolName: "bash", toolCallId: "c", isError: false, content: [{ type: "text", text: "😀".repeat(size) }], timestamp: 0 });
const rounds = (n: number, size = 1): Message[] => Array.from({ length: n }, () => ({ role: "assistant", api: "openai-responses", provider: "test", model: "test", stopReason: "stop", usage: emptyUsage(), content: [{ type: "text", text: "x".repeat(size) }], timestamp: 0 }));

test("only old output is pruned, with original logs and tool pairing preserved", () => {
	const fresh = output();
	const young = [fresh, ...rounds(PRUNE_AGE_ROUNDS - 1)];
	assert.equal(new AgedToolPruner().prepare(young), young);
	const old = [fresh, ...rounds(PRUNE_AGE_ROUNDS)];
	const saved: string[] = [];
	const pruner = new AgedToolPruner();
	const next = pruner.prepare(old, {}, { keep: (_tool, text) => { saved.push(text); return "scratch://result.txt"; } });
	assert.notEqual(next, old);
	assert.equal(next.length, old.length);
	assert.equal(next[0].role === "toolResult" && next[0].toolCallId, "c");
	assert.equal(fresh.content[0].type === "text" && fresh.content[0].text.length, 40_000);
	assert.match(JSON.stringify(next[0]), /scratch:\/\/result.txt/);
	assert.equal(saved.length, 1);
	assert.equal(pruner.prepare(old)[0], next[0], "continuations reuse the same view without rewriting logs");
});

test("warm long prefixes survive and changes are batched instead of made on every request", () => {
	const history = [output(), ...rounds(PRUNE_AGE_ROUNDS, 2000)];
	const pruner = new AgedToolPruner();
	assert.equal(pruner.prepare(history, { lastRequestAt: 0, now: 0 }), history);
	for (let i = 1; i < PRUNE_AGE_ROUNDS; i++) assert.equal(pruner.prepare(history, { lastRequestAt: 0, now: 600_000 }), history);
	assert.notEqual(pruner.prepare(history, { lastRequestAt: 0, now: 600_000 }), history);
});

test("a blow-up does not wait for the twenty-round batch", () => {
	const huge = output(80_000);
	const history = [huge, ...rounds(2)];
	const next = new AgedToolPruner().prepare(history);
	assert.notEqual(next, history);
	assert.match(JSON.stringify(next[0]), /characters omitted/);
	assert.equal(huge.content[0].type === "text" && huge.content[0].text.length, 160_000);
});

test("small results and skill instructions stay intact", () => {
	const skill = output();
	if (skill.role === "toolResult") skill.toolName = "skill";
	const history = [output(4096), skill, ...rounds(PRUNE_AGE_ROUNDS)];
	assert.equal(new AgedToolPruner().prepare(history), history);
});

test("a session keeps its pruning view across user turns and other sessions remain isolated", () => {
	const state = new Map<string, unknown>();
	assert.equal(sessionPruner(state), sessionPruner(state));
	assert.notEqual(sessionPruner(state), sessionPruner(new Map()));
});

test("the live request path actually sends the pruned view while keeping its source intact", async () => {
	const { runAgent } = await import("../src/agent/loop.ts");
	const source = output();
	const history = [source, ...rounds(PRUNE_AGE_ROUNDS)];
	const model = { id: "m", modelId: "m", providerId: "p", name: "m", contextWindow: 100000, maxOutputTokens: 100, supportsThinking: false, supportsImages: false, supportsTools: true };
	let sent: Message[] = [];
	await runAgent({ sessionId: "t", cwd: "/test", model, provider: { id: "p", name: "p", api: "openai-responses", baseUrl: "http://localhost", apiKey: "", enabled: true, models: [model] }, messages: history, tools: [], systemPrompt: "", streamFn: async context => {
		sent = context.messages;
		const answer = rounds(1)[0];
		if (answer.role !== "assistant") throw new Error("Invalid fixture");
		return answer;
	} }, async () => {});
	assert.notEqual(sent[0], source);
	assert.match(JSON.stringify(sent[0].content), /characters omitted/);
	assert.equal(source.content[0].type === "text" && source.content[0].text.length, 40000);
});
