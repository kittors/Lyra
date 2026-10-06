/**
 * The JSONL logs every conversation lived in before the database, brought into it once.
 *
 * Lyra shipped with them, so these are people's whole histories: what comes over has to be what they
 * had — the messages, the names they gave, the archive, what was spent — numbered as before, because
 * a phone syncing with `?since=N` holds those numbers. And once is once: a session deleted after the
 * import must not be brought back by its old file, which stays where it was as a backup.
 */

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mock, test } from "node:test";
import { projectIdFor, SessionStore, type SessionRecord } from "../src/session/store.ts";
import { emptyUsage } from "../src/types.ts";

const CWD = "/tmp/legacy-project";
const PROJECT = projectIdFor(CWD);

function meta(id: string, at: number) {
	return { id, title: "New session", cwd: CWD, projectId: PROJECT, projectName: "legacy-project", createdAt: at, updatedAt: at, modelId: "relay/m", messageCount: 0, usage: emptyUsage(), seq: 0 };
}

const user = (text: string, at: number) => ({ role: "user", content: [{ type: "text", text }], timestamp: at });
const reply = (text: string, input: number, at: number) => ({
	role: "assistant",
	content: [{ type: "text", text }],
	api: "openai-responses",
	provider: "relay",
	model: "m",
	stopReason: "stop",
	usage: { ...emptyUsage(), input, total: input },
	timestamp: at,
});

async function withHome(run: (root: string) => Promise<void>): Promise<void> {
	const root = await mkdtemp(join(tmpdir(), "ly-legacy-"));
	try {
		await run(root);
	} finally {
		await rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 25 });
	}
}

async function writeLog(root: string, id: string, lines: string[]): Promise<string> {
	await mkdir(join(root, PROJECT), { recursive: true });
	const path = join(root, PROJECT, `${id}.jsonl`);
	await writeFile(path, `${lines.join("\n")}\n`, "utf8");
	return path;
}

const line = (record: object) => JSON.stringify(record);

test("an old log comes over whole: messages, the name given, the archive, what was spent, the numbering", async () => {
	await withHome(async (root) => {
		const id = "11111111-1111-4111-8111-111111111111";
		await writeLog(root, id, [
			line({ seq: 1, ts: 1000, type: "meta", meta: meta(id, 1000) }),
			line({ seq: 2, ts: 2000, type: "message", message: user("hello", 2000) }),
			line({ seq: 3, ts: 3000, type: "message", message: reply("hi there", 700, 3000) }),
			line({ seq: 4, ts: 4000, type: "title", title: "Named by me", source: "user" }),
			line({ seq: 5, ts: 5000, type: "archive", archived: true }),
			line({ seq: 6, ts: 6000, type: "usage", source: "title-summary", providerId: "relay", modelId: "m", usage: { ...emptyUsage(), input: 9, total: 9 } }),
		]);

		const store = new SessionStore(root);
		const [listed] = await store.listSessions();
		assert.equal(listed?.id, id);
		assert.equal(listed.title, "Named by me");
		assert.equal(listed.titleSetByUser, true);
		assert.equal(listed.archived, true);
		assert.equal(listed.messageCount, 2);
		assert.equal(listed.usage.input, 709, "the reply and the side call, as the log totalled them");
		assert.equal(listed.updatedAt, 6000, "last used when it was last written to, not when it was filed away");
		assert.equal(listed.seq, 6);

		const loaded = await store.load(PROJECT, id);
		assert.deepEqual(loaded?.messages.map((message) => message.role), ["user", "assistant"]);
		const seqs: number[] = [];
		for await (const record of store.read(PROJECT, id)) seqs.push(record.seq);
		assert.deepEqual(seqs, [1, 2, 3, 4, 5, 6], "a phone holding seq 6 asks for what comes after 6, and gets it");

		const spent = await store.readSpend();
		assert.deepEqual(spent.map((row) => [row.sessionId, row.source, row.call?.usage.input]), [
			[id, "reply", 700],
			[id, "title-summary", 9],
		]);

		// And the next record continues the numbering rather than starting over.
		const next = await store.append(listed, { type: "message", message: user("again", 7000) as never });
		assert.equal(next?.seq, 7);
	});
});

