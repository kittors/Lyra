/**
 * The session database: what a crash mid-reply leaves, and what deleting a conversation does not
 * take with it.
 *
 * Carried over with the database itself from wJiaaa/Lyra (ADR-0032), against this store's methods.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { mock, test } from "node:test";
import { pathToFileURL } from "node:url";
import type { AgentEvent } from "../src/agent/events.ts";
import { SessionLog } from "../src/runtime/session-log.ts";
import { sessionDb, SessionDbUnavailable } from "../src/session/db.ts";
import { assemblePartial, mergePieces, PartialDiff, PartialWriter, type PartialPiece } from "../src/session/partial.ts";
import { SessionStore } from "../src/session/store.ts";
import { emptyUsage, type AssistantMessage, type Message } from "../src/types.ts";

const user = (text: string): Message => ({ role: "user", content: [{ type: "text", text }], timestamp: 1 });

function reply(content: AssistantMessage["content"], input = 100): AssistantMessage {
	return { role: "assistant", content, api: "openai-responses", provider: "p", model: "m", stopReason: "stop", usage: { ...emptyUsage(), input, total: input }, timestamp: 1 };
}

async function withStore(run: (store: SessionStore, root: string) => Promise<void>): Promise<void> {
	const root = await mkdtemp(join(tmpdir(), "ly-session-db-"));
	const store = new SessionStore(root);
	try {
		await run(store, root);
	} finally {
		store.close();
		await rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 25 });
	}
}

/** A pid that belonged to a process and no longer does. */
function deadPid(): number {
	const pid = spawnSync(process.execPath, ["-e", ""]).pid;
	assert.ok(pid);
	return pid;
}

test("a diff hands out only what is new, and a block that changed rather than grew whole", () => {
	const diff = new PartialDiff();
	assert.deepEqual(diff.take(reply([{ type: "thinking", thinking: "hm" }])), [{ i: 0, type: "thinking", text: "hm", reset: true }]);
	assert.deepEqual(diff.take(reply([{ type: "thinking", thinking: "hmm" }, { type: "text", text: "A" }])), [
		{ i: 0, type: "thinking", text: "m" },
		{ i: 1, type: "text", text: "A", reset: true },
	]);
	assert.deepEqual(diff.take(reply([{ type: "thinking", thinking: "hmm" }, { type: "text", text: "B" }])), [{ i: 1, type: "text", text: "B", reset: true }]);
	assert.deepEqual(diff.take(reply([{ type: "thinking", thinking: "hmm" }, { type: "text", text: "B" }])), []);
});

test("a long block is told apart by its end: growth hands out the tail, a rewrite the whole", () => {
	const diff = new PartialDiff();
	const body = "a".repeat(500);
	diff.take(reply([{ type: "text", text: `${body}END` }]));
	assert.deepEqual(diff.take(reply([{ type: "text", text: `${body}END and more` }])), [{ i: 0, type: "text", text: " and more" }]);
	// Same length and more, but the characters where it used to end are different: it started over.
	const rewritten = `${body}XYZ and more, again`;
	assert.deepEqual(diff.take(reply([{ type: "text", text: rewritten }])), [{ i: 0, type: "text", text: rewritten, reset: true }]);
	assert.deepEqual(diff.take(reply([{ type: "text", text: "short" }])), [{ i: 0, type: "text", text: "short", reset: true }], "and a block that shrank");
});

test("merged batches rebuild the same reply the deltas would", () => {
	const pieces = [
		{ i: 0, type: "text" as const, text: "a", reset: true as const },
		{ i: 0, type: "text" as const, text: "b" },
		{ i: 0, type: "text" as const, text: "c" },
		{ i: 0, type: "text" as const, text: "X", reset: true as const },
		{ i: 0, type: "text" as const, text: "y" },
	];
	assert.deepEqual(mergePieces(pieces), [
		{ i: 0, type: "text", text: "abc", reset: true },
		{ i: 0, type: "text", text: "Xy", reset: true },
	]);
	const head = reply([]);
	assert.deepEqual(assemblePartial(head, [pieces])?.content, [{ type: "text", text: "Xy" }]);
	assert.deepEqual(assemblePartial(head, [mergePieces(pieces)])?.content, [{ type: "text", text: "Xy" }]);
	assert.equal(assemblePartial(head, []), null, "nothing said, nothing to recover");
});

