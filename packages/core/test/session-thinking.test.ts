/**
 * How hard a conversation thinks, kept per conversation.
 *
 * It used to be one global setting, so turning the effort up to work through something hard turned
 * it up everywhere — every other open conversation, and every one opened afterwards, thought as
 * hard as the one that needed it and billed accordingly. Turning it back down had the mirror
 * problem: the session that wanted it lost it the moment another session wanted less.
 *
 * So the level lives on the session. The global one keeps its name and its meaning for anything
 * that has not chosen: it is what a conversation starts at, not what every conversation runs at.
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { DEFAULT_SETTINGS, type Settings } from "../src/config/settings.ts";
import { AgentSession } from "../src/runtime/session.ts";
import { SessionStore, type SessionRecord } from "../src/session/store.ts";
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

function settingsWith(thinking: ThinkingLevel): Settings {
	return {
		...DEFAULT_SETTINGS,
		providers: [PROVIDER],
		defaultModelId: MODEL.id,
		mcpServers: [],
		permissionMode: "full",
		thinking,
	};
}

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

async function harness(globalLevel: ThinkingLevel = "medium") {
	const root = await mkdtemp(join(tmpdir(), "ly-think-"));
	// A home of its own, so the assertions are about this test and not about this machine.
	const home = join(root, "home");
	await mkdir(home, { recursive: true });
	process.env.LYRA_HOME = home;

	/** What each turn was actually run at — the point of all of this. */
	const asked: (ThinkingLevel | undefined)[] = [];
	const store = new SessionStore(join(root, "sessions"));
	const session = new AgentSession({
		cwd: root,
		settings: settingsWith(globalLevel),
		store,
		emit: () => {},
		streamFn: async (_context, config) => {
			asked.push(config.thinking);
			return reply();
		},
	});
	await session.initialize();

	return {
		session,
		store,
		asked,
		/** Everything on disk, so the assertions are about the file rather than about memory. */
		async records(): Promise<SessionRecord[]> {
			const out: SessionRecord[] = [];
			for await (const record of store.read(session.meta.projectId, session.meta.id)) out.push(record);
			return out;
		},
		cleanup: async () => {
			delete process.env.LYRA_HOME;
			await rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 25 });
		},
	};
}

test("a session that never chose runs at the global default", async () => {
	const h = await harness("low");
	try {
		await h.session.prompt([{ type: "text", text: "hi" }]);
		assert.deepEqual(h.asked, ["low"]);
	} finally {
		await h.cleanup();
	}
});

test("a session that chose runs at its own level, not the global one", async () => {
	const h = await harness("low");
	try {
		await h.session.setThinking("high");
		await h.session.prompt([{ type: "text", text: "hi" }]);
		assert.deepEqual(h.asked, ["high"], "the conversation's choice outranks the app default");
	} finally {
		await h.cleanup();
	}
});

test("the choice is written to the log, so it survives a reload", async () => {
	const h = await harness("medium");
	try {
		await h.session.setThinking("high");

		const metas = (await h.records()).filter((r) => r.type === "meta");
		const last = metas.at(-1);
		assert.ok(last && last.type === "meta");
		assert.equal(last.meta.thinking, "high", "on disk, not just in the running session");

		/*
		 * And a session reopened from that log runs at it — read back the way the app reads it, so
		 * this covers `load` carrying the field as well as `setThinking` writing it. This is the
		 * case the whole change is for: closing the app used to lose the level, because it was
		 * never the session's to keep.
		 */
		const loaded = await h.store.load(h.session.meta.projectId, h.session.meta.id);
		assert.ok(loaded);
		assert.equal(loaded.meta.thinking, "high", "the reader keeps the field, not just the writer");

		const asked: (ThinkingLevel | undefined)[] = [];
		const reopened = new AgentSession({
			cwd: loaded.meta.cwd,
			settings: settingsWith("medium"),
			store: h.store,
			meta: loaded.meta,
			emit: () => {},
			streamFn: async (_context, config) => {
				asked.push(config.thinking);
				return reply();
			},
		});
		reopened.restore(loaded.messages, loaded.compaction);
		await reopened.initialize();
		assert.equal(reopened.meta.thinking, "high");

		await reopened.prompt([{ type: "text", text: "again" }]);
		assert.deepEqual(asked, ["high"], "and runs at it, rather than at the app default it was handed");
	} finally {
		await h.cleanup();
	}
});

test("one session's level does not follow the app default when that moves", async () => {
	const h = await harness("low");
	try {
		await h.session.setThinking("high");
		// Another window turning the default down is exactly what used to reach in and change this one.
		h.session.updateSettings(settingsWith("off"));
		await h.session.prompt([{ type: "text", text: "hi" }]);
		assert.deepEqual(h.asked, ["high"]);
	} finally {
		await h.cleanup();
	}
});

test("a session that never chose still follows the app default when it moves", async () => {
	const h = await harness("low");
	try {
		h.session.updateSettings(settingsWith("high"));
		await h.session.prompt([{ type: "text", text: "hi" }]);
		assert.deepEqual(h.asked, ["high"], "not having chosen means following, not being frozen at first read");
	} finally {
		await h.cleanup();
	}
});

test("what one turn asks for still wins, so the side chat can run without thinking", async () => {
	const h = await harness("medium");
	try {
		await h.session.setThinking("high");
		await h.session.prompt([{ type: "text", text: "hi" }], { thinking: "off" });
		assert.deepEqual(h.asked, ["off"], "a per-turn request is about that turn, not about the conversation");
		assert.equal(h.session.meta.thinking, "high", "and does not quietly rewrite the conversation's level");
	} finally {
		await h.cleanup();
	}
});

test("setting the level it already has writes nothing", async () => {
	const h = await harness("medium");
	try {
		await h.session.setThinking("high");
		const before = (await h.records()).length;
		assert.equal(await h.session.setThinking("high"), false);
		assert.equal((await h.records()).length, before, "an append-only log should not grow on a no-op");
	} finally {
		await h.cleanup();
	}
});

test("changing the level leaves the transcript alone", async () => {
	/*
	 * Unlike a model switch, which has to strip the reasoning handles written before it. Effort
	 * decides what the next turn does; it says nothing about the reasoning already recorded, and a
	 * session that cleared its own history on a slider drag would lose real context.
	 */
	const h = await harness("medium");
	try {
		await h.session.prompt([{ type: "text", text: "hi" }]);
		const before = h.session.messages.length;
		await h.session.setThinking("high");
		assert.equal(h.session.messages.length, before);
		assert.equal(h.session.meta.modelSwitchedAt, undefined);
	} finally {
		await h.cleanup();
	}
});
