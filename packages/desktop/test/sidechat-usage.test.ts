import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { DEFAULT_SETTINGS, SessionStore, AgentSession, emptyUsage, type AssistantMessage, type ModelConfig, type ProviderConfig } from "@lyra/core";

const model: ModelConfig = {
	id: "qa/model",
	modelId: "model",
	providerId: "qa",
	name: "QA",
	contextWindow: 128000,
	maxOutputTokens: 4096,
	supportsThinking: false,
	supportsImages: true,
	supportsTools: true,
};
const provider: ProviderConfig = {
	id: "qa",
	name: "QA",
	api: "anthropic-messages",
	baseUrl: "http://localhost",
	apiKey: "test",
	enabled: true,
	models: [model],
};
const settings = { ...DEFAULT_SETTINGS, providers: [provider], defaultModelId: model.id };

test("sideChat emits usage to main session log without inflating main messageCount", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "lyra-side-usage-"));
	t.after(async () => {

		await rm(root, { recursive: true, force: true });
	});

	const store = new SessionStore(join(root, "sessions"));
	const meta = await store.create(root, model.id);
	const main = new AgentSession({ cwd: root, store, meta, settings, emit: () => {} });
	t.after(async () => {
		main.dispose();
	});

	const sideUsage = {
		...emptyUsage(),
		input: 400,
		output: 60,
		cacheRead: 250,
		cacheWrite: 50,
		total: 460,
	};
	const assistantReply: AssistantMessage = {
		role: "assistant",
		content: [{ type: "text", text: "Side answer" }],
		api: "anthropic-messages",
		provider: "qa",
		model: "model",
		usage: sideUsage,
		stopReason: "stop",
		timestamp: Date.now(),
	};

	const { SideChat } = await import("@lyra/core");
	const chat = new SideChat({
		main,
		settings,
		streamFn: async () => assistantReply,
		emit: async (event) => {
			if (event.type === "message_end" && event.message.role === "assistant" && event.message.usage) {
				await main.log.append({
					type: "usage",
					source: "side-chat",
					providerId: event.message.provider,
					modelId: event.message.model,
					usage: event.message.usage,
				});
			}
		},
	});

	await chat.ask([{ type: "text", text: "Explain this code" }]);

	assert.equal(main.meta.messageCount, 0, "main conversation messageCount must remain 0");
	assert.equal(main.meta.usage.input, 400, "main session meta must include side-chat input");
	assert.equal(main.meta.usage.cacheRead, 250, "main session meta must include side-chat cacheRead");
	assert.equal(main.meta.usage.total, 460, "main session meta must include side-chat total");

	const loaded = await store.load(meta.projectId, meta.id);
	assert.ok(loaded);
	assert.equal(loaded.messages.length, 0);
	assert.equal(loaded.meta.messageCount, 0);
	assert.equal(loaded.meta.usage.input, 400);
	assert.equal(loaded.meta.usage.cacheRead, 250);
	assert.equal(loaded.meta.usage.total, 460);
});
