/**
 * One session, one `updatedAt` — whichever of the store's three copies is asked.
 *
 * The store keeps a session's meta in memory (the append queue's view), in `index.json`, and in the
 * log itself, and rebuilds the first two from the third when the index is missing or unreadable. A
 * new session took the time twice: the meta record on disk said T0, the index said T1. A rebuild
 * then put T0 back into memory, and moving or archiving — which must keep `updatedAt` as it was —
 * kept the wrong one. Only when the two calls straddled a millisecond, which is why
 * `session-move.test.ts` failed now and then, and more often on Windows, where the index read that
 * triggers a rebuild is the one antivirus gets in the way of.
 *
 * A clock that moves one millisecond per call makes every straddle happen, every time.
 */

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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

test("a rebuilt index says what the index said before it was lost", async (t) => {
	tickingClock(t);
	await withStore(async (store, root) => {
		const created = await store.create("/tmp/project-a", "fake/model");
		await store.append(created, { type: "message", message: { role: "user", content: [{ type: "text", text: "hi" }], timestamp: 1 } });
		const before = (await store.listSessions()).find((s) => s.id === created.id);

		// An index that cannot be read is rebuilt from the logs, by this store and by the next one.
		await writeFile(join(root, "index.json"), "not json", "utf8");
		const rebuilt = (await store.listSessions()).find((s) => s.id === created.id);
		const fresh = (await new SessionStore(root).rebuildIndex()).find((s) => s.id === created.id);

		assert.equal(rebuilt?.updatedAt, before?.updatedAt, "the rebuild moved the session in the list");
		assert.equal(fresh?.updatedAt, before?.updatedAt, "a restarted app rebuilds a different time");
	});
});

test("moving a session after the index was rebuilt keeps its place in the list", async (t) => {
	tickingClock(t);
	await withStore(async (store, root) => {
		const created = await store.create("/tmp/project-a", "fake/model");
		const before = (await store.listSessions()).find((s) => s.id === created.id)!.updatedAt;

		await writeFile(join(root, "index.json"), "not json", "utf8");
		const moved = await store.move(created.projectId, created.id, "/tmp/project-b", "B 项目");
		const after = (await store.listSessions()).find((s) => s.id === created.id)!.updatedAt;

		assert.equal(moved?.updatedAt, before);
		assert.equal(after, before, "filing a session away moved it in the list");
	});
});

test("reading a log that an append has since overtaken does not wind the numbering back", async () => {
	await withStore(async (store, root) => {
		const created = await store.create("/tmp/project-a", "fake/model");
		const first = await store.append(created, { type: "message", message: { role: "user", content: [{ type: "text", text: "one" }], timestamp: 1 } });

		/*
		 * `load` reads the file, then seeds the append queue's view with what it read. An append that
		 * lands in between has already moved that view on — and putting the older one back makes the
		 * next append reuse a sequence number, which a phone syncing with `?since=N` then skips. The
		 * file is cut back to its first record here to stand for "what the read saw".
		 */
		const log = join(root, created.projectId, `${created.id}.jsonl`);
		const lines = (await readFile(log, "utf8")).split("\n").filter(Boolean);
		await writeFile(log, `${lines[0]}\n`, "utf8");
		await store.load(created.projectId, created.id);
		await writeFile(log, `${lines.join("\n")}\n`, "utf8");

		const next = await store.append(first, { type: "message", message: { role: "user", content: [{ type: "text", text: "two" }], timestamp: 2 } });
		assert.equal(next.seq, first.seq + 1, "a sequence number was handed out twice");
	});
});
