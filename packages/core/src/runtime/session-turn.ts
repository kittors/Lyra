/**
 * Assembling one turn: everything the loop needs, in the order it has to be decided.
 *
 * Build the system prompt, let plugins amend the whole turn, then write down what came out. The
 * recording happens last on purpose — what belongs in the log is what the model was actually sent,
 * not what this file would have sent if nothing had intervened.
 *
 * Separate from the session because it is a function of its inputs and nothing else: given the same
 * workspace, capabilities and history it produces the same request. That is what makes a turn
 * something you can reason about after the fact rather than only watch happen.
 */

import { PROJECT_MEMORY_ENABLED_KEY, projectMemoryEnabled } from "./project-memory.ts";
import { gatherMemory } from "./memory-inject.ts";
import { platform } from "node:os";
import { access } from "node:fs/promises";
import { join } from "node:path";
import type { AgentEvent } from "../agent/events.ts";
import type { AgentRunConfig } from "../agent/loop.ts";
import { runTurn } from "../agent/runner.ts";
import { streamAssistant } from "../ai/index.ts";
import type { Settings } from "../config/settings.ts";
import { buildSystemPrompt, loadProjectInstructions } from "../prompt/system.ts";
import { TODOS_KEY, type TodoItem } from "../tools/todo.ts";
import { continueWhileWorkRemains } from "./continuation.ts";
import type {
	ApprovalDecision,
	ApprovalRequest,
	AssistantMessage,
	Message,
	ModelConfig,
	ProviderConfig,
	StreamEvent,
	ThinkingLevel,
} from "../types.ts";
import { droppedMessage, lastRequest, summaryMessages } from "./compaction.ts";
import { makeAfterToolCall, makeBeforeToolCall } from "./hooks.ts";
import type { SessionCapabilities } from "./session-capabilities.ts";
import type { SessionLog } from "./session-log.ts";
import { SUBAGENTS_KEY } from "../resources/handlers.ts";
import { DEFAULT_MAX_DEPTH } from "./dispatch-guard.ts";
import {
	DELEGATION_KEY,
	delegationConcurrency,
	delegationTier,
	mentionedAgents,
	normalizeDelegationPolicy,
	type DelegationDecision,
} from "./delegation.ts";
import { RENAMED_AGENTS, resolveAgentName } from "../agents-builtin.ts";
import { withEnvironment } from "../prompt/environment.ts";
import { readPromptOverride } from "../prompt/overrides.ts";
import { offerRuleFromCorrection } from "./rule-offer.ts";
import { prepareTurn } from "./turn.ts";
import { buildTurnConfig } from "./turn-config.ts";
import type { SubAgentRegistry } from "./sub-agents.ts";

export interface TurnInputs {
	cwd: string;
	settings: Settings;
	/** Resolve preferences at dispatch time without altering an already running model request. */
	getSettings?: () => Settings;
	log: SessionLog;
	can: SessionCapabilities;
	provider: ProviderConfig;
	model: ModelConfig;
	signal: AbortSignal;
	thinking?: ThinkingLevel;
	streamFn?: AgentRunConfig["streamFn"];
	scratchDir: string;
	requestApproval: (request: ApprovalRequest) => Promise<ApprovalDecision>;
	emit: (event: AgentEvent) => Promise<void>;
	drainSteering: () => Message[];
	/** Where sub-agents dispatched by this turn register — see `runtime/sub-agents.ts`. */
	subAgents?: SubAgentRegistry;
}

/**
 * Run one prompt to a standstill: the turn itself, then as many more as the plan still needs.
 *
 * The continuation is here rather than at the call site because it is the same turn continuing —
 * a model that stops with items still unticked has not finished, and restarting it is not a second
 * request in any sense the log or the user would recognise.
 */
