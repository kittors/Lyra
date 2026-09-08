/**
 * What one turn is handed.
 *
 * Assembling this used to be fifty lines in the middle of the method that runs the turn, which
 * made a short piece of orchestration look long and buried the two decisions in it that are
 * actually interesting: where previews are written, and what a sub-agent inherits.
 *
 * Everything it needs arrives as a parameter. That is not ceremony — it is the list of things a
 * turn depends on, which is worth being able to read in one place.
 */

import type { AgentEvent } from "../agent/events.ts";
import type { AgentRunConfig } from "../agent/loop.ts";
import type { streamAssistant } from "../ai/index.ts";
import type { Settings } from "../config/settings.ts";
import type { Skill } from "../skills/loader.ts";
import { ruleHooks } from "../rules/session.ts";
import { DispatchGate, rootDispatch } from "./dispatch-guard.ts";
import { delegationConcurrency, normalizeDelegationPolicy } from "./delegation.ts";
import type { StreamRuleMonitor } from "../rules/stream.ts";
import type { AgentDefinition } from "../tools/task.ts";
import type {
	ApprovalDecision,
	ApprovalRequest,
	ModelConfig,
	ProviderConfig,
	ThinkingLevel,
	Tool,
} from "../types.ts";
import { lyraHome } from "../session/store.ts";
import { compactWith } from "./compaction.ts";
import type { ArtifactSink } from "./prune.ts";
import { textTokens, toolTokens } from "./context.ts";
import { writePreview } from "./previews.ts";
import { runSubAgent } from "./sub-agent.ts";
import type { SubAgentRegistry } from "./sub-agents.ts";
import { resolveModelRef } from "../config/model-roles.ts";
import type { TurnContext } from "./turn.ts";
import { sandboxModeFor } from "../sandbox/mode-for.ts";

export interface TurnConfigDeps {
	sessionId: string;
	cwd: string;
	provider: ProviderConfig;
	model: ModelConfig;
	settings: Settings;
	/** Resolve preferences at dispatch time without altering an already running model request. */
	getSettings?: () => Settings;
	state: Map<string, unknown>;
	tools: Tool[];
	skills: Skill[];
	agents: AgentDefinition[];
	/**
	 * Where dispatched sub-agents register, so they can be watched and steered while they run.
	 *
	 * Optional throughout: a host that only wants the answer passes nothing and delegation behaves
	 * exactly as before. See `runtime/sub-agents.ts`.
	 */
	subAgents?: SubAgentRegistry;
	signal?: AbortSignal;
	streamFn?: AgentRunConfig["streamFn"];
	requestApproval(request: ApprovalRequest): Promise<ApprovalDecision>;
	emit(event: AgentEvent): Promise<void>;
	/** The session's stream override, in the shape compaction expects. */
	summaryStream?: typeof streamAssistant;
	/**
	 * 压缩剪掉的原文往哪儿存，让 `artifact://` 能取回。
	 *
	 * 可选：不给的时候剪掉就是没了，跟以前一样。
	 */
	artifacts?: ArtifactSink;
	beforeToolCall: AgentRunConfig["beforeToolCall"];
	afterToolCall: AgentRunConfig["afterToolCall"];
	drainSteering: AgentRunConfig["drainSteering"];
	/**
	 * Watches the stream for rule violations. Session-scoped, not per turn: repeat policy is
	 * counted in turns, so a monitor rebuilt each turn would let a `once` rule fire forever.
	 */
	ruleMonitor?: StreamRuleMonitor;
	/** The session's address space. Session-scoped for the same reason the monitor is. */
	resources?: AgentRunConfig["resources"];
	/** Where `scratch://` writes for this session. */
	scratchDir?: string;
}

