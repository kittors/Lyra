/**
 * Delegating a piece of work to a nested agent.
 *
 * The point is context isolation: a search that reads forty files returns one paragraph to the
 * parent instead of forty file dumps. Which means the sub-agent gets its own message list and its
 * own state map — its file reads and its todo list must not leak upwards.
 *
 * What it did is not lost, though. The steps it took are collected and handed back so the caller
 * can write them to the session log; a delegated turn should be as readable afterwards as one done
 * in the open.
 */

import { randomUUID } from "node:crypto";
import { access } from "node:fs/promises";
import { platform } from "node:os";
import { join } from "node:path";
import type { AgentEvent } from "../agent/events.ts";
import type { AgentRunConfig } from "../agent/loop.ts";
import { runTurn } from "../agent/runner.ts";
import type { streamAssistant } from "../ai/index.ts";
import type { Settings } from "../config/settings.ts";
import { buildSystemPrompt, loadProjectInstructions } from "../prompt/system.ts";
import { sandboxModeFor } from "../sandbox/mode-for.ts";
import { lyraHome } from "../session/store.ts";
import { CODE_INTEL_KEY, CodeIntelManager } from "../lsp/manager.ts";
import { compactWith } from "./compaction.ts";
import { textTokens, toolTokens } from "./context.ts";
import { makeAfterToolCall, makeBeforeToolCall } from "./hooks.ts";
import { writePreview } from "./previews.ts";
import { makeYieldTool, renderYield, yieldInstruction, YIELD_KEY, type YieldOutcome } from "./yield-tool.ts";
import type { Skill } from "../skills/loader.ts";
import { SKILLS_KEY } from "../skills/tool.ts";
import { AGENTS_KEY, BUILTIN_AGENTS, type AgentDefinition } from "../tools/task.ts";
import type { ApprovalDecision, ApprovalRequest, ModelConfig, ProviderConfig, Tool } from "../types.ts";
import type { SubAgentRegistry } from "./sub-agents.ts";