export async function driveTurn(input: TurnInputs): Promise<void> {
	const { cwd, can, log } = input;
	const onEvent = (event: AgentEvent) => recordTurnEvent(input.log, event);
	const { config, systemPrompt } = await assembleTurn(input);

	/*
	 * 扩展的 `turn_start` / `turn_end`。
	 *
	 * 这两个事件（连同 `tool_result`、`session_start`）在清单里认得、校验过、存下来了，
	 * **而从来没有被派发过**——扩展宿主此前只有一个调用点，就是工具调用前的那次拦截。
	 * 一个声明了 `events: ["turn_end"]` 的扩展装上去、加载成功、然后什么也收不到。
	 *
	 * `dispatch` 不是 `intercept`：这两个事件是观察，不接受 `block`。一个能否决整轮开始的
	 * 扩展，跟一个能让会话卡住的扩展是同一个东西。
	 */
	void can.extensions.dispatch("turn_start", { cwd, sessionId: log.meta.id }).catch(() => {});

	const first = await runTurn(config, onEvent);
	await continueWhileWorkRemains(first, {
		run: (messages) => runTurn({ ...config, messages, systemPrompt }, onEvent),
		// 续跑重建历史时也要带上——少了末尾那条，前缀就跟上一次不一样，缓存反而白丢一次。
		messages: () => withEnvironment(modelHistory(input.log, input.provider, input.model)),
		todos: () => (input.can.state.get(TODOS_KEY) as TodoItem[] | undefined) ?? [],
		aborted: () => input.signal.aborted,
		notify: (message) => input.emit({ type: "notice", level: "info", message }),
		// The running line, not a toast: this wait outlives one by an order of magnitude.
		resuming: (info) => input.emit({ type: "retry", ...info, resume: true }),
		// So that pressing stop during a minute-long wait is felt immediately.
		signal: input.signal,
		/*
		 * 无条件为真，也就是说 `continueWhileWorkRemains` 里那半段「连接断了就整轮重来」在这里
		 * 从来不会执行。这是有意的，值得写下来，因为光读那个文件会以为它在工作。
		 *
		 * 会话永远带着一份重试策略——`normalizeRetryPolicy` 在没有配置时也会给出默认值——所以请求
		 * 那一层总是受设置管着，而且现在覆盖了每一种失败（见 `failure.ts`）。再让外面这层加码，
		 * 「重试 10 次」就会变成 10 次请求重试 × 3 轮 resume 一共四十次，跟设置页上写的数字对不上。
		 * 设成无限重试时它更是永远轮不到：请求那层根本不会放弃。
		 *
		 * 那半段代码留着是因为 `continueWhileWorkRemains` 本身是通用的，`resume.test.ts` 也仍然
		 * 覆盖着它；换个不带重试预算的调用者就该打开。
		 */
		requestRetriesHandled: true,
	});

	void can.extensions.dispatch("turn_end", { cwd, sessionId: log.meta.id, messages: log.messages.length }).catch(() => {});

	/*
	 * After the work, never during it.
	 *
	 * A choice presented in the middle of an action is one people dismiss to get it out of the way,
	 * and this one is worth reading. It is also the reason this is awaited rather than left running:
	 * an offer that arrives after the next prompt has started would be about the wrong exchange.
	 */
	await offerRuleFromCorrection({
		messages: input.log.messages,
		settings: input.settings,
		provider: input.provider,
		model: input.model,
		stream: summaryStream(input.streamFn, { sessionId: log.meta.id, cwd, retryPolicy: () => (input.getSettings?.() ?? input.settings).retryPolicy, signal: input.signal }) ?? streamAssistant,
		budget: input.can.correctionBudget,
		signal: input.signal,
		emit: input.emit,
	});
}

/**
 * Every event on its way out of the loop, with the two things that must happen as it passes.
 *
 * `message_end` is the commit point: partial assistant messages are never persisted, so this is
 * the only place a reply enters the transcript.
 *
 * And a turn stopped for going in circles has to say so. Ending silently is indistinguishable from
 * finishing, and the difference matters: one means the work is done, the other means it is stuck
 * and waiting for a person to say something it has not thought of.
 */
