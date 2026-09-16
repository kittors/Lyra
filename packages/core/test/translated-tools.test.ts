import assert from "node:assert/strict";
import { test } from "node:test";
import { translatedShellCommand, TOOL_NAMES_KEY } from "../src/tools/reroute.ts";
import { runTools } from "../src/agent/tool-run.ts";
import type { AgentRunConfig } from "../src/agent/loop.ts";
import type { Tool } from "../src/types.ts";

test("only unambiguous shell arguments translate", () => {
	assert.deepEqual(translatedShellCommand('cat "a b.txt"'), { name: "read", args: { path: "a b.txt" } });
	assert.deepEqual(translatedShellCommand("ls -la src"), { name: "ls", args: { path: "src", all: true } });
	assert.deepEqual(translatedShellCommand("rg -n TODO src"), { name: "grep", args: { pattern: "TODO", path: "src" } });
	for (const command of ["", "cat", "cat -n a", "cat a b", "cat a > b", "cat a | wc -l", "cat a && echo ok", "cat $FILE", "cat *.ts", "cat a\nls", "grep -i word file", "ls -R", "cat 'unclosed", "rg a.*b src"]) {
		assert.equal(translatedShellCommand(command), null, command);
	}
});

function fixture() {
	const executed: string[] = [], hooks: string[] = [];
	const tool = (name: string): Tool => ({ name, snippet: name, description: name, parameters: { type: "object", properties: {} }, execute: async (args, ctx) => {
		executed.push(name); assert.equal(ctx.cwd, "/isolated");
		return { content: [{ type: "text", text: JSON.stringify(args) }] };
	} });
	const model = { id: "m", modelId: "m", providerId: "p", name: "m", contextWindow: 1000, maxOutputTokens: 100, supportsThinking: false, supportsImages: false, supportsTools: true };
	const config: AgentRunConfig = { sessionId: "s", cwd: "/isolated", model, provider: { id: "p", name: "p", baseUrl: "http://localhost", api: "openai-responses", apiKey: "", enabled: true, models: [model] }, tools: [tool("bash"), tool("read")], messages: [], systemPrompt: "",
		beforeToolCall: async ({ toolName }) => { hooks.push(`before:${toolName}`); },
		afterToolCall: async ({ toolName }) => { hooks.push(`after:${toolName}`); },
	};
	const state = new Map<string, unknown>([[TOOL_NAMES_KEY, new Set(["bash", "read"])]]);
	const run = (extra: Record<string, unknown> = {}) => runTools([{ type: "toolCall", id: "original", name: "bash", arguments: { command: "cat a.txt", ...extra } }], config, state, async () => {});
	return { config, state, run, executed, hooks };
}

test("translated calls keep the original result ID and both tool hooks without an extra model round", async () => {
	const f = fixture(); const [result] = await f.run();
	assert.deepEqual(f.executed, ["read"]);
	assert.deepEqual(f.hooks, ["before:bash", "before:read", "after:read", "after:bash"]);
	assert.equal(result.toolCallId, "original"); assert.equal(result.toolName, "bash");
	assert.equal(result.isError, false);
	assert.match(JSON.stringify(result.content), /a.txt/);
});

test("native hook rejection cannot be bypassed through bash", async () => {
	const f = fixture(); f.config.beforeToolCall = async ({ toolName }) => toolName === "read" ? { block: true, reason: "denied" } : undefined;
	assert.equal((await f.run())[0].isError, true); assert.deepEqual(f.executed, []);
});

for (const mode of ["disabled", "missing", "escalated", "background"]) test(`translation respects ${mode} execution`, async () => {
	const f = fixture();
	if (mode === "disabled") f.state.delete(TOOL_NAMES_KEY);
	if (mode === "missing") f.config.tools = f.config.tools.filter(tool => tool.name !== "read");
	await f.run(mode === "escalated" ? { escalate: true } : mode === "background" ? { run_in_background: true } : {});
	assert.deepEqual(f.executed, ["bash"]);
});
