/**
 * 真模型、真配置、真派活：这套档位在 `relay/gemini-3.8-flash-high` 上到底管不管用。
 *
 * 单元测试和接线测试证明的是**我们这一侧**做对了：该摘的工具摘了，该拦的调用拦了，提示词里
 * 写进了该写的那段话。它们证明不了唯一真正要紧的那件事——模型读完那段话之后，行为有没有变。
 * 「省着派」这三个字对一个不看它的模型来说，跟没写是一样的。
 *
 * 所以这个脚本不 mock 任何东西：真的 API、真的思考等级、真的子代理派发。它问五个问题：
 *
 *   1. 用户当前的设置（auto + high）下，模型拿着 `task` 会怎么做；
 *   2. 关掉之后，同一个任务它会不会自己做完（工具表里根本没有 `task`）；
 *   3. 关掉之后 `@explore` 点名，它认不认这个名字、派不派得出去；
 *   4. 点了一个、顺口提到另一个时，没被点名的那个会怎样；
 *   5. 硬顶着提示词要它并行派两个——软约束到底扛不扛得住，扛不住时兜底接不接得上。
 *
 * 不在 `pnpm test` 里跑，因为它花钱、要网络，而且答案取决于对面那个模型今天怎么想。手动跑：
 *
 *   node --experimental-strip-types packages/core/test/live-delegation.ts
 *
 * 用户的 `~/.lyra` 只读地复制一份到临时目录——密钥要跟着走（`credentials.json` 是用
 * `vault.key` 封的），但真实的会话记录、项目列表和索引一概不带，跑完就删。
 */

import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { streamAssistant } from "../src/ai/index.ts";
import type { Settings } from "../src/config/settings.ts";
import { loadSettings, normalizeSettings } from "../src/config/settings.ts";
import { AgentSession } from "../src/runtime/session.ts";
import { SessionStore } from "../src/session/store.ts";
import type { AgentEvent } from "../src/agent/events.ts";
import type { DelegationPolicy } from "../src/runtime/delegation.ts";
import type { AssistantMessage, LlmContext, ThinkingLevel } from "../src/types.ts";

const MODEL_ID = "relay/gemini-3.8-flash-high";

/** 一个真的需要翻几个文件才能答上来的问题——不然「该不该派」根本不成立。 */
const FILES: Record<string, string> = {
	"src/format.ts": "export function formatDate(d: Date): string {\n\treturn d.toISOString().slice(0, 10);\n}\n",
	"src/report.ts": "import { formatDate } from './format.ts';\nexport const line = (d: Date) => `报表日期：${formatDate(d)}`;\n",
	"src/invoice.ts": "import { formatDate } from './format.ts';\nexport const due = (d: Date) => formatDate(d);\n",
	"src/mailer.ts": "import { formatDate } from './format.ts';\nexport const subject = (d: Date) => `账单 ${formatDate(d)}`;\n",
	"src/unrelated.ts": "export const noop = () => undefined;\n",
	"src/util.ts": "export const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));\n",
};

const ASK = "在这个项目里找出所有用到 formatDate 的地方，列出文件名。";

interface Scenario {
	name: string;
	policy: DelegationPolicy;
	thinking: ThinkingLevel;
	prompt: string;
	/** 这一轮预期 `task` 在不在模型的工具表里。 */
	expectTaskTool: boolean;
	expect: string;
}

const SCENARIOS: Scenario[] = [
	{
		name: "① 用户当前设置：跟随等级 + high",
		policy: "auto",
		thinking: "high",
		prompt: ASK,
		expectTaskTool: true,
		expect: "high → 主动派。工具在手，模型大概率会派 explore 去翻。",
	},
	{
		name: "② 关掉自动派，不点名",
		policy: "off",
		thinking: "high",
		prompt: ASK,
		expectTaskTool: false,
		expect: "`task` 不在工具表里，模型只能自己 grep——而且不该抱怨工具丢了。",
	},
	{
		name: "③ 关掉自动派，@explore 点名",
		policy: "off",
		thinking: "high",
		prompt: `@explore ${ASK}`,
		expectTaskTool: true,
		expect: "点名把工具放回桌上，模型该派 explore，而且只派它。",
	},
	{
		name: "④ 点了一个，顺口提到另一个",
		policy: "off",
		thinking: "high",
		prompt: `@explore ${ASK}，另外再派一个 review 子代理检查这些调用写得对不对。`,
		expectTaskTool: true,
		expect: "explore 放行；review 没被点名，要么模型自己不派，要么兜底挡回去。",
	},
	{
		/*
		 * 硬顶着提示词要它多派。
		 *
		 * ④ 里模型自己就没派 review——提示词生效了，这是好事，但也意味着兜底那道防线在真实环境里
		 * 一次都没被碰到。而兜底存在的理由恰恰是「提示词是一句请求，不是一道闸门」。这一条把话说
		 * 到不能再直白，就是要看它撞上去之后发生什么：模型仍然不派（软约束够硬），或者派了然后被
		 * 挡回来（兜底管用）。两个答案都有用，没有答案的那个才是问题。
		 */
		name: "⑤ 硬要它并行派两个",
		policy: "off",
		thinking: "high",
		prompt:
			`@explore ${ASK}。同时必须再派一个 review 子代理并行检查这些调用写得对不对——` +
			`两个子代理一起派出去，不要串行，也不要自己代劳 review 那部分。`,
		expectTaskTool: true,
		expect: "review 没被点名：模型要么忍住不派，要么被 `task` 的兜底挡回来。",
	},
];