async function pathExists(path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

/**
 * What a delegated run hands back.
 *
 * `text` is what goes in the transcript and what the parent model reads. `output` is the same
 * answer as data, present only when the agent declared a schema and yielded against it — the
 * parent tool puts it in `details` so the UI can render it and `agent://<id>/<field>` can index
 * into it without the parent re-reading anything.
 */
export interface SubAgentAnswer {
	text: string;
	output?: Record<string, unknown>;
	/** Schema problems that were accepted rather than rejected. */
	warnings?: string[];
}

export interface SubAgentOptions {
	sessionId: string;
	cwd: string;
	settings: Settings;
	tools: Tool[];
	skills: Skill[];
	agents: AgentDefinition[];
	signal?: AbortSignal;
	streamFn?: AgentRunConfig["streamFn"];
	requestApproval(request: ApprovalRequest): Promise<ApprovalDecision>;
	emit(event: AgentEvent): Promise<void>;
	/**
	 * The session's stream override in the shape compaction expects, passed down so a delegated run
	 * summarises through the same model call the parent does.
	 *
	 * Optional like `registry`: left off, compaction still runs — it falls back to a real provider
	 * call, exactly as the parent's does when nothing is overriding it.
	 */
	summaryStream?: typeof streamAssistant;
	/**
	 * Where this run registers itself, so it can be watched and steered while it happens.
	 *
	 * Optional: a host that only wants the answer — the CLI, a test — passes nothing and gets the
	 * old behaviour exactly. Delegation works the same either way; the registry only adds a window.
	 */
	registry?: SubAgentRegistry;
}

export async function runSubAgent(
	options: SubAgentOptions,
	input: { description: string; prompt: string; agentType?: string },
	provider: ProviderConfig,
	model: ModelConfig,
	_parentSystemPrompt: string,
): Promise<SubAgentAnswer> {
	const definition = options.agents.find((a) => a.name === (input.agentType ?? "general")) ?? BUILTIN_AGENTS[0];
	const fromSession =
		definition.tools === "*" ? options.tools : options.tools.filter((t) => (definition.tools as string[]).includes(t.name));

	/*
	 * Recursive dispatch is off unless the definition asks for it.
	 *
	 * Removing `task` from the list rather than refusing the call later is deliberate: a model
	 * cannot want a tool it has not been shown, and an error after the fact costs a turn to
	 * discover something that was never going to work.
	 */
	const maySpawn = definition.spawns === "*" || (Array.isArray(definition.spawns) && definition.spawns.length > 0);
	const withoutTask = maySpawn ? fromSession : fromSession.filter((tool) => tool.name !== "task");

	/*
	 * A declared output shape turns the reply into an object.
	 *
	 * Built per run because the tool carries the attempt counter — a fresh one each dispatch, so a
	 * sub-agent that used up its retries does not hand a spent budget to the next one.
	 */
	const yieldTool = definition.output ? makeYieldTool(definition.output, { mode: definition.schemaMode }) : undefined;
	const allowed = yieldTool ? [...withoutTask, yieldTool as unknown as Tool] : withoutTask;
	const subState = new Map<string, unknown>([
		[SKILLS_KEY, options.skills],
		[AGENTS_KEY, options.agents],
	]);

	// The sub-agent gets its own message list and its own state map, so its file reads and
	// todo list cannot leak into the parent's.
	const id = `${options.sessionId}:sub:${randomUUID().slice(0, 8)}`;
	const steps: string[] = [];
	/*
	 * Its own controller, chained to the parent's.
	 *
	 * Two things must be able to stop this run and they are not the same thing: the session going
	 * away, which stops everything, and someone deciding *this* sub-agent is wedged, which must
	 * leave the parent and its siblings alone. Chaining gives the first without conceding the
	 * second — aborting here is local, aborting upstream still reaches here.
	 */
	const controller = new AbortController();
	const stopWithParent = () => controller.abort();
	options.signal?.addEventListener("abort", stopWithParent, { once: true });
	const registry = options.registry;
	registry?.start({ id, agent: definition.name, description: input.description, abort: () => controller.abort() });
	/*
	 * What it was asked to do, as the first line of its transcript.
	 *
	 * The loop only announces messages it *produces*, and the dispatch prompt is one it was handed —
	 * so without this the pane opened onto the sub-agent's replies with nothing to say what it had
	 * been told, which is the one piece of context a reader has none of. It is also the thing worth
	 * checking first when a sub-agent goes the wrong way: usually the prompt sent it there.
	 */
	registry?.record(id, { role: "user", content: [{ type: "text", text: input.prompt }], timestamp: Date.now() });

	await options.emit({
		type: "subagent",
		id,
		agent: definition.name,
		description: input.description,
		prompt: input.prompt,
		tools: allowed.map((tool) => tool.name),
	});

	// Build a complete, standalone system prompt for sub-agents
	const subAgentPrompt = await buildSystemPrompt({
		cwd: options.cwd,
		tools: allowed,
		skills: options.skills,
		agents: options.agents,
		projectInstructions: await loadProjectInstructions(options.cwd),
		platform: platform(),
		modelName: model.name,
		isGitRepo: await pathExists(join(options.cwd, ".git")),
		today: new Date().toISOString().slice(0, 10),
		appendSystemPrompt: definition.output
			? `${definition.systemPrompt}\n${yieldInstruction(definition.output)}`
			: definition.systemPrompt,
	});

	let result: Awaited<ReturnType<typeof runTurn>>;
	try {
		result = await runTurn(
			{
				sessionId: id,
				cwd: options.cwd,
				provider,
				model,
				systemPrompt: subAgentPrompt,
				tools: allowed,
				messages: [{ role: "user", content: [{ type: "text", text: input.prompt }], timestamp: Date.now() }],
				/*
				 * The app default, deliberately — not the dispatching conversation's level.
				 *
				 * A session turned up to the top level is one piece of work somebody decided was
				 * worth it; the sub-agents it dispatches are a dozen cheap errands run in parallel,
				 * and inheriting that level would multiply the decision by however many were sent.
				 */
				thinking: options.settings.thinking,
				retryAttempts: options.settings.retryAttempts,
				signal: controller.signal,
				state: subState,
				requestApproval: (request) => options.requestApproval(request),
				/*
				 * The session's policy, which does not stop applying because the work was delegated.
				 *
				 * Each of these was absent, and absent means "no restriction" rather than "inherit":
				 * a sub-agent ran its commands outside the sandbox the permission mode had chosen,
				 * reached hosts the allow-list excludes, and slipped past every configured hook — the
				 * same `bash` call audited in the main conversation and unaudited one level down.
				 * Delegation is a way of organising work, not a way around what the session decided.
				 */
				sandboxMode: sandboxModeFor(options.settings.permissionMode),
				allowedHosts: options.settings.allowedHosts,
				beforeToolCall: makeBeforeToolCall(options.settings.hooks, options.cwd, controller.signal),
				afterToolCall: makeAfterToolCall(options.settings.hooks, options.cwd, controller.signal),
				/*
				 * Previews go under the parent's session, not this run's own id.
				 *
				 * They are thrown away with the conversation that produced them, and a delegated run
				 * is part of that conversation — filed under an id that disappears when the sub-agent
				 * finishes, the page would outlive nothing and be found by no one.
				 */
				writePreview: (input) => writePreview(lyraHome(), { ...input, sessionId: options.sessionId }),
				// Inherited, so a host that replaced the provider call replaced it for the whole
				// tree — a sub-agent quietly dialling out would defeat the point of overriding it.
				streamFn: options.streamFn,
				/*
				 * The same splice-between-turns the main session uses for a message typed mid-run.
				 *
				 * Which is the whole of what "talking to a sub-agent" is: it finishes the step it is
				 * on, reads what was said with its context intact, and carries on rather than
				 * starting over. Nothing here knows where the message came from — the registry
				 * queues it, the loop drains it, exactly as for the parent.
				 */
				drainSteering: registry ? () => registry.drainSteering(id) : undefined,
				/*
				 * The same context compaction the parent gets, for the same reason.
				 *
				 * A delegated run is the one most likely to need it: sixty turns of reading files is
				 * exactly what it is dispatched to do, and its history is its own — the parent's
				 * compaction cannot reach it. Without this a long search does not degrade, it stops,
				 * with the provider refusing the request for being over the window; and because the
				 * `task` tool turns that into a tool error, what the user sees is delegation that
				 * mysteriously fails on the big jobs and works on the small ones.
				 *
				 * The overhead handed over is this run's own: its system prompt and its own subset of
				 * the tools, which is not what the parent carries.
				 */
				compact: (messages, model) =>
					compactWith(messages, model, provider, options.summaryStream, textTokens(subAgentPrompt) + toolTokens(allowed)),
				maxTurns: 60,
			},
			(event) => {
				// Record activity in registry for live sub-agent status line without toast spamming
				if (event.type === "tool_start") {
					steps.push(event.summary);
					registry?.activity(id, event.summary);
				}
				/*
				 * The transcript, as it is written.
				 *
				 * `message_end` rather than `message_start`: a message still streaming has nothing
				 * worth showing yet. These carry the sub-agent's own id and go nowhere near the
				 * session log — the parent's transcript is unchanged by watching one of these.
				 */
				if (event.type === "message_end") {
					registry?.record(id, event.message);
					void options.emit({ type: "subagent_message", id, message: event.message });
				}
			},
		);
	} catch (error) {
		/*
		 * A run that threw has to be marked, or it stays "running" for the life of the session.
		 *
		 * The throw is re-raised: `task` turns it into a tool error for the parent, which is how
		 * the model finds out. This only makes sure the record agrees with what happened.
		 */
		registry?.finish(id, { status: "failed", error: error instanceof Error ? error.message : String(error) });
		await options.emit({ type: "subagent_done", id, steps, answer: "" });
		throw error;
	} finally {
		options.signal?.removeEventListener("abort", stopWithParent);
		/*
		 * A delegated run has its own state map, so anything heavy it started is its own to stop.
		 *
		 * The session's `dispose` cannot reach this one — it looks at the session's map, and a
		 * sub-agent's is deliberately separate so its file reads and todo list stay out of the
		 * parent's. Which means a sub-agent that called `lsp` would leave a language server running
		 * for the life of the process, once per dispatch.
		 */
		const codeIntel = subState.get(CODE_INTEL_KEY);
		if (codeIntel instanceof CodeIntelManager) await codeIntel.dispose().catch(() => {});
	}

	/*
	 * A yielded object is the answer; the last paragraph is the fallback.
	 *
	 * The fallback still matters. An agent with no declared schema returns prose by design, and one
	 * that was aborted or ran out of turns before yielding has said something worth passing up
	 * rather than nothing at all.
	 */
	const yielded = subState.get(YIELD_KEY) as YieldOutcome | undefined;
	const last = [...result.messages].reverse().find((m) => m.role === "assistant");
	const prose =
		last?.role === "assistant"
			? last.content
					.filter((c) => c.type === "text")
					.map((c) => c.text)
					.join("\n")
					.trim()
			: "";
	const answer = yielded ? renderYield(yielded) : prose;

	/*
	 * Aborted is not failed.
	 *
	 * A sub-agent stopped on purpose has done exactly what was asked of it, and recording that as a
	 * failure would put an error in the parent's transcript for a button the user pressed.
	 */
	registry?.finish(
		id,
		controller.signal.aborted
			? { status: "aborted" }
			: { status: "done", answer, output: yielded?.value, warnings: yielded?.warnings },
	);
	await options.emit({ type: "subagent_done", id, steps, answer });
	return { text: answer, output: yielded?.value, warnings: yielded?.warnings };
}