async function recordTurnEvent(log: SessionLog, event: AgentEvent): Promise<void> {
	if (event.type === "agent_end" && event.reason === "stalled") {
		await log.emit({
			type: "notice",
			level: "warn",
			message: "同一个调用反复得到相同结果，已停下。告诉它换个方向，或直接说明你想怎么处理。",
		});
	}
	if (event.type === "message_end") await log.commit(event.message);
	/*
	 * Compaction is written down here, where the log is in reach and the message count is current.
	 *
	 * `kept` is absent when nothing was summarised away — pruning oversized tool results rewrites
	 * what is sent without moving where history begins, and it is cheap and idempotent enough to
	 * simply run again next turn.
	 */
	if (event.type === "compacted" && event.kept !== undefined) {
		log.markCompaction(event.summary ?? "", event.kept);
	}
	await log.emit(event);
}

/**
 * The history as the model should see it: everything, or the summary and what followed it.
 *
 * The log keeps every message and the boundary says where the model's view starts. Rebuilding the
 * synthetic head from the stored summary on each turn — rather than storing the head itself —
 * keeps one copy of what a summary message looks like, and lets the quoted standing request be
 * recomputed from the messages it was drawn from instead of going stale beside them.
 */
export function modelHistory(log: SessionLog, provider: ProviderConfig, model: ModelConfig): Message[] {
	const boundary = log.compaction;
	if (!boundary) return log.messages;

	const older = log.messages.slice(0, boundary.keptFrom);
	const tail = log.messages.slice(boundary.keptFrom);
	if (!boundary.summary) {
		const standing = lastRequest(older) ?? lastRequest(log.messages);
		return [droppedMessage(standing), ...tail];
	}

	const head = summaryMessages(boundary.summary, lastRequest(older), provider, model);
	const at = boundary.at ?? Math.max(0, ...tail.map((message) => message.timestamp));
	return [...head.map((message) => ({ ...message, timestamp: at })), ...tail];
}

/**
 * 这一轮到底派不派、派谁。
 *
 * 只在 `off` 档下才去读用户写了什么——其余四档的答案跟消息内容无关，而扫一遍历史找 `@` 是白花的
 * 工夫。这也让「关掉」成为唯一一个会因为用户措辞而改变工具表的档位，那正是它的定义。
 *
 * 看的是「上一条助手消息之后的所有用户消息」，而不是最后一条。用户常常分两次说完一件事——先
 * 「@explore 看看这个」，再补一句「先别改代码」——只读最后一条会把点名读丢，而那一条恰恰是他
 * 唯一一次明确表示要派活。
 *
 * 已知的边界：中途插话（steering）到达时这一轮的工具表已经定了，所以插话里的点名要等下一轮才
 * 算数。改成每次请求前重算是可以的，但那意味着一轮之内工具表会变，模型看到的世界在自己说话的
 * 过程中被换掉——那个代价比等一轮大。
 */
function delegationDecision(input: TurnInputs): DelegationDecision {
	const policy = normalizeDelegationPolicy(input.settings.subAgentDelegation);
	const tier = delegationTier(input.thinking ?? input.settings.thinking, policy);
	if (tier !== "off") return { tier, mentioned: [] };

	const messages = input.log.messages;
	const lastReply = messages.findLastIndex((message) => message.role === "assistant");
	// 旧名也认：三天前的会话里那句 `@fast` 指的人还在，见 `RENAMED_AGENTS`。
	const known = [...input.can.agents.map((agent) => agent.name), ...Object.keys(RENAMED_AGENTS)];
	const mentioned = new Set<string>();
	for (const message of messages.slice(lastReply + 1)) {
		// 运行时自己注入的那些（环境说明、规则纠正）不算点名——它们不是用户说的话。
		if (message.role !== "user" || message.synthetic) continue;
		const text = message.content
			.filter((part): part is Extract<typeof part, { type: "text" }> => part.type === "text")
			.map((part) => part.text)
			.join("\n");
		for (const name of mentionedAgents(text, known)) {
			const resolved = resolveAgentName(name, input.can.agents);
			// 旧名指向一个已经不存在的定义时不放行：留着它只会让 `task` 拿一个查无此人的名字去派。
			if (input.can.agents.some((agent) => agent.name === resolved)) mentioned.add(resolved);
		}
	}
	return { tier, mentioned: [...mentioned] };
}

