/**
 * Picking the work back up after the connection goes.
 *
 * Two halves, and the second only works because of the first. `continueWhileWorkRemains` starts
 * another turn over the history it already has — and that history is only usable if a reply cut off
 * mid-stream did not leave an opened tool call unanswered in it.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import type { AgentRunResult } from "../src/agent/loop.ts";
import { runAgent } from "../src/agent/loop.ts";
import { continueWhileWorkRemains } from "../src/runtime/continuation.ts";
import { toAnthropicMessages } from "../src/ai/anthropic-messages-request.ts";
import { TODOS_KEY, type TodoItem } from "../src/tools/todo.ts";
import type { AssistantMessage, Message, ModelConfig, ProviderConfig } from "../src/types.ts";
import { emptyUsage } from "../src/types.ts";

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
	api: "anthropic-messages",
	apiKey: "x",
	enabled: true,
	models: [MODEL],
};

function base(): Omit<AssistantMessage, "content"> {
	return {
		role: "assistant",
		api: "anthropic-messages",
		provider: "fake",
		model: "model",
		usage: emptyUsage(),
		stopReason: "stop",
		timestamp: 1,
	};
}

const result = (over: Partial<AgentRunResult>): AgentRunResult => ({ messages: [], reason: "done", ...over });

/** What a lost socket looks like by the time the continuation sees it. */
const dropped = result({ reason: "error", error: "fetch failed (UND_ERR_SOCKET)", retryable: true });

interface Recorded {
	runs: number;
	notices: string[];
	waited: number[];
	resumes: { attempt: number; delayMs: number; reason: string }[];
}

function deps(script: AgentRunResult[], over: Partial<Parameters<typeof continueWhileWorkRemains>[1]> = {}) {
	const seen: Recorded = { runs: 0, notices: [], waited: [], resumes: [] };
	const full: Parameters<typeof continueWhileWorkRemains>[1] = {
		run: async () => script[Math.min(seen.runs++, script.length - 1)],
		messages: () => [],
		todos: () => [],
		aborted: () => false,
		notify: (message) => void seen.notices.push(message),
		resuming: (info) => void seen.resumes.push(info),
		sleep: async (ms) => void seen.waited.push(ms),
		...over,
	};
	return { seen, full };
}

// ---------------------------------------------------------------------------
// Resuming after the connection dies
// ---------------------------------------------------------------------------

test("a turn killed by the connection is picked back up rather than abandoned", async () => {
	const { seen, full } = deps([result({ reason: "done" })]);
	const final = await continueWhileWorkRemains(dropped, full);

	assert.equal(seen.runs, 1, "it went back for the work");
	assert.equal(final.reason, "done");
});

test("what it resumes from is the history, which is where the finished work already is", async () => {
	const history: Message[] = [
		{ role: "user", content: [{ type: "text", text: "do the work" }], timestamp: 1 },
		{ ...base(), content: [{ type: "text", text: "step one done" }] },
	];
	let sent: Message[] = [];
	const { full } = deps([result({ reason: "done" })], {
		messages: () => history,
		run: async (messages) => {
			sent = messages;
			return result({ reason: "done" });
		},
	});
	await continueWhileWorkRemains(dropped, full);

	assert.deepEqual(sent, history, "the second turn starts from everything the first one got through");
});

test("no plan is not a reason to give up, because the network chose where to interrupt", async () => {
	// Unlike running out of rounds, which does consult the plan — a turn can drop before the model
	// has written one at all.
	const { seen, full } = deps([result({ reason: "done" })], { todos: () => [] });
	await continueWhileWorkRemains(dropped, full);

	assert.equal(seen.runs, 1);
});

test("an error that is not the connection is left alone", async () => {
	const rejected = result({ reason: "error", error: "HTTP 401: invalid api key" });
	const { seen, full } = deps([result({ reason: "done" })]);
	const final = await continueWhileWorkRemains(rejected, full);

	assert.equal(seen.runs, 0, "asking again would be told the same thing");
	assert.equal(final.error, "HTTP 401: invalid api key", "and the reason survives to be shown");
});

