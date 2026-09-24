/**
 * 探针：排队消息在这一轮「已经说完、但还没放手」的那段时间里出队，会发生什么。
 *
 * 断言那一半在 `queue-settling.test.ts`。这一支是量尺：它回答的不是「对不对」，而是「这件事
 * 是偶然还是必然」——把 `agent_end` 之后每一步的时刻和 `session.running` 打出来，再扫一遍两
 * 边的时长，看那条排队消息落在哪儿。当初正是它把「碰运气」和「谁慢谁赢」分开的：分界线精确
 * 落在两边相等处，39 次符合条件的运行全中，零抖动。
 *
 * 两种跑法：
 *   node --experimental-strip-types packages/core/test/queue-steering-race-probe.ts
 *   SWEEP=1 node --experimental-strip-types packages/core/test/queue-steering-race-probe.ts
 *
 * 后者扫「回合收尾那一段占住多久」这一个变量——它决定窗口有多宽，也就决定这件事是必然
 * 还是偶然。真实环境里占住它的是回合末尾那次规则分类请求（`session-turn.ts` 的
 * `offerRuleFromCorrection`），一次网络调用，上限 20 秒。
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentSession } from "../src/runtime/session.ts";
import { DEFAULT_SETTINGS, type Settings } from "../src/config/settings.ts";
import type { AssistantMessage, ModelConfig, ProviderConfig } from "../src/types.ts";

const MODEL: ModelConfig = {
	id: "fake/model", providerId: "fake", modelId: "model", name: "Fake",
	contextWindow: 100_000, maxOutputTokens: 4096,
	supportsThinking: false, supportsImages: false, supportsTools: true,
};
const PROVIDER: ProviderConfig = { id: "fake", name: "Fake", baseUrl: "http://localhost", api: "openai-responses", apiKey: "x", enabled: true, models: [MODEL] };
const SETTINGS: Settings = { ...DEFAULT_SETTINGS, providers: [PROVIDER], defaultModelId: MODEL.id, mcpServers: [], permissionMode: "full" };

const STORE = (id: string, cwd: string) =>
	({
		create: async () => ({ id, projectId: "p", cwd, title: "", updatedAt: 1 }),
		listSessions: async () => [],
		messages: async () => [],
		append: async (meta: unknown) => meta,
	}) as never;

const reply = (text: string): AssistantMessage =>
	({
		role: "assistant", content: [{ type: "text", text }],
		api: "openai-responses", provider: "fake", model: "model",
		usage: {}, stopReason: "stop", timestamp: 0,
	}) as AssistantMessage;

/** 分类器那一次调用的特征：系统提示是 `from-correction.ts` 里那段。 */
const isClassifier = (systemPrompt: string | undefined) => Boolean(systemPrompt?.startsWith("你在判断一段对话里"));

const QUEUED = "排队的那句";

interface Run {
	/** 用户消息在转录里的最终顺序。 */
	order: string[];
	/** 不含分类器的模型请求次数。排队那句若开了自己的回合，这里是 2。 */
	turns: number;
	classifierCalls: number;
	verdict: "重放" | "丢失" | "正常";
	timeline: string[];
}

/**
 * 跑一遍完整场景。
 *
 * @param classifyMs 回合收尾那一段占住多久——真实环境里是那次分类请求的耗时。
 * @param first      第一句话。带触发词的才会真的去问分类器。
 * @param ipcMs      窗口收到 `agent_end` 到主进程收到出队消息之间的往返，模拟一次 IPC。
 */
async function runOnce({ classifyMs, first, ipcMs }: { classifyMs: number; first: string; ipcMs: number }): Promise<Run> {
	const root = await mkdtemp(join(tmpdir(), "ly-queue-race-"));
	const t0 = Date.now();
	const timeline: string[] = [];
	const say = (line: string) => timeline.push(`+${String(Date.now() - t0).padStart(5)}ms  ${line}`);

	try {
		let turns = 0;
		let classifierCalls = 0;
		let queuedSent = false;
		let session!: AgentSession;
		/** 出队那一次 prompt 的 promise——不等它，回合结束后才结账。 */
		let queuedPrompt: Promise<void> | null = null;

		session = new AgentSession({
			cwd: root,
			settings: SETTINGS,
			store: STORE("s-race", root),
			emit: async (event) => {
				if (event.type === "agent_end") {
					say(`事件 agent_end(reason=${event.reason})   此刻 session.running=${session.running}`);
					if (!queuedSent) {
						queuedSent = true;
						/*
						 * 这就是 `queue-slice.ts` 的 flushQueue：窗口收到 agent_end，微任务里出队，
						 * 跨一次 IPC 回到主进程。`ipcMs` 就是那一趟。
						 */
						setTimeout(() => {
							say(`→ 队列出队，调 session.prompt("${QUEUED}")   此刻 session.running=${session.running}`);
							queuedPrompt = session.prompt([{ type: "text", text: QUEUED }]);
							void queuedPrompt.then(() => say(`  prompt("${QUEUED}") 已 resolve`));
						}, ipcMs);
					}
				}
				if (event.type === "message_start" && event.message.role === "user") {
					const text = event.message.content.filter((c) => c.type === "text").map((c) => c.text).join("");
					say(`事件 message_start(user) ← 转录里出现「${text}」`);
				}
			},
			streamFn: async (context) => {
				if (isClassifier(context.systemPrompt)) {
					classifierCalls += 1;
					say(`分类器请求开始（规则建议），会占住 ${classifyMs}ms`);
					await new Promise((r) => setTimeout(r, classifyMs));
					say(`分类器请求结束   此刻 session.running=${session.running}`);
					return reply('{"isCorrection": false}');
				}
				turns += 1;
				const asked = context.messages
					.filter((m) => m.role === "user" && !m.synthetic)
					.map((m) => m.content.filter((c) => c.type === "text").map((c) => c.text).join(""));
				say(`第 ${turns} 轮模型请求，这一轮看到的用户消息：${JSON.stringify(asked)}`);
				return reply("好");
			},
		});
		await session.initialize();

		say(`发出第一句：「${first}」`);
		await session.prompt([{ type: "text", text: first }]);
		say(`prompt("${first}") 已 resolve   此刻 session.running=${session.running}`);

		// 让排队那条有足够时间显形——或者证明它根本没跑。
		await new Promise((r) => setTimeout(r, Math.max(300, classifyMs)));
		say(`—— 等过去了，模型请求次数 = ${turns}（排队那句若开了新回合，这里该是 2）`);

		// 用户看见「卡住了」，自己再发一句。
		say(`用户手动再发一句：「?」`);
		await session.prompt([{ type: "text", text: "?" }]);
		await new Promise((r) => setTimeout(r, 200));
		await (queuedPrompt as Promise<void> | null)?.catch(() => {});

		const order = session.log.messages
			.filter((m) => m.role === "user")
			.map((m) => m.content.filter((c) => c.type === "text").map((c) => c.text).join(""));

		const queuedAt = order.indexOf(QUEUED);
		const questionAt = order.indexOf("?");
		const verdict = queuedAt < 0 ? "丢失" : queuedAt > questionAt && questionAt >= 0 ? "重放" : "正常";
		return { order, turns, classifierCalls, verdict, timeline };
	} finally {
		await rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 25 });
	}
}

