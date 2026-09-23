/**
 * Creating conversations at the same moment.
 *
 * The index is written whole, through a temporary file and a rename, so a crash cannot leave a
 * truncated one. That temporary name used to be `index.json.<pid>.tmp` — one name per process, for
 * an operation that runs concurrently *within* a process. Two creations racing meant the first
 * rename took the file out from under the second, which failed with `ENOENT` and left its session
 * missing from the index: a conversation that exists on disk and is in no list.
 *
 * Found in the app rather than here, which is why it is here now.
 *
 * Deleting and rebuilding are the other writers, and they went round the queue every other write
 * goes through: each read the index and wrote it back whenever it got there. A delete beside an
 * update either threw that update away, or was undone by it — the update had read the index with
 * the deleted session still in it, so the session came back to the sidebar with no log behind it.
 */

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { SessionStore, type SessionMeta } from "../src/session/store.ts";

async function indexOn(root: string): Promise<SessionMeta[]> {
	return JSON.parse(await readFile(join(root, "sessions", "index.json"), "utf8")) as SessionMeta[];
}

test("conversations created at the same moment all reach the index", async () => {
	const root = await mkdtemp(join(tmpdir(), "ly-index-race-"));
	try {
		const store = new SessionStore(join(root, "sessions"));
		const made = await Promise.all(Array.from({ length: 8 }, (_, i) => store.create(root, `m${i}`)));

		const listed = await store.listSessions();
		assert.equal(listed.length, 8, "every session is listed");
		for (const meta of made) {
			assert.ok(listed.some((each) => each.id === meta.id), `${meta.id} is missing from the index`);
		}

		// And what it left behind is a whole file, not a half-written one.
		const raw = await readFile(join(root, "sessions", "index.json"), "utf8");
		assert.equal((JSON.parse(raw) as unknown[]).length, 8);
	} finally {
		await rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 25 });
	}
});

test("no temporary files are left behind", async () => {
	const root = await mkdtemp(join(tmpdir(), "ly-index-race-"));
	try {
		const store = new SessionStore(join(root, "sessions"));
		await Promise.all(Array.from({ length: 4 }, (_, i) => store.create(root, `m${i}`)));
		const { readdir } = await import("node:fs/promises");
		const files = await readdir(join(root, "sessions"));
		assert.deepEqual(files.filter((name) => name.endsWith(".tmp")), [], "a rename that happened leaves nothing");
	} finally {
		await rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 25 });
	}
});

test("a delete beside an update: the deleted session stays gone and the update lands", async () => {
	const root = await mkdtemp(join(tmpdir(), "ly-index-race-"));
	try {
		const store = new SessionStore(join(root, "sessions"));
		// Which of the two reaches the disk first varies from run to run; enough rounds to meet both.
		for (let round = 0; round < 20; round++) {
			const doomed = await store.create(root, "m", `doomed ${round}`);
			const kept = await store.create(root, "m", `kept ${round}`);
			await Promise.all([store.setArchived(kept.projectId, kept.id, true), store.delete(doomed.projectId, doomed.id)]);

			const index = await indexOn(root);
			assert.ok(!index.some((each) => each.id === doomed.id), `round ${round}: the deleted session is back in the index`);
			assert.equal(index.find((each) => each.id === kept.id)?.archived, true, `round ${round}: the archive was lost`);
		}
	} finally {
		await rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 25 });
	}
});