test("a reply whose writer died is recovered as a stopped reply, once", async () => {
	await withStore(async (store, root) => {
		const meta = await store.create(root, "m");
		await store.append(meta, { type: "message", message: user("go") });
		await store.beginPartial(meta.id, "s1", reply([]));
		await store.appendPartial(meta.id, "s1", [{ i: 0, type: "thinking", text: "think", reset: true }, { i: 1, type: "text", text: "half an ans", reset: true }]);
		await store.appendPartial(meta.id, "s1", [{ i: 1, type: "text", text: "wer" }]);

		// Still streaming here: a reader must not steal it.
		assert.equal((await store.load(meta.projectId, meta.id))?.messages.length, 1);

		sessionDb(store.path).prepare("UPDATE partials SET owner_pid = ?").run(deadPid());
		const loaded = await new SessionStore(root).load(meta.projectId, meta.id);
		assert.equal(loaded?.messages.length, 2);
		const recovered = loaded?.messages[1] as AssistantMessage;
		assert.equal(recovered.stopReason, "aborted");
		assert.deepEqual(recovered.content, [{ type: "thinking", thinking: "think" }, { type: "text", text: "half an answer" }]);

		// Committed and gone: a second reader finds nothing more.
		assert.equal((await store.load(meta.projectId, meta.id))?.messages.length, 2);
		assert.equal(sessionDb(store.path).prepare("SELECT COUNT(*) AS n FROM partial_chunks").get()?.n, 0);
	});
});

test("a reply cut off before a reboot is recovered though its old pid is someone else's now", async () => {
	await withStore(async (store, root) => {
		const meta = await store.create(root, "m");
		await store.append(meta, { type: "message", message: user("go") });
		await store.beginPartial(meta.id, "s1", reply([]));
		await store.appendPartial(meta.id, "s1", [{ i: 0, type: "text", text: "cut off by a power failure", reset: true }]);
		// pid 1 is always alive; the last write is from long before this machine booted.
		sessionDb(store.path).prepare("UPDATE partials SET owner_pid = 1, updated_at = 1000").run();
		const loaded = await new SessionStore(root).load(meta.projectId, meta.id);
		assert.ok(loaded);
		assert.equal(loaded.messages.length, 2);
		assert.equal((loaded.messages[1] as AssistantMessage).stopReason, "aborted");
	});
});

test("a recovered reply keeps the time it was cut off, not the time it was opened", async () => {
	await withStore(async (store, root) => {
		const meta = await store.create(root, "m");
		const said = await store.append(meta, { type: "message", message: user("go") });
		await store.beginPartial(meta.id, "s1", reply([]));
		await store.appendPartial(meta.id, "s1", [{ i: 0, type: "text", text: "half", reset: true }]);
		const cutAt = said!.updatedAt + 5;
		sessionDb(store.path).prepare("UPDATE partials SET owner_pid = ?, updated_at = ?").run(deadPid(), cutAt);

		// Opened two days later.
		const realNow = Date.now();
		mock.method(Date, "now", () => realNow + 2 * 86_400_000);
		try {
			const loaded = await store.load(meta.projectId, meta.id);
			assert.equal(loaded?.meta.updatedAt, cutAt, "the conversation does not jump to the top of the list");
			const last = await Array.fromAsync(store.read(meta.projectId, meta.id, said!.seq));
			assert.deepEqual(last.map((record) => [record.type, record.ts]), [["message", cutAt]]);
		} finally {
			mock.restoreAll();
		}
	});
});

test("a turn that throws mid-reply commits what streamed, announced like any reply", async () => {
	await withStore(async (store, root) => {
		const events: AgentEvent[] = [];
		const log = new SessionLog(store, (event) => void events.push(event), await store.create(root, "m"));
		await log.commit(user("go"));
		const streaming = reply([]);
		await log.emit({ type: "message_start", message: streaming });
		await log.emit({ type: "message_update", message: { ...streaming, content: [{ type: "thinking", thinking: "hm" }, { type: "text", text: "half an ans" }, { type: "toolCall", id: "t", name: "bash", arguments: {} }] }, delta: { type: "text_delta" } as never });
		// The turn threw here: no message_end, no discard.
		await log.settleOrphan();

		const committed = log.messages.at(-1) as AssistantMessage;
		assert.equal(committed.stopReason, "aborted");
		assert.deepEqual(committed.content, [{ type: "thinking", thinking: "hm" }, { type: "text", text: "half an ans" }], "a tool call cut off mid-arguments never ran, so it is not kept");
		assert.equal(events.filter((event) => event.type === "message_end").length, 1, "the window is told, so it stays one-to-one with the log");
		assert.equal((await store.load(log.meta.projectId, log.meta.id))?.messages.length, 2, "and the store has it");
		assert.equal(sessionDb(store.path).prepare("SELECT COUNT(*) AS n FROM partials").get()?.n, 0);
		await log.settleOrphan();
		assert.equal(log.messages.length, 2, "settling twice commits once");
	});
});