test("a network that stays down is given up on, not retried forever", async () => {
	const { seen, full } = deps([dropped]);
	const final = await continueWhileWorkRemains(dropped, full);

	assert.equal(seen.runs, 3, "bounded by MAX_RESUMES");
	assert.equal(final.reason, "error", "and the last failure is what is reported");
});

test("the waits grow, because the short ones were already spent inside the request", async () => {
	const { seen, full } = deps([dropped]);
	await continueWhileWorkRemains(dropped, full);

	assert.deepEqual(seen.waited, [5_000, 20_000, 60_000]);
	assert.ok(
		seen.waited.every((ms, i) => i === 0 || ms > seen.waited[i - 1]),
		"each wait is longer than the last",
	);
});

test("the wait is announced before it starts, not after it ends", async () => {
	const order: string[] = [];
	const { full } = deps([result({ reason: "done" })], {
		resuming: () => void order.push("announced"),
		sleep: async () => void order.push("waited"),
		run: async () => {
			order.push("ran");
			return result({ reason: "done" });
		},
	});
	await continueWhileWorkRemains(dropped, full);

	assert.deepEqual(order, ["announced", "waited", "ran"], "a silent minute is the thing being avoided");
});

test("the announcement carries what the running line needs to count down", async () => {
	const { seen, full } = deps([dropped]);
	await continueWhileWorkRemains(dropped, full);

	assert.deepEqual(
		seen.resumes.map((r) => r.attempt),
		[1, 2, 3],
		"numbered against a budget, so 3/3 is visibly the last one",
	);
	assert.deepEqual(
		seen.resumes.map((r) => r.delayMs),
		[5_000, 20_000, 60_000],
		"the delay is what it will actually wait",
	);
	assert.match(seen.resumes[0].reason, /UND_ERR_SOCKET/, "and it carries what went wrong");
});

test("a resume is not also a toast, because a toast expires long before the wait does", async () => {
	const { seen, full } = deps([result({ reason: "done" })]);
	await continueWhileWorkRemains(dropped, full);

	assert.deepEqual(seen.notices, []);
});

test("an alternating connection burns the budget rather than resetting it", async () => {
	// Dies, recovers for one turn, dies again: a network that is not working, and a streak counter
	// would let this run forever.
	const { seen, full } = deps([dropped, dropped, dropped, dropped, dropped]);
	await continueWhileWorkRemains(dropped, full);

	assert.equal(seen.runs, 3);
});

test("stopping during the wait ends the turn rather than leaving it counting down", async () => {
	/*
	 * The one case where continuing anyway is right. The countdown is on the running line, which is
	 * where it has to be to survive a minute — so breaking out silently would leave it there for
	 * good, promising a resume that will never come. A run against an aborted signal sends nothing
	 * and ends immediately, and it is that ending the window is waiting to hear.
	 */
	let stopped = false;
	const { seen, full } = deps([result({ reason: "aborted" })], {
		aborted: () => stopped,
		sleep: async () => {
			stopped = true;
		},
	});
	const final = await continueWhileWorkRemains(dropped, full);

	assert.equal(seen.runs, 1, "so that something ends the turn properly");
	assert.equal(final.reason, "aborted");
});

test("stopping is not the start of another resume", async () => {
	let stopped = false;
	const { seen, full } = deps([dropped], {
		aborted: () => stopped,
		sleep: async () => {
			stopped = true;
		},
	});
	await continueWhileWorkRemains(dropped, full);

	// Even though that run came back as a dropped connection too, the loop stops at the top.
	assert.equal(seen.resumes.length, 1, "one wait was announced, and no more after the stop");
	assert.equal(seen.runs, 1);
});