test("deleting many beside updates leaves exactly the survivors, each updated", async () => {
	const root = await mkdtemp(join(tmpdir(), "ly-index-race-"));
	try {
		const store = new SessionStore(join(root, "sessions"));
		const kept: SessionMeta[] = [];
		for (let round = 0; round < 10; round++) {
			const doomed = await Promise.all(Array.from({ length: 3 }, (_, i) => store.create(root, "m", `doomed ${round}.${i}`)));
			const keeping = await Promise.all(Array.from({ length: 3 }, (_, i) => store.create(root, "m", `kept ${round}.${i}`)));
			kept.push(...keeping);
			await Promise.all([
				...keeping.map((each) => store.setArchived(each.projectId, each.id, true)),
				store.deleteMany(doomed.map((each) => ({ projectId: each.projectId, id: each.id }))),
			]);

			const index = await indexOn(root);
			assert.deepEqual(index.map((each) => each.id).sort(), kept.map((each) => each.id).sort(), `round ${round}`);
			assert.ok(index.every((each) => each.archived), `round ${round}: ${JSON.stringify(index.map((each) => [each.title, each.archived]))}`);
		}
	} finally {
		await rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 25 });
	}
});

test("a message still being written when its session is deleted does not bring the session back", async () => {
	const root = await mkdtemp(join(tmpdir(), "ly-index-race-"));
	try {
		const store = new SessionStore(join(root, "sessions"));
		const meta = await store.create(root, "m");
		const writing = store.append(meta, { type: "message", message: { role: "user", content: [{ type: "text", text: "late" }], timestamp: 1 } });
		await Promise.all([writing, store.delete(meta.projectId, meta.id)]);

		assert.equal(await stat(join(root, "sessions", meta.projectId, `${meta.id}.jsonl`)).catch(() => null), null, "the log grew back");
		assert.deepEqual(await indexOn(root), []);
	} finally {
		await rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 25 });
	}
});

test("rebuilding the index beside new conversations keeps every one of them", async () => {
	const root = await mkdtemp(join(tmpdir(), "ly-index-race-"));
	try {
		const store = new SessionStore(join(root, "sessions"));
		// Enough logs that the scan is still reading them when the new conversation is written.
		const made = await Promise.all(Array.from({ length: 40 }, (_, i) => store.create(root, `before ${i}`)));
		for (let round = 0; round < 5; round++) {
			const [, created] = await Promise.all([store.rebuildIndex(), store.create(root, `during ${round}`)]);
			made.push(created);

			const index = await indexOn(root);
			for (const meta of made) assert.ok(index.some((each) => each.id === meta.id), `round ${round}: ${meta.modelId} is missing from the index`);
		}
	} finally {
		await rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 25 });
	}
});

test("an index gone missing is rebuilt once, however many ask for it at the same moment", async () => {
	const root = await mkdtemp(join(tmpdir(), "ly-index-race-"));
	try {
		const store = new SessionStore(join(root, "sessions"));
		const made = await Promise.all(Array.from({ length: 4 }, (_, i) => store.create(root, `before ${i}`)));
		// Gone the way it goes at first launch, or after a crash took it: the sidebar asks for the list,
		// which rebuilds it, while conversations are being created.
		await unlink(join(root, "sessions", "index.json"));
		const [first, created, second] = await Promise.all([store.listSessions(), store.create(root, "during"), store.listSessions()]);
		made.push(created);

		const index = await indexOn(root);
		assert.deepEqual(index.map((each) => each.id).sort(), made.map((each) => each.id).sort());
		for (const listed of [first, second]) assert.ok(listed.length >= 4, `a caller got ${listed.length} sessions`);
	} finally {
		await rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 25 });
	}
});

test("a deleted session takes its display snapshot with it", async () => {
	const root = await mkdtemp(join(tmpdir(), "ly-index-race-"));
	try {
		const store = new SessionStore(join(root, "sessions"));
		const meta = await store.create(root, "m");
		await store.append(meta, { type: "message", message: { role: "user", content: [{ type: "text", text: "hello" }], timestamp: 1 } });
		await store.load(meta.projectId, meta.id, { display: true });
		const snapshot = join(root, "sessions", meta.projectId, `${meta.id}.display.json`);
		assert.ok(await stat(snapshot).catch(() => null), "the window's load leaves a snapshot");

		await store.delete(meta.projectId, meta.id);
		assert.equal(await stat(snapshot).catch(() => null), null);
	} finally {
		await rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 25 });
	}
});
