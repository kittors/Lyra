/**
 * 人在主会话等子代理的时候开口：父会话放手、先回应人，子代理在后台跑完，结果自己送回来。
 *
 * 2026-09-26 的真实会话：主会话派了四个审查子代理，人中途发了一句话，那句话等了两分多钟——
 * 插话只在两轮之间有人取，而 `task` 让这一轮卡到最后一个子代理交差为止。这里从 `AgentSession`
 * 这一头验整条路：放手、先答人、后台跑完、送达、开一个新回合把结论接上；以及停下之后什么都
 * 不再送回来。
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { DEFAULT_SETTINGS, type Settings } from "../src/config/settings.ts";
import type { AgentEvent } from "../src/agent/events.ts";
import { AgentSession } from "../src/runtime/session.ts";
import { deliveryMessage } from "../src/runtime/delegation-waits.ts";
import { SessionStore } from "../src/session/store.ts";
import { emptyUsage, type AssistantMessage, type LlmContext, type Message, type ModelConfig, type ProviderConfig } from "../src/types.ts";

const MODEL: ModelConfig = {
	id: "fake/model",
	providerId: "fake",
	modelId: "gpt-6-astra",
	name: "Fake",
	contextWindow: 100_000,
	maxOutputTokens: 4096,
	supportsThinking: true,
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
	maxConcurrentSubAgents: 4,
	subAgentDelegation: "eager",
};

function assistant(parts: AssistantMessage["content"], stopReason: AssistantMessage["stopReason"] = "stop"): AssistantMessage {
	return { role: "assistant", content: parts, api: "openai-responses", provider: "fake", model: "gpt-6-astra", usage: emptyUsage(), stopReason, timestamp: Date.now() };
}
const says = (text: string) => assistant([{ type: "text", text }]);

const textOf = (message: Message) => message.content.map((part) => ("text" in part ? part.text : "")).join("");

function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>((done) => (resolve = done));
	return { promise, resolve };
}

async function until(check: () => boolean, what: string, ms = 5000) {
	const start = Date.now();
	while (!check()) {
		if (Date.now() - start > ms) throw new Error(`等不到：${what}`);
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
}

/**
 * 一个会派活的主会话，和一个要等测试放行才交差的子代理。
 *
 * 主会话的每一轮按它看到的东西决定说什么：还没派过就派；看到送达就合并。子代理的请求认得出来——
 * 它手里没有 `task`。
 */
async function harness() {
	const root = await mkdtemp(join(tmpdir(), "ly-detach-"));
	const home = join(root, "home");
	await mkdir(home, { recursive: true });
	process.env.LYRA_HOME = home;

	const finish = deferred();
	const main: LlmContext[] = [];
	const events: AgentEvent[] = [];
	const session = new AgentSession({
		cwd: root,
		settings: SETTINGS,
		store: new SessionStore(join(root, "sessions")),
		emit: (event) => void events.push(event),
		streamFn: async (context) => {
			if (!context.tools.some((tool) => tool.name === "task")) {
				// 子代理：等测试放行再交差。
				if (context.tools.length > 0) {
					await finish.promise;
					return says("报告：src/a.ts:12 的空值没有判断。");
				}
				return says("{}");
			}
			main.push(context);
			// 末尾那块是运行时接的 `<env>`，不是送达——往回找。
			if (context.messages.some((message) => message.role === "user" && message.delivery)) return says("合并后的结论：a.ts:12 要补空值判断。");
			if (!context.messages.some((message) => message.role === "toolResult")) {
				return assistant(
					[{ type: "toolCall", id: "t1", name: "task", arguments: { description: "审查 a.ts", prompt: "看看 a.ts", subagent_type: "general" }, argumentsText: "{}" }],
					"toolUse",
				);
			}
			return says("先回答你：1+1=2。审查还在后台跑。");
		},
	});
	await session.initialize();

	return {
		session,
		main,
		events,
		finish,
		cleanup: async () => {
			finish.resolve();
			session.abort();
			delete process.env.LYRA_HOME;
			await rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 25 });
		},
	};
}

