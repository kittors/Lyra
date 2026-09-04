/**
 * 清单里声明的每个事件，都真的会被派发。
 *
 * 这个文件存在的原因很具体：`tool_result`、`turn_start`、`turn_end`、`session_start` 在
 * `extensions/types.ts` 里认得、校验、存进 manifest，而**扩展宿主此前只有一个调用点**——
 * 工具调用之前的那次拦截。一个声明了 `events: ["turn_end"]` 的扩展装上去、加载成功、
 * 然后什么也收不到，而屏幕上没有任何东西说得出这件事。
 *
 * 所以这里断言的不是「事件长什么样」，而是**它到底会不会来**。
 */

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { ALL_EXTENSION_EVENTS } from "../src/extensions/types.ts";
import { makeAfterToolCall } from "../src/runtime/hooks.ts";
import { AgentSession } from "../src/runtime/session.ts";
import { DEFAULT_SETTINGS, type Settings } from "../src/config/settings.ts";
import type { AssistantMessage, ModelConfig, ProviderConfig, ToolResult } from "../src/types.ts";

let root: string;
before(async () => {
	root = await mkdtemp(join(tmpdir(), "ly-ev-"));
});
after(async () => {
	await rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 25 });
});

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
const PROVIDER: ProviderConfig = { id: "fake", name: "Fake", baseUrl: "http://l", api: "openai-responses", apiKey: "x", enabled: true, models: [MODEL] };
const SETTINGS: Settings = { ...DEFAULT_SETTINGS, providers: [PROVIDER], defaultModelId: MODEL.id, mcpServers: [], permissionMode: "full" };

/** 记下宿主收到的每个事件，替掉真的 worker。 */
function spy() {
	const seen: string[] = [];
	return {
		seen,
		host: {
			dispatch: async (event: string) => {
				seen.push(event);
				return [];
			},
			intercept: async () => ({}),
		},
	};
}

test("每个声明得出来的事件，都有地方派发它", async () => {
	/*
	 * 这一条是拿清单去对代码，而不是反过来。
	 *
	 * 反过来（列出代码里派发了什么，断言它们在清单里）永远会通过——漏掉的那个事件不会出现在
	 * 任何一边。只有从清单出发，才问得出「你声明了它，那它在哪儿发」。
	 */
	const { execSync } = await import("node:child_process");
	/*
	 * 两种派发都算：`dispatch` 是观察，`intercept` 是能否决的那种。
	 *
	 * 第一版只找 `dispatch`，于是把 `tool_call` 报成了漏掉的——而它恰恰是唯一一个从一开始
	 * 就接好的。一个把对的说成错的检查，会让人把它关掉。
	 */
	const src = execSync("grep -rhoE '(dispatch|intercept)\\(\"[a-z_]+\"' packages/core/src --include='*.ts' || true", {
		cwd: join(import.meta.dirname, "..", "..", ".."),
		encoding: "utf8",
	});
	const dispatched = new Set([...src.matchAll(/(?:dispatch|intercept)\("([a-z_]+)"/g)].map((m) => m[1]));

	const missing = ALL_EXTENSION_EVENTS.filter((event) => !dispatched.has(event));
	assert.deepEqual(missing, [], `这些事件清单里认得、而代码里没有任何地方发：${missing.join("、")}`);
});

test("tool_result 是观察，不是拦截", async () => {
	/*
	 * 工具已经跑完了，这时候能「否决」的只有那份结果——而一个能改写工具结果的观察者，跟一个
	 * 能凭空编造事实的扩展是同一个东西。要改结果得在清单里声明 `intercepts`，那是调用**之前**。
	 */
	const watcher = spy();
	const after = makeAfterToolCall([], root, undefined, watcher.host as never);
	const result: ToolResult = { content: [{ type: "text", text: "跑完了" }] } as ToolResult;

	const out = await after({ toolName: "bash", args: {}, result });
	await new Promise((r) => setTimeout(r, 10));

	assert.deepEqual(watcher.seen, ["tool_result"]);
	assert.equal(out, undefined, "没有钩子时不改结果");
});

test("一个回合真的会发 turn_start 和 turn_end", async () => {
	const session = new AgentSession({
		cwd: root,
		settings: SETTINGS,
		store: {
			create: async () => ({ id: "s1", projectId: "p", cwd: root, title: "", updatedAt: 1 }),
			listSessions: async () => [],
			messages: async () => [],
			append: async (meta: unknown) => meta,
		} as never,
		emit: async () => {},
		streamFn: async () =>
			({
				role: "assistant",
				content: [{ type: "text", text: "好" }],
				api: "openai-responses",
				provider: "fake",
				model: "model",
				usage: {},
				stopReason: "stop",
				timestamp: 0,
			}) as AssistantMessage,
	});
	await session.initialize();

	const watcher = spy();
	// 换掉真的宿主——这里要验的是「谁在什么时候调它」，不是 worker 本身。
	Object.defineProperty(session.can, "extensions", { value: watcher.host, configurable: true });

	await session.prompt([{ type: "text", text: "你好" }]);
	await new Promise((r) => setTimeout(r, 20));

	assert.ok(watcher.seen.includes("turn_start"), `该有 turn_start：${watcher.seen.join("、")}`);
	assert.ok(watcher.seen.includes("turn_end"), `该有 turn_end：${watcher.seen.join("、")}`);
	assert.ok(
		watcher.seen.indexOf("turn_start") < watcher.seen.indexOf("turn_end"),
		"顺序反了的话，一个记录耗时的扩展会算出负数",
	);
});
