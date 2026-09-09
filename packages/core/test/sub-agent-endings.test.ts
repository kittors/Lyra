/**
 * The four ways a delegated run can stop, and what each of them hands back.
 *
 * Only one of them used to be told apart. `runTurn` reports why it stopped and `runSubAgent` never
 * read it, so a run that used up its rounds, went in circles or lost the provider mid-request was
 * filed as `done` — with an empty answer, because the fallback prose read the last message and the
 * last message of a run cut off partway is a bare tool call. What reached the parent was
 * `(the sub-agent returned no output)`; what reached the roster was a green tick. Four sub-agents,
 * half an hour each, and nothing to show for them or to say why.
 *
 * So every test here asserts two things about one ending: that the parent is told what happened,
 * and that whatever the run had worked out by then travels with it. The clean and aborted paths are
 * in here too, as the regression half — the fix must not turn an ordinary finish into a warning.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { MAX_SUB_AGENT_TURNS, runSubAgent } from "../src/runtime/sub-agent.ts";
import { SubAgentRegistry } from "../src/runtime/sub-agents.ts";
import type { AgentDefinition } from "../src/agents-builtin.ts";
import type { AgentEvent } from "../src/agent/events.ts";
import type { AssistantMessage, ModelConfig, ProviderConfig, Settings, Tool } from "../src/types.ts";
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
	api: "openai-responses",
	apiKey: "x",
	enabled: true,
	models: [MODEL],
};

/** Shaped like the built-in `explore`: a declared output, so delivery means calling `yield`. */
const EXPLORE: AgentDefinition = {
	name: "explore",
	description: "只读搜索",
	systemPrompt: "read-only",
	tools: ["read"],
	source: "builtin",
	output: {
		type: "object",
		required: ["summary", "files"],
		properties: { summary: { type: "string" }, files: { type: "array", items: { type: "object" } } },
	},
};

const read: Tool = {
	name: "read",
	snippet: "reads",
	description: "reads",
	parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
	summarize: () => "读了一个文件",
	async execute() {
		return { content: [{ type: "text", text: "ok" }] };
	},
};

function assistant(parts: AssistantMessage["content"], stopReason: AssistantMessage["stopReason"] = "toolUse"): AssistantMessage {
	return {
		role: "assistant",
		api: "openai-responses",
		provider: "fake",
		model: "model",
		usage: emptyUsage(),
		stopReason,
		timestamp: Date.now(),
		content: parts,
	};
}

const says = (text: string) => assistant([{ type: "text", text }], "stop");
/** `n` varies the arguments, so the repetition watch does not call this stuck. */
const looks = (n: number, text?: string) =>
	assistant([
		...(text ? [{ type: "text" as const, text }] : []),
		{ type: "toolCall" as const, id: `c${n}`, name: "read", arguments: { at: n }, argumentsText: `{"at":${n}}` },
	]);
/** Same arguments every time, which is what the repetition watch is looking for. */
const stuck = (n: number) =>
	assistant([{ type: "toolCall", id: `c${n}`, name: "read", arguments: {}, argumentsText: "{}" }]);
const yields = (n: number, value: Record<string, unknown>) =>
	assistant([{ type: "toolCall", id: `y${n}`, name: "yield", arguments: value, argumentsText: JSON.stringify(value) }]);

function broke(message = "HTTP 502 上游服务端故障"): AssistantMessage {
	return { ...assistant([], "error"), errorMessage: message, errorRetryable: true };
}

async function dispatch(options: {
	/** `tools` 是这一轮桌上有什么——只剩 `yield` 的那一轮就是讨要交付的那一轮。 */
	reply: (turn: number, tools: string[]) => AssistantMessage;
	signal?: AbortSignal;
	onTurn?: (turn: number, registry: SubAgentRegistry, id: string) => void;
}) {
	const registry = new SubAgentRegistry();
	const events: AgentEvent[] = [];
	let turn = 0;

	const answer = await runSubAgent(
		{
			sessionId: "s1",
			cwd: "/tmp",
			settings: { thinking: "off", retryAttempts: 0 } as unknown as Settings,
			tools: [read],
			skills: [],
			agents: [EXPLORE],
			signal: options.signal,
			registry,
			requestApproval: async () => "allow",
			emit: async (event) => {
				events.push(event);
			},
			streamFn: async (context) => {
				options.onTurn?.(turn, registry, registry.list()[0]?.id ?? "");
				return options.reply(turn++, context.tools.map((one) => one.name));
			},
		},
		{ description: "分析后端基础与认证", prompt: "去分析", agentType: "explore" },
		PROVIDER,
		MODEL,
		"",
	);

	const done = events.find((event) => event.type === "subagent_done");
	return { answer, registry, record: registry.list()[0], done, turns: turn };
}