test("a batch that fails to save is kept and written ahead of what came after it", async () => {
	await withStore(async (store, root) => {
		const meta = await store.create(root, "m");
		await store.append(meta, { type: "message", message: user("go") });
		const append = store.appendPartial.bind(store);
		let failures = 1;
		mock.method(store, "appendPartial", async (...args: Parameters<SessionStore["appendPartial"]>) => {
			if (failures-- > 0) throw new Error("database is locked");
			return append(...args);
		});
		const reported = mock.method(console, "error", () => {});
		try {
			const head = reply([]);
			const writer = new PartialWriter(store, () => meta.id);
			await writer.begin(head);
			// The first write fails; the stream does not stop for it.
			await writer.update({ ...head, content: [{ type: "text", text: "first" }] });
			await writer.update({ ...head, content: [{ type: "text", text: "first, then more" }] });
			await writer.flush();
			assert.equal(reported.mock.callCount(), 1, "said once, not swallowed");

			sessionDb(store.path).prepare("UPDATE partials SET owner_pid = ?").run(deadPid());
			const loaded = await store.load(meta.projectId, meta.id);
			assert.deepEqual(loaded?.messages.at(-1)?.content, [{ type: "text", text: "first, then more" }], "no hole where the failed batch was");
		} finally {
			mock.restoreAll();
		}
	});
});

test("a reply whose final write fails stays recoverable instead of being forgotten first", async () => {
	await withStore(async (store, root) => {
		const events: AgentEvent[] = [];
		const log = new SessionLog(store, (event) => void events.push(event), await store.create(root, "m"));
		await log.commit(user("go"));
		const streaming = reply([]);
		await log.emit({ type: "message_start", message: streaming });
		await log.emit({ type: "message_update", message: { ...streaming, content: [{ type: "text", text: "the whole answer" }] }, delta: { type: "text_delta" } as never });
		const failing = mock.method(store, "append", async () => { throw new Error("disk I/O error"); });
		const final = { ...streaming, content: [{ type: "text" as const, text: "the whole answer" }] };
		await assert.rejects(log.commit(final), /disk I\/O error/);
		assert.equal(log.messages.length, 1, "what was not written is not in the transcript either");
		failing.mock.restore();

		// The turn ends on that error; the stream is still there to be committed as a stopped reply.
		await log.settleOrphan();
		assert.equal(log.messages.length, 2);
		assert.deepEqual(log.messages.at(-1)?.content, [{ type: "text", text: "the whole answer" }]);
		assert.equal((await store.load(log.meta.projectId, log.meta.id))?.messages.length, 2, "and the store has it once");
	});
});

test("a normal exit writes out the batch still waiting and folds the WAL back into the file", async () => {
	await withStore(async (store, root) => {
		const source = (path: string) => JSON.stringify(pathToFileURL(join(import.meta.dirname, "..", "src", path)).href);
		const script = join(root, "child.ts");
		await writeFile(script, `
			import { SessionStore } from ${source("session/store.ts")};
			import { PartialWriter } from ${source("session/partial.ts")};
			const store = new SessionStore(${JSON.stringify(root)});
			const meta = await store.create(${JSON.stringify(root)}, "m");
			await store.append(meta, { type: "message", message: ${JSON.stringify(user("go"))} });
			const head = ${JSON.stringify(reply([]))};
			const writer = new PartialWriter(store, () => meta.id);
			await writer.begin(head);
			await writer.update({ ...head, content: [{ type: "text", text: "first" }] });
			// This batch is waiting on its timer when the process leaves.
			await writer.update({ ...head, content: [{ type: "text", text: "first, then the rest" }] });
			process.exit(0);
		`);
		const run = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", script], { encoding: "utf8" });
		assert.equal(run.status, 0, run.stderr);
		assert.equal(existsSync(`${store.path}-wal`), false, "closed: nothing is left only in the WAL");

		// The writer is gone, so the next reader recovers the reply — all of it.
		const [meta] = await store.listSessions();
		const loaded = await store.load(meta.projectId, meta.id);
		assert.deepEqual(loaded?.messages.at(-1)?.content, [{ type: "text", text: "first, then the rest" }]);
	});
});

