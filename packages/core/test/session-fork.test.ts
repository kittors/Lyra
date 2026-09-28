/**
 * Forking a conversation from before one of its messages, and what a fork carries besides messages.
 *
 * A fork used to copy messages and nothing else. A compacted conversation forked into its full,
 * uncompacted history — a request its model could not take — and a conversation that had changed
 * models forked into one that replayed the old provider's handles to the new one.
 */

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { SessionStore } from "../src/session/store.ts";
import { forkBeforeMessage, forkSession } from "../src/trajectory/index.ts";
import type { AgentEvent } from "../src/agent/events.ts";
import type { AssistantMessage, Message } from "../src/types.ts";
import { emptyUsage } from "../src/types.ts";

const user = (text: string, timestamp: number): Message => ({ role: "user", content: [{ type: "text", text }], timestamp });
const reply = (text: string, timestamp: number): AssistantMessage => ({
	role: "assistant",
	content: [{ type: "text", text }],
	api: "openai-responses",
	provider: "fake",
	model: "model",
	usage: emptyUsage(),
	stopReason: "stop",
	timestamp,
});

async function conversation() {
	const root = await mkdtemp(join(tmpdir(), "ly-fork-"));
	const store = new SessionStore(join(root, "sessions"));
	let meta = await store.create(root, "fake/model", "长对话", { thinking: "high" });
	return {
		store,
		get meta() {
			return meta;
		},
		async say(...messages: Message[]) {
			for (const message of messages) meta = await store.append(meta, { type: "message", message });
		},
		async compacted(event: Omit<Extract<AgentEvent, { type: "compacted" }>, "type">) {
			meta = await store.append(meta, { type: "event", event: { type: "compacted", ...event } });
		},
		async switchedModelAt(at: number) {
			meta = await store.append(meta, { type: "meta", meta: { ...meta, modelSwitchedAt: at } });
		},
		async truncateFrom(index: number) {
			const cut = await store.truncateFrom(meta.projectId, meta.id, index);
			assert.ok(cut);
			meta = cut.meta;
		},
		load(meta: { projectId: string; id: string }) {
			return store.load(meta.projectId, meta.id);
		},
		cleanup: () => rm(root, { recursive: true, force: true, maxRetries: 8 }),
	};
}

const texts = (messages: Message[]) => messages.map((message) => (message.content as { text: string }[])[0]?.text);

test("forking before a message holds everything before it; the message and what followed stay in the original", async () => {
	const c = await conversation();
	try {
		await c.say(user("q1", 10), reply("a1", 11), user("q2", 20), reply("a2", 21));
		const fork = await forkBeforeMessage(c.store, c.meta.projectId, c.meta.id, 2, 20, "长对话（分叉）");
		assert.ok(fork);
		assert.equal(fork.messages, 2);
		const forked = await c.load(fork.meta);
		assert.deepEqual(texts(forked!.messages), ["q1", "a1"]);
		assert.equal(forked!.meta.title, "长对话（分叉）");
		assert.equal(forked!.meta.thinking, "high", "the fork continues at the same reasoning level");
		assert.equal(forked!.meta.cwd, c.meta.cwd, "and in the same project");
		assert.deepEqual(texts((await c.load(c.meta))!.messages), ["q1", "a1", "q2", "a2"], "the original is untouched");
	} finally {
		await c.cleanup();
	}
});

test("forking before the first message gives an empty conversation to start again from", async () => {
	const c = await conversation();
	try {
		await c.say(user("q1", 10), reply("a1", 11));
		const fork = await forkBeforeMessage(c.store, c.meta.projectId, c.meta.id, 0, 10);
		assert.ok(fork);
		assert.equal(fork.messages, 0);
	} finally {
		await c.cleanup();
	}
});

