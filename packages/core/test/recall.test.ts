/**
 * Reading back what compaction removed from the window.
 *
 * The central test here is the one that runs a session past its context window and then asks for
 * something that was in its very first message. That is the claim the whole compaction design rests
 * on: history leaves the window, it does not leave the session. Without it, summarising aggressively
 * would be a bet that the summary happened to keep whatever turns out to matter — and the safe
 * response to that bet is to summarise as little as possible, which is how a long session becomes
 * unaffordable.
 *
 * Real logs on disk throughout. The thing being tested is whether what was written can be found
 * again, and a fake store answers that question by assuming it.
 */

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import type { AgentEvent } from "../src/agent/events.ts";
import { DEFAULT_SETTINGS, type Settings } from "../src/config/settings.ts";
import { AgentSession } from "../src/runtime/session.ts";
import { SessionStore } from "../src/session/store.ts";
import { recallTool } from "../src/tools/recall.ts";
import type { AssistantMessage, Message, ModelConfig, ProviderConfig, ToolContext } from "../src/types.ts";
import { emptyUsage } from "../src/types.ts";

const MODEL: ModelConfig = {
	id: "fake/model",
	providerId: "fake",
	modelId: "model",
	name: "Fake",
	contextWindow: 2_000,
	maxOutputTokens: 512,
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

/** A turn that does nothing but search its own history — the shape the loop was made of. */
function callRecall(id: string, args: Record<string, unknown>): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "toolCall", id, name: "recall", arguments: args }],
		api: "openai-responses",
		provider: "fake",
		model: "model",
		usage: emptyUsage(),
		stopReason: "toolUse",
		timestamp: Date.now(),
	};
}

/**
 * A window wide enough that compaction stays out of it.
 *
 * The 2k model above exists to *force* compaction, which is what the first test needs and what
 * every test below it would be confused by: a summary landing mid-run changes both the number of
 * messages in the log and what they say, and these are counting matches.
 */
const ROOMY_MODEL: ModelConfig = { ...MODEL, id: "fake/roomy", modelId: "roomy", contextWindow: 400_000 };
const ROOMY: Settings = {
	...SETTINGS,
	providers: [{ ...PROVIDER, models: [MODEL, ROOMY_MODEL] }],
	defaultModelId: ROOMY_MODEL.id,
};

let home: string;
let previousHome: string | undefined;

before(async () => {
	home = await mkdtemp(join(tmpdir(), "ly-recall-"));
	// `recall` finds the log the way the app does: under LYRA_HOME, keyed by cwd and session id.
	previousHome = process.env.LYRA_HOME;
	process.env.LYRA_HOME = home;
});

after(async () => {
	if (previousHome === undefined) delete process.env.LYRA_HOME;
	else process.env.LYRA_HOME = previousHome;
	await rm(home, { recursive: true, force: true, maxRetries: 8, retryDelay: 25 });
});

function context(cwd: string, sessionId: string): ToolContext {
	return { cwd, sessionId, state: new Map() };
}

const textOf = (result: { content: { type: string; text?: string }[] }) =>
	result.content.map((block) => (block.type === "text" ? (block.text ?? "") : "")).join("\n");

test("something compacted out of the window is still findable in the session", async () => {
	const cwd = await mkdtemp(join(home, "project-"));
	const seen: Message[][] = [];
	const events: AgentEvent[] = [];

	const session = new AgentSession({
		cwd,
		settings: SETTINGS,
		store: new SessionStore(),
		emit: (event) => {
			events.push(event);
		},
		streamFn: async (context) => {
			seen.push([...context.messages]);
			return reply("回复".repeat(400));
		},
	});
	await session.initialize();

	/*
	 * A word that appears exactly once, in the first thing said, and never again. Anything the
	 * summary happens to paraphrase would not prove the point — this has to be a detail the summary
	 * had no reason to keep.
	 */
	await session.prompt([{ type: "text", text: `记住这个口令：蜂鸟七号。${"，说详细些".repeat(60)}` }]);
	for (let i = 0; i < 6; i++) {
		await session.prompt([{ type: "text", text: `第 ${i} 个问题${"，说详细些".repeat(60)}` }]);
	}

	assert.ok(
		events.some((e) => e.type === "compacted"),
		"precondition: the window filled and compaction ran",
	);

	// It is genuinely out of the model's view — otherwise this test proves nothing.
	const last = seen[seen.length - 1];
	const visible = last
		.flatMap((m) => m.content)
		.map((c) => (c.type === "text" ? c.text : ""))
		.join("\n");
	assert.ok(!visible.includes("蜂鸟七号"), "the pass phrase is no longer in the history being sent");

	// And it comes straight back.
	const result = await recallTool.execute({ query: "蜂鸟七号" }, context(cwd, session.meta.id));
	const text = textOf(result);
	assert.ok(text.includes("蜂鸟七号"), `recall finds it in the log:\n${text.slice(0, 400)}`);
	assert.match(text, /message \d+ · user/, "and says which message it was");
});