test("committing the reply, or throwing it away, leaves nothing to recover", async () => {
	await withStore(async (store, root) => {
		const meta = await store.create(root, "m");
		await store.beginPartial(meta.id, "s1", reply([]));
		await store.appendPartial(meta.id, "s1", [{ i: 0, type: "text", text: "draft", reset: true }]);
		await store.append(meta, { type: "message", message: reply([{ type: "text", text: "final" }]) }, { stream: "s1" });
		assert.equal(sessionDb(store.path).prepare("SELECT COUNT(*) AS n FROM partials").get()?.n, 0, "the reply took its stream with it");
		await store.beginPartial(meta.id, "s2", reply([]));
		await store.appendPartial(meta.id, "s2", [{ i: 0, type: "text", text: "thrown away", reset: true }]);
		await store.dropPartial(meta.id, "s2");

		sessionDb(store.path).prepare("UPDATE partials SET owner_pid = ?").run(deadPid());
		const loaded = await store.load(meta.projectId, meta.id);
		assert.deepEqual(loaded?.messages.map((m) => (m.content[0] as { text: string }).text), ["final"]);
		assert.equal(sessionDb(store.path).prepare("SELECT COUNT(*) AS n FROM partials").get()?.n, 0);
	});
});

test("a database of another schema version is refused with its path and left as it was", async () => {
	await withStore(async (store, root) => {
		const meta = await store.create(root, "m");
		await store.append(meta, { type: "message", message: user("go") });
		sessionDb(store.path).exec("PRAGMA user_version = 2");
		store.close();

		await assert.rejects(new SessionStore(root).load(meta.projectId, meta.id), (error: unknown) => error instanceof SessionDbUnavailable && error.path === store.path && /tables are version 2/.test(error.reason));
		const raw = new DatabaseSync(store.path, { readOnly: true });
		try {
			assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM records").get()?.n, 2, "nothing converted, nothing dropped");
		} finally {
			raw.close();
		}
	});
});

test("closing a database ends what this process was streaming into it, and only into it", async () => {
	await withStore(async (closed, closedRoot) => {
		await withStore(async (open, openRoot) => {
			const a = await closed.create(closedRoot, "m");
			const b = await open.create(openRoot, "m");
			for (const [store, meta] of [[closed, a], [open, b]] as const) {
				await store.append(meta, { type: "message", message: user("go") });
				await store.beginPartial(meta.id, `s-${meta.id}`, reply([]));
				await store.appendPartial(meta.id, `s-${meta.id}`, [{ i: 0, type: "text", text: "cut off", reset: true }]);
			}
			closed.close();

			const reopened = new SessionStore(closedRoot);
			assert.deepEqual((await reopened.load(a.projectId, a.id))?.messages.at(-1)?.content, [{ type: "text", text: "cut off" }], "recovered, as after a restart");
			assert.equal((await open.load(b.projectId, b.id))?.messages.length, 1, "a stream into another database is still being written");
		});
	});
});

test("a stream that was taken over cannot be extended, dropped or settled by its old writer", async () => {
	await withStore(async (store, root) => {
		const meta = await store.create(root, "m");
		await store.beginPartial(meta.id, "old", reply([]));
		await store.beginPartial(meta.id, "new", reply([]));
		await store.appendPartial(meta.id, "old", [{ i: 0, type: "text", text: "stale", reset: true }]);
		await store.appendPartial(meta.id, "new", [{ i: 0, type: "text", text: "current", reset: true }]);
		const db = sessionDb(store.path);
		const chunks = () => db.prepare("SELECT body FROM partial_chunks").all().map((row) => (JSON.parse(String(row.body)) as PartialPiece[])[0]?.text);
		assert.deepEqual(chunks(), ["current"]);

		await store.dropPartial(meta.id, "old");
		await store.append(meta, { type: "message", message: reply([{ type: "text", text: "the old writer's reply" }]) }, { stream: "old" });
		assert.deepEqual(chunks(), ["current"], "neither the old drop nor the old reply took the new stream");
		// Still this process's live stream: a reader leaves it alone.
		assert.equal((await store.load(meta.projectId, meta.id))?.messages.length, 1);
	});
});