test("a position that drifted is corrected by the timestamp; a message that is not there is not forked from", async () => {
	const c = await conversation();
	try {
		await c.say(user("q1", 10), reply("a1", 11), user("q2", 20), reply("a2", 21));
		// Pointing at the reply, with the question's timestamp: the question is found by its timestamp.
		const drifted = await forkBeforeMessage(c.store, c.meta.projectId, c.meta.id, 3, 20);
		assert.equal(drifted?.messages, 2);

		const before = (await c.store.listSessions()).length;
		assert.equal(await forkBeforeMessage(c.store, c.meta.projectId, c.meta.id, 0, 999), null);
		// An assistant message is not a place to fork from before, even with a matching timestamp.
		assert.equal(await forkBeforeMessage(c.store, c.meta.projectId, c.meta.id, 1, 11), null);
		assert.equal((await c.store.listSessions()).length, before, "no empty conversation is left behind");
	} finally {
		await c.cleanup();
	}
});

test("a fork of a compacted conversation starts from the same boundary, not the full history", async () => {
	const c = await conversation();
	try {
		await c.say(user("q1", 10), reply("a1", 11), user("q2", 20), reply("a2", 21), user("q3", 30), reply("a3", 31));
		await c.compacted({ before: 90_000, after: 12_000, summary: "前情提要", kept: 2 });
		await c.say(user("q4", 40), reply("a4", 41));

		const source = await c.load(c.meta);
		assert.deepEqual(source!.compaction && { summary: source!.compaction.summary, keptFrom: source!.compaction.keptFrom }, { summary: "前情提要", keptFrom: 4 });

		const fork = await forkBeforeMessage(c.store, c.meta.projectId, c.meta.id, 6, 40);
		const forked = await c.load(fork!.meta);
		assert.equal(forked!.messages.length, 6);
		assert.equal(forked!.compaction?.summary, "前情提要", "the model is given the summary, not every message before it");
		assert.equal(forked!.compaction?.keptFrom, 4);
		assert.deepEqual(forked!.compactions, [6], "the divider is where it was");
	} finally {
		await c.cleanup();
	}
});

test("a boundary a rewind retired stays retired in the fork, even with an older one still standing as a divider", async () => {
	const c = await conversation();
	try {
		await c.say(user("q1", 10), reply("a1", 11), user("q2", 20), reply("a2", 21));
		await c.compacted({ before: 50_000, after: 9_000, summary: "旧的提要", kept: 1 });
		await c.say(user("q3", 30), reply("a3", 31), user("q4", 40), reply("a4", 41), user("q5", 50), reply("a5", 51));
		await c.compacted({ before: 80_000, after: 10_000, summary: "新的提要", kept: 2 });
		// 撤回 to before q4: the newer boundary's kept tail is gone, so the source drops it — and does not
		// fall back to the older one.
		await c.truncateFrom(6);
		const source = await c.load(c.meta);
		assert.equal(source!.compaction, null);
		assert.deepEqual(source!.compactions, [4]);

		const fork = await forkSession(c.store, c.meta.projectId, c.meta.id, c.meta.seq);
		const forked = await c.load(fork!.meta);
		assert.equal(forked!.messages.length, 6);
		assert.equal(forked!.compaction, null, "the older summary does not come back as the boundary");
		assert.deepEqual(forked!.compactions, [4]);
	} finally {
		await c.cleanup();
	}
});

test("a fork keeps where the model changed, so one provider's handles are not replayed to another", async () => {
	const c = await conversation();
	try {
		await c.say(user("q1", 10), reply("a1", 11));
		await c.switchedModelAt(2);
		await c.say(user("q2", 20), reply("a2", 21));

		const whole = await forkSession(c.store, c.meta.projectId, c.meta.id, c.meta.seq);
		assert.equal((await c.load(whole!.meta))!.meta.modelSwitchedAt, 2);

		// Forked from before the change: everything it inherits came from the model before, and it
		// continues on the one after — so all of it is stripped.
		const early = await forkBeforeMessage(c.store, c.meta.projectId, c.meta.id, 1, 11);
		assert.equal(early, null, "an assistant message is not a fork point");
		const beforeQ2 = await forkBeforeMessage(c.store, c.meta.projectId, c.meta.id, 2, 20);
		assert.equal((await c.load(beforeQ2!.meta))!.meta.modelSwitchedAt, 2);
		const beforeA1 = await forkSession(c.store, c.meta.projectId, c.meta.id, 2);
		assert.equal((await c.load(beforeA1!.meta))!.meta.modelSwitchedAt, 1, "a change after the fork point strips everything inherited");
	} finally {
		await c.cleanup();
	}
});