test("the wait can be cut short, so stop is felt at once rather than in a minute", async () => {
	// The default sleep, with a signal — the path a real turn takes.
	const controller = new AbortController();
	const { seen, full } = deps([result({ reason: "aborted" })], {
		aborted: () => controller.signal.aborted,
		signal: controller.signal,
		sleep: undefined,
	});
	const started = process.hrtime.bigint();
	const waiting = continueWhileWorkRemains(dropped, full);
	/*
	 * Let the wait actually begin. Aborting before it starts takes the already-stopped short
	 * circuit, which passes this test while proving nothing about interrupting a timer that is
	 * running — the case the user is in when they press stop.
	 */
	await new Promise((resolve) => setTimeout(resolve, 25));
	assert.equal(seen.runs, 0, "still waiting at this point, not running");
	controller.abort();
	await waiting;
	const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;

	assert.ok(elapsedMs < 1_000, `the 5s wait was abandoned, not served (took ${Math.round(elapsedMs)}ms)`);
	assert.equal(seen.runs, 1);
});

test("running out of rounds still behaves as it did", async () => {
	const capped = result({ reason: "max_turns" });
	const unfinished: TodoItem[] = [{ content: "step", status: "pending" }];
	const { seen, full } = deps([result({ reason: "done" })], { todos: () => unfinished });
	await continueWhileWorkRemains(capped, full);

	assert.equal(seen.runs, 1);
	assert.deepEqual(seen.waited, [], "and it does not wait, because nothing is broken");
	assert.match(seen.notices[0], /步数用尽/);
});

test("running out of rounds with the plan complete still stops", async () => {
	const { seen, full } = deps([result({ reason: "done" })], { todos: () => [] });
	await continueWhileWorkRemains(result({ reason: "max_turns" }), full);

	assert.equal(seen.runs, 0);
});

/*
 * 清单上一项都没打勾的续跑，最多给一次。
 *
 * 真实案例：2026-09-15 的 `86ff1d52` 跑了 396 轮、5.32 小时、36.9M token、$10.72，计划始终停在
 * 0/4。当时的条件只问「还有没有没做完的」，而清单是模型自己写的，探索中只增不减，于是永远为真。
 * 重复看门狗也没有拦住它——那 396 次调用里有 384 个不同指纹，它没有任何东西可抓。
 */
test("rounds that finish nothing twice over stop rather than continuing", async () => {
	// 四项，一项都没打勾——两轮下来还是一项都没打勾。
	const stuck: TodoItem[] = [
		{ content: "a", status: "in_progress" },
		{ content: "b", status: "pending" },
		{ content: "c", status: "pending" },
		{ content: "d", status: "pending" },
	];
	const { seen, full } = deps([result({ reason: "max_turns" }), result({ reason: "max_turns" }), result({ reason: "max_turns" })], {
		todos: () => stuck,
	});

	await continueWhileWorkRemains(result({ reason: "max_turns" }), full);

	assert.equal(seen.runs, 1, "第一次零进展还给一次机会，第二次就该停——不是 10 次");
	assert.match(seen.notices[seen.notices.length - 1], /一项都没完成/);
});

test("rounds that keep finishing things keep going", async () => {
	/*
	 * 打勾数每轮 +1：这是真的长任务，不该被上面那条闸误伤。
	 *
	 * 没有这条，上面那条测试可以靠「永远停在第一次续跑」通过——而那会把每一个超过两百步的正经
	 * 任务砍在半路。
	 */
	let ticked = 0;
	const { seen, full } = deps(
		[result({ reason: "max_turns" }), result({ reason: "max_turns" }), result({ reason: "done" })],
		{
			todos: () => [
				{ content: "a", status: ticked > 0 ? "completed" : "pending" },
				{ content: "b", status: ticked > 1 ? "completed" : "pending" },
				{ content: "c", status: ticked > 2 ? "completed" : "pending" },
				{ content: "d", status: "pending" },
			],
			run: async () => {
				ticked += 1;
				return [result({ reason: "max_turns" }), result({ reason: "max_turns" }), result({ reason: "done" })][
					Math.min(seen.runs++, 2)
				];
			},
		},
	);

	await continueWhileWorkRemains(result({ reason: "max_turns" }), full);

	assert.equal(seen.runs, 3, "每一轮都打上了勾，就一直继续到它自己说做完了");
	assert.ok(
		!seen.notices.some((notice) => /一项都没完成/.test(notice)),
		"有进展的轮次不该收到停下来的通知",
	);
});

