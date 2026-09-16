/**
 * What the session log keeps.
 *
 * The transcript is only half the record: the same messages behave differently under a different
 * system prompt or tool set, and a delegated turn happens entirely out of view. These tests hold
 * the line that both are written down, and that the first one is not rewritten every turn.
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { DEFAULT_SETTINGS, type Settings } from "../src/config/settings.ts";
import { AgentSession } from "../src/runtime/session.ts";
import { SessionStore, type SessionRecord } from "../src/session/store.ts";
import type { AssistantMessage, ModelConfig, ProviderConfig } from "../src/types.ts";
import { emptyUsage } from "../src/types.ts";
import { controlMainTool } from "../src/runtime/sidechat-controls.ts";
import { TODOS_KEY } from "../src/tools/todo.ts";

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

function reply(text: string): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		api: "openai-responses",
		provider: "fake",
		model: "model",
		usage: emptyUsage(),
		stopReason: "stop",
		timestamp: Date.now(),
	};
}

async function harness(script?: (turn: number) => AssistantMessage | Promise<AssistantMessage>) {
	const root = await mkdtemp(join(tmpdir(), "ly-log-"));
	/*
	 * A home of its own, so the assertions are about this test and not about this machine.
	 *
	 * A session loads the user's global skills as well as the workspace's, so `~/.lyra/skills`
	 * was part of every context these tests measured. Installing a skill collection therefore
	 * broke the suite — and `pnpm test` is in the pre-push hook, so using the app as intended
	 * stopped you pushing to it.
	 */
	const home = join(root, "home");
	await mkdir(home, { recursive: true });
	process.env.LYRA_HOME = home;
	let turn = 0;
	const store = new SessionStore(join(root, "sessions"));
	const session = new AgentSession({
		cwd: root,
		settings: SETTINGS,
		store,
		emit: () => {},
		streamFn: async () => script?.(turn++) ?? reply("ok"),
	});
	await session.initialize();

	return {
		session,
		root,
		/** Everything on disk, so the assertions are about the file rather than about memory. */
		async records(): Promise<SessionRecord[]> {
			const out: SessionRecord[] = [];
			for await (const record of store.read(session.meta.projectId, session.meta.id)) out.push(record);
			return out;
		},
		cleanup: async () => {
			await session.dispose();
			delete process.env.LYRA_HOME;
			await rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 25 });
		},
	};
}

test("explicit cancellation clears the plan durably without making another model request", async () => {
	let requests = 0;
	const h = await harness(() => { requests++; return reply("ok"); });
	try {
		h.session.can.state.set(TODOS_KEY, [{ content: "old work", status: "in_progress" }]);
		await controlMainTool(h.session).execute({ action: "pause", discardPlan: true }, { cwd: h.root, sessionId: h.session.meta.id, state: new Map() });
		assert.equal(h.session.can.state.has(TODOS_KEY), false);
		assert.equal(requests, 0);
		assert.ok((await h.records()).some((record) => record.type === "message" && record.message.role === "user" && record.message.clearsTaskPlan));
	} finally { await h.cleanup(); }
});

test("all runtime stop reasons survive on disk independently of model stopReason", async () => {
	const h = await harness();
	try {
		const reasons = ["done", "aborted", "error", "max_turns", "stalled"] as const;
		for (const reason of reasons) await h.session.log.emit({ type: "agent_end", reason });
		const recorded = (await h.records()).flatMap((record) => record.type === "event" && record.event.type === "agent_end" ? [record.event.reason] : []);
		assert.deepEqual(recorded, [...reasons]);
	} finally { await h.cleanup(); }
});

test("the context the model was given is written down, once", async () => {
	const h = await harness();
	try {
		await h.session.prompt([{ type: "text", text: "hello" }]);
		await h.session.prompt([{ type: "text", text: "again" }]);

		const contexts = (await h.records()).filter((r) => r.type === "event" && r.event.type === "context");
		assert.equal(contexts.length, 1, "an unchanged context is not rewritten every turn");

		const first = contexts[0];
		assert.equal(first.type, "event");
		if (first.type !== "event" || first.event.type !== "context") throw new Error("wrong record");
		assert.match(first.event.systemPrompt, /Lyra/, "the prompt itself is kept, not a hash of it");
		assert.ok(first.event.tools.includes("bash"), "and which tools it could reach");
		assert.deepEqual([...first.event.tools].sort(), first.event.tools, "recorded in a stable order");
		assert.ok(first.event.schemas?.some(tool => tool.name === "bash" && tool.parameters), "the actual tool schemas survive a restart");
		const requests = (await h.records()).filter(record => record.type === "event" && record.event.type === "request");
		assert.equal(requests.length, 2, "each model invocation has a durable start boundary");
	} finally {
		await h.cleanup();
	}
});