test("imported once: a conversation deleted afterwards is not brought back by its old file", async () => {
	await withHome(async (root) => {
		const id = "22222222-2222-4222-8222-222222222222";
		const path = await writeLog(root, id, [line({ seq: 1, ts: 1000, type: "meta", meta: meta(id, 1000) }), line({ seq: 2, ts: 2000, type: "message", message: user("x", 2000) })]);
		const store = new SessionStore(root);
		assert.equal((await store.listSessions()).length, 1);
		await store.delete(PROJECT, id);
		store.close();

		assert.ok(existsSync(path), "the file stays, as a backup");
		assert.deepEqual(await new SessionStore(root).listSessions(), [], "and is not read again");
	});
});

test("out-of-order numbers are renumbered after the record before, and a cut still cuts where it did", async () => {
	await withHome(async (root) => {
		const id = "33333333-3333-4333-8333-333333333333";
		// Two writes once raced to the same number: the old store's queue came after logs like this.
		await writeLog(root, id, [
			line({ seq: 1, ts: 1000, type: "meta", meta: meta(id, 1000) }),
			line({ seq: 2, ts: 2000, type: "message", message: user("kept", 2000) }),
			line({ seq: 3, ts: 3000, type: "message", message: reply("dropped by the cut", 10, 3000) }),
			line({ seq: 3, ts: 3001, type: "message", message: user("raced", 3001) }),
			line({ seq: 4, ts: 4000, type: "truncate", afterSeq: 2 }),
		]);
		const store = new SessionStore(root);
		const records: SessionRecord[] = [];
		for await (const record of store.read(PROJECT, id)) records.push(record);
		assert.deepEqual(records.map((record) => record.seq), [1, 2, 3, 4, 5]);
		const loaded = await store.load(PROJECT, id);
		assert.deepEqual(loaded?.messages.map((message) => (message.content[0] as { text: string }).text), ["kept"]);
	});
});

test("a log with no meta record, or with a damaged line, does not stop the others", async () => {
	await withHome(async (root) => {
		await writeLog(root, "no-meta", [line({ seq: 1, ts: 1000, type: "message", message: user("orphan", 1000) })]);
		const id = "44444444-4444-4444-8444-444444444444";
		await writeLog(root, id, [
			line({ seq: 1, ts: 1000, type: "meta", meta: meta(id, 1000) }),
			'{"seq":2,"ts":2000,"type":"message","message":{"role":"us',
			line({ seq: 3, ts: 3000, type: "message", message: user("after the damage", 3000) }),
		]);
		const store = new SessionStore(root);
		assert.deepEqual((await store.listSessions()).map((session) => session.id), [id]);
		const loaded = await store.load(PROJECT, id);
		assert.deepEqual(loaded?.messages.map((message) => (message.content[0] as { text: string }).text), ["after the damage"]);
	});
});

test("a reply logged without usage comes over with none; a record with nothing in it is dropped, not its session", async () => {
	await withHome(async (root) => {
		const id = "55555555-5555-4555-8555-555555555555";
		await writeLog(root, id, [
			line({ seq: 1, ts: 1000, type: "meta", meta: meta(id, 1000) }),
			line({ seq: 2, ts: 2000, type: "message", message: user("before", 2000) }),
			// Hand-written logs, the e2e fixtures among them, leave usage out; the JSONL store showed these all the same.
			line({ seq: 3, ts: 3000, type: "message", message: { role: "assistant", content: [{ type: "text", text: "no usage" }], timestamp: 3000 } }),
			line({ seq: 4, ts: 3500, type: "message", message: { ...reply("no cost", 5, 3500), usage: { input: 5, output: 1 } } }),
			line({ seq: 5, ts: 4000, type: "event", event: null }),
			line({ seq: 6, ts: 5000, type: "message", message: reply("after", 40, 5000) }),
		]);
		const store = new SessionStore(root);
		const [listed] = await store.listSessions();
		assert.equal(listed?.id, id);
		assert.equal(listed.messageCount, 4);
		assert.equal(listed.usage.input, 45);
		const loaded = await store.load(PROJECT, id);
		assert.deepEqual(loaded?.messages.map((message) => (message.content[0] as { text: string }).text), ["before", "no usage", "no cost", "after"]);
		const seqs: number[] = [];
		for await (const record of store.read(PROJECT, id)) seqs.push(record.seq);
		assert.deepEqual(seqs, [1, 2, 3, 4, 6], "only the empty event is gone, and the rest keep their numbers");
		const next = await store.append(listed, { type: "message", message: user("again", 7000) as never });
		assert.equal(next?.seq, 7);
	});
});

