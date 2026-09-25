import type { RetryPolicySource } from "../config/retry-policy.ts";
/**
 * The agent loop.
 *
 * One turn = one assistant response plus every tool it asked for. The loop keeps turning
 * while the model emits tool calls, and drains a steering queue between turns so the user
 * can redirect a running agent without cancelling it.
 */

import { REPEAT_WARN, RepetitionWatch } from "./repetition.ts";
import type { RuleMatch } from "../rules/stream.ts";
import { extractPaths } from "../rules/stream.ts";
import { failTruncatedCalls, runTools } from "./tool-run.ts";
import { streamAssistant } from "../ai/index.ts";
import { dropUneventful, stripOversizedToolResults } from "../runtime/prune.ts";
import type { ArtifactSink } from "../runtime/prune.ts";
import { AgedToolPruner } from "../runtime/aged-prune.ts";
import { stripStaleHandles } from "../runtime/model-switch.ts";
import { clearActiveSkill, syncSkillContext } from "../skills/tool.ts";
import type { Compaction } from "../runtime/compaction.ts";
import type {
	ApprovalDecision,
	ApprovalRequest,
	AssistantMessage,
	LlmContext,
	Message,
	ModelConfig,
	ProviderConfig,
	ThinkingLevel,
	Tool,
	ToolContext,
	ToolResult,
} from "../types.ts";
import type { AgentEventSink } from "./events.ts";

export interface AgentRunConfig {
	sessionId: string;
	cwd: string;
	provider: ProviderConfig;
	model: ModelConfig;
	/**
	 * 这场对话此刻该用哪个模型——由会话给，一轮之内也能变。
	 *
	 * `provider` / `model` 是这一轮开始时的那个。从前整轮都用它：人在一轮中途换了模型，剩下的
	 * 几十个请求照旧发给旧的；旧的上游坏了、正在一刻不停地重试时，换模型等于没换——界面上写着
	 * 「Model B」，服务器收到的一直是 a（`e2e/edit-resend-model-probe.ts` 量出来的）。重试策略早就
	 * 是每次重试前现读的（`retry-policy.ts` 的 `RetryPolicySource`），模型是同一个道理。
	 *
	 * 省略就是整轮不变：子代理、侧聊、评测、测试都是这样。
	 */
	liveModel?: LiveModel;
	systemPrompt: string;
	tools: Tool[];
	messages: Message[];
	thinking?: ThinkingLevel;
	/** Attempts per request, including the first; see `Settings.retryAttempts`. */
	retryAttempts?: number;
	retryPolicy?: RetryPolicySource;
	maxTokens?: number;
	temperature?: number;
	maxTurns?: number;
	/**
	 * 盯着「这一轮有没有在原地打转」的那只表，由调用方给，**跨整条续跑链共用一只**。
	 *
	 * 不在这里 `new` 的原因是这个函数会被续跑反复调用（`runtime/continuation.ts`）：每次新建一只，
	 * 计数就清零，于是跑满两百轮换来的全部观察在续跑的瞬间归零，看门狗永远攒不够。真实日志里那个
	 * 会话跑了 588 轮、agent 起停五次，而每一段都以为自己是第一段。
	 *
	 * 省略时自己建一只——单次调用（子代理、评测、测试）本来就没有「上一段」。
	 */
	repetition?: RepetitionWatch;
	pruner?: AgedToolPruner;
	artifacts?: ArtifactSink;
	signal?: AbortSignal;
	/** Session-scoped scratch space shared by every tool. */
	state?: Map<string, unknown>;
	requestApproval?: (request: ApprovalRequest) => Promise<ApprovalDecision>;
	/** Passed through to the tools; see `ToolContext.sandboxMode`. */
	sandboxMode?: ToolContext["sandboxMode"];
	/** Passed through to the tools; see `ToolContext.sandboxNetwork`. */
	sandboxNetwork?: ToolContext["sandboxNetwork"];
	/** Passed through to the tools; see `ToolContext.allowedHosts`. */
	allowedHosts?: ToolContext["allowedHosts"];
	/** Passed through to the tools; see `ToolContext.allowedPaths`. */
	allowedPaths?: ToolContext["allowedPaths"];
	/** Passed through to the tools; see `ToolContext.projectRoots`. */
	projectRoots?: ToolContext["projectRoots"];
	/** Passed through to the tools; see `ToolContext.writePreview`. */
	writePreview?: ToolContext["writePreview"];
	spawnSubAgent?: ToolContext["spawnSubAgent"];
	/** The session's address space; see `ToolContext.resources`. */
	resources?: ToolContext["resources"];
	/** Where `scratch://` writes; see `ToolContext.scratchDir`. */
	scratchDir?: string;
	/** Messages the user typed while the agent was mid-turn. Drained between turns. */
	drainSteering?: () => Message[];
	/**
	 * Called before each request. Return a replacement history to compact it when the conversation
	 * approaches the context window, along with what to record so the compaction outlives this run.
	 */
	compact?: (messages: Message[], model: ModelConfig) => Promise<Compaction | null>;
	/**
	 * Replaces the provider call. Tests script turns through this so loop behaviour can be
	 * checked without a network round trip.
	 */
	streamFn?: (context: LlmContext, config: AgentRunConfig) => Promise<AssistantMessage>;
	/**
	 * Runs before a tool executes. Returning `block` turns the call into an error result the
	 * model can react to, without ending the turn.
	 */
	/**
	 * Watching the stream for rule violations, and what to inject when one fires.
	 *
	 * Optional because the loop must stay usable without it — tests, subagents and the CLI all
	 * construct a run directly. When absent nothing is buffered and nothing is matched.
	 */
	rules?: {
		/** Fed every delta; returns the rules that just became eligible. */
		observe(chunk: { source: "text" | "thinking" | "tool"; delta: string; key: string; toolName?: string; paths?: string[] }): RuleMatch[];
		/** Turn boundary, for buffers and repeat accounting. */
		startTurn(): void;
		/** Called once a correction has actually been delivered. */
		markFired(matches: RuleMatch[]): void;
		/** The hidden message injected before the retry. */
		render(matches: RuleMatch[]): Message;
		/** The hidden message delivered at the end of a turn, for rules that did not interrupt. */
		renderReminder(matches: RuleMatch[]): Message;
	};