const CORRECTION = "不要再用 any 了";
const PLAIN = "这个文件是不是可以删除掉了";

if (process.env.SWEEP) {
	/*
	 * 一个变量：回合收尾那一段占住多久。出队固定在 agent_end 之后 10ms（比真实 IPC 宽松）。
	 * 每档跑三遍，看结论稳不稳。
	 */
	const REPEATS = 3;
	console.log(`扫描：回合收尾占住 N 毫秒 → 排队那句的下场（每档 ${REPEATS} 遍，出队固定在 agent_end 之后 10ms）\n`);
	console.log(`占住时长    结果                       模型请求次数    用户消息顺序`);
	for (const classifyMs of [0, 2, 5, 8, 10, 12, 15, 20, 50, 200, 1500]) {
		const runs: Run[] = [];
		for (let i = 0; i < REPEATS; i += 1) runs.push(await runOnce({ classifyMs, first: CORRECTION, ipcMs: 10 }));
		const verdicts = runs.map((r) => r.verdict);
		const bad = verdicts.filter((v) => v !== "正常").length;
		const mark = bad === REPEATS ? "❌ 每遍都中" : bad === 0 ? "✅ 每遍都好" : `⚠️  ${bad}/${REPEATS} 中`;
		console.log(
			`${String(classifyMs).padStart(6)}ms    ${mark.padEnd(24)} ${[...new Set(runs.map((r) => r.turns))].join("/").padEnd(14)} ${JSON.stringify(runs[0]!.order)}`,
		);
	}

	/*
	 * 反过来再扫一遍：收尾固定占住 500ms（一次真实分类请求的量级），换出队那一趟要多久。
	 * 这是同一场赛跑的另一头——要多慢的 IPC 才躲得过去。
	 */
	console.log(`\n反向扫描：收尾固定占住 500ms，换出队那一趟的往返时间`);
	console.log(`出队往返    结果`);
	for (const ipcMs of [1, 5, 50, 200, 450, 490, 520, 700]) {
		const runs: Run[] = [];
		for (let i = 0; i < REPEATS; i += 1) runs.push(await runOnce({ classifyMs: 500, first: CORRECTION, ipcMs }));
		const bad = runs.filter((r) => r.verdict !== "正常").length;
		console.log(`${String(ipcMs).padStart(6)}ms    ${bad === REPEATS ? "❌ 每遍都中" : bad === 0 ? "✅ 每遍都好" : `⚠️  ${bad}/${REPEATS} 中`}`);
	}

	console.log(`\n对照：同样的时序，但第一句不带触发词（分类器根本不跑）`);
	const control: Run[] = [];
	for (let i = 0; i < REPEATS; i += 1) control.push(await runOnce({ classifyMs: 1500, first: PLAIN, ipcMs: 10 }));
	const bad = control.filter((r) => r.verdict !== "正常").length;
	console.log(`  ${bad === 0 ? "✅ 每遍都好" : `❌ ${bad}/${REPEATS} 中`}    分类器调用 = ${control[0]!.classifierCalls}    ${JSON.stringify(control[0]!.order)}`);
} else {
	const run = await runOnce({
		classifyMs: Number(process.env.CLASSIFY_MS ?? 1500),
		first: process.env.FIRST ?? CORRECTION,
		ipcMs: Number(process.env.IPC_MS ?? 10),
	});
	console.log("\n================ 时间线 ================");
	for (const line of run.timeline) console.log(line);
	console.log("\n================ 结论 ================");
	console.log(`模型请求次数（不含分类器）= ${run.turns}，分类器调用 = ${run.classifierCalls}`);
	console.log(`用户消息顺序：${JSON.stringify(run.order)}`);
	console.log({
		重放: "❌ 复现：排队那句没有自己开一轮，被后来那次发送顺带重放了（排在「?」之后）。",
		丢失: "❌ 复现（更糟）：排队那句压根没进转录，卡在 steering 里。",
		正常: "✅ 没复现：排队那句按自己的顺序开了一轮。",
	}[run.verdict]);
}
