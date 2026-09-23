/**
 * A conversation's own reasoning level.
 *
 * Asserted on what actually reaches the provider rather than on what the meta says, because those
 * are two different claims and only the second one is the feature: a level stored perfectly and
 * never read would look right everywhere except in the bill.
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { DEFAULT_SETTINGS, type Settings } from "../src/config/settings.ts";
import { AgentSession } from "../src/runtime/session.ts";
import { SessionStore, type SessionMeta } from "../src/session/store.ts";
import { forkSession } from "../src/trajectory/fork.ts";
import type { AssistantMessage, ModelConfig, ProviderConfig, ThinkingLevel } from "../src/types.ts";
import { emptyUsage } from "../src/types.ts";

const MODEL: ModelConfig = {
	id: "fake/model",
	providerId: "fake",
	modelId: "model",
	name: "Fake",
	contextWindow: 100_000,
	maxOutputTokens: 4096,
	supportsThinking: true,
	supportsImages: false,
	supportsTools: true,
};

const PROVIDER: ProviderConfig = {
	id: "fake",
	name: "Fake",
	baseUrl: "http://localhost",
	api: "openai-responses",
	apiKey: "x",
	enabled: true,
	models: [MODEL],
};

const SETTINGS: Settings = {
	...DEFAULT_SETTINGS,
	providers: [PROVIDER],
	defaultModelId: MODEL.id,
	mcpServers: [],
	permissionMode: "full",
	thinking: "medium",
};

function reply(): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text: "ok" }],
		api: "openai-responses",
		provider: "fake",
		model: "model",
		usage: emptyUsage(),
		stopReason: "stop",
		timestamp: Date.now(),
	};
}

/**
 * Two sessions over one store, and a record of what each turn asked the provider for.
 *
 * Two because the whole point is that they are separate; one store because in the app they share
 * one, and a bug that leaks through the store would be invisible with two.
 */
async function harness(settings: Settings = SETTINGS) {
	const root = await mkdtemp(join(tmpdir(), "ly-think-"));
	const home = join(root, "home");
	await mkdir(home, { recursive: true });
	process.env.LYRA_HOME = home;

	const asked: (ThinkingLevel | undefined)[] = [];
	const store = new SessionStore(join(root, "sessions"));
	/** A new conversation, or — given a meta — an existing one reopened. */
	const make = async (meta?: SessionMeta) => {
		const session = new AgentSession({
			cwd: root,
			settings,
			store,
			meta,
			emit: () => {},
			// `(context, config)`; the level the turn resolved to is on the config.
			streamFn: async (_context, config) => {
				asked.push(config.thinking);
				return reply();
			},
		});
		await session.initialize();
		return session;
	};

	return {
		root,
		store,
		asked,
		make,
		/** The last level handed to the provider. */
		last: () => asked[asked.length - 1],
		cleanup: async () => {
			delete process.env.LYRA_HOME;
			await rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 25 });
		},
	};
}

test("a new conversation starts at the app default, and has it written down", async () => {
	const h = await harness();
	try {
		const session = await h.make();
		await session.prompt([{ type: "text", text: "hi" }]);
		assert.equal(h.last(), "medium");
		assert.equal(session.meta.thinking, "medium", "the default of the moment is the conversation's own from the start");

		const loaded = await h.store.load(session.meta.projectId, session.meta.id);
		assert.equal(loaded?.meta.thinking, "medium", "in the first record, not only in memory");
	} finally {
		await h.cleanup();
	}
});

test("a chosen level is what the next turn asks for", async () => {
	const h = await harness();
	try {
		const session = await h.make();
		await session.setThinking("high");
		await session.prompt([{ type: "text", text: "hi" }]);
		assert.equal(h.last(), "high");
	} finally {
		await h.cleanup();
	}
});

test("one conversation's level does not reach another", async () => {
	const h = await harness();
	try {
		const a = await h.make();
		const b = await h.make();
		await a.setThinking("high");

		await a.prompt([{ type: "text", text: "hi" }]);
		assert.equal(h.last(), "high");

		await b.prompt([{ type: "text", text: "hi" }]);
		assert.equal(h.last(), "medium", "the other conversation is still on the app default");

		// And back again, so this is not just about ordering.
		await a.prompt([{ type: "text", text: "again" }]);
		assert.equal(h.last(), "high");
	} finally {
		await h.cleanup();
	}
});