test("of two writers on one conversation, the one taken over changes nothing of its successor's", async () => {
	await withStore(async (store, root) => {
		const meta = await store.create(root, "m");
		const head = reply([]);
		const old = new PartialWriter(store, () => meta.id);
		const next = new PartialWriter(store, () => meta.id);
		await old.begin(head);
		await next.begin(head);
		await next.update({ ...head, content: [{ type: "text", text: "current" }] });
		await old.update({ ...head, content: [{ type: "text", text: "stale" }] });
		await old.discard();

		sessionDb(store.path).prepare("UPDATE partials SET owner_pid = ?").run(deadPid());
		assert.deepEqual((await store.load(meta.projectId, meta.id))?.messages.at(-1)?.content, [{ type: "text", text: "current" }]);
	});
});

test("deleting a conversation keeps what it spent", async () => {
	await withStore(async (store, root) => {
		const meta = await store.create(root, "m");
		await store.append(meta, { type: "message", message: user("go") });
		await store.append(meta, { type: "message", message: reply([{ type: "text", text: "ok" }], 700) });
		await store.append(meta, { type: "truncate", afterSeq: 1 });
		await store.recordUsage({ source: "memory-extract", providerId: "p", modelId: "m", usage: { ...emptyUsage(), input: 5 } });

		await store.delete(meta.projectId, meta.id);
		const spent = await store.readSpend();
		assert.deepEqual(spent.map((row) => [row.sessionId, row.stream, row.kind, row.source]), [
			[meta.id, "main", "call", "reply"],
			[meta.id, "main", "rewind", null],
			[null, null, "call", "memory-extract"],
		]);
		assert.equal(spent[0].call?.usage.input, 700);
		assert.deepEqual(await store.readSpend(spent[1].id), [spent[2]], "read on from a cursor");
	});
});

test("a write that lands after its conversation was deleted commits nothing and keeps what it spent", async () => {
	await withStore(async (store, root) => {
		const meta = await store.create(root, "m");
		await store.delete(meta.projectId, meta.id);
		assert.equal(await store.append(meta, { type: "title", title: "late" }), null);
		assert.equal(await store.append(meta, { type: "message", message: reply([{ type: "text", text: "late reply" }], 300) }), null);
		assert.equal(await store.append(meta, { type: "usage", source: "title-summary", providerId: "p", modelId: "m", usage: { ...emptyUsage(), input: 9 } }), null);
		assert.equal(await store.append(meta, { type: "truncate", afterSeq: 0 }), null);
		assert.equal(await store.get(meta.id), null, "it does not come back");
		assert.deepEqual((await store.readSpend()).map((row) => [row.sessionId, row.kind, row.source, row.call?.usage.input]), [
			[meta.id, "call", "reply", 300],
			[meta.id, "call", "title-summary", 9],
			[meta.id, "rewind", null, undefined],
		]);
	});
});

test("history copied from another conversation is not billed twice", async () => {
	await withStore(async (store, root) => {
		const meta = await store.create(root, "m");
		await store.append(meta, { type: "message", message: reply([{ type: "text", text: "paid for elsewhere" }]) }, { copy: true });
		assert.deepEqual(await store.readSpend(), []);
		assert.equal((await store.get(meta.id))?.usage.input, 100, "the conversation still shows what it holds");
	});
});

test("deleted space is handed back to the file system", async () => {
	await withStore(async (store, root) => {
		const db = sessionDb(store.path);
		assert.equal(db.prepare("PRAGMA auto_vacuum").get()?.auto_vacuum, 2);
		const meta = await store.create(root, "m");
		for (let i = 0; i < 50; i++) await store.append(meta, { type: "message", message: user("x".repeat(4096)) });
		const onDisk = () => statSync(store.path).size + (existsSync(`${store.path}-wal`) ? statSync(`${store.path}-wal`).size : 0);
		const before = onDisk();
		await store.delete(meta.projectId, meta.id);
		assert.equal(db.prepare("PRAGMA freelist_count").get()?.freelist_count, 0);
		// The file and its WAL together: the vacuum moves pages through the WAL, which kept the disk as full as before.
		assert.ok(onDisk() < before / 2, `${before} bytes before, ${onDisk()} after`);
	});
});