	beforeToolCall?: (call: {
		toolName: string;
		args: Record<string, unknown>;
	}) => Promise<{ block?: boolean; reason?: string } | void>;
	/** Runs after a tool executes; may replace the result the model sees. */
	afterToolCall?: (call: {
		toolName: string;
		args: Record<string, unknown>;
		result: ToolResult;
	}) => Promise<{ result?: ToolResult } | void>;
}

/**
 * 会话此刻设定的模型，和它什么时候变。见 `AgentRunConfig.liveModel`。
 */
export interface LiveModel {
	/** 现在该用哪个。解析不出来（模型被删了）就是 null，循环接着用手上那个。 */
	current(): { provider: ProviderConfig; model: ModelConfig } | null;
	/**
	 * 它变了的时候通知一声，返回取消订阅。
	 *
	 * 光靠每轮开头读一次不够：一个正在重试的请求可能要等很久才轮到下一轮，而人换模型恰恰是因为
	 * 那个请求在等一个坏掉的上游。
	 */
	onChange(listener: () => void): () => void;
	/**
	 * 循环真的换过去了：从下一个请求起用 `model`，在这之前的历史都出自别的模型。
	 *
	 * 会话据此把「换模型的位置」挪到此刻——人按下切换和循环真正换过去之间，旧模型可能又说完了
	 * 一句，那一句的供应商句柄同样不能交给新模型。
	 */
	adopted?(model: ModelConfig): void;
}

export interface AgentRunResult {
	messages: Message[];
	/**
	 * 这一轮结束时，模型眼里的整段历史——压缩、裁剪之后的那一份，末尾接着这一轮产出的消息。
	 *
	 * `messages` 只有这一轮新产出的部分，而压缩发生在循环内部，调用方从外面看不见。要在同一段
	 * 上下文上接着跑（子代理续跑就是），拿这一份原样往后接：前缀跟上一次请求逐字相同，供应商的
	 * 前缀缓存才接得上。从转录重建会丢掉压缩边界，也会把日期块挪位置，缓存从第二条起全部作废。
	 *
	 * 可选：换进来的别的循环（`useAgentLoop`）不一定给，调用方要有退路。
	 */
	view?: Message[];
	reason: "done" | "aborted" | "error" | "max_turns" | "stalled";
	error?: string;
	/**
	 * The run died on the connection, not on anything it asked for.
	 *
	 * Only meaningful with `reason: "error"`. It is what tells a caller whether going back is worth
	 * anything: a dropped socket will likely be gone in ten seconds, a rejected key will not.
	 */
	retryable?: boolean;
}

/**
 * Whether a reply failed because the far end would not accept the request as posted.
 *
 * Narrow on purpose. A 401 is a key, a 404 is a URL, a 429 is a queue — none of them get better
 * because the history got smaller, and retrying them would spend a request to learn what the
 * status code already said. What is worth one more attempt is the range that means "this payload
 * is not something I can process": a plain 400, a body that is too large, an entity that failed
 * validation.
 */
function rejectedContent(assistant: AssistantMessage): boolean {
	if (assistant.stopReason !== "error" || assistant.errorRetryable) return false;
	/*
	 * 问分类的结果，而不是对着一行字做模式匹配。
	 *
	 * 从前这里读的是 `errorMessage` 的开头像不像 `HTTP 400`——而那行字是给人看的，措辞一变这条
	 * 判断就悄悄失效。`check-request` 是同一件事被写下来的样子：请求体本身不被接受，值得裁掉历史
	 * 再试一次。旧会话里没有 `failure`，所以正则留着兜底。
	 */
	if (assistant.failure) return assistant.failure.hint === "check-request";
	return /^HTTP (400|413|422)\b/.test(assistant.errorMessage ?? "");
}