test("the level survives a restart, because it is in the log", async () => {
	const h = await harness();
	try {
		const session = await h.make();
		await session.setThinking("xhigh");

		// A second session over the same log is what reopening the conversation does.
		const reopened = new AgentSession({
			cwd: process.cwd(),
			settings: SETTINGS,
			store: h.store,
			emit: () => {},
			meta: session.meta,
		});
		const loaded = await h.store.load(session.meta.projectId, session.meta.id);
		assert.equal(loaded?.meta.thinking, "xhigh", "written to the file, not just held in memory");
		assert.equal(reopened.meta.thinking, "xhigh");
	} finally {
		await h.cleanup();
	}
});

test("null hands the conversation back to the app default", async () => {
	const h = await harness();
	try {
		const session = await h.make();
		await session.setThinking("high");
		await session.setThinking(null);
		await session.prompt([{ type: "text", text: "hi" }]);
		assert.equal(h.last(), "medium");
		assert.equal(session.meta.thinking, undefined, "cleared, not pinned to today's default");

		const loaded = await h.store.load(session.meta.projectId, session.meta.id);
		assert.equal(loaded?.meta.thinking, undefined, "and cleared on disk too");
	} finally {
		await h.cleanup();
	}
});

test("a level asked for by the caller still wins, for the one turn", async () => {
	const h = await harness();
	try {
		const session = await h.make();
		await session.setThinking("high");
		await session.prompt([{ type: "text", text: "hi" }], { thinking: "off" });
		assert.equal(h.last(), "off");

		// The conversation's own level is not consumed by that override.
		await session.prompt([{ type: "text", text: "again" }]);
		assert.equal(h.last(), "high");
	} finally {
		await h.cleanup();
	}
});

/*
 * The 0.9.19 report, in the order it happened: a conversation started at `high`, a second new chat
 * set to `medium` — which, with no session to hold it yet, moves the app default — and the first
 * one came back at `medium`, in the label and in what it asked the provider for.
 */
test("moving the app default leaves conversations already under way where they were", async () => {
	const h = await harness({ ...SETTINGS, thinking: "high" });
	try {
		const first = await h.make();
		const lowered: Settings = { ...SETTINGS, thinking: "medium" };
		first.updateSettings(lowered);

		await first.prompt([{ type: "text", text: "hi" }]);
		assert.equal(h.last(), "high", "it started at high, and a later default is not its business");
		assert.equal(first.meta.thinking, "high");
	} finally {
		await h.cleanup();
	}
});

test("a conversation from before levels were written down still follows the default", async () => {
	const h = await harness();
	try {
		// What every log written by 0.9.19 and earlier looks like: no level in it at all.
		const old = await h.store.create(h.root, MODEL.id);
		assert.equal(old.thinking, undefined);
		const session = await h.make(old);

		session.updateSettings({ ...SETTINGS, thinking: "high" });
		await session.prompt([{ type: "text", text: "hi" }]);
		assert.equal(h.last(), "high", "nothing recorded, so there is nothing to keep it from the default");
	} finally {
		await h.cleanup();
	}
});

test("a fork keeps the level of the conversation it came from", async () => {
	const h = await harness();
	try {
		const source = await h.make();
		await source.setThinking("xhigh");
		await source.prompt([{ type: "text", text: "hi" }]);

		const fork = await forkSession(h.store, source.meta.projectId, source.meta.id, source.meta.seq);
		assert.equal(fork?.meta.thinking, "xhigh");
	} finally {
		await h.cleanup();
	}
});

test("switching the model leaves the level alone", async () => {
	const h = await harness();
	try {
		const session = await h.make();
		await session.setThinking("high");
		await session.setModel(MODEL.id);
		await session.prompt([{ type: "text", text: "hi" }]);
		assert.equal(h.last(), "high", "a meta write for one field must not drop the other");
	} finally {
		await h.cleanup();
	}
});