// ---------------------------------------------------------------------------
// The history it resumes from has to be one the provider will accept
// ---------------------------------------------------------------------------

const interrupted = (stopReason: "error" | "aborted"): AssistantMessage => ({
	...base(),
	stopReason,
	...(stopReason === "error" ? { errorMessage: "fetch failed (UND_ERR_SOCKET)", errorRetryable: true } : {}),
	// Half a call: the stream carried the name and then stopped.
	content: [{ type: "toolCall", id: "call-1", name: "write_file", arguments: {}, argumentsText: '{"path":' }],
});

async function runInterrupted(stopReason: "error" | "aborted") {
	return runAgent(
		{
			sessionId: "test",
			cwd: "/tmp",
			provider: PROVIDER,
			model: MODEL,
			systemPrompt: "",
			tools: [],
			messages: [{ role: "user", content: [{ type: "text", text: "write the file" }], timestamp: 1 }],
			state: new Map<string, unknown>([[TODOS_KEY, []]]),
			streamFn: async () => interrupted(stopReason),
		},
		() => {},
	);
}

for (const stopReason of ["error", "aborted"] as const) {
	test(`a call cut off by ${stopReason} is answered, so the history stays sendable`, async () => {
		const run = await runInterrupted(stopReason);
		const answer = run.messages.find((m) => m.role === "toolResult" && m.toolCallId === "call-1");

		assert.ok(answer, "the opened call was closed");
		assert.equal(answer.role === "toolResult" && answer.isError, true, "and closed as a failure, not a result");
	});

	test(`the ${stopReason} history is one Anthropic will accept`, async () => {
		/*
		 * The reason this matters at all: an unanswered `tool_use` is a 400 on every later request,
		 * so one dropped socket would take the whole conversation with it — including the resume.
		 */
		const run = await runInterrupted(stopReason);
		const wire = toAnthropicMessages(run.messages);

		let checked = 0;
		for (const [index, message] of wire.entries()) {
			for (const block of message.content) {
				if (block.type !== "tool_use") continue;
				checked += 1;
				const next = wire[index + 1];
				assert.ok(
					next?.role === "user" && next.content.some((b) => b.type === "tool_result" && b.tool_use_id === block.id),
					`tool_use ${String(block.id)} has no tool_result after it`,
				);
			}
		}
		// Without this the loop above passes by finding nothing, which is the one way it could be
		// green while the bug is present.
		assert.equal(checked, 1, "the half-sent call is still in the history — answered, not deleted");
	});
}

test("an interrupted call is failed rather than run, since its arguments never finished arriving", async () => {
	const run = await runInterrupted("error");
	const answer = run.messages.find((m) => m.role === "toolResult");
	const text = answer?.content.map((c) => (c.type === "text" ? c.text : "")).join("") ?? "";

	assert.match(text, /was not executed/);
	assert.match(text, /connection dropped/, "and it says why, so the model can decide to re-issue it");
});

test("a dropped connection is reported as one worth going back for", async () => {
	const run = await runInterrupted("error");

	assert.equal(run.reason, "error");
	assert.equal(run.retryable, true, "which is what lets the continuation tell it from a rejected key");
});

test("a turn the user stopped is not something to resume", async () => {
	const run = await runInterrupted("aborted");

	assert.equal(run.reason, "aborted");
	assert.equal(run.retryable, undefined);
});

test("a configured request budget cannot be restarted by outer continuation", async () => {
	const { seen, full } = deps([result({ reason: "done" })], { requestRetriesHandled: true });
	const final = await continueWhileWorkRemains(dropped, full);
	assert.equal(final, dropped);
	assert.equal(seen.runs, 0); assert.deepEqual(seen.waited, []);
});
