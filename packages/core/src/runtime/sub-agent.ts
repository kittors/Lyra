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
import type { AgentEvent, AgentEventSink } from "../agent/events.ts";
import type { AgentRunConfig, AgentRunResult } from "../agent/loop.ts";
import { runTurn } from "../agent/runner.ts";
import { streamAssistant } from "../ai/index.ts";
import type { Settings } from "../config/settings.ts";
import { resolveModelRef } from "../config/model-roles.ts";
import { withEnvironment } from "../prompt/environment.ts";
import { readPromptOverride } from "../prompt/overrides.ts";
import { buildSystemPrompt, loadProjectInstructions } from "../prompt/system.ts";
import { sandboxModeFor } from "../sandbox/mode-for.ts";
import { lyraHome } from "../session/store.ts";
import { CODE_INTEL_KEY, CodeIntelManager } from "../lsp/manager.ts";
import { resolveSubAgentModel } from "../config/model-roles.ts";
import { compactWith } from "./compaction.ts";
import { childDispatch, DEFAULT_MAX_DEPTH, DISPATCH_KEY, DispatchGate, rootDispatch, type DispatchContext } from "./dispatch-guard.ts";
import {
	DELEGATION_KEY,
	delegationConcurrency,
	normalizeDelegationPolicy,
	type DelegationDecision,
} from "./delegation.ts";
import { textTokens, toolTokens } from "./context.ts";
import { makeAfterToolCall, makeBeforeToolCall } from "./hooks.ts";
import { writePreview } from "./previews.ts";
import { makeYieldTool, renderYield, yieldInstruction, YIELD_KEY, type YieldOutcome } from "./yield-tool.ts";
import type { Skill } from "../skills/loader.ts";
import { SKILLS_KEY } from "../skills/tool.ts";
import { AGENTS_KEY, BUILTIN_AGENTS, resolveAgentName, type AgentDefinition } from "../tools/task.ts";
import type { ApprovalDecision, ApprovalRequest, Message, ModelConfig, ProviderConfig, Tool } from "../types.ts";
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

/**
 * How many rounds a delegated run gets.
 *
 * Named because the number appears in what a caller is told when it runs out — "用满了 60 步" is
 * actionable in a way that "步数用尽" is not, and a constant is the only way those two stay in step.
 * Deliberately below the main conversation's 200: a dozen of these can be in flight at once.
 */
export const MAX_SUB_AGENT_TURNS = 60;

export interface SubAgentOptions {
	sessionId: string;
	cwd: string;
	settings: Settings;
	/** Resolve preferences at dispatch time without altering an already running model request. */
	getSettings?: () => Settings;
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
	/**
	 * Where the run doing the dispatching sits in the tree. Absent means the main conversation.
	 *
	 * Carried rather than counted, because the two limits need different things from it: depth is
	 * a number, and self-recursion needs the names on the path.
	 */
	dispatch?: DispatchContext;
	/**
	 * The concurrency semaphore, shared by the whole tree.
	 *
	 * One per session, passed down: a limit of four that each level enforced separately would be
	 * four at the top and four under each of those.
	 */
	gate?: DispatchGate;
}