test("a log that cannot be imported at all is left on disk, and the others still come over", async () => {
	await withHome(async (root) => {
		const good = "66666666-6666-4666-8666-666666666666";
		const bad = "77777777-7777-4777-8777-777777777777";
		await writeLog(root, good, [line({ seq: 1, ts: 1000, type: "meta", meta: meta(good, 1000) })]);
		// A meta with no creation time cannot fill the sessions row.
		const { createdAt: _createdAt, ...broken } = meta(bad, 1000);
		const path = await writeLog(root, bad, [line({ seq: 1, ts: 1000, type: "meta", meta: broken })]);
		const warn = mock.method(console, "warn", () => {});
		try {
			assert.deepEqual((await new SessionStore(root).listSessions()).map((session) => session.id), [good]);
			assert.equal(warn.mock.callCount(), 1);
			assert.ok(String(warn.mock.calls[0]?.arguments[0]).includes(bad), "the warning names the file");
		} finally {
			warn.mock.restore();
		}
		assert.ok(existsSync(path));
	});
});

test("with an index, what it listed comes over in its order, last used when it said, and nothing else", async () => {
	await withHome(async (root) => {
		const [first, second, unlisted] = ["88888888-8888-4888-8888-888888888881", "88888888-8888-4888-8888-888888888882", "88888888-8888-4888-8888-888888888883"];
		// Record times that say otherwise, as hand-made and restored logs do.
		for (const id of [second, first, unlisted]) await writeLog(root, id, [line({ seq: 1, ts: 1, type: "meta", meta: meta(id, 1) })]);
		await writeFile(join(root, "index.json"), JSON.stringify([{ ...meta(first, 1), updatedAt: 9000 }, { ...meta(second, 1), updatedAt: 9000 }]));
		const listed = await new SessionStore(root).listSessions();
		assert.deepEqual(listed.map((session) => session.id), [first, second], "a tie keeps the index's order; a log it did not name is not a session");
		assert.deepEqual(listed.map((session) => session.updatedAt), [9000, 9000]);
	});
});

test("one id under two projects comes over from the one the index names", async () => {
	await withHome(async (root) => {
		const id = "99999999-9999-4999-8999-999999999999";
		const elsewhere = "0000000000000000";
		await mkdir(join(root, elsewhere), { recursive: true });
		await writeFile(join(root, elsewhere, `${id}.jsonl`), `${line({ seq: 1, ts: 1000, type: "meta", meta: { ...meta(id, 1000), projectId: elsewhere, title: "before the move" } })}\n`);
		await writeLog(root, id, [line({ seq: 1, ts: 2000, type: "meta", meta: { ...meta(id, 2000), title: "after the move" } })]);
		await writeFile(join(root, "index.json"), JSON.stringify([{ ...meta(id, 2000), title: "after the move" }]));
		const [listed] = await new SessionStore(root).listSessions();
		assert.equal(listed?.title, "after the move");
		assert.equal(listed.projectId, PROJECT);
	});
});

test("a log the index did not name is no session, but what it spent still counts", async () => {
	await withHome(async (root) => {
		const kept = "aaaaaaaa-0000-4000-8000-000000000001";
		const orphan = "aaaaaaaa-0000-4000-8000-000000000002";
		await writeLog(root, kept, [line({ seq: 1, ts: 1000, type: "meta", meta: meta(kept, 1000) }), line({ seq: 2, ts: 2000, type: "message", message: reply("kept", 10, 2000) })]);
		// Deleted from the index while its log stayed behind: the JSONL store's usage page still summed it.
		await writeLog(root, orphan, [
			line({ seq: 1, ts: 1000, type: "meta", meta: meta(orphan, 1000) }),
			line({ seq: 2, ts: 3000, type: "message", message: reply("deleted", 90, 3000) }),
			line({ seq: 3, ts: 4000, type: "event", event: null }),
		]);
		await writeFile(join(root, "index.json"), JSON.stringify([meta(kept, 2000)]));
		const store = new SessionStore(root);
		assert.deepEqual((await store.listSessions()).map((session) => session.id), [kept]);
		const spent = await store.readSpend();
		assert.deepEqual(spent.map((row) => [row.sessionId, row.call?.usage.input]).sort(), [[kept, 10], [orphan, 90]].sort());
		assert.equal(await store.get(orphan), null);
	});
});

