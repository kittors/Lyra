import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { DEFAULT_SETTINGS, SessionStore, AgentSession, type AgentEvent } from "@lyra/core";
import { createStoredSession } from "../electron/create-session.ts";
import { initialPrompt, promptContent, promptOptions } from "../electron/prompt-input.ts";

test("opening submissions have durable distinct identities before any runtime is initialized", async () => {
	const root = await mkdtemp(join(tmpdir(), "lyra-create-"));
	try {
		const store = new SessionStore(join(root, "sessions"));
		const content = promptContent([{ type: "text", text: "同一个问题\n  两个会话" }]);
		const settings = { ...DEFAULT_SETTINGS, worktrees: { ...DEFAULT_SETTINGS.worktrees, autoCreateOnNewSession: true } };
		const [first, second] = await Promise.all([createStoredSession(store, settings, root, "", { content }), createStoredSession(store, settings, root, "", { content })]);
		assert.notEqual(first.meta.id, second.meta.id);
		assert.equal(first.meta.title, "同一个问题 两个会话");
		assert.equal(first.meta.workspaceSetup, "worktree");
		assert.equal((await store.load(first.meta.projectId, first.meta.id))?.messages.length, 1);
		await store.append(first.meta, { type: "title", title: "只改第一个" });
		await store.setArchived(first.meta.projectId, first.meta.id, true);
		assert.equal((await store.load(second.meta.projectId, second.meta.id))?.meta.title, second.meta.title);
		assert.equal((await store.load(second.meta.projectId, second.meta.id))?.meta.archived, undefined);
		await store.delete(first.meta.projectId, first.meta.id);
		assert.equal((await store.listSessions()).length, 1);
	} finally { await rm(root, { recursive: true, force: true }); }
});

test("a persisted opening message is consumed once and abort can cancel its startup", async () => {
	const root = await mkdtemp(join(tmpdir(), "lyra-pending-"));
	try {
		const store = new SessionStore(join(root, "sessions"));
		const saved = await createStoredSession(store, DEFAULT_SETTINGS, root, "", { content: [{ type: "text", text: "opening" }] });
		const events: AgentEvent[] = [];
		const endStarted = Promise.withResolvers<void>();
		const endWritten = Promise.withResolvers<void>();
		const openingWritten = Promise.withResolvers<void>();
		const releaseEnd = Promise.withResolvers<void>();
		const append = store.append.bind(store);
		store.append = async (meta, record) => {
			if (record.type === "event" && record.event.type === "agent_end") { endStarted.resolve(); await releaseEnd.promise; }
			const next = await append(meta, record);
			if (record.type === "meta" && !record.meta.pendingPrompt) openingWritten.resolve();
			if (record.type === "event" && record.event.type === "agent_end") endWritten.resolve();
			return next;
		};
		const session = new AgentSession({ cwd: root, store, settings: { ...DEFAULT_SETTINGS, providers: [] }, meta: saved.meta, emit: (event) => { events.push(event); } });
		session.restore(saved.messages);
		const first = session.resumePendingPrompt();
		assert.equal(session.running, true, "the disk-write interval is already busy");
		assert.equal(session.resumePendingPrompt(), first);
		session.abort();
		let settled = false;
		void first.then(() => { settled = true; });
		try {
			await endStarted.promise;
			await openingWritten.promise;
			await new Promise<void>(resolve => setImmediate(resolve));
			assert.equal(settled, false, "startup cannot finish while its cancellation record is still being written");
		} finally { releaseEnd.resolve(); await first; await endWritten.promise; }
		await first;
		assert.equal(session.running, false);
		assert.equal(events.some((event) => event.type === "notice"), false, "no provider was reached after cancellation");
		assert.ok(events.some(event => event.type === "agent_end" && event.reason === "aborted"));
		assert.equal((await store.load(saved.meta.projectId, saved.meta.id))?.messages.length, 1);
		assert.equal((await store.load(saved.meta.projectId, saved.meta.id))?.meta.pendingPrompt, undefined);
		await session.dispose();
	} finally { await rm(root, { recursive: true, force: true }); }
});