export async function runSubAgent(
	options: SubAgentOptions,
	input: { description: string; prompt: string; agentType?: string },
	provider: ProviderConfig,
	model: ModelConfig,
	_parentSystemPrompt: string,
): Promise<SubAgentAnswer> {
	// 旧名在这里也要认：历史记录重放和外部调用都可能带着 `fast`／`deep` 进来。见 `RENAMED_AGENTS`。
	const wanted = resolveAgentName(input.agentType ?? "general", options.agents);
	const definition = options.agents.find((a) => a.name === wanted) ?? BUILTIN_AGENTS[0];
	const fromSession =
		definition.tools === "*" ? options.tools : options.tools.filter((t) => (definition.tools as string[]).includes(t.name));

	/*
	 * Recursive dispatch is off unless the definition asks for it, and off again at the depth limit.
	 *
	 * Removing `task` from the list rather than refusing the call later is deliberate: a model
	 * cannot want a tool it has not been shown, and an error after the fact costs a turn to
	 * discover something that was never going to work.
	 *
	 * Both halves were previously missing their other half. `spawns` kept `task` in the list, and
	 * nothing was ever passed for `spawnSubAgent` — so a definition that declared it could delegate
	 * got the tool and a refusal from it. The depth the prompt promised was not enforced anywhere.
	 */
	// Its registry id, minted before the dispatch context so a run one level down can name its parent.
	const id = `${options.sessionId}:sub:${randomUUID().slice(0, 8)}`;
	const here = childDispatch(options.dispatch ?? rootDispatch(), definition.name, id);
	const maySpawn = definition.spawns === "*" || (Array.isArray(definition.spawns) && definition.spawns.length > 0);
	const deepEnough = here.depth < DEFAULT_MAX_DEPTH;
	/*
	 * 用户把派活关掉时，这一层也到头了。
	 *
	 * 走到这里的子代理是用户自己点名派的——他点的是**它**，不是它到时候想拉来的一串。一个
	 * `spawns: "*"` 的编排型定义，在关掉的设置下仍然能铺开一整棵树，那这个开关就只挡住了第一层，
	 * 而第一层恰恰是最便宜的那一层。
	 *
	 * 只看 policy 不看等级：`off` 是用户钉死的档，跟这个子代理自己用什么推理等级跑无关。
	 */
	const delegationOff = normalizeDelegationPolicy((options.getSettings?.() ?? options.settings).subAgentDelegation) === "off";
	const withoutTask =
		maySpawn && deepEnough && !delegationOff ? fromSession : fromSession.filter((tool) => tool.name !== "task");

	/*
	 * A declared output shape turns the reply into an object.
	 *
	 * Built per run because the tool carries the attempt counter — a fresh one each dispatch, so a
	 * sub-agent that used up its retries does not hand a spent budget to the next one.
	 */
	// Local preferences override portable definitions; an explicit missing model is an error.

	const chosen = resolveSubAgentModel(options.getSettings?.() ?? options.settings, definition, { provider, model });
	const runProvider = chosen.provider;
	const runModel = chosen.model;

	const yieldTool = definition.output ? makeYieldTool(definition.output, { mode: definition.schemaMode }) : undefined;
	const allowed = yieldTool ? [...withoutTask, yieldTool as unknown as Tool] : withoutTask;
	const subState = new Map<string, unknown>([
		[SKILLS_KEY, options.skills],
		[AGENTS_KEY, options.agents],
		// So the `task` tool one level down knows where it is, and can refuse a cycle by name.
		[DISPATCH_KEY, here],
	]);
	/*
	 * 状态图是新建的，所以这一条要自己带下去。
	 *
	 * 上面已经把 `task` 从工具表里摘了，这是同一件事的第二道——挡的是别的路子把工具放回去的情况
	 * （`definition.output` 拼 `allowed` 时、插件改工具表时）。`mentioned` 是空的：点名放行的是
	 * 这个子代理本身，那次已经用掉了，它不继承任何人的通行证。
	 */
	if (delegationOff) subState.set(DELEGATION_KEY, { tier: "off", mentioned: [] } satisfies DelegationDecision);

	// The sub-agent gets its own message list and its own state map, so its file reads and
	// todo list cannot leak into the parent's.
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
	registry?.start({
		id,
		agent: definition.name,
		description: input.description,
		abort: () => controller.abort(),
		// Who asked, and how far down this is — the two things a lineage is made of.
		parentId: options.dispatch?.id,
		depth: here.depth,
	});
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
		parentId: options.dispatch?.id,
		provider: runProvider.id,
		model: runModel.modelId,
	});

	// Build a complete, standalone system prompt for sub-agents
	const subAgentPrompt = await buildSystemPrompt({
		cwd: options.cwd,
		tools: allowed,
		skills: options.skills,
		agents: options.agents,
		projectInstructions: await loadProjectInstructions(options.cwd),
		/*
		 * 行为准则跟着走，身份不跟。
		 *
		 * 「注释一律中文」「匹配周围代码风格」对子代理写的代码同样成立——这些约定管的是产出，
		 * 而子代理的产出最后进的是同一个仓库。而 `identity` 不读：子代理的身份由它自己的定义
		 * 写着（「你是一个只读的代码审查者」），用项目的身份段盖掉它，等于把派它出去的理由抹掉。
		 */
		guidelinesOverride: await readPromptOverride(options.cwd, "guidelines"),
		/*
		 * 它自己的等级，不是派它出来的那个会话的。
		 *
		 * 这个值只用来决定「它该有多想再往下派」（见 `delegation.ts`），而一个编排者被配成
		 * `@fast:low` 就是有人明说过这一层不值得慢慢想——那正是它也不该在下面铺开摊子的时候。
		 * 用父会话的等级，等于把父亲那一次「值得」的决定，乘上它派出去的份数。
		 */
		thinking: chosen.thinking,
		platform: platform(),
		modelName: runModel.name,
		isGitRepo: await pathExists(join(options.cwd, ".git")),
		appendSystemPrompt: definition.output
			? `${definition.systemPrompt}\n${yieldInstruction(definition.output)}`
			: definition.systemPrompt,
	});

	// 子代理也要知道今天几号，同样接在末尾——理由见 `prompt/environment.ts`。
	// 留成变量，因为讨要交付的那一轮要拿它当历史的头。
	const history = withEnvironment([{ role: "user", content: [{ type: "text", text: input.prompt }], timestamp: Date.now() }]);

	/*
	 * The same context compaction the parent gets, for the same reason.
	 *
	 * A delegated run is the one most likely to need it: sixty turns of reading files is exactly
	 * what it is dispatched to do, and its history is its own — the parent's compaction cannot
	 * reach it. Without this a long search does not degrade, it stops, with the provider refusing
	 * the request for being over the window; and because the `task` tool turns that into a tool
	 * error, what the user sees is delegation that mysteriously fails on the big jobs and works on
	 * the small ones.
	 *
	 * The overhead handed over is this run's own: its system prompt and its own subset of the
	 * tools, which is not what the parent carries.
	 */
	const compactHistory: AgentRunConfig["compact"] = (messages, model) => {
		const summarizer = resolveModelRef(options.settings, "@compact", { provider: runProvider, model });
		return compactWith({
			messages,
			model,
			provider: runProvider,
			streamFn: (provider, summaryModel, context, streamOptions) => (options.summaryStream ?? streamAssistant)(provider, summaryModel, context, { ...streamOptions, retryPolicy: () => (options.getSettings?.() ?? options.settings).retryPolicy, signal: controller.signal }),
			overhead: textTokens(subAgentPrompt) + toolTokens(allowed),
			summarizer,
		});
	};

	/** Everything on its way out of the loop: the pane, the roster, and the step list. */
	const relay: AgentEventSink = async (event) => {
		if (event.type === "tool_start" || event.type === "request" || event.type === "retry" || event.type === "retry_settled" || event.type === "agent_end" || event.type === "turn_start" || event.type === "compacted") {
			await options.emit({ type: "subagent_event", id, event });
		}
		// Record activity in registry for live sub-agent status line without toast spamming
		if (event.type === "tool_start") {
			steps.push(event.summary);
			registry?.activity(id, event.summary);
		}
		/*
		 * 卡在重连上也是一种状态，而且是最该说出口的那种。
		 *
		 * 这两行之前不存在：子代理的 `retry` 只进了转录，面板不认识它，主对话的抖动提示也不解包
		 * `subagent_event`（见 `apply-event.ts`）。于是一个正在反复重连的子代理，在界面上和一个
		 * 正在安静干活的子代理长得一模一样——派它来的人只看见一个一直转的 task，没有任何线索说明
		 * 它在等什么、等了多少次。
		 */
		if (event.type === "retry") registry?.retrying(id, { attempt: event.attempt, reason: event.reason });
		if (event.type === "retry_settled") registry?.retrying(id, undefined);
		/*
		 * The transcript, as it is written.
		 *
		 * `message_end` rather than `message_start`: a message still streaming has nothing worth
		 * showing yet. These carry the sub-agent's own id and go nowhere near the parent model
		 * transcript — durable events keep them available after reopening.
		 */
		if (event.type === "message_end") {
			registry?.record(id, event.message);
			await options.emit({ type: "subagent_message", id, message: event.message });
		}
	};

	/**
	 * Whether it is worth asking once more for a delivery.
	 *
	 * Only for a run that had more to do and no more rounds to do it in, that declares a schema,
	 * and that has not already yielded. An aborted one is excluded on purpose: stopping it was
	 * somebody's decision, and spending another request would be arguing with it.
	 */
	const needsFinalYield = (reason: AgentRunResult["reason"]) =>
		reason === "max_turns" && yieldTool !== undefined && subState.get(YIELD_KEY) === undefined && !controller.signal.aborted;

	let result: Awaited<ReturnType<typeof runTurn>>;
	/** Both rounds' messages, so the prose fallback can see what the last one said. */
	let produced: Message[] = [];
	/** Whether the extra round got a delivery out of it, which changes what the answer says. */
	let salvaged = false;
	try {
		await options.emit({ type: "subagent_event", id, event: {
			type: "context", systemPrompt: subAgentPrompt, tools: allowed.map(tool => tool.name),
			skills: options.skills.map(skill => skill.name),
			schemas: allowed.map(tool => ({ name: tool.name, description: tool.description, parameters: tool.parameters })),
		} });
		result = await runTurn(
			{
				sessionId: id,
				cwd: options.cwd,
				provider: runProvider,
				model: runModel,
				systemPrompt: subAgentPrompt,
				tools: allowed,
				messages: history,
				/*
				 * The app default, deliberately — not the dispatching conversation's level.
				 *
				 * A session turned up to the top level is one piece of work somebody decided was
				 * worth it; the sub-agents it dispatches are a dozen cheap errands run in parallel,
				 * and inheriting that level would multiply the decision by however many were sent.
				 */
				thinking: chosen.thinking,
				retryAttempts: options.settings.retryAttempts,
				retryPolicy: () => (options.getSettings?.() ?? options.settings).retryPolicy,
				signal: controller.signal,
				state: subState,
				/*
				 * How a sub-agent delegates further — and until now, it could not.
				 *
				 * `spawns` kept the `task` tool in its list and nothing was ever passed here, so a
				 * definition that declared it could orchestrate got the tool and, from it, "sub-agents
				 * are not available in this session". The field parsed, the tool appeared, the feature
				 * did not exist.
				 *
				 * Undefined rather than a function that refuses, when this run may not spawn: the tool
				 * is already gone from `allowed` in that case, and leaving the capability behind it
				 * would be a second answer to the same question.
				 */
				spawnSubAgent: allowed.some((tool) => tool.name === "task")
					? (nested) => {
							/*
							 * `spawns: ["scout", "reviewer"]` 是一份名单，不只是一个开关。
							 *
							 * 计划里它的作用是「读 agent 定义的人一眼看出这是个编排者，以及它会派谁」。
							 * 只把它当布尔用，那份名单就成了注释。
							 */
							const allowedNames = definition.spawns;
							// 同样先认旧名，否则一条写着 `fast` 的 spawns 白名单会把改名后的它自己挡在外面。
							const wanted = resolveAgentName(nested.agentType ?? "general", options.agents);
							if (Array.isArray(allowedNames) && !allowedNames.map((name) => resolveAgentName(name, options.agents)).includes(wanted)) {
								throw new Error(
									`\`${definition.name}\` 只被允许派生 ${allowedNames.join("、")}，不包括 \`${wanted}\`。` +
										`要放开，请在它的定义里把 \`${wanted}\` 加进 spawns。`,
								);
							}
							/*
							 * `nested` 而不是 `run`：这一层要先把自己的位置让出来。
							 *
							 * 它现在不在跑，它在等这个孩子。占着位置等同一道闸门里的位置，就是一个死锁——
							 * 闸门收到 1 的时候必然发生，收到 4 的时候四路各派一个也一样。见 `DispatchGate.nested`。
							 *
							 * 兜底的那道闸门也要按等级收窄。正常路径下 `options.gate` 一定在（整棵派生树
							 * 共用一道），走到 `??` 右边的是没有会话的宿主——CLI、测试。那里同样是这一层的
							 * 等级在决定划不划算，用天花板开一道全宽的闸门，等于在唯一没人看着的地方把这个
							 * 设置关掉。
							 */
							return (
								options.gate ??
								new DispatchGate(
									delegationConcurrency(
										options.settings.maxConcurrentSubAgents,
										chosen.thinking,
										normalizeDelegationPolicy(options.settings.subAgentDelegation),
									),
								)
							).nested(() =>
								runSubAgent({ ...options, dispatch: here }, nested, runProvider, runModel, subAgentPrompt),
							);
						}
					: undefined,
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
				sandboxNetwork: options.settings.denyCommandNetwork ? "deny" : "allow",
				allowedHosts: options.settings.allowedHosts,
				scratchDir: join(lyraHome(), "scratch", options.sessionId),
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
				compact: compactHistory,
				maxTurns: MAX_SUB_AGENT_TURNS,
			},
			relay,
		);
		produced = result.messages;

		/*
		 * 步数用尽时，讨一份交付回来。
		 *
		 * 有 schema 的子代理只认 `yield`——没调用就等于什么都没交。而「跑满 60 步」恰恰是它读了
		 * 一路、手里有货、只是没走到收尾那一步的情形：报告的价值最高，拿到的却是零。四个 explore
		 * 各跑了半小时、一份报告都没有，就是这么来的。
		 *
		 * 所以再给一轮，工具表里只剩 `yield`——它没有别的事可做，只能交。两轮而不是一轮：
		 * 字段填错时校验会退回来，留一次改正的机会比让整轮白费划算。
		 *
		 * 只在这一种收尾上做。`stalled` 是它在原地打转，再问一次多半还是同一个圈；上游出错时
		 * 连接本身就是坏的；被人按停的那次，用户要的就是它别再花钱了。
		 */
		if (needsFinalYield(result.reason)) {
			const salvage = await runTurn(
				{
					sessionId: id,
					cwd: options.cwd,
					provider: runProvider,
					model: runModel,
					systemPrompt: subAgentPrompt,
					// 只有 yield。剩下的工具都拿走，它就没有第二条路可走了。
					tools: [yieldTool as unknown as Tool],
					messages: [...history, ...result.messages, finalDemand()],
					thinking: chosen.thinking,
					retryAttempts: options.settings.retryAttempts,
					retryPolicy: () => (options.getSettings?.() ?? options.settings).retryPolicy,
					signal: controller.signal,
					state: subState,
					requestApproval: (request) => options.requestApproval(request),
					// 跑满 60 步的历史多半装不下一次新请求，压缩这一步不能省。
					compact: compactHistory,
					streamFn: options.streamFn,
					maxTurns: 2,
				},
				relay,
			);
			produced = [...produced, ...salvage.messages];
			salvaged = subState.get(YIELD_KEY) !== undefined;
		}
	} catch (error) {
		/*
		 * A run that threw has to be marked, or it stays "running" for the life of the session.
		 *
		 * The throw is re-raised: `task` turns it into a tool error for the parent, which is how
		 * the model finds out. This only makes sure the record agrees with what happened.
		 */
		registry?.finish(id, { status: "failed", error: error instanceof Error ? error.message : String(error) });
		await options.emit({ type: "subagent_done", id, steps, answer: "", status: "failed", error: error instanceof Error ? error.message : String(error) });
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
	 * A yielded object is the answer; the last thing it said is the fallback.
	 *
	 * Both halves used to be able to come back empty, and between them that is how a sub-agent could
	 * run for half an hour and hand the parent an empty string:
	 *
	 *   - `renderYield` of `{ summary: "", files: [] }` is `""`. The schema check asks whether the
	 *     required fields are present and typed, not whether they were filled in, so that object is
	 *     accepted and delivers nothing. Hence `|| prose` rather than a plain ternary.
	 *   - the fallback read only the *last* assistant message, and the last message of a run that
	 *     hit its round cap, stalled or died mid-request is a bare tool call with no text in it.
	 *     `lastProse` walks back to the newest thing it actually said.
	 */
	const yielded = subState.get(YIELD_KEY) as YieldOutcome | undefined;
	const prose = lastProse(produced);
	const delivered = (yielded ? renderYield(yielded) : "") || prose;

	/*
	 * How it ended, in the answer itself.
	 *
	 * `runTurn` reports its reason and nothing here read it, so a run that used up its rounds, went
	 * in circles, or lost the provider mid-stream was filed as `done` with an empty answer — and the
	 * parent, the transcript and the roster all said the same thing a clean finish says. The parent
	 * has no other channel to learn this on: it sees one string.
	 *
	 * In front of the report rather than after it, because its job is to stop a partial finding
	 * being read as a conclusion — which has to happen before the finding, not after.
	 */
	const aborted = controller.signal.aborted;
	const cutShort = aborted ? null : incompleteNote(result.reason, result.error, salvaged);
	const answer = cutShort ? [cutShort, delivered].filter(Boolean).join("\n\n") : delivered;

	/*
	 * Aborted is not failed, and neither is out of rounds.
	 *
	 * A sub-agent stopped on purpose has done exactly what was asked of it, and recording that as a
	 * failure would put an error in the parent's transcript for a button the user pressed. A run
	 * that used up its rounds or stopped going anywhere is not a failure either — it did the work,
	 * it just did not get to the end of it, and the note above says so. Only a provider that failed
	 * the request is `failed`, which is also what puts the 重新派发 button on the pane.
	 */
	const status = aborted ? "aborted" : result.reason === "error" ? "failed" : "done";
	/*
	 * 被按停的那次，也要把它已经交出来的东西留下。
	 *
	 * 这里曾经是干干净净的 `{ status: "aborted" }`——什么都不带。而按停最常发生的时刻，恰恰是它
	 * 已经交付、然后卡在别的什么地方的时候：报告早就在 `state` 里躺着，人等得不耐烦按了停止，
	 * 面板上于是一片空白。派它来的那个模型还能从 `answer` 里读到（下面那行一直是带着的），只有
	 * 看着界面的人什么都拿不到——而按停止的正是他。
	 *
	 * 只带东西，不带 `incomplete`。那个标记会让面板画上「没跑完，只是它手上的一部分」，而按停止
	 * 这件事上面那段已经定过调子了：人按下的按钮不是一桩要报告的事故。带回他的东西，别给他一条
	 * 警告。
	 */
	registry?.finish(
		id,
		aborted
			? { status: "aborted", ...(delivered ? { answer, output: yielded?.value, warnings: yielded?.warnings } : {}) }
			: {
					status,
					answer,
					output: yielded?.value,
					warnings: yielded?.warnings,
					// Same fact the first line of `answer` states, in a form the pane can draw.
					...(cutShort ? { incomplete: true } : {}),
					...(result.error ? { error: result.error } : {}),
				},
	);
	await options.emit({
		type: "subagent_done",
		id,
		steps,
		answer,
		status,
		...(result.error ? { error: result.error } : {}),
	});
	return { text: answer, output: yielded?.value, warnings: yielded?.warnings };
}

