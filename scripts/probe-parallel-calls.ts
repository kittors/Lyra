/** Opt-in bounded real-provider experiment. Sends only synthetic task text; never executes tools. */
import { loadSettings } from "../packages/core/src/config/settings.ts";
import { streamAssistant } from "../packages/core/src/ai/index.ts";
import { buildSystemPrompt } from "../packages/core/src/prompt/system.ts";
import { readTool } from "../packages/core/src/tools/read.ts";
import type { AssistantMessage } from "../packages/core/src/types.ts";

const settings = await loadSettings();
const modelName = process.argv[2] ?? "gemini-3.8-flash-high";
const provider = settings.providers.find(p => p.enabled && p.models.some(m => m.modelId === modelName));
const model = provider?.models.find(m => m.modelId === modelName);
if (!provider || !model) throw new Error("Requested model is not configured");
const base = await buildSystemPrompt({ cwd: "/isolated-example", tools: [readTool], skills: [], projectInstructions: [], platform: "linux", modelName, isGitRepo: false });
const PARALLEL_EXAMPLE = "Before calling tools, separate independent reads from dependent steps. Example: to compare three known files A.ts, B.ts, C.ts, emit three read calls together in one response. To read a file whose path is listed inside manifest.json, first read only manifest.json; wait for its result, then read the discovered path. Never guess a dependency's output or batch an edit with a command that verifies that edit.";
for (let repeat = 0; repeat < 2; repeat++) for (const variant of ["baseline", "example"]) for (const dependent of [false, true]) {
	const prompt = dependent ? "Read manifest.json to discover the entrypoint path, then inspect that entrypoint. Do not invent the path." : "Read A.ts, B.ts and C.ts and compare their exported functions. All three files are present in the workspace.";
	const started = Date.now();
	const stream = streamAssistant(provider, model, { systemPrompt: base + (variant === "example" ? `\n${PARALLEL_EXAMPLE}` : ""), tools: [readTool], messages: [{ role: "user", content: [{ type: "text", text: prompt }], timestamp: Date.now() }] }, { signal: AbortSignal.timeout(90_000), maxTokens: 2048, thinking: "off", retryAttempts: 1 });
	let reply: AssistantMessage;
	for (;;) { const event = await stream.next(); if (event.done) { reply = event.value; break; } }
	const calls = reply.content.flatMap(block => block.type === "toolCall" ? [{ name: block.name, path: block.arguments.path }] : []);
	console.log(JSON.stringify({ model: modelName, repeat, variant, dependent, calls, stop: reply.stopReason, durationMs: Date.now() - started, usage: reply.usage }));
}