async function assembleTurn(input: TurnInputs): Promise<{ config: AgentRunConfig; systemPrompt: string }> {
	const { cwd, can, log, settings } = input;
	const memoryEnabled = projectMemoryEnabled(settings);
	can.state.set(PROJECT_MEMORY_ENABLED_KEY, memoryEnabled);

	/*
	 * 派活关掉的时候，`task` 这一轮在不在桌上，取决于用户有没有点名。
	 *
	 * 摘掉工具是主路径——模型不会想要一个没见过的工具，而事后报错要花掉一整轮才让它发现这条路
	 * 本来就不通。但「关掉」在这里的意思是「别自作主张」，不是「这个功能没了」：`@explore` 在
	 * 输入框里只是一段纯文本，模型读到它之后走的仍然是 `task`，所以一刀摘掉会把用户自己点的名
	 * 一起摘掉。于是按轮决定——认出点名就把工具留下，认不出就收走。见 `delegation.ts`。
	 */
	const delegation = delegationDecision(input);
	can.state.set(DELEGATION_KEY, delegation);
	const tools = can.tools.filter(
		(tool) =>
			(tool.name !== "learn" || memoryEnabled) &&
			(tool.name !== "task" || delegation.tier !== "off" || delegation.mentioned.length > 0),
	);

	/*
	 * Where `agent://` finds the sub-agents this session dispatched.
	 *
	 * Put in the state map rather than handed to the router, because the router is built once per
	 * session while the registry arrives per turn — and a session with no registry (the CLI, a
	 * test) should leave `agent://` resolving to "this session has no sub-agents" rather than to
	 * a stale one.
	 */
	if (input.subAgents) can.state.set(SUBAGENTS_KEY, input.subAgents);

	// Both memories, read from disk this turn, and each entry stamped as having reached the model.
	const { memorySnippet, projectMemory } = await gatherMemory(cwd, settings.personalization?.enableMemory !== false, Date.now(), memoryEnabled);

	const turn = await prepareTurn({
		cwd,
		tools,
		/*
		 * 日期接在末尾，而不是写在 system prompt 里。
		 *
		 * 前缀缓存从最前面逐段匹配，system prompt 正是最前面那一段——里面放一个每天变一次的
		 * 字符串，等于每天头一次请求要为整个对话重付一次全额。放末尾，跨天时只失效这一小块。
		 * 见 `prompt/environment.ts`。
		 */
		messages: withEnvironment(modelHistory(log, input.provider, input.model)),
		systemPrompt: await buildSystemPrompt({
			cwd,
			tools,
			skills: can.skills,
			agents: can.agents,
			projectInstructions: await loadProjectInstructions(cwd),
			customInstructions: settings.personalization?.customInstructions,
			tone: settings.personalization?.tone,
			memorySnippet,
			projectMemory,
			platform: platform(),
			modelName: input.model.name,
			isGitRepo: await pathExists(join(cwd, ".git")),
			scratchDir: input.scratchDir,
				rules: can.rules,
				resources: can.resources.schemes(),
				/*
				 * 说出去的数字必须跟真正拦人的那个一样。
				 *
				 * 闸门按推理等级收窄（见 `delegation.ts`），提示词却照着设置里的天花板说，那就是
				 * 把「派八个会排队」换成了「派四个会排队」——同一个看不见的队列，只是这次是提示词
				 * 自己告诉模型的一个假数。
				 */
				thinking: input.thinking ?? settings.thinking,
				// 这一轮的档位和点名，提示词那一段照着它写。见 `delegationDecision`。
				delegation,
				dispatchLimits: {
					maxConcurrent: delegationConcurrency(
						settings.maxConcurrentSubAgents,
						input.thinking ?? settings.thinking,
						normalizeDelegationPolicy(settings.subAgentDelegation),
					),
					maxDepth: DEFAULT_MAX_DEPTH,
				},
				identityOverride: await readPromptOverride(cwd, "identity"),
				guidelinesOverride: await readPromptOverride(cwd, "guidelines"),
		}),
	});

	const systemPrompt = await log.recordContext(
		turn.systemPrompt,
		turn.tools.map((tool) => tool.name),
		can.skills.map((skill) => skill.name),
		turn.tools.map(({ name, description, parameters }) => ({ name, description, parameters })),
	);

	const config = buildTurnConfig(
		{
			sessionId: log.meta.id,
			cwd,
			provider: input.provider,
			model: input.model,
			settings,
			getSettings: input.getSettings,
			state: can.state,
			tools,
			skills: can.skills,
			agents: can.agents,
			ruleMonitor: can.ruleMonitor,
			resources: can.resources,
			scratchDir: input.scratchDir,
			// Where anything this turn delegates registers itself, so it can be watched and steered.
			subAgents: input.subAgents,
			signal: input.signal,
			streamFn: input.streamFn,
			requestApproval: input.requestApproval,
			emit: input.emit,
			summaryStream: summaryStream(input.streamFn, { sessionId: log.meta.id, cwd, retryPolicy: () => (input.getSettings?.() ?? input.settings).retryPolicy, signal: input.signal }),
			// 压缩剪掉的大块输出存进会话，占位标记里给出 `artifact://` 地址。
			artifacts: { keep: (tool, content) => can.keepArtifact(tool, content) },
			beforeToolCall: makeBeforeToolCall(settings.hooks, cwd, input.signal, can.extensions),
			afterToolCall: makeAfterToolCall(settings.hooks, cwd, input.signal, can.extensions),
			drainSteering: input.drainSteering,
		},
		turn,
		systemPrompt,
		input.thinking,
	);

	return { config, systemPrompt };
}