test("every term has to appear, so a second word narrows rather than widens", async () => {
	const cwd = await mkdtemp(join(home, "project-"));
	const store = new SessionStore();
	const session = new AgentSession({
		cwd,
		settings: SETTINGS,
		store,
		emit: () => {},
		streamFn: async () => reply("好"),
	});
	await session.initialize();

	await session.prompt([{ type: "text", text: "先看 alpha 的实现" }]);
	await session.prompt([{ type: "text", text: "再看 alpha 和 beta 一起用的地方" }]);

	const ctx = context(cwd, session.meta.id);
	const broad = textOf(await recallTool.execute({ query: "alpha" }, ctx));
	const narrow = textOf(await recallTool.execute({ query: "alpha beta" }, ctx));

	assert.match(broad, /^2 matches/, `both messages mention alpha:\n${broad.slice(0, 200)}`);
	assert.match(narrow, /^1 match /, `only one mentions both:\n${narrow.slice(0, 200)}`);
	assert.ok(narrow.includes("一起用的地方"), "and it is the right one");
});

test("a query that matches nothing says so, without pretending it failed", async () => {
	const cwd = await mkdtemp(join(home, "project-"));
	const session = new AgentSession({
		cwd,
		settings: SETTINGS,
		store: new SessionStore(),
		emit: () => {},
		streamFn: async () => reply("好"),
	});
	await session.initialize();
	await session.prompt([{ type: "text", text: "随便说点什么" }]);

	const result = await recallTool.execute({ query: "根本没提过的东西" }, context(cwd, session.meta.id));
	assert.ok(!result.isError, "an empty result is an answer, not an error");
	assert.match(textOf(result), /No message in this session contains/);
});

test("a long message is quoted head and tail, not in full", async () => {
	const cwd = await mkdtemp(join(home, "project-"));
	const session = new AgentSession({
		cwd,
		settings: SETTINGS,
		store: new SessionStore(),
		emit: () => {},
		streamFn: async () => reply("好"),
	});
	await session.initialize();

	/*
	 * The point of the cap: recalling must not cost more window than the summary saved, or the
	 * agent learns to be careful with the one tool that makes compaction safe.
	 */
	const long = `开头标记 ${"填充".repeat(3000)} 结尾标记`;
	await session.prompt([{ type: "text", text: long }]);

	const text = textOf(await recallTool.execute({ query: "开头标记" }, context(cwd, session.meta.id)));
	assert.ok(text.includes("开头标记"), "the head is there");
	assert.ok(text.includes("结尾标记"), "and so is the tail");
	assert.match(text, /characters omitted/, "with the middle accounted for");
	assert.ok([...text].length < [...long].length / 2, `and it is much shorter than the message (${[...text].length})`);
});

test("a session with nothing written down yet answers instead of throwing", async () => {
	const cwd = await mkdtemp(join(home, "project-"));
	const result = await recallTool.execute({ query: "任何东西" }, context(cwd, "no-such-session"));
	assert.equal(result.isError, true);
	assert.match(textOf(result), /no transcript on disk/);
});

/*
 * The chase.
 *
 * Recall writes into the log it reads, so before this was fixed every call left two more records
 * containing the very terms just searched for — and the next search found them. The count climbed
 * by exactly two per call, forever, and `slice` from the newest end served the tool its own echo
 * before any history. One real session did this 280 times across an hour and 28M tokens.
 *
 * Driven through a real session rather than by calling `execute` three times, because the bug lives
 * in the gap between the two: `execute` alone never writes anything, and it is the writing that
 * moves the target.
 */
test("recall does not find its own calls, so the hit count stands still", async () => {
	const cwd = await mkdtemp(join(home, "project-"));
	const answers: string[] = [];
	let turn = 0;

	const session = new AgentSession({
		cwd,
		settings: ROOMY,
		store: new SessionStore(),
		emit: (event) => {
			if (event.type === "message_end" && event.message.role === "toolResult" && event.message.toolName === "recall") {
				answers.push(textOf(event.message));
			}
		},
		streamFn: async () => {
			turn += 1;
			return turn <= 3 ? callRecall(`call-${turn}`, { query: "蜂鸟七号" }) : reply("好");
		},
	});
	await session.initialize();
	await session.prompt([{ type: "text", text: "记住这个口令：蜂鸟七号。" }]);

	assert.equal(answers.length, 3, "three searches actually ran");
	const counts = answers.map((text) => Number(/^(\d+) match/.exec(text)?.[1]));
	assert.deepEqual(counts, [1, 1, 1], `only the user's message mentions it, every time — got ${counts.join(", ")}`);
	assert.ok(
		!answers[2].includes('"query"'),
		`and no answer quotes an earlier recall call back:\n${answers[2].slice(0, 300)}`,
	);
});