/**
 * The message that spends the salvage round.
 *
 * Blunt, and it has to be: the round it opens has one tool on the table and one thing worth doing
 * with it. "不完整也要交" is the important half — a model that has been told it is out of budget
 * will otherwise apologise for not finishing and deliver nothing, which is the failure this whole
 * round exists to prevent.
 *
 * `synthetic`, because the runtime is speaking. It has to be a user message for the model to take
 * it as an instruction, and the pane must not draw it as something the person typed.
 */
function finalDemand(): Message {
	return {
		role: "user",
		content: [
			{
				type: "text",
				text:
					"（自动追加）步数已经用尽，这是最后一轮，你手上只剩 `yield` 这一个工具。" +
					"把已经查到的东西按 `yield` 的字段交上去——不完整也要交，在 `summary` 里写清楚哪些没查完、卡在哪。" +
					"不调用 `yield`，派你来的人就什么都拿不到。",
			},
		],
		timestamp: Date.now(),
		synthetic: true,
	};
}

/**
 * The newest thing the run actually said, rather than the newest message.
 *
 * A turn that ends on a tool call has no text in it, so reading the last message alone answers
 * "what did it conclude" with silence for exactly the runs that were cut off — the ones where the
 * question is worth asking.
 */
function lastProse(messages: Message[]): string {
	for (let index = messages.length - 1; index >= 0; index--) {
		const message = messages[index];
		if (message.role !== "assistant") continue;
		const text = message.content
			.filter((part) => part.type === "text")
			.map((part) => part.text)
			.join("\n")
			.trim();
		if (text) return text;
	}
	return "";
}