test("a clean finish is unchanged: the report, and nothing said about it", async () => {
	// The regression half. Every warning below is only worth having if this one stays quiet.
	const { answer, record, done } = await dispatch({ reply: () => says("在 auth.ts:42") });

	assert.equal(answer.text, "在 auth.ts:42");
	assert.equal(record.status, "done");
	assert.equal(record.error, undefined);
	assert.ok(!answer.text.includes("⚠"), "a run that finished has nothing to warn about");
	assert.equal(record.incomplete, undefined, "and nothing for the pane to mark either");
	assert.equal(done?.type === "subagent_done" ? done.status : null, "done");
});

test("running out of rounds is asked once more for a delivery, and that delivery is the answer", async () => {
	/*
	 * The one that produced the report. Four of these ran for half an hour each, hit the cap, and
	 * came back as an empty string filed under `done` — with everything they had found still in
	 * their heads and one `yield` call away.
	 *
	 * So the cap is not the end any more: the tools come off the table, `yield` stays, and it is
	 * told to hand over what it has. Which is exactly what the fixture does when it sees a
	 * one-tool round.
	 */
	const { answer, record, turns } = await dispatch({
		reply: (turn, tools) =>
			tools.length === 1 && tools[0] === "yield"
				? yields(turn, { summary: "登录在 auth.ts:42", files: [{ path: "auth.ts", why: "入口" }] })
				: looks(turn, `第 ${turn + 1} 轮：在看 auth.ts`),
	});

	assert.ok(turns > MAX_SUB_AGENT_TURNS, `the cap was reached and one more round was spent asking (${turns})`);
	assert.ok(answer.text.includes("登录在 auth.ts:42"), `the delivery came back: ${answer.text}`);
	assert.deepEqual(answer.output, { summary: "登录在 auth.ts:42", files: [{ path: "auth.ts", why: "入口" }] }, "as an object too");
	assert.ok(answer.text.includes("补交"), "and it is labelled as a delivery it was pressed for, not a finished piece of work");
	assert.equal(record.status, "done");
	assert.equal(record.answer, answer.text, "the pane and the parent are told the same thing");
	assert.equal(record.incomplete, true, "pressed for it, so the pane says so — the leading ⚠ is stripped before it reaches the screen");
});

test("the salvage round has nothing on the table but yield", async () => {
	// 这一条是上面那条的机制：不把别的工具拿走，它会接着去读下一个文件，然后这一轮也白花。
	const rounds: string[][] = [];
	await dispatch({
		reply: (turn, tools) => {
			rounds.push(tools);
			return tools.length === 1 ? yields(turn, { summary: "好了", files: [] }) : looks(turn, "看着");
		},
	});

	assert.deepEqual(rounds.at(-1), ["yield"], `最后一轮只该剩 yield，实际是 ${JSON.stringify(rounds.at(-1))}`);
	assert.ok(rounds[0].includes("read"), "而正常轮次里它照常有自己的工具");
});

test("a run that will not deliver even when pressed still says what happened", async () => {
	/*
	 * 讨要不是保证。模型可能道个歉就完了——那正是这一整条链最初的失败模式，所以要确认兜底还在：
	 * 说清楚步数用尽，并把它最后说过的话交上去。
	 */
	const { answer, record } = await dispatch({
		reply: (turn, tools) => (tools.length === 1 ? says("抱歉，时间不够了") : looks(turn, `第 ${turn + 1} 轮：在看 auth.ts`)),
	});

	assert.ok(answer.text.includes(`用满了 ${MAX_SUB_AGENT_TURNS} 步`), `the cause is named: ${answer.text}`);
	assert.ok(!answer.text.includes("补交"), "没交出来就不能说成补交了");
	assert.ok(answer.text.includes("抱歉，时间不够了"), "最后说的那句仍然要交上去");
	assert.equal(record.status, "done", "it did the work, it just did not get to the end of it");
});

