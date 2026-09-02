/**
 * Renaming a conversation, and the name staying put.
 *
 * Two halves, and the second is the one that was missing. Writing the title to the log is
 * straightforward — the store already understands a `title` record. But the first prompt names a
 * session after its opening line, and it did that regardless of whether the session already had a
 * name someone typed. So the ordinary way to use the feature — make a session, name it, then ask
 * it something — lost the name on the first message, which reads as the rename never having
 * worked at all.
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { DEFAULT_SETTINGS, type Settings } from "../src/config/settings.ts";
import { AgentSession } from "../src/runtime/session.ts";
import { SessionStore } from "../src/session/store.ts";
import type { AssistantMessage, ModelConfig, ProviderConfig } from "../src/types.ts";
import { emptyUsage } from "../src/types.ts";

const MODEL: ModelConfig = {
	id: "fake/model",
	providerId: "fake",
	modelId: "model",
	name: "Fake",
	contextWindow: 100_000,
	maxOutputTokens: 4096,
	supportsThinking: false,
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

async function harness() {
	const root = await mkdtemp(join(tmpdir(), "ly-rename-"));
	// A home of its own, so the assertions are about this test and not about this machine.
	const home = join(root, "home");
	await mkdir(home, { recursive: true });
	process.env.LYRA_HOME = home;
	const store = new SessionStore(join(root, "sessions"));
	const session = new AgentSession({
		cwd: root,
		settings: SETTINGS,
		store,
		emit: () => {},
		streamFn: async () => reply(),
	});
	await session.initialize();
	return {
		session,
		store,
		/** The title as it is on disk, which is the only one that survives a reload. */
		async storedTitle(): Promise<string | undefined> {
			const loaded = await store.load(session.meta.projectId, session.meta.id);
			return loaded?.meta.title;
		},
		cleanup: async () => {
			delete process.env.LYRA_HOME;
			await rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 25 });
		},
	};
}

test("a rename reaches the log, not just the window", async () => {
	const h = await harness();
	try {
		await h.session.rename("重构登录流程");
		assert.equal(await h.storedTitle(), "重构登录流程");
	} finally {
		await h.cleanup();
	}
});

test("a hand-typed name survives the first prompt", async () => {
	const h = await harness();
	try {
		await h.session.rename("重构登录流程");
		await h.session.prompt([{ type: "text", text: "帮我看看这个 bug 怎么回事" }]);
		assert.equal(await h.storedTitle(), "重构登录流程", "the opening line does not get to rename a named session");
	} finally {
		await h.cleanup();
	}
});

test("a session nobody named is still named after its opening line", async () => {
	// The default that makes the session list readable — this is what must not be lost while
	// fixing the case above.
	const h = await harness();
	try {
		await h.session.prompt([{ type: "text", text: "帮我看看这个 bug 怎么回事" }]);
		assert.equal(await h.storedTitle(), "帮我看看这个 bug 怎么回事");
	} finally {
		await h.cleanup();
	}
});

test("renaming after the conversation started also sticks", async () => {
	const h = await harness();
	try {
		await h.session.prompt([{ type: "text", text: "第一句" }]);
		await h.session.rename("说清楚点的名字");
		await h.session.prompt([{ type: "text", text: "第二句" }]);
		assert.equal(await h.storedTitle(), "说清楚点的名字");
	} finally {
		await h.cleanup();
	}
});

test("an empty or blank name is not a rename", async () => {
	const h = await harness();
	try {
		await h.session.rename("有名字了");
		await h.session.rename("   ");
		await h.session.rename("");
		assert.equal(await h.storedTitle(), "有名字了", "whitespace does not get to blank out a title");
	} finally {
		await h.cleanup();
	}
});

test("the name is still there after the session is reopened from disk", async () => {
	const h = await harness();
	try {
		await h.session.rename("重构登录流程");

		const loaded = await h.store.load(h.session.meta.projectId, h.session.meta.id);
		assert.ok(loaded);
		assert.equal(loaded.meta.title, "重构登录流程");
		assert.equal(loaded.meta.titleSetByUser, true, "the flag rides the log too, or the next prompt overwrites it");

		// And the reopened session does not rename itself on the next thing asked of it.
		const reopened = new AgentSession({
			cwd: loaded.meta.cwd,
			settings: SETTINGS,
			store: h.store,
			meta: loaded.meta,
			emit: () => {},
			streamFn: async () => reply(),
		});
		reopened.restore(loaded.messages, loaded.compaction);
		await reopened.initialize();
		await reopened.prompt([{ type: "text", text: "接着上面那个问题" }]);
		assert.equal(await h.storedTitle(), "重构登录流程");
	} finally {
		await h.cleanup();
	}
});

test("renaming twice keeps the last name and does not re-flag every time", async () => {
	const h = await harness();
	try {
		await h.session.rename("第一个名字");
		const afterFirst = h.session.meta.seq;
		await h.session.rename("第二个名字");
		assert.equal(await h.storedTitle(), "第二个名字");
		// One title record, no second meta write: the flag is already set and re-stating it would
		// grow an append-only log for nothing.
		assert.equal(h.session.meta.seq - afterFirst, 1);
	} finally {
		await h.cleanup();
	}
});