const DEFAULT_MAX_TURNS = 200;
/** Empty-response retries per run; tool calls must not replenish this budget. */
const MAX_NUDGES = 3;

/** Appended to a lone todo_write's result. The wording names the cost, not just the rule. */
export const SOLO_TODO_NOTE =
	"（这一轮只调了 todo_write，没有做任何实际工作。从下一轮起，把清单更新和真正的下一步——读文件、改代码、跑命令——放在同一次回复里；单独更新清单是浪费一次往返。）";

export async function runAgent(config: AgentRunConfig, emit: AgentEventSink): Promise<AgentRunResult> {
	const messages = [...config.messages];
	/** Messages produced by this run, so the caller can append them to the persisted session. */
	const produced: Message[] = [];
	const state = config.state ?? new Map<string, unknown>();
	const maxTurns = config.maxTurns ?? DEFAULT_MAX_TURNS;
	/** Empty-response retries spent in this run. */
	let nudges = 0;
	/** Watches for a turn that has stopped learning anything; see `repetition.ts`. */
	const repetition = config.repetition ?? new RepetitionWatch();
	const pruner = config.pruner ?? new AgedToolPruner();
	/**
	 * When the last request went out, for judging whether the provider's prefix cache is still warm.
	 *
	 * Undefined on the first turn, which reads as "no cache to protect" — correct, since there has
	 * been no request to cache anything from.
	 */
	let lastRequestAt: number | undefined;

	await emit({ type: "agent_start", sessionId: config.sessionId });

	let turn = 0;
	/**
	 * Steering messages drained at the end of a turn, waiting to be injected at the start of
	 * the next one. `drainSteering` empties the queue, so whatever it returns must be held
	 * here — reading only its length would discard the user's message and leave the loop
	 * prompting the model with no new input.
	 */
	let carried: Message[] = [];
	/**
	 * Reminders from rules that matched without interrupting.
	 *
	 * Delivered at the start of the next turn rather than folded into the tool result that tripped
	 * them. That is later than it could be, and it is the honest place for it: `interrupt: never`
	 * means "this is not urgent enough to stop for", and a message that arrives with the next turn
	 * says exactly that. It also leaves tool results the shape every renderer expects.
	 */
	let reminders: Message[] = [];

	/*
	 * 这一轮此刻用的模型。起点是调用方给的那个，人中途换了就跟着换——见 `liveModel`。
	 *
	 * 只在循环顶上换：一个请求发出去之后它就是它，换人发生在两个请求之间。唯一的例外是一个还
	 * 什么都没说出口的请求（在连、在重试），那个会被放手，见 `streamTurn`。
	 */
	let active: AgentRunConfig = config;

	while (true) {
		if (config.signal?.aborted) return finish("aborted");
		if (turn >= maxTurns) return finish("max_turns");
		turn += 1;
		await emit({ type: "turn_start", turn });

		const drained = config.drainSteering?.() ?? [];
		/*
		 * Something the person just said ends the previous skill's tool restriction.
		 *
		 * Their message is a new instruction, and a restriction left standing across it would
		 * silently refuse work they had just asked for — with an explanation naming a skill they
		 * may not remember loading.
		 */
		if (drained.some((message) => message.role === "user" && !message.synthetic)) clearActiveSkill(state);

		const steering = [...reminders, ...carried, ...drained];
		reminders = [];
		carried = [];
		for (const steered of steering) {
			messages.push(steered);
			produced.push(steered);
			await emit({ type: "message_start", message: steered });
			await emit({ type: "message_end", message: steered });
		}

		/*
		 * 人换了模型：从这个请求起换过去。
		 *
		 * 手上这份历史全出自旧模型，它的供应商句柄交给新模型只会被整条拒掉（见 `model-switch.ts`），
		 * 所以先摘掉。按「切换那一刻之前的都剥」来，不按每条消息的 `model` 字段比：有的供应商回报的
		 * 模型名跟配置里的对不上（带日期、带别名），逐条比会把同一个模型自己的思考签名也剥掉。
		 */
		const wanted = config.liveModel?.current();
		if (wanted && wanted.model.id !== active.model.id) {
			const cleaned = stripStaleHandles(messages, messages.length);
			if (cleaned !== messages) {
				messages.length = 0;
				messages.push(...cleaned);
			}
			active = { ...config, provider: wanted.provider, model: wanted.model };
			config.liveModel?.adopted?.(wanted.model);
		}

		/*
		 * Tidy away the results that were never going to be read again, when it is free to do so.
		 *
		 * Different from the pass inside compaction, which runs when the window is nearly full and
		 * takes the cache hit because the alternative is a model call.
		 *
		 * Worth knowing what the cache check actually guards here, because it is not what it looks
		 * like. Within a running turn the result being cleared is almost always the newest message,
		 * with nothing under it — no cache has ever included it, so clearing it costs nothing and
		 * `worthPruning` says yes every time. Where it earns its place is a *resumed* conversation:
		 * the history loaded from the log carries empty results from turns that ended before this
		 * process started, and those do sit under everything that came after.
		 */
		const tidied = pruner.prepare(dropUneventful(messages, { lastRequestAt }), { lastRequestAt }, config.artifacts);
		if (tidied !== messages) {
			messages.length = 0;
			messages.push(...tidied);
		}

		if (config.compact) {
			const before = messages.length;
			const compaction = await config.compact(messages, active.model);
			if (compaction) {
				messages.length = 0;
				messages.push(...compaction.messages);
				/*
				 * The summary and the boundary travel with the event because the event is where they
				 * are stored. Everything below this line in the loop works on `messages`, which is
				 * this run's own array and dies with it — so a compaction that went no further than
				 * here was undone the moment the next prompt rebuilt its history from the log.
				 */
				await emit({
					type: "compacted",
					before,
					after: compaction.messages.length,
					summary: compaction.summary,
					kept: compaction.kept,
				});
			}
		}

		// Compaction can wait on a model; cancellation during that await must prevent a new request.
		if (config.signal?.aborted) return finish("aborted");
		const context: LlmContext = {
			systemPrompt: config.systemPrompt,
			messages,
			tools: config.tools.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters })),
		};

		lastRequestAt = Date.now();
		let { message: assistant, ruleMatches, deferredMatches, switched } = await streamTurn(active, context, emit);
		/*
		 * 还没说出一个字就被换下的请求：什么都不留，回到顶上用新模型从同一处重来。
		 *
		 * 不算一轮——它什么都没做，算进去等于让人为换模型付一轮的检查点额度。
		 */
		if (switched) {
			turn -= 1;
			continue;
		}

		/*
		 * The far end refused the request itself. Try once more without the biggest thing in it.
		 *
		 * A 4xx is not a transport failure, so nothing retries it — correctly, because asking the
		 * same question again gets the same answer. The trouble is that the question is the
		 * *history*, and history does not change on its own: every later request carries the same
		 * rejected payload, so the conversation is not merely failing, it is sealed. Retry fails.
		 * Continue fails. Opening it tomorrow fails.
		 *
		 * One tool result is very often the whole of it — a `gh api` dump, a 2,000-line file, a
		 * grep across a build directory — and gateways translating between formats have limits and
		 * bugs that no client can enumerate. So rather than guessing which, this drops the oversized
		 * results to a line each and asks once more. It costs one request in the case that was
		 * already lost, and nothing at all in every case that was not.
		 */
		if (rejectedContent(assistant)) {
			const stripped = stripOversizedToolResults(messages);
			if (stripped !== messages) {
				await emit({
					type: "notice",
					level: "warn",
					message: "模型服务拒收了这次请求。已把其中过大的工具输出压成一行，正在重试。",
				});
				messages.length = 0;
				messages.push(...stripped);
				({ message: assistant, ruleMatches, deferredMatches } = await streamTurn(active, { ...context, messages }, emit));
			}
		}
		/*
		 * A rule interrupted this turn: drop what was said and say it again, better informed.
		 *
		 * The partial output is discarded rather than kept. Leaving half a violation in the
		 * history invites the model to continue it, and the whole point of interrupting mid-
		 * sentence was to stop that sentence from existing.
		 *
		 * `config.signal` is checked because both signals abort the same stream: if the user
		 * pressed stop in the same moment a rule fired, the user wins.
		 */
		if (ruleMatches.length > 0 && assistant.stopReason === "aborted" && !config.signal?.aborted && config.rules) {
			const injection = config.rules.render(ruleMatches);
			config.rules.markFired(ruleMatches);
			messages.push(injection);
			produced.push(injection);
			await emit({ type: "message_start", message: injection });
			await emit({ type: "message_end", message: injection });
			await emit({
				type: "rule_triggered",
				rules: ruleMatches.map((m) => ({
					name: m.rule.name,
					path: m.rule.path,
					excerpt: m.excerpt,
					source: m.source,
					toolName: m.toolName,
				})),
			});
			continue;
		}

		if (deferredMatches.length > 0 && config.rules && assistant.stopReason !== "aborted" && assistant.stopReason !== "error") {
			config.rules.markFired(deferredMatches);
			reminders.push(config.rules.renderReminder(deferredMatches));
			await emit({
				type: "rule_triggered",
				rules: deferredMatches.map((m) => ({
					name: m.rule.name,
					path: m.rule.path,
					excerpt: m.excerpt,
					source: m.source,
					toolName: m.toolName,
					deferred: true,
				})),
			});
		}

		messages.push(assistant);
		produced.push(assistant);

		if (assistant.stopReason === "aborted" || assistant.stopReason === "error") {
			/*
			 * A call the model never finished saying still has to be answered.
			 *
			 * A reply cut off mid-stream keeps whatever it had emitted, and that can include an
			 * opened tool call. Anthropic rejects any request carrying a `tool_use` with no result
			 * after it — so the orphan does not end one turn, it ends the conversation: every later
			 * request fails on the same 400, including the one sent to pick the work back up. The
			 * call is failed rather than run, because arguments that stopped arriving halfway are
			 * not arguments.
			 */
			const unanswered = assistant.content.filter((c) => c.type === "toolCall");
			if (unanswered.length > 0) {
				const why =
					assistant.stopReason === "aborted"
						? "the turn was stopped before it could run"
						: "the connection dropped while the call was still arriving, so its arguments are incomplete";
				for (const result of await failTruncatedCalls(unanswered, emit, why)) {
					messages.push(result);
					produced.push(result);
				}
			}
			if (assistant.stopReason === "aborted") return finish("aborted");
			return finish("error", assistant.errorMessage, assistant.errorRetryable);
		}

		const toolCalls = assistant.content.filter((c) => c.type === "toolCall");
		if (toolCalls.length === 0) {
			await emit({ type: "turn_end", message: assistant, toolResults: [] });
			// A steering message that arrived during the final stream still deserves an answer.
			carried = config.drainSteering?.() ?? [];
			if (carried.length > 0) continue;

			// A checklist cannot distinguish a question from abandoned work. Text yields to the
			// person; only an actually empty response earns a bounded retry.
			const saidNothing = assistant.content.every((part) => part.type !== "text" || !part.text.trim());
			if (saidNothing && nudges < MAX_NUDGES) {
				nudges += 1;
				const nudgeText = "（自动继续）上一条回复没有正文。请给出回答；如果需要用户补充信息，请直接提问并等待回复。";

				const nudge: Message = {
					role: "user",
					content: [
						{
							type: "text",
							text: nudgeText,
						},
					],
					timestamp: Date.now(),
					/*
					 * The runtime is speaking, not the person.
					 *
					 * It has to be a user message because that is the only role the model will take
					 * an instruction in — but the window must not draw it as one. Rendered in the
					 * human's own bubble it reads as something they typed, and the transcript then
					 * shows them asking for things they never asked for.
					 */
					synthetic: true,
				};
				messages.push(nudge);
				produced.push(nudge);
				await emit({ type: "message_start", message: nudge });
				await emit({ type: "message_end", message: nudge });
				continue;
			}
			return saidNothing
				? finish("error", "模型连续返回空回复，请重试或更换模型。")
				: finish("done");
		}

		syncSkillContext(state, messages);
		const toolResults =
			assistant.stopReason === "length"
				? await failTruncatedCalls(toolCalls, emit)
				: await runTools(toolCalls, config, state, emit);

		/*
		 * A reply that only updated the list did nothing else, and will spend another round trip
		 * doing it. Said in the result of that very call — where the model reads next, about the
		 * thing it just did — rather than in a prompt it has already skimmed past. Measured before
		 * this: nearly half the tool turns on a three-step task were a lone todo_write (06 §6.3).
		 */
		if (toolCalls.length === 1 && toolCalls[0].name === "todo_write" && config.tools.length > 1) {
			for (const result of toolResults) {
				if (result.role === "toolResult" && !result.isError) result.content.push({ type: "text", text: SOLO_TODO_NOTE });
			}
		}

		for (const result of toolResults) {
			messages.push(result);
			produced.push(result);
		}

		await emit({ type: "turn_end", message: assistant, toolResults });

		/*
		 * 一个工具说了「到此为止」，那就到此为止。
		 *
		 * `ToolResult.terminate` 这个字段一直都在，只是从来没有人写、也从来没有人读——于是唯一需要
		 * 它的那个工具只能靠模型自觉收尾。`yield` 的语义是「交付即结束」：结果已经在 `state` 里，
		 * 派它来的人拿的就是那个对象，此后再问模型一句话，答案不会被任何人读到。
		 *
		 * 那一句废话的代价不是零。顺利的时候，它是一整份上下文换回来的一句「我做完了」；不顺的
		 * 时候——模型交完货真的无话可说、服务商把它转成一个没有内容的流——它就是一次空回答，而空
		 * 回答是会被重试的。开着无限重试时，这一轮不会失败，它会永远转下去：子代理的报告早就躺在
		 * `state` 里，派它来的人却一直等不到。真实日志里量到过同一个请求重发 222 次、34 分钟。
		 *
		 * 收在 `turn_end` 之后：这一轮确实完整地发生过，工具跑了、结果进了历史，只是不再问下一句。
		 */
		const terminated = toolResults.find((result) => result.terminate === true);
		if (terminated) return finish("done");

		/*
		 * Same call, same arguments, same answer — again.
		 *
		 * Told once, most models change approach. Told and ignored, the turn ends: an agent
		 * repeating a probe that has already answered the same way six times is not going to
		 * discover anything on the seventh, and the hours it would spend doing so belong to
		 * whoever is waiting for it.
		 */
		const { warn: repeated, kind, repeats } = repetition.observe(toolCalls, toolResults);

		/*
		 * 问到第三次的，不再把那份一模一样的结果重贴一遍。
		 *
		 * 这里原本是「问满六次就结束这一轮」。停下来解决不了任何问题：它既没告诉模型该怎么办，也没把
		 * 等结果的人放出来，只是把一次卡住变成一次中断。
		 *
		 * 换成纠正之后，模型收到的是一句具体的话——第几次、结果没变、它不会因为再问一次而改变——而
		 * 不是一段它三分钟前刚读过的原文。省下的是实打实的钱：真实日志里同一段 `read` 贴过 5 遍，同一个
		 * `skill` 注入过 4 次，每次 5,625 token。
		 *
		 * 只动给模型看的那一份，工具照常执行过：万一这次结果真的变了，指纹就不同，根本走不到这里。
		 */
		if (repetition.exhausted()) return finish("stalled");

		for (const [index, seen] of repeats.entries()) {
			if (seen < REPEAT_WARN) continue;
			const result = toolResults[index];
			if (!result || result.role !== "toolResult") continue;
			result.content = [
				{
					type: "text",
					text:
						`（这是你第 ${seen} 次用同样的参数调用 \`${toolCalls[index].name}\`，结果和前几次一字不差，` +
						`所以这里不再重复贴一遍。它不会因为你再问一次就改变——要么先去动它，要么换个问法。）`,
				},
			];
		}
		if (repeated) {
			/*
			 * 两条线两句话，因为说错了等于没说。
			 *
			 * 对一个每轮都在改 `offset` 的调用说「你用了同样的参数」，模型对照一眼就知道这话不成立，
			 * 于是连带着后半句一起不信——而后半句才是要紧的那句。真实记录里，一次翻了 37 页的搜索
			 * 全程没有收到任何提示；等到终于收到时，那句话描述的也不是它正在做的事。
			 */
			const text =
				kind === "probe"
					? `（自动提示）你已经连续多次切图、读切片或做像素测距。` +
						`这类探测回答不了「为什么间距是这样」——去读对应的 CSS 和组件结构，基于已有证据下结论。` +
						`不要再写新的测距脚本，也不要再切图。`
					: kind === "intent"
					? `（自动提示）你已经用不同的翻页参数把 \`${repeated}\` 的同一个问题问了很多遍。` +
						`翻页不会把答案翻出来——要么它本来就不在这里，要么该换个问法。` +
						`换个工具、换个假设，或者直接说明当前卡在哪里、需要什么。`
					: `（自动提示）你已经用同样的参数调用 \`${repeated}\` 多次，每次得到的结果都一样。` +
						`再问一次不会有新信息。换一个思路：换个工具、换个假设，或者直接说明当前卡在哪里、需要什么。`;
			const notice: Message = {
				role: "user",
				content: [{ type: "text", text }],
				timestamp: Date.now(),
				synthetic: true,
			};
			messages.push(notice);
			produced.push(notice);
			await emit({ type: "message_start", message: notice });
			await emit({ type: "message_end", message: notice });
		}
	}

	async function finish(
		reason: AgentRunResult["reason"],
		error?: string,
		retryable?: boolean,
	): Promise<AgentRunResult> {
		/*
		 * A reminder that never got a turn to ride on still has to land somewhere.
		 *
		 * Non-interrupting matches are delivered at the start of the next turn — and when the match
		 * happens on the last turn there is no next one, so it was silently dropped. Measured: a
		 * rule with `interrupt: never` fired, was marked deferred, and the model never saw it.
		 *
		 * Persisting it into the produced messages is the right home rather than a consolation
		 * prize: the reminder is about what to do *going forward*, and the conversation continues
		 * the next time the user types. It is not pushed into `messages`, which belongs to a run
		 * that is over.
		 */
		for (const reminder of reminders) {
			produced.push(reminder);
			await emit({ type: "message_start", message: reminder });
			await emit({ type: "message_end", message: reminder });
		}
		// 提醒不进 `messages`（那是这一轮自己的），但接着跑的那一段要看得见它——见 `view`。
		const view = [...messages, ...reminders];
		reminders = [];

		await emit({ type: "agent_end", reason, error });
		return { messages: produced, view, reason, error, ...(retryable ? { retryable } : {}) };
	}
}