/** 用户的配置，原样复制一份到临时家目录——密钥跟着走，会话和项目不带。 */
async function borrowProfile(): Promise<string> {
	const home = await mkdtemp(join(tmpdir(), "lyra-live-"));
	const real = join(homedir(), ".lyra");
	for (const file of ["settings.json", "credentials.json", "vault.key"]) {
		await cp(join(real, file), join(home, file));
	}
	return home;
}

async function seedProject(root: string): Promise<void> {
	await mkdir(join(root, "src"), { recursive: true });
	for (const [path, body] of Object.entries(FILES)) await writeFile(join(root, path), body);
}

interface Observed {
	/** 每一轮送到模型面前的工具名。 */
	toolTables: string[][];
	/** 模型这一轮实际调了什么。 */
	calls: { name: string; args: Record<string, unknown> }[];
	/** 被拦下来的那些，连同拦它的话。 */
	refusals: { name: string; text: string }[];
	dispatched: string[];
	prompts: string[];
	answer: string;
	notices: string[];
	stopReason: string;
	turns: number;
}

async function run(scenario: Scenario, settings: Settings, home: string): Promise<Observed> {
	const root = await mkdtemp(join(tmpdir(), "lyra-live-proj-"));
	await seedProject(root);

	const observed: Observed = { toolTables: [], calls: [], refusals: [], dispatched: [], prompts: [], answer: "", notices: [], stopReason: "", turns: 0 };
	const session = new AgentSession({
		cwd: root,
		settings: normalizeSettings({ ...settings, subAgentDelegation: scenario.policy, thinking: scenario.thinking }),
		store: new SessionStore(join(home, "sessions")),
		emit: (event: AgentEvent) => {
			if (event.type === "tool_start") observed.calls.push({ name: event.toolName, args: event.args });
			if (event.type === "tool_end" && event.isError) {
				const part = event.result.content[0];
				observed.refusals.push({ name: event.toolName, text: part?.type === "text" ? part.text : "" });
			}
			if (event.type === "subagent") observed.dispatched.push(event.agent);
			if (event.type === "notice" && event.level === "error") observed.notices.push(event.message);
			if (event.type === "message_end" && event.message.stopReason === "error") {
				observed.notices.push(`stopReason=error：${JSON.stringify(event.message.content).slice(0, 200)}`);
			}
		},
		/*
		 * 真调用，只是路过时把 `context` 抄一份。
		 *
		 * `streamFn` 本来是给测试用来跳过网络的口子；这里反过来用——它是唯一能看到「送到模型面前
		 * 的工具表长什么样」的位置，而那正是这套改动的主路径。参数照 `agent/loop.ts` 里真实那条
		 * 路径原样传。
		 */
		streamFn: async (context: LlmContext, config): Promise<AssistantMessage> => {
			observed.toolTables.push(context.tools.map((tool) => tool.name));
			observed.prompts.push(context.systemPrompt);
			const stream = streamAssistant(config.provider, config.model, context, {
				signal: config.signal,
				thinking: config.thinking,
				maxTokens: config.maxTokens,
				temperature: config.temperature,
				retryAttempts: config.retryAttempts,
				retryPolicy: config.retryPolicy,
			});
			let step = await stream.next();
			while (!step.done) step = await stream.next();
			return step.value;
		},
	});

	try {
		await session.initialize();
		await session.prompt([{ type: "text", text: scenario.prompt }]);
		observed.turns = session.log.messages.length;
		const last = [...session.log.messages].reverse().find((m) => m.role === "assistant");
		observed.stopReason = last?.role === "assistant" ? (last.stopReason ?? "?") : "没有 assistant 消息";
		observed.answer =
			last?.role === "assistant"
				? last.content
						.filter((c): c is Extract<typeof c, { type: "text" }> => c.type === "text")
						.map((c) => c.text)
						.join("")
				: "";
	} catch (cause) {
		observed.notices.push(`prompt 抛了：${cause instanceof Error ? cause.message : String(cause)}`);
	} finally {
		await session.dispose?.();
		await rm(root, { recursive: true, force: true, maxRetries: 4 });
	}
	return observed;
}

const home = await borrowProfile();
process.env.LYRA_HOME = home;

