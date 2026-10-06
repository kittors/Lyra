/**
 * Writers racing on the same sessions.
 *
 * The JSON index these tests were first written for lost updates three ways: two creations raced on
 * one temporary file, a delete was undone by an update that had read the index before it, and a
 * rebuild dropped conversations created while it scanned. The database has no index to lose, but
 * the promises are the same, and each of them is cheap to break again — a write that reads the meta
 * outside its transaction brings every one of them back.
 */

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { SessionStore, type SessionMeta } from "../src/session/store.ts";

const user = (text: string) => ({ role: "user" as const, content: [{ type: "text" as const, text }], timestamp: 1 });

async function withStore(run: (store: SessionStore, root: string) => Promise<void>): Promise<void> {
	const root = await mkdtemp(join(tmpdir(), "ly-index-race-"));
	const store = new SessionStore(root);
	try {
		await run(store, root);
	} finally {
		store.close();
		await rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 25 });
	}
}

test("conversations created at the same moment are all listed", async () => {
	await withStore(async (store, root) => {
		const made = await Promise.all(Array.from({ length: 8 }, (_, i) => store.create(root, `m${i}`)));
		const listed = await store.listSessions();
		assert.deepEqual(listed.map((each) => each.id).sort(), made.map((each) => each.id).sort());
	});
});

test("a delete beside an update: the deleted session stays gone and the update lands", async () => {
	await withStore(async (store, root) => {
		for (let round = 0; round < 20; round++) {
			const doomed = await store.create(root, "m", `doomed ${round}`);
			const kept = await store.create(root, "m", `kept ${round}`);
			await Promise.all([store.setArchived(kept.projectId, kept.id, true), store.delete(doomed.projectId, doomed.id)]);

			const listed = await store.listSessions();
			assert.ok(!listed.some((each) => each.id === doomed.id), `round ${round}: the deleted session is back`);
			assert.equal(listed.find((each) => each.id === kept.id)?.archived, true, `round ${round}: the archive was lost`);
		}
	});
});

test("deleting many beside updates leaves exactly the survivors, each updated", async () => {
	await withStore(async (store, root) => {
		const kept: SessionMeta[] = [];
		for (let round = 0; round < 10; round++) {
			const doomed = await Promise.all(Array.from({ length: 3 }, (_, i) => store.create(root, "m", `doomed ${round}.${i}`)));
			const keeping = await Promise.all(Array.from({ length: 3 }, (_, i) => store.create(root, "m", `kept ${round}.${i}`)));
			kept.push(...keeping);
			await Promise.all([
				...keeping.map((each) => store.setArchived(each.projectId, each.id, true)),
				store.deleteMany(doomed.map((each) => ({ projectId: each.projectId, id: each.id }))),
			]);

			const listed = await store.listSessions();
			assert.deepEqual(listed.map((each) => each.id).sort(), kept.map((each) => each.id).sort(), `round ${round}`);
			assert.ok(listed.every((each) => each.archived), `round ${round}`);
		}
	});
});

test("a message still being written when its session is deleted does not bring the session back", async () => {
	await withStore(async (store, root) => {
		const meta = await store.create(root, "m");
		await Promise.all([store.append(meta, { type: "message", message: user("late") }), store.delete(meta.projectId, meta.id)]);
		assert.equal(await store.get(meta.id), null);
		assert.deepEqual(await store.listSessions(), []);
		const records = [];
		for await (const record of store.read(meta.projectId, meta.id)) records.push(record);
		assert.deepEqual(records, [], "no orphaned records");
		// And a write that arrives after the delete says so, rather than handing back a meta to broadcast.
		assert.equal(await store.append(meta, { type: "title", title: "again", source: "user" }), null);
	});
});

test("a second store on the same directory continues the numbering, whatever meta the caller holds", async () => {
	await withStore(async (first, root) => {
		let meta = await first.create(root, "m");
		const stale = meta;
		meta = (await first.append(meta, { type: "message", message: user("hi") })) ?? meta;
		for (let i = 0; i < 3; i++) meta = (await first.append(meta, { type: "event", event: { type: "turn_start" } as never })) ?? meta;

		// As after a restart: another instance, handed a meta from before most of the log was written.
		const second = new SessionStore(root);
		const after = await second.append(stale, { type: "message", message: user("again") });
		assert.equal(after?.seq, meta.seq + 1);
		const seqs: number[] = [];
		for await (const record of second.read(meta.projectId, meta.id)) seqs.push(record.seq);
		assert.deepEqual(seqs, Array.from({ length: meta.seq + 1 }, (_, i) => i + 1));
		assert.equal(after?.messageCount, 2);
	});
});