// ---------------------------------------------------------------------------
// Streaming one assistant turn
// ---------------------------------------------------------------------------

/**
 * One assistant turn, plus whatever rules it tripped on the way.
 *
 * `ruleMatches` is non-empty only when a rule asked to interrupt: the stream was aborted
 * deliberately, and the caller is expected to discard the partial output, inject the rule, and
 * generate again from the same point.
 */
interface TurnResult {
	message: AssistantMessage;
	/** Rules that asked to interrupt: the stream was aborted and the turn should be redone. */
	ruleMatches: RuleMatch[];
	/** Rules that matched but did not interrupt: delivered once this turn has finished. */
	deferredMatches: RuleMatch[];
	/** 人换了模型，而这个请求还什么都没说出口：它被放手了，调用方该用新模型从同一处重来。 */
	switched?: boolean;
}

async function streamTurn(config: AgentRunConfig, context: LlmContext, emit: AgentEventSink): Promise<TurnResult> {
	await emit({ type: "request", provider: config.provider.id, model: config.model.modelId, thinking: config.thinking, messageCount: context.messages.length });

	/*
	 * 换模型的那一下，单独一个控制器，理由和下面规则打断那个一样：它的意思不是「停」，是「换个人
	 * 重来」，所以不能跟 `config.signal`（人按了停止）混为一谈。
	 *
	 * 只放手还什么都没说出口的请求——在连、在重试。那正是人会去换模型的时候：旧的上游坏了，这个请求
	 * 在一遍遍地等它。已经在出字的不动：它在干活，说完了下一个请求自然用新的。
	 */
	const switchAbort = new AbortController();
	let said = false;
	const unsubscribe = config.liveModel?.onChange(() => {
		const wanted = config.liveModel?.current();
		if (!said && wanted && wanted.model.id !== config.model.id) switchAbort.abort();
	});
	const switched = () => switchAbort.signal.aborted && !config.signal?.aborted;

	if (config.streamFn) {
		try {
			// 替身拿到的也是带着「换人」的那根信号，行为跟真实请求一样，才测得到。
			const message = await config.streamFn(context, { ...config, signal: AbortSignal.any([...(config.signal ? [config.signal] : []), switchAbort.signal]) });
			if (switched()) return { message, ruleMatches: [], deferredMatches: [], switched: true };
			await emit({ type: "message_start", message });
			await emit({ type: "message_end", message });
			return { message, ruleMatches: [], deferredMatches: [] };
		} finally {
			unsubscribe?.();
		}
	}

	/*
	 * How many times *this request* has been retried, which is not what either retry counts.
	 *
	 * Two of them are nested: `fetchWithRetry` for getting the connection, `retryStream` for
	 * keeping it once it is open. Each has its own budget and each numbers its attempts from 1,
	 * so passing those numbers straight through made the line on screen count 1, 2, 1, 1, 2 as
	 * control moved between the layers — and call the fifth attempt of the request "第 1 次".
	 * The user is waiting on the request, so the request is what gets counted.
	 */
	let retries = 0;

	/*
	 * A separate controller for rule interrupts.
	 *
	 * It must not be `config.signal`: that one means "the user stopped this", and the loop ends
	 * the run when it fires. A rule interrupt means the opposite — keep going, but say something
	 * first — so the two are combined for the request and told apart afterwards.
	 */
	const ruleAbort = new AbortController();
	const pendingMatches: RuleMatch[] = [];
	const deferredMatches: RuleMatch[] = [];

	const signal = AbortSignal.any([...(config.signal ? [config.signal] : []), ruleAbort.signal, switchAbort.signal]);

	const stream = streamAssistant(config.provider, config.model, context, {
		signal,
		thinking: config.thinking,
		maxTokens: config.maxTokens,
		temperature: config.temperature,
		retryAttempts: config.retryAttempts,
		retryPolicy: config.retryPolicy,
		/*
		 * Said out loud, because the alternative is a turn that appears to hang.
		 *
		 * A retry costs seconds of silence at a moment when the user is already waiting, and
		 * silence is indistinguishable from a stall. One line naming the cause turns it into
		 * something that is visibly being handled.
		 */
		onRetry: ({ delayMs, reason, failure }) => {
			retries += 1;
			void emit({ type: "retry", attempt: retries, delayMs, reason, failure });
		},
	});

	let started = false;

	/**
	 * 那次中断怎么收的场，说一句。
	 *
	 * 这里是唯一同时知道两件事的地方：重试了几次（数在上面），以及最后那条消息是什么样子。少了这
	 * 一句，界面上的「正在重连」就没有下文——它只能等着被下一轮清掉，于是「重连成功」和「窗口
	 * 闲着」在屏幕上长得一模一样。
	 */
	const settle = async (message: AssistantMessage) => {
		const failed = message.stopReason === "error";
		/*
		 * 一次都没重试过的成功没什么可说的，别的都要说。
		 *
		 * 尤其是一次都没重试过的**失败**——密钥不对、模型名写错，分类器判成 `fatal` 当场停下，一条
		 * retry 事件都不会有。要是这里也不说，界面上就只剩一片安静：转录里那句话没了，而它本来是
		 * 唯一说明发生过什么的东西。
		 */
		if (retries === 0 && !failed) return;
		await emit({
			type: "retry_settled",
			outcome: failed ? "gave_up" : "recovered",
			attempts: retries,
			failure: message.failure,
		});
	};

	/**
	 * 换了模型，这个请求放手。
	 *
	 * 没开始出流的，什么都不发、不进转录——它什么都没说，留一条空的「已停止」只会让人以为自己按了
	 * 停。开始了但一个字没有的（极少见），照常收尾，免得界面上留着一个永远在转的气泡。重试过的，
	 * 那行「正在重连」要收场，而且要说实话：不是重连上了，是换了人。
	 */
	const letGo = async (message: AssistantMessage): Promise<TurnResult> => {
		if (started) await emit({ type: "message_end", message });
		if (retries > 0) {
			const to = config.liveModel?.current()?.model.name;
			await emit({ type: "retry_settled", outcome: "switched", attempts: retries, ...(to ? { switchedTo: to } : {}) });
		}
		return { message, ruleMatches: [], deferredMatches: [], switched: true };
	};

	try {
	while (true) {
		const next = await stream.next();
		if (next.done) {
			if (switched()) return await letGo(next.value);
			await settle(next.value);
			return { message: next.value, ruleMatches: pendingMatches, deferredMatches };
		}
		const event = next.value;

		switch (event.type) {
			case "start":
				started = true;
				await emit({ type: "message_start", message: event.partial });
				break;
			case "text_delta":
			case "thinking_delta":
			case "toolcall_delta":
			case "toolcall_end":
				said = true;
				await emit({ type: "message_update", message: event.partial, delta: event });
				if (config.rules && event.type !== "toolcall_end") observeDelta(config.rules, event, pendingMatches, deferredMatches, ruleAbort);
				break;
			case "done":
			case "error": {
				const message = event.message;
				if (switched()) {
					const tail = await stream.next();
					return await letGo(tail.done ? tail.value : message);
				}
				if (!started) await emit({ type: "message_start", message });
				await emit({ type: "message_end", message });
				// Drain the generator so its `return` value is the authoritative final message.
				const tail = await stream.next();
				const settled = tail.done ? tail.value : message;
				await settle(settled);
				return { message: settled, ruleMatches: pendingMatches, deferredMatches };
			}
			default:
				break;
		}
	}
	} finally {
		unsubscribe?.();
	}
}