test("a run cut off mid-tool-call still reports the last thing it said", async () => {
	/*
	 * The bug inside the bug: the fallback read the *last* assistant message, and a run that is
	 * stopped from outside almost always ends on a tool call with no text in it.
	 */
	const { answer } = await dispatch({
		reply: (turn) => (turn === 0 ? looks(0, "读完了 auth.ts，登录在 42 行") : looks(turn)),
	});

	assert.ok(answer.text.includes("登录在 42 行"), `walked back to the newest prose: ${answer.text}`);
});

test("going in circles is reported as going in circles, not as finishing", async () => {
	const { answer, record, turns } = await dispatch({ reply: (turn) => (turn === 0 ? looks(0, "先看一眼") : stuck(turn)) });

	assert.ok(turns < MAX_SUB_AGENT_TURNS, "the repetition watch stopped it early");
	assert.ok(answer.text.includes("反复用同样的参数"), `the cause is named: ${answer.text}`);
	assert.equal(record.incomplete, true);
	assert.ok(answer.text.includes("先看一眼"), "and what it had said is still delivered");
	assert.equal(record.status, "done");
});

test("a provider that failed is recorded as failed, with the work it had done attached", async () => {
	const { answer, record, done } = await dispatch({
		reply: (turn) => (turn === 0 ? looks(0, "读完了 auth.ts") : broke()),
	});

	assert.equal(record.status, "failed", "this one is a failure — and it is what puts 重新派发 on the pane");
	assert.match(record.error ?? "", /502/);
	assert.match(answer.text, /模型服务出错/);
	assert.match(answer.text, /502/, "the parent decides whether to retry, so it needs to see what broke");
	assert.ok(answer.text.includes("读完了 auth.ts"), "half an hour of work is not thrown away with the connection");
	assert.equal(record.incomplete, true, "failed and partial are different facts; the pane shows both");
	assert.equal(done?.type === "subagent_done" ? done.status : null, "failed");
	assert.match(done?.type === "subagent_done" ? (done.error ?? "") : "", /502/);
});

test("a yielded object that renders to nothing is not a delivery", async () => {
	/*
	 * The schema check asks whether the required fields are present and typed, not whether they
	 * were filled in — so `{ summary: "", files: [] }` is accepted, and renders to an empty string.
	 * Without the fallback that is another silent empty answer, this time from a run that did
	 * everything it was told to.
	 */
	const { answer } = await dispatch({
		reply: (turn) => (turn === 0 ? yields(0, { summary: "", files: [] }) : says("没找到能确定的东西，认证那块看不到入口")),
	});

	assert.ok(answer.text.includes("认证那块看不到入口"), `fell back to what it said: ${answer.text}`);
});

test("a real yield still wins over the prose beside it", async () => {
	// The other half of the line above: the fallback must not start overruling actual deliveries.
	const { answer } = await dispatch({
		reply: (turn) =>
			turn === 0 ? yields(0, { summary: "登录在 auth.ts:42", files: [{ path: "auth.ts", why: "入口" }] }) : says("说完了"),
	});

	assert.ok(answer.text.startsWith("登录在 auth.ts:42"), `the yielded object is the answer: ${answer.text}`);
	assert.deepEqual(answer.output, { summary: "登录在 auth.ts:42", files: [{ path: "auth.ts", why: "入口" }] });
});

test("pressing stop is still not a failure, and still says nothing about rounds", async () => {
	const { record, answer } = await dispatch({
		reply: (turn) => looks(turn, `第 ${turn} 轮`),
		onTurn: (turn, registry, id) => {
			if (turn === 1) registry.abort(id);
		},
	});

	assert.equal(record.status, "aborted");
	assert.ok(!answer.text.includes("⚠"), "a button the user pressed is not an incident to report");
	assert.equal(record.incomplete, undefined);
});
