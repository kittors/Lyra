import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mock, test } from "node:test";
import { SessionStore } from "../src/session/store.ts";

test("archiving does not reorder the list", async () => {
	const root = await mkdtemp(join(tmpdir(), "ly-arch-"));
	try {
		const store = new SessionStore(root);
		const older = await store.create("/tmp/a", "m");
		await new Promise((r) => setTimeout(r, 8));
		const newer = await store.create("/tmp/b", "m");

		const before = await store.listSessions();
		assert.equal(before[0].id, newer.id, "newest first to begin with");

		const archived = await store.setArchived(older.projectId, older.id, true);
		assert.equal(archived?.archived, true);
		assert.equal(archived?.updatedAt, older.updatedAt, "archiving must not stamp updatedAt");

		const after = await store.listSessions();
		assert.equal(after[0].id, newer.id, "archiving must not float the row to the top");
		assert.equal(after.find((s) => s.id === older.id)?.archived, true);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("archive state survives a reload from the log", async () => {
	const root = await mkdtemp(join(tmpdir(), "ly-arch-"));
	try {
		const store = new SessionStore(root);
		const meta = await store.create("/tmp/a", "m");
		await store.setArchived(meta.projectId, meta.id, true);

		const fresh = new SessionStore(root);
		const loaded = await fresh.load(meta.projectId, meta.id);
		assert.equal(loaded?.meta.archived, true, "replaying the log restores the flag");

		await fresh.setArchived(meta.projectId, meta.id, false);
		const restored = await new SessionStore(root).load(meta.projectId, meta.id);
		assert.equal(restored?.meta.archived, false, "and unarchiving is replayed too");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("deleteMany empties the archive in one index rewrite", async () => {
	const root = await mkdtemp(join(tmpdir(), "ly-arch-"));
	try {
		const store = new SessionStore(root);
		const a = await store.create("/tmp/a", "m");
		const b = await store.create("/tmp/b", "m");
		const keep = await store.create("/tmp/c", "m");
		await store.setArchived(a.projectId, a.id, true);
		await store.setArchived(b.projectId, b.id, true);

		const archived = (await store.listSessions()).filter((s) => s.archived);
		await store.deleteMany(archived.map((s) => ({ projectId: s.projectId, id: s.id })));

		const left = await store.listSessions();
		assert.deepEqual(left.map((s) => s.id), [keep.id]);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("setArchived on an unknown session returns null rather than throwing", async () => {
	const root = await mkdtemp(join(tmpdir(), "ly-arch-"));
	try {
		const store = new SessionStore(root);
		await store.create("/tmp/a", "m");
		assert.equal(await store.setArchived("nope", "nope", true), null);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("pruneEmpty drops unused sessions but spares recent and used ones", async () => {
	const root = await mkdtemp(join(tmpdir(), "ly-prune-"));
	try {
		const store = new SessionStore(root);
		const used = await store.create("/tmp/a", "m");
		await store.append(used, {
			type: "message",
			message: { role: "user", content: [{ type: "text", text: "hi" }], timestamp: 1 },
		});
		// Made an hour ago, past the guard window, without touching the other two.
		mock.timers.enable({ apis: ["Date"], now: Date.now() - 60 * 60_000 });
		await store.create("/tmp/b", "m");
		mock.timers.reset();
		const fresh = await store.create("/tmp/c", "m");

		assert.equal(await store.pruneEmpty(), 1, "only the aged empty session goes");
		const left = (await store.listSessions()).map((s) => s.id).sort();
		assert.deepEqual(left, [used.id, fresh.id].sort(), "a used session and a just-created one both survive");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("truncateFrom drops a message and everything after it", async () => {
	const root = await mkdtemp(join(tmpdir(), "ly-trunc-"));
	try {
		const store = new SessionStore(root);
		let meta = await store.create("/tmp/a", "m");
		const say = async (role: "user" | "assistant", text: string) => {
			meta = await store.append(meta, {
				type: "message",
				message:
					role === "user"
						? { role, content: [{ type: "text", text }], timestamp: 1 }
						: {
								role,
								content: [{ type: "text", text }],
								timestamp: 1,
								stopReason: "end",
								usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, cost: { input: 0, output: 0, total: 0 } },
							},
			});
		};
		await say("user", "one");
		await say("assistant", "reply one");
		await say("user", "two");
		await say("assistant", "reply two");

		const before = await store.load(meta.projectId, meta.id);
		assert.equal(before?.messages.length, 4);

		// Editing message 2 discards it and the reply it drew.
		const after = await store.truncateFrom(meta.projectId, meta.id, 2);
		assert.deepEqual(
			after?.messages.map((m) => (m.content[0] as { text: string }).text),
			["one", "reply one"],
		);
		assert.equal(after?.meta.messageCount, 2, "the index must reflect the shorter history");

		// And it survives a reload — the truncate is in the log, not just in memory.
		const reloaded = await new SessionStore(root).load(meta.projectId, meta.id);
		assert.deepEqual(
			reloaded?.messages.map((m) => (m.content[0] as { text: string }).text),
			["one", "reply one"],
		);

		// Appending after a truncate continues from the shortened history.
		await say("user", "two edited");
		const final = await new SessionStore(root).load(meta.projectId, meta.id);
		assert.deepEqual(
			final?.messages.map((m) => (m.content[0] as { text: string }).text),
			["one", "reply one", "two edited"],
		);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("truncateFrom refuses an index that is not there", async () => {
	const root = await mkdtemp(join(tmpdir(), "ly-trunc-"));
	try {
		const store = new SessionStore(root);
		const meta = await store.create("/tmp/a", "m");
		assert.equal(await store.truncateFrom(meta.projectId, meta.id, 0), null);
		assert.equal(await store.truncateFrom(meta.projectId, meta.id, -1), null);
		await store.append(meta, { type: "message", message: { role: "user", content: [{ type: "text", text: "keep" }], timestamp: 1 } });
		for (const index of [0.5, NaN, Infinity]) {
			assert.equal(await store.truncateFrom(meta.projectId, meta.id, index), null);
		}
		assert.equal((await store.load(meta.projectId, meta.id))?.messages.length, 1);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
