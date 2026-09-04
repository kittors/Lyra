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

import { platform } from "node:os";
import { access } from "node:fs/promises";
import { join } from "node:path";
import type { AgentEvent } from "../agent/events.ts";
import type { AgentRunConfig } from "../agent/loop.ts";
import { runTurn } from "../agent/runner.ts";
import type { streamAssistant } from "../ai/index.ts";
import type { Settings } from "../config/settings.ts";
import { buildSystemPrompt, loadProjectInstructions } from "../prompt/system.ts";
import { formatMemoryForPrompt, loadMemory } from "./memory.ts";
import { formatProjectMemory, readLessons } from "./project-memory.ts";
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
import { prepareTurn } from "./turn.ts";
import { buildTurnConfig } from "./turn-config.ts";
import type { SubAgentRegistry } from "./sub-agents.ts";

export interface TurnInputs {
	cwd: string;
	settings: Settings;
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
	const onEvent = (event: AgentEvent) => recordTurnEvent(input.log, event);
	const { config, systemPrompt } = await assembleTurn(input);

	const first = await runTurn(config, onEvent);
	await continueWhileWorkRemains(first, {
		run: (messages) => runTurn({ ...config, messages, systemPrompt }, onEvent),
		messages: () => modelHistory(input.log, input.provider, input.model),
		todos: () => (input.can.state.get(TODOS_KEY) as TodoItem[] | undefined) ?? [],
		aborted: () => input.signal.aborted,
		notify: (message) => input.emit({ type: "notice", level: "info", message }),
		// The running line, not a toast: this wait outlives one by an order of magnitude.
		resuming: (info) => input.emit({ type: "retry", ...info, resume: true }),
		// So that pressing stop during a minute-long wait is felt immediately.
		signal: input.signal,
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

	return [...summaryMessages(boundary.summary, lastRequest(older), provider, model), ...tail];
}

async function assembleTurn(input: TurnInputs): Promise<{ config: AgentRunConfig; systemPrompt: string }> {
	const { cwd, can, log, settings } = input;

	/*
	 * Where `agent://` finds the sub-agents this session dispatched.
	 *
	 * Put in the state map rather than handed to the router, because the router is built once per
	 * session while the registry arrives per turn — and a session with no registry (the CLI, a
	 * test) should leave `agent://` resolving to "this session has no sub-agents" rather than to
	 * a stale one.
	 */
	if (input.subAgents) can.state.set(SUBAGENTS_KEY, input.subAgents);

	let memorySnippet = "";
	if (settings.personalization?.enableMemory !== false) {
		try {
			const memoryStore = await loadMemory();
			memorySnippet = formatMemoryForPrompt(memoryStore.entries);
		} catch {
			// Memory loading is resilient and silent
		}
	}

	/*
	 * Read once per turn from disk, not cached in the session.
	 *
	 * `learn` writes the file, and a session that cached this at startup would keep telling the
	 * model it had not learned the thing it just learned. Reading it is one small file.
	 */
	const projectMemory = settings.personalization?.enableMemory === false ? "" : formatProjectMemory(await readLessons(cwd).catch(() => []));

	const turn = await prepareTurn({
		cwd,
		tools: can.tools,
		messages: modelHistory(log, input.provider, input.model),
		systemPrompt: await buildSystemPrompt({
			cwd,
			tools: can.tools,
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
			today: new Date().toISOString().slice(0, 10),
			scratchDir: input.scratchDir,
				rules: can.rules,
				resources: can.resources.schemes(),
				dispatchLimits: { maxConcurrent: settings.maxConcurrentSubAgents, maxDepth: DEFAULT_MAX_DEPTH },
		}),
	});

	const systemPrompt = await log.recordContext(
		turn.systemPrompt,
		turn.tools.map((tool) => tool.name),
		can.skills.map((skill) => skill.name),
	);

	const config = buildTurnConfig(
		{
			sessionId: log.meta.id,
			cwd,
			provider: input.provider,
			model: input.model,
			settings,
			state: can.state,
			tools: can.tools,
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
			summaryStream: (provider) => summaryStream(input.streamFn, provider, input.model),
			beforeToolCall: makeBeforeToolCall(settings.hooks, cwd, input.signal),
			afterToolCall: makeAfterToolCall(settings.hooks, cwd, input.signal),
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
	provider: ProviderConfig,
	model: ModelConfig,
): typeof streamAssistant | undefined {
	if (!override) return undefined;
	return (_provider, _model, context) => {
		const call = override;
		// A generator that only returns: compaction asks for a stream, the override answers with a
		// whole message. The generator shape is the adaptor; there is nothing to yield along the way.
		// oxlint-disable-next-line require-yield
		async function* once(): AsyncGenerator<StreamEvent, AssistantMessage> {
			return call({ ...context }, { provider, model } as AgentRunConfig);
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