test("a turn that recalled alongside real work keeps its own words findable", async () => {
	const cwd = await mkdtemp(join(home, "project-"));
	let turn = 0;
	const session = new AgentSession({
		cwd,
		settings: ROOMY,
		store: new SessionStore(),
		emit: () => {},
		streamFn: async () => {
			turn += 1;
			if (turn > 1) return reply("好");
			/*
			 * Text and a recall call in one turn. Only the call is an echo; the sentence beside it is
			 * the model's own and has to stay searchable, or fixing the loop would quietly delete
			 * half the transcript from the index.
			 */
			return {
				...callRecall("mixed-1", { query: "无关" }),
				content: [
					{ type: "text", text: "我的结论是：走 B 方案。" },
					{ type: "toolCall", id: "mixed-1", name: "recall", arguments: { query: "无关" } },
				],
			} as AssistantMessage;
		},
	});
	await session.initialize();
	await session.prompt([{ type: "text", text: "选哪个方案" }]);

	const text = textOf(await recallTool.execute({ query: "B 方案" }, context(cwd, session.meta.id)));
	assert.match(text, /^1 match/, `the assistant's own sentence is still there:\n${text.slice(0, 300)}`);
	assert.ok(text.includes("走 B 方案"), "and it reads back in full");
});

test("offset walks backwards through matches instead of re-serving the newest page", async () => {
	const cwd = await mkdtemp(join(home, "project-"));
	const session = new AgentSession({
		cwd,
		settings: ROOMY,
		store: new SessionStore(),
		emit: () => {},
		streamFn: async () => reply("好"),
	});
	await session.initialize();
	for (let i = 1; i <= 5; i++) await session.prompt([{ type: "text", text: `标记 第${i}条` }]);

	const ctx = context(cwd, session.meta.id);
	const first = textOf(await recallTool.execute({ query: "标记", limit: 2 }, ctx));
	const second = textOf(await recallTool.execute({ query: "标记", limit: 2, offset: 2 }, ctx));

	assert.ok(first.includes("第5条") && first.includes("第4条"), `newest page first:\n${first.slice(0, 300)}`);
	assert.ok(second.includes("第3条") && second.includes("第2条"), `and offset reaches the one behind it:\n${second.slice(0, 300)}`);
	assert.ok(!second.includes("第5条"), "without repeating what was already shown");
});

/*
 * The footer is the whole difference between a walk and a loop.
 *
 * "N older matches not shown; narrow the query to reach them" was true, and pointed the opposite
 * way from where the model wanted to go. Naming the offset that reaches the next page is what lets
 * paging terminate.
 */
test("the footer names the offset that reaches the next page, and says when there is none", async () => {
	const cwd = await mkdtemp(join(home, "project-"));
	const session = new AgentSession({
		cwd,
		settings: ROOMY,
		store: new SessionStore(),
		emit: () => {},
		streamFn: async () => reply("好"),
	});
	await session.initialize();
	for (let i = 1; i <= 4; i++) await session.prompt([{ type: "text", text: `路标 第${i}条` }]);

	const ctx = context(cwd, session.meta.id);
	const page = textOf(await recallTool.execute({ query: "路标", limit: 2 }, ctx));
	assert.match(page, /offset=2/, `it says exactly how to continue:\n${page.slice(-300)}`);

	const last = textOf(await recallTool.execute({ query: "路标", limit: 2, offset: 2 }, ctx));
	assert.match(last, /nothing older to page to/, `and the end is stated, not implied:\n${last.slice(-300)}`);
});

test("paging past the oldest match says so instead of returning the same page again", async () => {
	const cwd = await mkdtemp(join(home, "project-"));
	const session = new AgentSession({
		cwd,
		settings: ROOMY,
		store: new SessionStore(),
		emit: () => {},
		streamFn: async () => reply("好"),
	});
	await session.initialize();
	await session.prompt([{ type: "text", text: "界碑 只有这一条" }]);

	const result = await recallTool.execute({ query: "界碑", offset: 99 }, context(cwd, session.meta.id));
	const text = textOf(result);
	assert.match(text, /past the oldest/, `an offset beyond the end is answered plainly:\n${text.slice(0, 300)}`);
	assert.ok(!text.includes("只有这一条"), "and does not quietly hand back the page it already served");
});

/*
 * An image is findable and not replayable, and saying only the first half is what produced 56
 * calls hunting 「Figure 1 Figure 2」 in one session — a search for something no query could return.
 */
test("a match that carried an image says the image cannot come back", async () => {
	const cwd = await mkdtemp(join(home, "project-"));
	const session = new AgentSession({
		cwd,
		settings: ROOMY,
		store: new SessionStore(),
		emit: () => {},
		streamFn: async () => reply("好"),
	});
	await session.initialize();
	await session.prompt([
		{ type: "text", text: "看这张图 标记图片" },
		{ type: "image", data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", mimeType: "image/png" },
	]);

	const text = textOf(await recallTool.execute({ query: "标记图片" }, context(cwd, session.meta.id)));
	assert.match(text, /carried 1 image/, `the answer accounts for it:\n${text.slice(0, 400)}`);
	assert.match(text, /cannot be replayed/, "and says plainly that searching harder will not produce it");
	assert.match(text, /ask the user to resend/, "and names the only thing that will");
});
