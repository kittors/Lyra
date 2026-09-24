/**
 * 回合说完之后、放手之前的那一段，进来的话该怎么办。
 *
 * 一个回合 `agent_end` 发出去之后并没有立刻结束：末尾还有一次「刚才那句算不算纠正、要不要存成
 * 规则」的判断（`session-turn.ts` 的 `offerRuleFromCorrection`），一次网络调用，上限 20 秒。那
 * 段时间里 `running` 仍是 true，而 loop 已经走了——`drainSteering` 再也不会被调用。
 *
 * 窗口那边正好在这一拍上出队：它收到 `agent_end` 就把排着的下一条送出来（`store/queue-slice.ts`）。
 * 从前这条消息照着 `running` 被塞进 `steering`，然后再没有人来取。症状是最难查的那一种——不报错、
 * 不在转录里、也不回到队列条上，屏幕上只是「发出去了但一点反应都没有」，而下一次发送时它会被
 * `drainSteering` 顺带倒出来，看起来像旧话重放。真窗口里量过：那之后输入框会永久卡在「停止」上，
 * 说什么都只能继续排队，连停止按钮都按不动。
 *
 * 这场赛跑没有侥幸的一边：收尾是一次网络请求，对面只是一趟进程内 IPC。
 */

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { AgentSession } from "../src/runtime/session.ts";
import { DEFAULT_SETTINGS, type Settings } from "../src/config/settings.ts";
import type { AgentEvent } from "../src/agent/events.ts";
import type { AssistantMessage, ModelConfig, ProviderConfig } from "../src/types.ts";

const MODEL: ModelConfig = {
	id: "fake/model", providerId: "fake", modelId: "model", name: "Fake",
	contextWindow: 100_000, maxOutputTokens: 4096,
	supportsThinking: false, supportsImages: false, supportsTools: true,
};
const PROVIDER: ProviderConfig = { id: "fake", name: "Fake", baseUrl: "http://localhost", api: "openai-responses", apiKey: "x", enabled: true, models: [MODEL] };
const SETTINGS: Settings = { ...DEFAULT_SETTINGS, providers: [PROVIDER], defaultModelId: MODEL.id, mcpServers: [], permissionMode: "full" };

/** 每次一个新对象：`log.commit` 按引用去重，共用一个会让第二轮的回复静默消失。 */
const reply = (text = "好"): AssistantMessage =>
	({
		role: "assistant", content: [{ type: "text", text }],
		api: "openai-responses", provider: "fake", model: "model",
		usage: {}, stopReason: "stop", timestamp: 0,
	}) as AssistantMessage;

let root: string;
before(async () => { root = await mkdtemp(join(tmpdir(), "ly-settling-")); });
after(async () => { await rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 25 }); });

const STORE = (id: string) =>
	({
		create: async () => ({ id, projectId: "p", cwd: root, title: "", updatedAt: 1 }),
		listSessions: async () => [],
		messages: async () => [],
		append: async (meta: unknown) => meta,
	}) as never;

/** 分类器那一次调用的特征：系统提示是 `rules/from-correction.ts` 里那段。 */
const isClassifier = (systemPrompt: string | undefined) => Boolean(systemPrompt?.startsWith("你在判断一段对话里"));
/** 命中 `looksLikeCorrection` 的开场白——只有它才会让回合末尾真的去问一次模型。 */
const CORRECTION = "不要再用 any 了";

/**
 * 窗口那一端的出队，搬进这里。
 *
 * 它收到 `agent_end` 就把排着的下一条送出来（`store/apply-event.ts` 里那个
 * `queueMicrotask(flushQueue)`），中间隔一趟 IPC。10ms 比真实的往返宽松得多，而对面的收尾是
 * 一次网络调用——这场赛跑的两头本来就差着两三个数量级，所以它落在窗口里是必然而不是偶然。
 */
