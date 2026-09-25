/**
 * 一轮中途换模型，从下一个请求起就换；卡在重试上的请求当场放手。
 *
 * 反馈原话：「对话 a 以模型 a 请求发出去之后，一直响应有问题（上游问题），我就在对话框的位置切模型
 * b……这时请求的还是之前的模型 a」。真窗口里量出来的（`e2e/edit-resend-model-probe.ts`）：输入框上
 * 已经写着 Model B，服务器在接下来的 3.5 秒里收到的是 a、a、a、a——一轮开始时拿到的模型用到这一轮
 * 结束，而上游重试设成「一直重试到取消」时，这一轮永远不会自己结束。
 *
 * 会话那两条走真实适配器和一个本地服务器：卡在重试上的那一段等待发生在适配器里面，替身模型够不着。
 */

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";

import { runAgent, type LiveModel } from "../src/agent/loop.ts";
import type { AgentEvent } from "../src/agent/events.ts";
import { DEFAULT_SETTINGS } from "../src/config/settings.ts";
import { AgentSession } from "../src/runtime/session.ts";
import { SessionStore } from "../src/session/store.ts";
import type { AssistantMessage, Message, ModelConfig, ProviderConfig, Tool } from "../src/types.ts";
import { emptyUsage } from "../src/types.ts";

const model = (id: string, name: string): ModelConfig => ({
	id: `t/${id}`, providerId: "t", modelId: id, name, contextWindow: 100_000,
	maxOutputTokens: 1024, supportsThinking: false, supportsImages: false, supportsTools: true,
});
const A = model("model-a", "Model A");
const B = model("model-b", "Model B");

// ---------------------------------------------------------------------------
// 会话：真实适配器 + 本地服务器
// ---------------------------------------------------------------------------

let server: Server;
let base = "";
/** 服务器按到达顺序收到的模型。 */
let hits: string[] = [];
/** 模型 a 的回答方式：`broken` 一直 502；`slow` 先吐一个字，停一会儿再说完。 */
let aMode: "broken" | "slow" = "broken";

const sse = (text: string) =>
	[
		`data: {"choices":[{"index":0,"delta":{"role":"assistant","content":${JSON.stringify(text)}},"finish_reason":null}]}`,
		`data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}`,
		"data: [DONE]",
	].join("\n\n") + "\n\n";