/**
 * What to say about an ending that was not the end of the work.
 *
 * Written for the parent model first — it is the one that has to decide whether to redispatch,
 * narrow the task, or carry on with a partial answer — and read by a person second. Each names the
 * cause and what to do about it, because "没有输出" gives neither.
 */
function incompleteNote(reason: AgentRunResult["reason"], error: string | undefined, salvaged: boolean): string | null {
	if (reason === "max_turns") {
		return salvaged
			? `⚠ 这次派发用满了 ${MAX_SUB_AGENT_TURNS} 步，下面是它被叫停时补交的结论——它没能自己跑完，可能有没查到的地方。要更完整的结果，把任务拆小再派一次。`
			: `⚠ 这次派发用满了 ${MAX_SUB_AGENT_TURNS} 步就停了，下面是它停下前最后说的话，不是完整结论。要完整的结果，把任务拆小再派一次。`;
	}
	if (reason === "stalled") {
		return "⚠ 它反复用同样的参数调同一个工具、每次拿到的结果都一样，已经停下。下面是它停下前最后说的话，不是完整结论。";
	}
	if (reason === "error") {
		return `⚠ 模型服务出错，这次派发没跑完${error ? `：${error}` : ""}。下面是它中断前最后说的话，不是完整结论。`;
	}
	return null;
}