function dequeueOnEnd(text: string) {
	let session: AgentSession | null = null;
	let fired = false;
	let settle!: () => void;
	const sent = new Promise<void>((resolve) => { settle = resolve; });
	return {
		/** 会话建好之后挂上去——构造它的时候还没有它自己。 */
		attach(built: AgentSession) { session = built; },
		/** 那条排队消息真正交出去之后才落定。 */
		sent,
		onEvent(event: AgentEvent) {
			if (event.type !== "agent_end" || fired) return;
			fired = true;
			setTimeout(() => { void session?.prompt([{ type: "text", text: text }]).then(() => settle()); }, 10);
		},
	};
}

/** 转录里的用户消息，按先后。 */
const asked = (session: AgentSession) =>
	session.log.messages
		.filter((m) => m.role === "user")
		.map((m) => m.content.filter((c) => c.type === "text").map((c) => c.text).join(""));

test("回合说完、还没放手的那一拍上进来的话，自己开一轮", async () => {
	/*
	 * 窗口出队的那一刻，主进程正卡在收尾的分类调用里。这条消息不能掉进 `steering`——那里此刻
	 * 已经没有取件人了。
	 */
	let classifierCalls = 0;
	let turns = 0;
	const queue = dequeueOnEnd("排队的那句");

	const session = new AgentSession({
		cwd: root,
		settings: SETTINGS,
		store: STORE("settling-1"),
		emit: async (event: AgentEvent) => queue.onEvent(event),
		streamFn: async (context) => {
			if (isClassifier(context.systemPrompt)) {
				classifierCalls += 1;
				// 一次真实的分类调用要几百毫秒到几秒；这里用 300ms 代表「比那趟 IPC 长得多」。
				await new Promise((r) => setTimeout(r, 300));
				return reply('{"isCorrection": false}');
			}
			turns += 1;
			return reply();
		},
	});
	queue.attach(session);
	await session.initialize();

	await session.prompt([{ type: "text", text: CORRECTION }]);
	await queue.sent;
	// 收尾结束后 `drainPending` 才送它出去，给它一拍落地。
	await new Promise((r) => setTimeout(r, 200));

	assert.equal(classifierCalls, 1, "前置条件：这一轮末尾该真的问了一次分类器，否则这条测试没测到那段窗口");
	assert.equal(turns, 2, `排队那句该自己开一轮，而不是掉进 steering：${JSON.stringify(asked(session))}`);
	assert.deepEqual(asked(session), [CORRECTION, "排队的那句"]);
});

test("掉进收尾里的话不会在下一次发送时被顺带倒出来", async () => {
	/*
	 * 这条盯的是症状而不是机制：出问题时屏幕上会看到同一句话两遍，中间夹着后来发的那句——
	 * 用户报的就是这个样子。顺序错了就是错了，哪怕两句都在转录里。
	 */
	const queue = dequeueOnEnd("排队的那句");
	const session = new AgentSession({
		cwd: root,
		settings: SETTINGS,
		store: STORE("settling-2"),
		emit: async (event: AgentEvent) => queue.onEvent(event),
		streamFn: async (context) => {
			if (isClassifier(context.systemPrompt)) {
				await new Promise((r) => setTimeout(r, 300));
				return reply('{"isCorrection": false}');
			}
			return reply();
		},
	});
	queue.attach(session);
	await session.initialize();

	await session.prompt([{ type: "text", text: CORRECTION }]);
	await queue.sent;
	await new Promise((r) => setTimeout(r, 200));
	// 人接着又说了一句。排队那句要是还卡在 steering 里，就会在这一轮被倒出来，排到它后面。
	await session.prompt([{ type: "text", text: "?" }]);

	assert.deepEqual(asked(session), [CORRECTION, "排队的那句", "?"]);
});

