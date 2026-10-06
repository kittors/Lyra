/**
 * One session, one `updatedAt` — whoever asks, and however often the store is reopened.
 *
 * The JSONL store kept a session's meta in three places — memory, `index.json`, the log — and a new
 * session took the time twice: the meta record said T0, the index T1, and a rebuild put T0 back.
 * Moving or archiving, which must keep `updatedAt` as it was, then kept the wrong one, and only when
 * the calls straddled a millisecond. The database keeps one copy, written with each record; these
 * check that it stays the one answer.
 *
 * A clock that moves one millisecond per call makes every straddle happen, every time.
 */

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { SessionStore } from "../src/session/store.ts";

function tickingClock(t: TestContext): void {
	let now = Date.now();
	t.mock.method(Date, "now", () => (now += 1));
}

async function withStore(run: (store: SessionStore, root: string) => Promise<void>): Promise<void> {
	const root = await mkdtemp(join(tmpdir(), "lyra-clock-"));
	try {
		await run(new SessionStore(root), root);
	} finally {
		await rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 25 });
	}
}

test("a reopened store says what the store said before", async (t) => {
	tickingClock(t);
	await withStore(async (store, root) => {
		const created = await store.create("/tmp/project-a", "fake/model");
		await store.append(created, { type: "message", message: { role: "user", content: [{ type: "text", text: "hi" }], timestamp: 1 } });
		const before = (await store.listSessions()).find((s) => s.id === created.id);
		store.close();
		const fresh = (await new SessionStore(root).listSessions()).find((s) => s.id === created.id);
		assert.equal(fresh?.updatedAt, before?.updatedAt, "a restarted app lists a different time");
	});
});

test("moving a session keeps its place in the list", async (t) => {
	tickingClock(t);
	await withStore(async (store) => {
		const created = await store.create("/tmp/project-a", "fake/model");
		const before = (await store.listSessions()).find((s) => s.id === created.id)!.updatedAt;
		const moved = await store.move(created.projectId, created.id, "/tmp/project-b", "B 项目");
		const after = (await store.listSessions()).find((s) => s.id === created.id)!.updatedAt;
		assert.equal(moved?.updatedAt, before);
		assert.equal(after, before, "filing a session away moved it in the list");
	});
});

test("an append made with a stale meta continues the session's own numbering", async () => {
	await withStore(async (store) => {
		const created = await store.create("/tmp/project-a", "fake/model");
		const first = await store.append(created, { type: "message", message: { role: "user", content: [{ type: "text", text: "one" }], timestamp: 1 } });
		/*
		 * The caller still holds the meta from before `first`. Numbered from it, the next record would
		 * reuse a sequence number, which a phone syncing with `?since=N` skips. The store reads the
		 * session's own meta under the write lock instead.
		 */
		const next = await store.append(created, { type: "message", message: { role: "user", content: [{ type: "text", text: "two" }], timestamp: 2 } });
		assert.equal(next?.seq, (first?.seq ?? 0) + 1, "a sequence number was handed out twice");
	});
});