export function buildTurnConfig(
	deps: TurnConfigDeps,
	turn: TurnContext,
	systemPrompt: string,
	thinking?: ThinkingLevel,
): AgentRunConfig {
	/*
	 * 闸门在组装这一轮的时候就定好宽度，而不是等到第一次派活。
	 *
	 * 宽度是这一轮的属性。放在 `spawnSubAgent` 里懒算，结果是对的，但「这一轮有多宽」变成了
	 * 取决于「这一轮有没有派过活」——在没派活的会话里根本不存在，谁想看一眼都看不到。
	 */
	const gate = dispatchGate(deps, thinking);
	return {

			sessionId: deps.sessionId,
			cwd: deps.cwd,
			provider: deps.provider,
			model: deps.model,
			systemPrompt,
			tools: turn.tools,
			messages: turn.messages,
			thinking: thinking ?? deps.settings.thinking,
			retryAttempts: deps.settings.retryAttempts,
				retryPolicy: () => (deps.getSettings?.() ?? deps.settings).retryPolicy,
			signal: deps.signal,
			state: deps.state,
			/*
			 * Previews are written under the app's directory, keyed by this session.
			 *
			 * The workspace is the user's project; a page produced to demonstrate an idea
			 * is not part of it and should never turn up in `git status`. Keyed by session
			 * so it can be thrown away with the conversation that produced it.
			 */
			writePreview: (input) =>
				writePreview(lyraHome(), { ...input, sessionId: deps.sessionId }),
			requestApproval: (request) => deps.requestApproval(request),
			/*
			 * What this turn's commands may change, derived from the permission mode.
			 *
			 * Derived here rather than read from settings by each tool, because it is one decision
			 * per turn: the mode cannot change halfway through a command, and a tool that looked it
			 * up itself could disagree with the one running beside it.
			 */
			sandboxMode: sandboxModeFor(deps.settings.permissionMode),
			allowedHosts: deps.settings.allowedHosts,
			/*
			 * Queued rather than run on demand.
			 *
			 * A model asked to look at eight things dispatches eight, which is a reasonable thought
			 * and an unreasonable amount of concurrency — eight simultaneous runs each with their
			 * own context and their own model calls. The gate turns "do these eight" into "do these
			 * eight, four at a time", which is what was wanted; the prompt says the number so the
			 * model does not read the queue as slowness and try harder.
			 */
			spawnSubAgent: (input) =>
				gate.run(() =>
					runSubAgent(
						{
							sessionId: deps.sessionId,
							cwd: deps.cwd,
							settings: deps.settings,
							getSettings: deps.getSettings,
							tools: deps.tools,
							skills: deps.skills,
							agents: deps.agents,
							signal: deps.signal,
							streamFn: deps.streamFn,
							requestApproval: (request) => deps.requestApproval(request),
							emit: (event) => deps.emit(event),
							// Where the run registers itself so it can be watched and steered. Absent for
							// hosts that only want the answer — see `SubAgentOptions.registry`.
							registry: deps.subAgents,
							// So a delegated run compacts through the same model call this session does.
							summaryStream: deps.summaryStream,
							/*
							 * 整棵派生树共用同一个闸门和同一条链。
							 *
							 * 闸门传下去，是因为「最多四个」如果每一层各算各的，就成了顶层四个、
							 * 每个下面再四个。链传下去，是因为深度和自递归都只有在链上才看得出来。
							 */
							gate,
							dispatch: rootDispatch(),
						},
						input,
						deps.provider,
						deps.model,
						systemPrompt,
					),
				),
			drainSteering: deps.drainSteering,
			resources: deps.resources,
			scratchDir: deps.scratchDir,
			rules: deps.ruleMonitor?.active ? ruleHooks(deps.ruleMonitor) : undefined,
			beforeToolCall: deps.beforeToolCall,
			afterToolCall: deps.afterToolCall,
			// The session's own stream override applies here too; summarising is a model call.
			/*
			 * The session's own stream override applies here too; summarising is a model call.
			 *
			 * The overhead is handed over rather than inferred. Compaction has to know what the
			 * request carries besides the history — this prompt and these schemas, in full, every
			 * time — because a budget that treats them as part of the conversation shrinks them on
			 * paper when the conversation is cut, and the result lands over the line it was aiming
			 * for. That is a conversation which compacts on every single turn.
			 */
			compact: (messages, model) => {
				const summarizer = resolveModelRef(deps.settings, "@compact", { provider: deps.provider, model });
				return compactWith(
					messages,
					model,
					deps.provider,
					deps.summaryStream,
					textTokens(systemPrompt) + toolTokens(turn.tools),
					// 自动压缩剪掉的原文也存下来——它剪掉的量比手动压缩多得多。
					deps.artifacts,
					summarizer,
				);
			},
			streamFn: deps.streamFn,
	};
}

/**
 * One gate per session, found through the session's own state map.
 *
 * Not a module-level singleton: two windows on two projects would then share a limit and slow each
 * other down for no reason anybody could see. The state map is already the session-scoped place
 * where things like this live.
 */
const GATE_KEY = "dispatchGate";

/**
 * 会话级的闸门，宽度按这一轮的推理等级重算。
 *
 * 闸门本身必须活过一轮——它数的是「现在有几个在跑」，每轮换一个就等于每轮从零开始数，上一轮
 * 派出去还没跑完的那些谁都不算数了。而宽度必须每轮重算：推理等级是可以在对话中途改的，改完
 * 只影响下一轮的提示词、不影响真正拦人的那道闸门的话，这个设置就只剩半个。见 `delegation.ts`。
 */
function dispatchGate(deps: TurnConfigDeps, thinking?: ThinkingLevel): DispatchGate {
	// 现读，不用组装这一轮时的副本：宽度和档位都能在对话中途改，而这两个正是要跟上的东西。
	const live = deps.getSettings?.() ?? deps.settings;
	const width = delegationConcurrency(
		live.maxConcurrentSubAgents,
		thinking ?? deps.settings.thinking,
		normalizeDelegationPolicy(live.subAgentDelegation),
	);
	const existing = deps.state.get(GATE_KEY);
	if (existing instanceof DispatchGate) {
		existing.setLimit(width);
		return existing;
	}
	const gate = new DispatchGate(width);
	deps.state.set(GATE_KEY, gate);
	return gate;
}