before(async () => {
	server = createServer((req, res) => {
		let raw = "";
		req.on("data", (chunk) => (raw += chunk));
		req.on("end", () => {
			const wanted = (JSON.parse(raw) as { model?: string }).model ?? "?";
			hits.push(wanted);
			if (wanted === "model-a" && aMode === "broken") {
				res.writeHead(502, { "content-type": "application/json" });
				res.end(JSON.stringify({ error: { message: "upstream exploded" } }));
				return;
			}
			if (wanted === "model-a" && aMode === "slow") {
				res.writeHead(200, { "content-type": "text/event-stream" });
				res.write(`data: {"choices":[{"index":0,"delta":{"role":"assistant","content":"a 正在说"},"finish_reason":null}]}\n\n`);
				setTimeout(() => {
					res.end(`data: {"choices":[{"index":0,"delta":{"content":"，说完了"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n`);
				}, 1500);
				return;
			}
			res.writeHead(200, { "content-type": "text/event-stream" });
			res.end(sse(`这一句是 ${wanted} 回答的`));
		});
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => new Promise<void>((resolve) => server.close(() => resolve())));

async function session() {
	const root = await mkdtemp(join(tmpdir(), "ly-live-model-"));
	process.env.LYRA_HOME = join(root, "home");
	const provider: ProviderConfig = { id: "t", name: "T", baseUrl: base, api: "openai-chat-completions", apiKey: "x", enabled: true, models: [A, B] };
	// 跟反馈者本机一样：上游坏了就一直重试，直到有人取消。间隔取允许的最短一秒。
	const forever = { retries: null, strategy: "fixed", intervalMs: 1000, maxIntervalMs: 1000 };
	const events: AgentEvent[] = [];
	const agent = new AgentSession({
		cwd: root,
		store: new SessionStore(join(root, "sessions")),
		settings: {
			...DEFAULT_SETTINGS,
			providers: [provider],
			defaultModelId: A.id,
			autoSummarizeTitle: false,
			retryPolicy: { network: forever, upstream: forever },
		} as typeof DEFAULT_SETTINGS,
		emit: async (event) => {
			events.push(event);
		},
	});
	await agent.initialize();
	return { agent, events, cleanup: async () => { await agent.dispose(); await rm(root, { recursive: true, force: true }); } };
}

const until = async (ready: () => boolean, ms = 8000) => {
	const end = Date.now() + ms;
	while (!ready() && Date.now() < end) await new Promise((resolve) => setTimeout(resolve, 20));
	assert.ok(ready(), "timed out");
};

test("switching models while a request is stuck retrying lets it go and asks the new model at once", async () => {
	hits = [];
	aMode = "broken";
	const { agent, events, cleanup } = await session();
	try {
		const turn = agent.prompt([{ type: "text", text: "Q" }]);
		await until(() => hits.filter((one) => one === "model-a").length >= 2);

		const switchedAt = hits.length;
		await agent.setModel(B.id);
		await turn;

		assert.deepEqual(hits.slice(switchedAt), ["model-b"], `after the switch only b was asked: ${hits.join(", ")}`);
		const last = agent.messages.at(-1) as AssistantMessage;
		assert.equal(last.role, "assistant");
		assert.match(last.content.map((part) => (part.type === "text" ? part.text : "")).join(""), /model-b 回答/);
		assert.ok(
			!agent.messages.some((message) => message.role === "assistant" && message.stopReason === "aborted"),
			"the request that was let go leaves nothing in the transcript — nobody pressed stop",
		);
		const settled = events.filter((event) => event.type === "retry_settled");
		assert.equal(settled.length, 1);
		assert.equal(settled[0]!.type === "retry_settled" && settled[0]!.outcome, "switched", "the retry line says it was a switch, not a recovery");
		assert.equal(settled[0]!.type === "retry_settled" && settled[0]!.switchedTo, "Model B");
		assert.equal(agent.meta.modelId, B.id);
	} finally {
		await cleanup();
	}
});

test("stop still means stop: a stuck request is not re-sent to anyone", async () => {
	hits = [];
	aMode = "broken";
	const { agent, cleanup } = await session();
	try {
		const turn = agent.prompt([{ type: "text", text: "Q" }]);
		await until(() => hits.length >= 2);
		agent.abort();
		await turn;
		const settledAt = hits.length;
		await new Promise((resolve) => setTimeout(resolve, 1300));
		assert.equal(hits.length, settledAt, "nothing more went out after stop");
		assert.ok(hits.every((one) => one === "model-a"));
	} finally {
		await cleanup();
	}
});

test("a request that is already answering is left to finish; the switch applies from the next one", async () => {
	/*
	 * 放手只给还什么都没说出口的请求。一个已经在出字的请求是在干活——打断它等于扔掉它说了一半的
	 * 话、再花一次钱重问。
	 */
	hits = [];
	aMode = "slow";
	const { agent, events, cleanup } = await session();
	try {
		const turn = agent.prompt([{ type: "text", text: "Q" }]);
		await until(() => hits.length >= 1);
		await new Promise((resolve) => setTimeout(resolve, 300));
		await agent.setModel(B.id);
		await turn;

		assert.deepEqual(hits, ["model-a"], "the answer in progress was not cut off and re-asked");
		const last = agent.messages.at(-1) as AssistantMessage;
		assert.match(last.content.map((part) => (part.type === "text" ? part.text : "")).join(""), /说完了/);
		assert.ok(!events.some((event) => event.type === "retry_settled" && event.outcome === "switched"));
	} finally {
		await cleanup();
	}
});

// ---------------------------------------------------------------------------
// 循环：请求之间换人、旧句柄摘掉
// ---------------------------------------------------------------------------

function live(start: ModelConfig): LiveModel & { to(next: ModelConfig): void; adoptedWith: string[] } {
	const provider: ProviderConfig = { id: "t", name: "T", baseUrl: "http://localhost", api: "anthropic-messages", apiKey: "x", enabled: true, models: [A, B] };
	let now = start;
	const listeners = new Set<() => void>();
	const adoptedWith: string[] = [];
	return {
		current: () => ({ provider, model: now }),
		onChange: (listener) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		adopted: (model) => adoptedWith.push(model.id),
		to(next) {
			now = next;
			for (const listener of listeners) listener();
		},
		adoptedWith,
	};
}

const reply = (model: string, content: AssistantMessage["content"], stopReason: AssistantMessage["stopReason"]): AssistantMessage => ({
	role: "assistant", api: "anthropic-messages", provider: "t", model, usage: emptyUsage(), stopReason, timestamp: Date.now(), content,
});

test("between two requests the next one goes to the new model, with the old one's handles taken off", async () => {
	const watch = live(A);
	const flip: Tool = {
		name: "flip", snippet: "flip", description: "flip",
		parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
		summarize: () => "flip",
		async execute() {
			watch.to(B); // 人在工具跑着的时候换了模型
			return { content: [{ type: "text", text: "ok" }] };
		},
	};
	const asked: { model: string; messages: Message[] }[] = [];
	const provider: ProviderConfig = { id: "t", name: "T", baseUrl: "http://localhost", api: "anthropic-messages", apiKey: "x", enabled: true, models: [A, B] };
	const result = await runAgent(
		{
			sessionId: "s", cwd: "/tmp", provider, model: A, liveModel: watch, systemPrompt: "", tools: [flip],
			messages: [{ role: "user", content: [{ type: "text", text: "go" }], timestamp: 1 }],
			streamFn: async (context, config) => {
				asked.push({ model: config.model.modelId, messages: structuredClone(context.messages) });
				return asked.length === 1
					? reply("model-a", [
							{ type: "thinking", thinking: "想一想", signature: "sig-from-a" },
							{ type: "toolCall", id: "c1", name: "flip", arguments: {}, argumentsText: "{}" },
						], "toolUse")
					: reply("model-b", [{ type: "text", text: "好了" }], "stop");
			},
		},
		async () => {},
	);

	assert.deepEqual(asked.map((one) => one.model), ["model-a", "model-b"]);
	const fromA = asked[1]!.messages.find((message) => message.role === "assistant") as AssistantMessage;
	const thinking = fromA.content.find((part) => part.type === "thinking") as { signature?: string } | undefined;
	assert.equal(thinking?.signature, undefined, "a's signature is not handed to b — it would reject the whole request");
	assert.deepEqual(watch.adoptedWith, [B.id], "the session is told where the switch really happened");
	assert.equal(result.reason, "done");
});

test("without a live model nothing changes: the whole run stays on the model it was given", async () => {
	const asked: string[] = [];
	const provider: ProviderConfig = { id: "t", name: "T", baseUrl: "http://localhost", api: "anthropic-messages", apiKey: "x", enabled: true, models: [A, B] };
	await runAgent(
		{
			sessionId: "s", cwd: "/tmp", provider, model: A, systemPrompt: "", tools: [],
			messages: [{ role: "user", content: [{ type: "text", text: "go" }], timestamp: 1 }],
			streamFn: async (_context, config) => {
				asked.push(config.model.modelId);
				return reply("model-a", [{ type: "text", text: "好" }], "stop");
			},
		},
		async () => {},
	);
	assert.deepEqual(asked, ["model-a"]);
});
