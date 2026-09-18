import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { DEFAULT_SETTINGS } from "../src/config/settings.ts";
import { AgentSession } from "../src/runtime/session.ts";
import { SessionStore } from "../src/session/store.ts";
import { emptyUsage, type AssistantMessage, type ModelConfig, type ProviderConfig } from "../src/types.ts";

function fixtures(): { model: ModelConfig; provider: ProviderConfig } {
	const model: ModelConfig = {
		id: "test/model",
		providerId: "test",
		modelId: "model",
		name: "Test",
		contextWindow: 128000,
		maxOutputTokens: 4096,
		supportsThinking: false,
		supportsImages: false,
		supportsTools: true,
	};
	return {
		model,
		provider: {
			id: "test",
			name: "Test",
			api: "openai-responses",
			apiKey: "test",
			baseUrl: "http://localhost",
			enabled: true,
			models: [model],
		},
	};
}

test("revert cuts the message and does not start another turn", async () => {
	const root = await mkdtemp(join(tmpdir(), "ly-revert-"));
	const { model, provider } = fixtures();
	let streams = 0;
	const seen: string[] = [];
	const session = new AgentSession({
		cwd: root,
		store: new SessionStore(join(root, "sessions")),
		settings: { ...DEFAULT_SETTINGS, providers: [provider], defaultModelId: model.id },
		emit: async (event) => {
			seen.push(event.type);
		},
		streamFn: async (): Promise<AssistantMessage> => {
			streams += 1;
			return {
				role: "assistant",
				content: [{ type: "text", text: "Replied" }],
				api: provider.api,
				provider: provider.id,
				model: model.modelId,
				stopReason: "stop",
				usage: emptyUsage(),
				timestamp: Date.now(),
			};
		},
	});
	await session.initialize();
	await session.prompt([{ type: "text", text: "First" }]);
	await session.prompt([{ type: "text", text: "Second" }]);
	assert.equal(session.messages.length, 4);
	assert.equal(streams, 2);

	await session.revert(2);
	assert.equal(session.messages.length, 2);
	assert.equal((session.messages[0].content[0] as { text: string }).text, "First");
	assert.equal(streams, 2, "undo is a cut, not another prompt");
	assert.ok(seen.includes("rewound"));
	await session.dispose();
	await rm(root, { recursive: true, force: true });
});

test("revert refuses while a turn is still running", async () => {
	const root = await mkdtemp(join(tmpdir(), "ly-revert-run-"));
	const { model, provider } = fixtures();
	const gate = Promise.withResolvers<void>();
	const session = new AgentSession({
		cwd: root,
		store: new SessionStore(join(root, "sessions")),
		settings: { ...DEFAULT_SETTINGS, providers: [provider], defaultModelId: model.id },
		emit: async () => {},
		streamFn: async (): Promise<AssistantMessage> => {
			await gate.promise;
			return {
				role: "assistant",
				content: [{ type: "text", text: "Later" }],
				api: provider.api,
				provider: provider.id,
				model: model.modelId,
				stopReason: "stop",
				usage: emptyUsage(),
				timestamp: Date.now(),
			};
		},
	});
	await session.initialize();
	const pending = session.prompt([{ type: "text", text: "Hold" }]);
	await assert.rejects(session.revert(0), /running/);
	gate.resolve();
	await pending;
	await session.dispose();
	await rm(root, { recursive: true, force: true });
});