test("人一开口，父会话就不再干等：先回应人，子代理在后台跑完，结果自己送回来", async () => {
	const h = await harness();
	try {
		const first = h.session.prompt([{ type: "text", text: "派一个去审查 a.ts" }]);
		await until(() => h.session.subAgents.list()[0]?.status === "running", "子代理开跑");

		// 人插了一句话——子代理还在跑。
		await h.session.prompt([{ type: "text", text: "先告诉我 1+1 等于几" }]);
		await first;

		assert.equal(h.main.length, 2, "放手之后这一轮当场往下走，而不是等子代理交差");
		const second = h.main[1];
		const detached = second.messages.find((message) => message.role === "toolResult");
		assert.match(detached ? textOf(detached) : "", /转到后台继续跑/, "父会话拿到的是「它在后台」，不是结论");
		assert.ok(second.messages.some((message) => message.role === "user" && textOf(message).includes("1+1")), "下一轮开头就读到了人说的话");
		assert.equal(h.session.subAgents.list()[0]?.background, true, "名单上标着它在后台");
		assert.equal(h.session.subAgents.list()[0]?.status, "running", "子代理没被打扰");
		assert.equal(h.session.running, false, "主会话回应完人就收尾了，不挂着");

		// 子代理跑完：结果送回来，主会话开一个新回合接上。
		h.finish.resolve();
		await until(() => h.main.length === 3 && !h.session.running, "送达之后开新回合");
		const delivered = h.session.messages.find((message) => message.role === "user" && message.delivery);
		assert.ok(delivered, "送达是一条消息，进了转录");
		assert.equal(delivered?.role === "user" && delivered.synthetic, true, "不是人说的话");
		assert.deepEqual(
			delivered?.role === "user" ? delivered.delivery?.map(({ agent, description, status }) => ({ agent, description, status })) : null,
			[{ agent: "general", description: "审查 a.ts", status: "done" }],
		);
		assert.match(textOf(delivered!), /<subagent_result [^>]*agent="general"[^>]*>\n报告：src\/a\.ts:12/);
		assert.match(textOf(delivered!), /合并成一份/, "末尾那句话叫它合并，不要逐个转述");
		const reply = h.session.messages.at(-1);
		assert.equal(reply?.role, "assistant");
		assert.match(reply ? textOf(reply) : "", /合并后的结论/);
	} finally {
		await h.cleanup();
	}
});

test("放手之后人按了停止：后台那个也停，停下的结果不再把主会话叫醒", async () => {
	const h = await harness();
	try {
		const first = h.session.prompt([{ type: "text", text: "派一个去审查 a.ts" }]);
		await until(() => h.session.subAgents.list()[0]?.status === "running", "子代理开跑");
		await h.session.prompt([{ type: "text", text: "先告诉我 1+1 等于几" }]);
		await first;
		assert.equal(h.main.length, 2);

		h.session.abort();
		h.finish.resolve();
		await until(() => h.session.subAgents.list()[0]?.status !== "running", "子代理停下");
		await new Promise((resolve) => setTimeout(resolve, 600));
		assert.equal(h.session.subAgents.list()[0]?.status, "aborted");
		assert.equal(h.main.length, 2, "没有为一份被腰斩的结果再开一轮");
		assert.ok(!h.session.messages.some((message) => message.role === "user" && message.delivery), "也没有送达消息");
	} finally {
		await h.cleanup();
	}
});

test("没人插话的时候，一步都不多：父会话照旧等到结果", async () => {
	const h = await harness();
	try {
		const first = h.session.prompt([{ type: "text", text: "派一个去审查 a.ts" }]);
		await until(() => h.session.subAgents.list()[0]?.status === "running", "子代理开跑");
		h.finish.resolve();
		await first;
		assert.equal(h.main.length, 2, "派一次、收一次，没有送达那一轮");
		const result = h.main[1].messages.find((message) => message.role === "toolResult");
		assert.match(result ? textOf(result) : "", /报告：src\/a\.ts:12/, "结论当场交回");
		assert.ok(!h.session.messages.some((message) => message.role === "user" && message.delivery));
		assert.equal(h.session.subAgents.list()[0]?.background, undefined);
	} finally {
		await h.cleanup();
	}
});

