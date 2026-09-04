/**
 * The agent loop.
 *
 * One turn = one assistant response plus every tool it asked for. The loop keeps turning
 * while the model emits tool calls, and drains a steering queue between turns so the user
 * can redirect a running agent without cancelling it.
 */

import { RepetitionWatch } from "./repetition.ts";
import type { RuleMatch } from "../rules/stream.ts";
import { extractPaths } from "../rules/stream.ts";
import { failTruncatedCalls, runTools } from "./tool-run.ts";
import { streamAssistant } from "../ai/index.ts";
import { stripOversizedToolResults } from "../runtime/prune.ts";
import { readTodos } from "../tools/todo.ts";
import type { Compaction } from "../runtime/compaction.ts";
import type {
	ApprovalDecision,
	ApprovalRequest,
	AssistantMessage,
	LlmContext,
	Message,
	ModelConfig,
	ProviderConfig,
	SubAgentInput,
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
	systemPrompt: string;
	tools: Tool[];
	messages: Message[];
	thinking?: ThinkingLevel;
	/** Attempts per request, including the first; see `Settings.retryAttempts`. */
	retryAttempts?: number;
	maxTokens?: number;
	temperature?: number;
	maxTurns?: number;
	signal?: AbortSignal;
	/** Session-scoped scratch space shared by every tool. */
	state?: Map<string, unknown>;
	requestApproval?: (request: ApprovalRequest) => Promise<ApprovalDecision>;
	/** Passed through to the tools; see `ToolContext.sandboxMode`. */
	sandboxMode?: ToolContext["sandboxMode"];
	/** Passed through to the tools; see `ToolContext.allowedHosts`. */
	allowedHosts?: ToolContext["allowedHosts"];
	/** Passed through to the tools; see `ToolContext.writePreview`. */
	writePreview?: ToolContext["writePreview"];
	spawnSubAgent?: (input: SubAgentInput) => Promise<string>;
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

export interface AgentRunResult {
	messages: Message[];
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
	return /^HTTP (400|413|422)\b/.test(assistant.errorMessage ?? "");
}

const DEFAULT_MAX_TURNS = 200;
/**
 * How many times in a row the agent may be told to get on with it.
 *
 * Enough to carry a plan over a couple of pauses, few enough that a model which has genuinely
 * finished — but left an item it decided against — is not argued with indefinitely.
 */
const MAX_NUDGES = 3;

export async function runAgent(config: AgentRunConfig, emit: AgentEventSink): Promise<AgentRunResult> {
	const messages = [...config.messages];
	/** Messages produced by this run, so the caller can append them to the persisted session. */
	const produced: Message[] = [];
	const state = config.state ?? new Map<string, unknown>();
	const maxTurns = config.maxTurns ?? DEFAULT_MAX_TURNS;
	/** Consecutive turns that talked about the plan without touching it. */
	let nudges = 0;
	/** Watches for a turn that has stopped learning anything; see `repetition.ts`. */
	const repetition = new RepetitionWatch();

	await emit({ type: "agent_start", sessionId: config.sessionId });

	let turn = 0;
	/**
	 * Steering messages drained at the end of a turn, waiting to be injected at the start of
	 * the next one. `drainSteering` empties the queue, so whatever it returns must be held
	 * here — reading only its length would discard the user's message and leave the loop
	 * prompting the model with no new input.
	 */
	let carried: Message[] = [];

	while (true) {
		if (config.signal?.aborted) return finish("aborted");
		if (turn >= maxTurns) return finish("max_turns");
		turn += 1;
		await emit({ type: "turn_start", turn });

		const steering = [...carried, ...(config.drainSteering?.() ?? [])];
		carried = [];
		for (const steered of steering) {
			messages.push(steered);
			produced.push(steered);
			await emit({ type: "message_start", message: steered });
			await emit({ type: "message_end", message: steered });
		}

		if (config.compact) {
			const before = messages.length;
			const compaction = await config.compact(messages, config.model);
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

		const context: LlmContext = {
			systemPrompt: config.systemPrompt,
			messages,
			tools: config.tools.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters })),
		};

		let { message: assistant, ruleMatches } = await streamTurn(config, context, emit);

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
				({ message: assistant, ruleMatches } = await streamTurn(config, { ...context, messages }, emit));
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

			/*
			 * Saying what comes next is not the same as stopping.
			 *
			 * On long work a model regularly ends a turn with a sentence like "backend done, now
			 * the SSR pages" and no tool call at all — it narrated the next step instead of taking
			 * it. Read literally that is the end of the run, and eight-step plans were being
			 * abandoned three steps in with nothing wrong and nothing said.
			 *
			 * Its own task list is the evidence. If items remain unfinished, the work is not over
			 * and it is asked to carry on. Bounded, and reset by any turn that actually uses a
			 * tool, so a model that has genuinely stopped is nudged a few times and then left
			 * alone rather than talked at forever.
			 */
			/*
			 * An empty reply is not an answer.
			 *
			 * A turn that produced no tool call *and* no words has said nothing — it happens when a
			 * model spends its turn thinking and emits nothing after it. Read literally that is the
			 * end of the run, and a whole task once ended this way four messages in with an empty
			 * workspace and no explanation. There is no plan to consult in that case, because
			 * nothing has happened yet; the emptiness is the evidence.
			 */
			const saidNothing = assistant.content.every((part) => part.type !== "text" || !part.text.trim());
			const unfinished = readTodos(state).filter((todo) => todo.status !== "completed");
			/*
			 * Both tests are facts about the run, not readings of what the reply said.
			 *
			 * The tempting third case is a turn that describes a plan and stops without starting it,
			 * and it cannot be decided here: whether a reply owed the user an action depends on what
			 * they asked for, and that is not in the reply. Matching the wording instead catches
			 * every polite sign-off on a finished answer and every question worth asking, and
			 * answers them by demanding a tool call there is no work for. A plan the session should
			 * hold on to goes in `todo_write`, where it becomes the first test above; one left in
			 * prose is a sentence, and sentences are the user's to judge.
			 */
			if ((unfinished.length > 0 || saidNothing) && nudges < MAX_NUDGES) {
				nudges += 1;
				let nudgeText = "（自动继续）上一条回复是空的。请直接开始执行：说明你要做什么，并调用工具去做。";
				if (!saidNothing && unfinished.length > 0) {
					const inProgress = unfinished.find((t) => t.status === "in_progress") ?? unfinished[0];
					const listStr = unfinished
						.map((t, idx) => `  ${idx + 1}. [${t.status === "in_progress" ? "进行中" : "待处理"}] ${t.content}`)
						.join("\n");
					nudgeText = `（自动继续）清单里还有 ${unfinished.length} 项没有完成：\n${listStr}\n\n请直接执行【${inProgress.content}】，调用工具继续，不要只描述计划。`;
				}

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
			return finish("done");
		}
		// It did something, so whatever made it pause before is no longer the pattern.
		nudges = 0;

		const toolResults =
			assistant.stopReason === "length"
				? await failTruncatedCalls(toolCalls, emit)
				: await runTools(toolCalls, config, state, emit);

		for (const result of toolResults) {
			messages.push(result);
			produced.push(result);
		}

		await emit({ type: "turn_end", message: assistant, toolResults });

		/*
		 * Same call, same arguments, same answer — again.
		 *
		 * Told once, most models change approach. Told and ignored, the turn ends: an agent
		 * repeating a probe that has already answered the same way six times is not going to
		 * discover anything on the seventh, and the hours it would spend doing so belong to
		 * whoever is waiting for it.
		 */
		repetition.observe(toolCalls, toolResults);
		if (repetition.exhausted()) {
			return finish("stalled");
		}
		const repeated = repetition.shouldWarn(toolCalls, toolResults);
		if (repeated) {
			const notice: Message = {
				role: "user",
				content: [
					{
						type: "text",
						text:
							`（自动提示）你已经用同样的参数调用 \`${repeated}\` 多次，每次得到的结果都一样。` +
							`再问一次不会有新信息。换一个思路：换个工具、换个假设，或者直接说明当前卡在哪里、需要什么。`,
					},
				],
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
		await emit({ type: "agent_end", reason, error });
		return { messages: produced, reason, error, ...(retryable ? { retryable } : {}) };
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
	ruleMatches: RuleMatch[];
}

async function streamTurn(config: AgentRunConfig, context: LlmContext, emit: AgentEventSink): Promise<TurnResult> {
	if (config.streamFn) {
		const message = await config.streamFn(context, config);
		await emit({ type: "message_start", message });
		await emit({ type: "message_end", message });
		return { message, ruleMatches: [] };
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
	const signal = config.signal ? AbortSignal.any([config.signal, ruleAbort.signal]) : ruleAbort.signal;

	const stream = streamAssistant(config.provider, config.model, context, {
		signal,
		thinking: config.thinking,
		maxTokens: config.maxTokens,
		temperature: config.temperature,
		retryAttempts: config.retryAttempts,
		/*
		 * Said out loud, because the alternative is a turn that appears to hang.
		 *
		 * A retry costs seconds of silence at a moment when the user is already waiting, and
		 * silence is indistinguishable from a stall. One line naming the cause turns it into
		 * something that is visibly being handled.
		 */
		onRetry: ({ delayMs, reason }) => {
			retries += 1;
			void emit({ type: "retry", attempt: retries, delayMs, reason });
		},
	});

	let started = false;

	while (true) {
		const next = await stream.next();
		if (next.done) return { message: next.value, ruleMatches: pendingMatches };
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
				await emit({ type: "message_update", message: event.partial, delta: event });
				if (config.rules && event.type !== "toolcall_end") observeDelta(config.rules, event, pendingMatches, ruleAbort);
				break;
			case "done":
			case "error": {
				const message = event.message;
				if (!started) await emit({ type: "message_start", message });
				await emit({ type: "message_end", message });
				// Drain the generator so its `return` value is the authoritative final message.
				const tail = await stream.next();
				return { message: tail.done ? tail.value : message, ruleMatches: pendingMatches };
			}
			default:
				break;
		}
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

	// `interrupt` decides whether this is worth stopping mid-sentence. A rule set to `never`, or
	// scoped away from this source, still matched — it just gets delivered the ordinary way.
	const interrupting = matches.filter((match) => {
		if (match.rule.interrupt === "never") return false;
		if (match.rule.interrupt === "prose-only") return chunk.source !== "tool";
		if (match.rule.interrupt === "tool-only") return chunk.source === "tool";
		return true;
	});
	if (interrupting.length === 0) return;

	for (const match of interrupting) {
		if (!pending.some((existing) => existing.rule.name === match.rule.name)) pending.push(match);
	}
	if (!abort.signal.aborted) abort.abort();
}