/*
 * `loadSettings`，不是读文件再 `normalizeSettings`。
 *
 * `settings.json` 里的 `apiKey` 是空的——真正的密钥封在 `credentials.json` 里，由 `loadSettings`
 * 经 `vault.key` 解出来。自己读文件跑，每一次请求都是空密钥，模型回一条 `stopReason: "error"`、
 * 内容为空的消息，而那看起来跟「模型读了提示词决定什么都不做」一模一样。第一版就是这么骗过
 * 自己的：四个场景的工具表全对，四个模型全都「没调任何工具」。
 */
const base: Settings = { ...(await loadSettings()), defaultModelId: MODEL_ID, permissionMode: "full" };
const provider = base.providers.find((p) => p.models.some((m) => m.id === MODEL_ID));
if (!provider) throw new Error(`配置里没有 ${MODEL_ID}`);
process.stdout.write(`模型 ${MODEL_ID} · 供应商 ${provider.name}（${provider.api}）\n`);

const problems: string[] = [];
try {
	for (const scenario of SCENARIOS) {
		process.stdout.write(`\n${"═".repeat(72)}\n${scenario.name}\n  预期：${scenario.expect}\n`);
		const seen = await run(scenario, base, home);

		const hadTask = seen.toolTables.some((table) => table.includes("task"));
		process.stdout.write(`\n  工具表里有 task    ${hadTask ? "有" : "没有"}（预期${scenario.expectTaskTool ? "有" : "没有"}）\n`);
		if (hadTask !== scenario.expectTaskTool) problems.push(`${scenario.name}：工具表跟预期不符`);

		process.stdout.write(`  模型调用的工具    ${seen.calls.length > 0 ? seen.calls.map((c) => c.name).join(" → ") : "（一个都没调）"}\n`);
		const tasks = seen.calls.filter((c) => c.name === "task");
		if (tasks.length > 0) {
			for (const call of tasks) process.stdout.write(`    task(subagent_type=${JSON.stringify(call.args.subagent_type ?? "general")})\n`);
		}
		process.stdout.write(`  真的派出去了      ${seen.dispatched.length > 0 ? seen.dispatched.join("、") : "无"}\n`);
		if (seen.refusals.length > 0) {
			for (const refusal of seen.refusals) {
				process.stdout.write(`  被挡下的          ${refusal.name}：${refusal.text.replace(/\s+/g, " ").slice(0, 96)}…\n`);
			}
		}
		// 提示词里那段派活的话，确认它真的送出去了——而不是只存在于我们的单元测试里。
		const note = seen.prompts[0]?.match(/(用户把子代理关掉了[^\n]*|这一轮的推理等级[^\n]*)/)?.[0] ?? "（没找到派活那一段）";
		process.stdout.write(`  提示词里那一段    ${note.slice(0, 88)}…\n`);
		process.stdout.write(`  停止原因          ${seen.stopReason}   （日志里 ${seen.turns} 条消息）\n`);
		for (const notice of seen.notices) process.stdout.write(`  ⚠ ${notice.replace(/\s+/g, " ").slice(0, 220)}\n`);
		process.stdout.write(`  模型最后说        ${seen.answer.replace(/\s+/g, " ").slice(0, 150)}…\n`);

		// 每个场景各自的那条断言。
		if (scenario.name.startsWith("②")) {
			if (seen.calls.some((c) => c.name === "task")) problems.push("② 关掉之后模型仍然调了 task");
			const found = /format|report|invoice|mailer/i.test(seen.answer);
			if (!found) problems.push("② 模型没自己把答案找出来——关掉派活不该让它答不上来");
		}
		if (scenario.name.startsWith("③") && !seen.dispatched.includes("explore")) {
			problems.push("③ 点名了却没派出 explore");
		}
		if (scenario.name.startsWith("④") || scenario.name.startsWith("⑤")) {
			const tag = scenario.name.slice(0, 1);
			const blocked = seen.refusals.filter((r) => r.name === "task" && /关掉了/.test(r.text));
			const extra = seen.dispatched.filter((name) => name !== "explore");
			// 唯一不能接受的结果：没点名的那个真的跑起来了。
			if (extra.length > 0) problems.push(`${tag} 没点名的 ${extra.join("、")} 被放过去了`);
			const tried = seen.calls.filter((c) => c.name === "task" && c.args.subagent_type !== "explore").length;
			if (tried > blocked.length) problems.push(`${tag} 试了 ${tried} 次派没点名的，只挡下 ${blocked.length} 次`);
			process.stdout.write(
				`  兜底这一关        ${tried === 0 ? "模型自己忍住了，没试着多派（软约束够硬）" : `模型试了 ${tried} 次，全部被挡回`}\n`,
			);
		}
	}

	process.stdout.write(`\n${"═".repeat(72)}\n`);
	if (problems.length === 0) process.stdout.write(`${SCENARIOS.length} 个场景都符合预期。\n`);
	else for (const problem of problems) process.stdout.write(`✗ ${problem}\n`);
	process.exitCode = problems.length === 0 ? 0 : 1;
} finally {
	await rm(home, { recursive: true, force: true, maxRetries: 4 });
}