test("a changed context is written again", async () => {
	const h = await harness();
	try {
		await h.session.prompt([{ type: "text", text: "hello" }]);

		// A skill appearing mid-session is exactly the kind of change the log must not miss: the
		// same messages, a different set of things the model could have done about them.
		const dir = join(h.root, ".lyra", "skills", "greet");
		await mkdir(dir, { recursive: true });
		await writeFile(join(dir, "SKILL.md"), "---\nname: greet\ndescription: Say hello\n---\n\nSay hello.\n");
		await h.session.initialize();

		await h.session.prompt([{ type: "text", text: "again" }]);

		const contexts = (await h.records()).filter((r) => r.type === "event" && r.event.type === "context");
		assert.equal(contexts.length, 2, "the second turn ran under a different context");
		const second = contexts[1];
		if (second.type !== "event" || second.event.type !== "context") throw new Error("wrong record");
		assert.deepEqual(second.event.skills, ["greet"]);
	} finally {
		await h.cleanup();
	}
});

test("a delegated turn is written down: what it was sent, what it did, what it said", async () => {
	const h = await harness((turn) => {
		// Turn 0 is the parent delegating; turn 1 is the sub-agent answering; turn 2 the parent
		// closing out. Only the first needs to be a tool call for the rest to follow.
		if (turn > 0) return reply(turn === 1 ? "the cache is cold on every build" : "done");
		return {
			...reply(""),
			content: [
				{
					type: "toolCall",
					id: "call_1",
					name: "task",
					arguments: { description: "why builds are slow", prompt: "Find out why the build is slow.", subagent_type: "explore" },
				},
			],
			stopReason: "toolUse",
		};
	});

	try {
		await h.session.prompt([{ type: "text", text: "why is the build slow" }]);
		const records = await h.records();

		const start = records.find((r) => r.type === "event" && r.event.type === "subagent");
		if (start?.type !== "event" || start.event.type !== "subagent") throw new Error("no dispatch record");
		assert.equal(start.event.agent, "explore");
		assert.equal(start.event.prompt, "Find out why the build is slow.");
		assert.ok(!start.event.tools.includes("write"), "and the narrower tool set it was given");
		const childId = start.event.id;

		const end = records.find((r) => r.type === "event" && r.event.type === "subagent_done");
		if (end?.type !== "event" || end.event.type !== "subagent_done") throw new Error("no result record");
		assert.equal(end.event.id, start.event.id, "the two halves are joinable");
		assert.equal(end.event.answer, "the cache is cold on every build");
		const messages = records.filter(record => record.type === "event" && record.event.type === "subagent_message" && record.event.id === childId);
		assert.ok(messages.some(record => record.type === "event" && record.event.type === "subagent_message" && record.event.message.role === "assistant"), "the child transcript is durable, not just its final summary");
		for (const type of ["request", "context", "turn_start"]) {
			assert.ok(records.some(record => record.type === "event" && record.event.type === "subagent_event" && record.event.id === childId && record.event.event.type === type), `child ${type} retains its scope`);
		}
	} finally {
		await h.cleanup();
	}
});

test("a history read back from disk is adopted, not appended again", async () => {
	const h = await harness();
	try {
		await h.session.prompt([{ type: "text", text: "hello" }]);
		const before = (await h.records()).filter((r) => r.type === "message").length;
		const history = [...h.session.messages];

		/*
		 * What the hosts do on every reconnect: build a session around the stored meta, then hand
		 * it the transcript that was read off disk. These messages are already in the log — that
		 * is where they came from — so adopting them must not write a second copy of each.
		 */
		h.session.restore(history);

		assert.deepEqual(h.session.messages, history, "the transcript is what was handed over");
		assert.equal(
			(await h.records()).filter((r) => r.type === "message").length,
			before,
			"and nothing was written again",
		);

		// The next real message still lands, so adopting a history does not wedge the log shut.
		await h.session.prompt([{ type: "text", text: "again" }]);
		assert.equal((await h.records()).filter((r) => r.type === "message").length, before + 2);
	} finally {
		await h.cleanup();
	}
});

test("discarding an active plan suppresses a late tool response and leaves no resumable old dispatch", async () => {
	let begin!: () => void, finish!: (message: AssistantMessage) => void;
	const started = new Promise<void>(resolve => { begin = resolve; });
	const delayed = new Promise<AssistantMessage>(resolve => { finish = resolve; });
	const h = await harness(() => { begin(); return delayed; });
	try {
		h.session.can.state.set(TODOS_KEY, [{ content: "old", status: "in_progress" }]);
		await h.session.enqueueTask("old dispatch"); await started;
		const cancellation = h.session.discardTaskPlan();
		finish({ ...reply(""), stopReason: "toolUse", content: [{ type: "toolCall", id: "late", name: "todo_write", arguments: { todos: [{ content: "late old work", status: "pending" }] } }] });
		await cancellation;
		assert.equal(h.session.running, false);
		assert.equal(h.session.can.state.has(TODOS_KEY), false);
		assert.equal(h.session.interruptedTask(), null);
		assert.equal(h.session.taskQueue[0]?.cancelledBy, "user");
		const records = await h.records();
		assert.ok(records.some(record => record.type === "message" && record.message.role === "user" && record.message.clearsTaskPlan));
	} finally { await h.cleanup(); }
});