test("prompt boundary rejects malformed payloads and keeps supported image/text content", () => {
	assert.throws(() => initialPrompt({ content: [{ type: "text", text: 4 }] }));
	assert.throws(() => initialPrompt({ content: [], synthetic: "yes" }));
	assert.throws(() => promptOptions({ resumePending: "true" }));
	assert.throws(() => promptOptions({ deliver: "unknown" }));
	assert.deepEqual(initialPrompt({ content: [{ type: "image", data: "eA==", mimeType: "image/png" }] }), { content: [{ type: "image", data: "eA==", mimeType: "image/png" }] });
});

test("presentation metadata is validated on both prompt entry points", () => {
	for (const invalid of [{ displayText: 12 }, { skillRef: { name: "s", path: {} } }, { skillRef: { name: "s", pluginId: [] } }, { sessionRefs: [null] }, { sessionRefs: [{ id: 4, title: "t" }] }]) {
		assert.throws(() => initialPrompt({ content: "hello", ...invalid }));
		assert.throws(() => promptOptions(invalid));
	}
	const metadata = { displayText: "", skillRef: { name: "s", path: "/skills/s.md", pluginId: "p" }, sessionRefs: [{ id: "a", title: "同名" }, { id: "b", title: "同名" }] };
	assert.deepEqual(promptOptions(metadata), metadata);
	assert.deepEqual(initialPrompt({ content: "hello", ...metadata }), { content: [{ type: "text", text: "hello" }], ...metadata });
});

test("附件过这道门时，身份留下、字节留不下", () => {
	/*
	 * 这道门一度只放行 name / kind / mimeType，把 `path` 和 `label` 一并抹掉。
	 *
	 * 抹掉的后果只在发送**之后**才看得见：一条已经发出去的消息，对着自己带的那份表格，右键点上去什
	 * 么都做不了——没有路径就没有「打开」「在访达中显示」「复制路径」，而文件又没有像素可复制，于是
	 * 一行都不剩。界面、类型、发送端三处写的都是对的，只有这一行不知道这两个字段存在。
	 */
	const carried = {
		content: "看看这个",
		attachments: [{ name: "台账.xlsx", kind: "excel", mimeType: "application/vnd.ms-excel", path: "/Users/me/下载/台账.xlsx", label: "表格 1" }],
	};
	assert.deepEqual(initialPrompt(carried)?.attachments, carried.attachments);
	assert.deepEqual(promptOptions(carried).attachments, carried.attachments);

	/*
	 * 字节仍然进不来。
	 *
	 * 正文和像素走 `content`，从这儿混进去的话每条消息都会把一份上千行的文档再存一遍——转录一轮大一
	 * 倍。放行的是「它是什么」，不是「它装了什么」。
	 */
	const sneaked = initialPrompt({ content: "x", attachments: [{ name: "a.md", text: "一整篇正文", data: "eA==" }] });
	assert.deepEqual(sneaked?.attachments, [{ name: "a.md" }]);

	for (const invalid of [{ name: "a", path: 4 }, { name: "a", label: [] }, { name: "  " }, { name: "a", kind: {} }]) {
		assert.throws(() => initialPrompt({ content: "x", attachments: [invalid] }), `本该拒绝：${JSON.stringify(invalid)}`);
	}
});

test("a reference-only opening uses its label and persists both same-title targets", async () => {
	const root = await mkdtemp(join(tmpdir(), "lyra-reference-prompt-"));
	try {
		const store = new SessionStore(join(root, "sessions"));
		const initial = initialPrompt({ content: "reference instructions", displayText: "", sessionRefs: [{ id: "a", title: "同名" }, { id: "b", title: "同名" }] });
		const saved = await createStoredSession(store, DEFAULT_SETTINGS, root, "", initial);
		assert.equal(saved.meta.title, "同名");
		const message = (await store.load(saved.meta.projectId, saved.meta.id))?.messages[0];
		assert.ok(message?.role === "user");
		assert.deepEqual(message.sessionRefs, initial?.sessionRefs);
		assert.equal(message.displayText, "");
	} finally { await rm(root, { recursive: true, force: true }); }
});