test("主会话的请求都带着同一个缓存键，子代理带它自己的", async () => {
	const keys: { sub: boolean; key?: string }[] = [];
	const root = await mkdtemp(join(tmpdir(), "ly-cachekey-"));
	process.env.LYRA_HOME = join(root, "home");
	await mkdir(process.env.LYRA_HOME, { recursive: true });
	const session = new AgentSession({
		cwd: root,
		settings: SETTINGS,
		store: new SessionStore(join(root, "sessions")),
		emit: () => {},
		streamFn: async (context, config) => {
			const sub = !context.tools.some((tool) => tool.name === "task");
			if (sub && context.tools.length === 0) return says("{}");
			keys.push({ sub, key: config.cacheKey });
			if (sub) return says("子代理的报告");
			if (!context.messages.some((message) => message.role === "toolResult")) {
				return assistant([{ type: "toolCall", id: "t1", name: "task", arguments: { description: "看看", prompt: "看", subagent_type: "general" }, argumentsText: "{}" }], "toolUse");
			}
			return says("好了");
		},
	});
	try {
		await session.initialize();
		await session.prompt([{ type: "text", text: "派一个" }]);
		const mains = keys.filter((one) => !one.sub).map((one) => one.key);
		const subs = keys.filter((one) => one.sub).map((one) => one.key);
		assert.deepEqual(mains, [session.meta.id, session.meta.id], "主会话每个请求都是会话 id");
		assert.deepEqual(subs, [session.subAgents.list()[0]?.id], "子代理用它自己的登记 id");
	} finally {
		session.abort();
		delete process.env.LYRA_HOME;
		await rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 25 });
	}
});

test("送达消息：几个结果一条消息，失败的说出原因，给界面的那一份不带报告正文", () => {
	const message = deliveryMessage([
		{ report: { id: "s:sub:1", answer: { text: "A 的结论" } }, summary: { agent: "review", description: "审查 \"前端\"", status: "done" } },
		{ report: { id: "s:sub:2", error: "HTTP 502" }, summary: { agent: "explore", description: "找入口", status: "failed" } },
	]);
	assert.equal(message.role, "user");
	const text = textOf(message);
	assert.match(text, /<subagent_result id="s:sub:1" agent="review" task="审查 '前端'" status="done">\nA 的结论/, "描述里的引号不能把标签撑破");
	assert.match(text, /status="failed">\n它没能跑完：HTTP 502/);
	assert.deepEqual(message.role === "user" ? message.delivery : null, [
		{ id: "s:sub:1", agent: "review", description: "审查 \"前端\"", status: "done" },
		{ id: "s:sub:2", agent: "explore", description: "找入口", status: "failed" },
	]);
});

test("设置里把并发调大，排着的当场开跑——不等一个永远轮不到的「下一轮」", async () => {
	const root = await mkdtemp(join(tmpdir(), "ly-gatewidth-"));
	process.env.LYRA_HOME = join(root, "home");
	await mkdir(process.env.LYRA_HOME, { recursive: true });
	const finish = deferred();
	const narrow: Settings = { ...SETTINGS, maxConcurrentSubAgents: 1 };
	const session = new AgentSession({
		cwd: root,
		settings: narrow,
		store: new SessionStore(join(root, "sessions")),
		emit: () => {},
		streamFn: async (context) => {
			const sub = !context.tools.some((tool) => tool.name === "task");
			if (sub && context.tools.length === 0) return says("{}");
			if (sub) {
				await finish.promise;
				return says("报告");
			}
			if (!context.messages.some((message) => message.role === "toolResult")) {
				return assistant(
					["甲", "乙"].map((name, i) => ({ type: "toolCall" as const, id: `t${i}`, name: "task", arguments: { description: `审查${name}`, prompt: name, subagent_type: "general" }, argumentsText: "{}" })),
					"toolUse",
				);
			}
			return says("好了");
		},
	});
	try {
		await session.initialize();
		const turn = session.prompt([{ type: "text", text: "派两个" }]);
		await until(() => session.subAgents.list().length === 2 && session.subAgents.list().some((one) => one.status === "running"), "两个都上了名单");
		assert.deepEqual(session.subAgents.list().map((one) => one.status).sort(), ["queued", "running"], "闸门只放一个");

		session.updateSettings({ ...narrow, maxConcurrentSubAgents: 2 });
		await until(() => session.subAgents.list().every((one) => one.status === "running"), "排着的那个开跑");

		finish.resolve();
		await turn;
		assert.deepEqual(session.subAgents.list().map((one) => one.status), ["done", "done"]);
	} finally {
		finish.resolve();
		session.abort();
		delete process.env.LYRA_HOME;
		await rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 25 });
	}
});