test("a side call logged without its provider still comes over, and so does its session", async () => {
	await withHome(async (root) => {
		const id = "bbbbbbbb-0000-4000-8000-000000000001";
		await writeLog(root, id, [
			line({ seq: 1, ts: 1000, type: "meta", meta: meta(id, 1000) }),
			line({ seq: 2, ts: 2000, type: "usage", source: "title-summary", usage: { ...emptyUsage(), input: 7, total: 7 } }),
		]);
		const store = new SessionStore(root);
		assert.deepEqual((await store.listSessions()).map((session) => session.id), [id]);
		assert.deepEqual((await store.readSpend()).map((row) => [row.source, row.provider, row.call?.usage.input]), [["title-summary", null, 7]]);
	});
});

test("a log with no meta record is no session, but what it spent counts", async () => {
	await withHome(async (root) => {
		// Hand-written, like the e2e fixtures: replies and nothing else. The JSONL store listed none of it, and summed all of it.
		await writeLog(root, "history", [line({ seq: 1, ts: 1000, type: "message", message: reply("from before", 300, 1000) })]);
		const store = new SessionStore(root);
		assert.deepEqual(await store.listSessions(), []);
		assert.deepEqual((await store.readSpend()).map((row) => [row.sessionId, row.call?.usage.input]), [["history", 300]]);
	});
});

test("a session the index lists comes over from the index when its log lost the meta line", async () => {
	await withHome(async (root) => {
		const id = "cccccccc-0000-4000-8000-000000000001";
		await writeLog(root, id, ['{"seq":1,"ts":1000,"type":"meta","meta":{"id":"cccc', line({ seq: 2, ts: 2000, type: "message", message: user("still here", 2000) })]);
		await writeFile(join(root, "index.json"), JSON.stringify([{ ...meta(id, 1000), title: "From the index", updatedAt: 2000 }]));
		const store = new SessionStore(root);
		const [listed] = await store.listSessions();
		assert.equal(listed?.title, "From the index");
		assert.equal(listed.messageCount, 1);
		const loaded = await store.load(PROJECT, id);
		assert.deepEqual(loaded?.messages.map((message) => (message.content[0] as { text: string }).text), ["still here"]);
		assert.equal((await store.readSpend()).length, 0, "and nothing counted twice");
	});
});

test("a session the index listed with no log behind it comes over as the index had it, in its place", async () => {
	await withHome(async (root) => {
		const logged = "dddddddd-0000-4000-8000-000000000001";
		const bare = "dddddddd-0000-4000-8000-000000000002";
		await writeLog(root, logged, [line({ seq: 1, ts: 1000, type: "meta", meta: meta(logged, 1000) }), line({ seq: 2, ts: 1500, type: "message", message: user("hi", 1500) })]);
		// Listed first and last used at the same moment: the JSONL store's sidebar drew it first.
		await writeFile(join(root, "index.json"), JSON.stringify([{ ...meta(bare, 500), title: "Only in the index", updatedAt: 3000, messageCount: 4, seq: 9, archived: true }, { ...meta(logged, 1000), updatedAt: 3000 }]));
		const store = new SessionStore(root);
		const listed = await store.listSessions();
		assert.deepEqual(listed.map((session) => session.id), [bare, logged]);
		assert.equal(listed[0]?.title, "Only in the index");
		assert.equal(listed[0]?.archived, true);
		assert.equal(await store.pruneEmpty(0), 0, "what the index counted, the sidebar showed; it is not swept as empty");
		const next = await store.append(listed[0], { type: "title", title: "Renamed", source: "user" });
		assert.equal(next?.seq, 10, "and its numbering goes on from where the index left it");
	});
});