/**
 * The provider call compaction should make, in the shape it expects.
 *
 * The session's override answers a whole turn; compaction wants a stream. Adapting rather than
 * reaching for the real provider is the point: a host that replaced how requests are made — a test,
 * a recorded session, a gateway — must have replaced this one too. Undefined when nothing was
 * overridden, which leaves the real provider in place.
 */
export function summaryStream(
	override: AgentRunConfig["streamFn"] | undefined,
	scope: Pick<AgentRunConfig, "sessionId" | "cwd" | "retryPolicy" | "signal">,
): typeof streamAssistant | undefined {
	if (!override) return (provider, model, context, options) => streamAssistant(provider, model, context, { ...options, retryPolicy: options?.retryPolicy ?? scope.retryPolicy, signal: options?.signal ?? scope.signal });
	return (provider, model, context, options) => {
		const call = override;
		// A generator that only returns: compaction asks for a stream, the override answers with a
		// whole message. The generator shape is the adaptor; there is nothing to yield along the way.
		// oxlint-disable-next-line require-yield
		async function* once(): AsyncGenerator<StreamEvent, AssistantMessage> {
			return call({ ...context }, {
				...scope, provider, model, messages: context.messages,
				systemPrompt: context.systemPrompt ?? "", tools: [],
				thinking: options?.thinking, maxTokens: options?.maxTokens, signal: options?.signal ?? scope.signal,
			});
		}
		return once();
	};
}

async function pathExists(path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}