test("插话仍然是插话：回合跑着的时候进来的话不另起一轮", async () => {
	/*
	 * 这条是上面两条的反面，缺了它那两条可以靠「一律不插话」作弊过关——而那正是修这个 bug 时
	 * 真的写出来过的一版：翻牌翻在 `Session.emit` 上，而 loop 自己的事件走 `recordTurnEvent`
	 * 直连 `log.emit`，于是 `agent_start` 一次都没翻到，插话全都退化成了「这一轮做完再说」。
	 * 当时整套测试是绿的——因为大家都只断言转录的顺序，而两种投递下顺序恰好一样。
	 *
	 * 所以这里数的是回合数，不是顺序：插话不开新回合，排队开。
	 */
	let turns = 0;
	let release: (() => void) | undefined;
	const firstTurnBlocked = new Promise<void>((resolve) => { release = resolve; });
	const starts: string[] = [];

	const session = new AgentSession({
		cwd: root,
		settings: SETTINGS,
		store: STORE("settling-3"),
		emit: async (event: AgentEvent) => { if (event.type === "agent_start") starts.push("start"); },
		streamFn: async (context) => {
			if (isClassifier(context.systemPrompt)) return reply('{"isCorrection": false}');
			turns += 1;
			if (turns === 1) await firstTurnBlocked;
			return reply();
		},
	});
	await session.initialize();

	const first = session.prompt([{ type: "text", text: "第一件事" }]);
	// 有上限地等它真的开始：没配 provider 的话 `run` 直接返回，不带上限的等待会挂到超时而不是失败。
	for (let waited = 0; waited < 400; waited += 1) {
		if (turns > 0) break;
		await new Promise((r) => setTimeout(r, 5));
	}
	assert.ok(turns > 0, "第一轮没跑起来——检查 settings 里有没有配 provider");

	// 回合确实在跑，这一句该插进去，不该另起一轮。
	await session.prompt([{ type: "text", text: "等等，不是那样" }], { deliver: "steer" });
	release?.();
	await first;
	await new Promise((r) => setTimeout(r, 100));

	assert.equal(starts.length, 1, `插话不该另起一个回合，agent_start 该只有一个：${starts.length}`);
	assert.deepEqual(asked(session), ["第一件事", "等等，不是那样"]);
});

test("人说了下一句，收尾那次判断就该让路", async () => {
	/*
	 * 让排队那句能跑起来还不够：它不该为一次已经作废的判断干等。那次判断问的是「刚才那句纠正
	 * 要不要存成规则」，而人一旦说了下一句，按 `session-turn.ts` 自己的说法它讲的就已经是上一
	 * 次交流了。最长 20 秒（`CLASSIFY_TIMEOUT_MS`），期间屏幕上是消息在、助手那边空着。
	 *
	 * 量的是分类调用有没有被叫停，不是它花了多久——后者在忙的机器上会抖。
	 */
	let classifierAborted = false;
	const queue = dequeueOnEnd("排队的那句");

	const session = new AgentSession({
		cwd: root,
		settings: SETTINGS,
		store: STORE("settling-4"),
		emit: async (event: AgentEvent) => queue.onEvent(event),
		streamFn: async (context, config) => {
			if (!isClassifier(context.systemPrompt)) return reply();
			// 按住不放，直到有人叫停——真实世界里这就是一次慢的网络调用。
			await new Promise<void>((resolve) => {
				const done = () => { classifierAborted = true; resolve(); };
				if (config.signal?.aborted) { done(); return; }
				config.signal?.addEventListener("abort", done, { once: true });
				setTimeout(resolve, 5_000);
			});
			return reply('{"isCorrection": false}');
		},
	});
	queue.attach(session);
	await session.initialize();

	await session.prompt([{ type: "text", text: CORRECTION }]);
	await queue.sent;
	await new Promise((r) => setTimeout(r, 200));

	assert.ok(classifierAborted, "下一句已经进来了，那次分类判断该被叫停，而不是把回合压满五秒");
	assert.deepEqual(asked(session), [CORRECTION, "排队的那句"]);
});