/**
 * Route one stream delta to the rule monitor, and abort if a rule wants to interrupt.
 *
 * The tool case needs the buffer keyed per call: two tools streaming their arguments at once
 * would otherwise share one buffer, and a pattern could match across the seam between them —
 * a rule firing on text that no single call ever contained.
 */
function observeDelta(
	rules: NonNullable<AgentRunConfig["rules"]>,
	event: { type: string; delta: string; index: number; partial: AssistantMessage },
	pending: RuleMatch[],
	deferred: RuleMatch[],
	abort: AbortController,
): void {
	let chunk: Parameters<typeof rules.observe>[0];

	if (event.type === "text_delta") {
		chunk = { source: "text", delta: event.delta, key: "text" };
	} else if (event.type === "thinking_delta") {
		chunk = { source: "thinking", delta: event.delta, key: "thinking" };
	} else {
		const call = event.partial.content[event.index];
		if (call?.type !== "toolCall") return;
		const partialArgs = typeof call.arguments === "string" ? call.arguments : JSON.stringify(call.arguments ?? {});
		chunk = { source: "tool", delta: event.delta, key: `tool:${call.id}`, toolName: call.name, paths: extractPaths(partialArgs) };
	}

	const matches = rules.observe(chunk);
	if (matches.length === 0) return;

	/*
	 * `interrupt` decides whether this is worth stopping mid-sentence.
	 *
	 * A rule set to `never`, or scoped away from this source, still matched — it is delivered at
	 * the end of the turn instead. Dropping it would make `interrupt: never` a setting that
	 * silently disables the rule, which is the worst thing a setting can do.
	 */
	for (const match of matches) {
		const interrupts =
			match.rule.interrupt === "never"
				? false
				: match.rule.interrupt === "prose-only"
					? chunk.source !== "tool"
					: match.rule.interrupt === "tool-only"
						? chunk.source === "tool"
						: true;
		const bucket = interrupts ? pending : deferred;
		if (!bucket.some((existing) => existing.rule.name === match.rule.name)) bucket.push(match);
	}

	if (pending.length > 0 && !abort.signal.aborted) abort.abort();
}
