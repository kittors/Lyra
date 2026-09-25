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
import { commandShell } from "../platform.ts";
import { join } from "node:path";
import type { AgentEvent, AgentEventSink } from "../agent/events.ts";
import type { AgentRunConfig, AgentRunResult } from "../agent/loop.ts";
import { RepetitionWatch } from "../agent/repetition.ts";
import { runTurn } from "../agent/runner.ts";
import { streamAssistant } from "../ai/index.ts";
import type { Settings } from "../config/settings.ts";
import { resolveModelRef } from "../config/model-roles.ts";
import { projectRootsFor } from "../config/project-roots.ts";
import { today, withEnvironment } from "../prompt/environment.ts";
import { readPromptOverride } from "../prompt/overrides.ts";
import { buildSystemPrompt, loadProjectInstructions } from "../prompt/system.ts";
import { sandboxModeFor } from "../sandbox/mode-for.ts";
import { lyraHome } from "../session/store.ts";
import { CODE_INTEL_KEY, CodeIntelManager } from "../lsp/manager.ts";
import { resolveSubAgentModel } from "../config/model-roles.ts";
import { sessionPruner } from "./aged-prune.ts";
import { compactWith } from "./compaction.ts";
import { continueWhileWorkRemains } from "./continuation.ts";
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
import { TODOS_KEY, type TodoItem } from "../tools/todo.ts";
import type { ApprovalDecision, ApprovalRequest, JsonSchema, Message, ModelConfig, ProviderConfig, Tool } from "../types.ts";
import type { SubAgentConversation, SubAgentRegistry } from "./sub-agents.ts";
import { isIsolatedWorktree } from "./workspace.ts";

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
	/** 登记簿里的 id，续跑用。没有登记簿的宿主不给。 */
	id?: string;
	/** 没做完就停下了——`text` 开头那句话说了为什么。上下文还在，可以续跑。 */
	incomplete?: boolean;
	/** 人在面板上把它按停的。派它来的那一方不该自作主张地让它接着跑。 */
	stoppedByUser?: boolean;
}

/**
 * 子代理每跑多少轮停下来看一眼——检查点，不是上限。
 *
 * 这个数从前是硬上限：到了就停，上下文整个扔掉，交回停下前最后说的那句话，派它来的模型只能
 * 从零再派一个，把读过的文件再读一遍。反馈里「重开三个子代理、个个跑满 60 步、最后主会话自己
 * 做了」就是这么来的。60 这个数也不是量出来的：它是 8 月引入子代理时写下的，后来补的理由是
 * 「可能同时有十来个在跑」——而并发现在由派发闸门管着（默认 4 个、最多 8 个），不该再压在
 * 每个子代理的轮数上。
 *
 * 现在到了检查点：
 *   - 它的清单在往前推，就接着跑——判据和主会话的续跑链是同一个（`continuation.ts`），在
 *     真实事故上校准过，不是另起的「它是不是在瞎忙」的启发式；
 *   - 否则讨一份交接（做了什么、还剩什么、下一步），然后**停下但留着上下文**：派它来的那一方
 *     用 `task` 的 `resume` 让它从停下的地方接着来，只付新增的那几轮。
 *
 * 按定义可以改（agent 文件里的 `maxTurns`）。改的是「多久汇报一次」，不是「最多干多少活」。
 */
export const SUB_AGENT_CHECKPOINT_TURNS = 60;

/**
 * 一个没有声明输出格式的子代理，到检查点时交的那份交接。
 *
 * `general` 之前在这里什么都不交：只有带 schema 的子代理有补交的那一轮，其余的交回的是「停下前
 * 最后说的话」——一个读文件读到一半被截断的子代理，最后说的多半是「让我再看看 xxx」。
 *
 * 三个字段对着续跑的人要问的三件事，缺一不可：已经知道了什么（别再查一遍）、还差什么（接下来
 * 干什么）、打算怎么干（接手的人照着走，或者改道）。
 */
export const HANDOFF_SCHEMA: JsonSchema = {
	type: "object",
	required: ["summary", "remaining"],
	properties: {
		summary: { type: "string", description: "已经做完了什么、查到的关键事实——带上 `path:line`，接手的人不用再查一遍。" },
		remaining: { type: "string", description: "还没做完的部分，以及卡在哪。" },
		next: { type: "string", description: "你打算接下来怎么做——接着跑的时候照这个走。" },
	},
};

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
	/** Passed through to the subagent; see `ToolContext.allowedPaths`. */
	allowedPaths?: ReadonlySet<string>;
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
	input: { description: string; prompt: string; agentType?: string; resume?: string },
	provider: ProviderConfig,
	model: ModelConfig,
	_parentSystemPrompt: string,
): Promise<SubAgentAnswer> {
	/*
	 * 续跑：还是那个子代理，带着它读过、做过的一切。
	 *
	 * 这是从零重派的反面。重派的那个什么都不知道，把上一个读过的文件再读一遍、把走过的弯路
	 * 再走一遍；续跑的这个只往它自己的历史后面接一句话，前缀跟它上一次请求逐字相同，供应商的
	 * 缓存还热着的话，那几十轮历史几乎不花钱。
	 *
	 * 只能续跑自己派出去的：主会话续跑它派的，子代理续跑它派的。别人的子代理不是你能指挥的。
	 */
	const earlier = input.resume === undefined ? undefined : resumable(options, input.resume);

	// 旧名在这里也要认：历史记录重放和外部调用都可能带着 `fast`／`deep` 进来。见 `RENAMED_AGENTS`。
	// 续跑的时候不换人：它是谁，当初派出去时就定了。
	const wanted = earlier ? earlier.conversation.agent : resolveAgentName(input.agentType ?? "general", options.agents);
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
	// A resumed run keeps the id it had: same row on the roster, same transcript, same `agent://`.
	const id = earlier?.id ?? `${options.sessionId}:sub:${randomUUID().slice(0, 8)}`;
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
	/*
	 * 续跑的用它原来那一份：清单、读过哪些文件、裁剪器都在里面。丢了它，它要改一个文件得先
	 * 重读一遍，清单也得从头写——那正是续跑要省下的东西。
	 */
	const subState = earlier?.conversation.state ?? new Map<string, unknown>();
	subState.set(SKILLS_KEY, options.skills);
	subState.set(AGENTS_KEY, options.agents);
	// So the `task` tool one level down knows where it is, and can refuse a cycle by name.
	subState.set(DISPATCH_KEY, here);
	// 上一段交的东西说的是上一段。这一段要交，就得自己再交一次——否则一次什么都没交的续跑会把旧的那份当成新结论。
	subState.delete(YIELD_KEY);
	/*
	 * 状态图是新建的，所以这一条要自己带下去。
	 *
	 * 上面已经把 `task` 从工具表里摘了，这是同一件事的第二道——挡的是别的路子把工具放回去的情况
	 * （`definition.output` 拼 `allowed` 时、插件改工具表时）。`mentioned` 是空的：点名放行的是
	 * 这个子代理本身，那次已经用掉了，它不继承任何人的通行证。
	 */
	if (delegationOff) subState.set(DELEGATION_KEY, { tier: "off", mentioned: [] } satisfies DelegationDecision);
	// 续跑时设置可能已经改回来了；上一段留下的「关掉」不能跟着过来。
	else subState.delete(DELEGATION_KEY);

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
	/*
	 * 面板上按停的那一下，要认得出是人按的。
	 *
	 * 父会话整轮被停和这一个被单独按停，落到这里都是 `abort`。前者整件事都停了，没人会读结果；
	 * 后者父会话还在跑，会读到它交回的东西——它得知道这是人的决定，别转头就让它接着跑。
	 */
	const stopByUser = () => controller.abort(STOPPED_BY_USER);
	if (earlier) registry?.reopen(id, { abort: stopByUser });
	else
		registry?.start({
			id,
			agent: definition.name,
			description: input.description,
			abort: stopByUser,
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
	const opening: Message = { role: "user", content: [{ type: "text", text: input.prompt }], timestamp: Date.now() };
	registry?.record(id, opening);
	/*
	 * 续跑的这一句是转录中间新添的，要单独发出去。
	 *
	 * 新派的那一句不用：`subagent` 事件里带着它，面板打开时从登记簿整份读。而续跑时面板多半
	 * 正开着，只收增量——不发，这一句就只在登记簿里，屏幕上看到的是它没头没尾地又动起来了。
	 */
	if (earlier) await options.emit({ type: "subagent_message", id, message: opening });

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
		...(earlier ? { resumed: true } : {}),
	});

	// Build a complete, standalone system prompt for sub-agents
	const subAgentPrompt = await buildSystemPrompt({
		cwd: options.cwd,
		projectRoots: projectRootsFor(options.settings.projects, options.cwd),
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
		// Its own mode decides its shell, exactly as `sandboxMode` below is decided for its tools.
		shell: commandShell(sandboxModeFor(options.settings.permissionMode)),
		modelName: runModel.name,
		isGitRepo: await pathExists(join(options.cwd, ".git")),
			isolatedWorktree: await isIsolatedWorktree(options.cwd),
		appendSystemPrompt: definition.output
			? `${definition.systemPrompt}\n${yieldInstruction(definition.output)}`
			: definition.systemPrompt,
	});

	// 子代理也要知道今天几号，同样接在末尾——理由见 `prompt/environment.ts`。
	let envDate = earlier?.conversation.envDate ?? today();
	let history: Message[];
	if (!earlier) history = withEnvironment([opening]);
	else if (today() === envDate) {
		/*
		 * 原样接在它上一次看到的历史后面，一个字节都不动。
		 *
		 * 不从转录重建：转录里没有压缩边界、没有那条日期块，重建出来的前缀从第二条起就跟上一次
		 * 请求对不上，缓存整段作废——续跑省下的那部分又花回去了。
		 */
		history = [...earlier.conversation.view, opening];
	} else {
		// 隔了天再续：旧的日期块留在原位（前缀不动），新的一条接在末尾，模型读到的「今天」是对的。
		envDate = today();
		history = withEnvironment([...earlier.conversation.view, opening]);
	}

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
	 * Only for a run that stopped at a checkpoint with work left and has not already yielded — any
	 * definition, not only the ones that declare a schema: a `general` sub-agent cut off at the
	 * checkpoint used to hand back whatever sentence it happened to say last. An aborted one is
	 * excluded on purpose: stopping it was somebody's decision, and spending another request would
	 * be arguing with it.
	 */
	const needsFinalYield = (reason: AgentRunResult["reason"]) =>
		reason === "max_turns" && subState.get(YIELD_KEY) === undefined && !controller.signal.aborted;

	let result: AgentRunResult;
	/** Every round's messages, so the prose fallback can see what the last one said. */
	const produced: Message[] = [];
	/**
	 * 模型眼里的历史，随着每一段往前走——续跑、检查点之后接着跑，都接在它后面。
	 *
	 * 讨交接的那一轮不算进来：那是跟派它来的人的一次交代，不是它干活的一部分。续跑时它从交代
	 * 之前的地方接着干，「这是最后一轮、只剩 yield」那句话不该出现在它往后的历史里。
	 */
	let view: Message[] = history;
	/** Whether the extra round got a delivery out of it, which changes what the answer says. */
	let salvaged = false;
	const checkpoint = definition.maxTurns ?? SUB_AGENT_CHECKPOINT_TURNS;
	try {
		await options.emit({ type: "subagent_event", id, event: {
			type: "context", systemPrompt: subAgentPrompt, tools: allowed.map(tool => tool.name),
			skills: options.skills.map(skill => skill.name),
			schemas: allowed.map(tool => ({ name: tool.name, description: tool.description, parameters: tool.parameters })),
		} });
		const runConfig: AgentRunConfig = {
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
							/*
							 * 续跑不过白名单：能续的只有它自己派出去的那些，派的那一刻已经过过一次了。而这里
							 * 拿到的名字是调用时填的，不是那个子代理真正的定义——拿它来查只会冤枉人。
							 */
							if (nested.resume === undefined && Array.isArray(allowedNames) && !allowedNames.map((name) => resolveAgentName(name, options.agents)).includes(wanted)) {
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
				allowedPaths: options.allowedPaths,
				// Derived rather than passed down: same settings, same cwd, same answer — and one
				// fewer parameter that can be forgotten at a new call site. A delegated run reads
				// across the project's folders exactly as the conversation that dispatched it does.
				projectRoots: projectRootsFor(options.settings.projects, options.cwd),
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
				maxTurns: checkpoint,
				/*
				 * 一只表、一个裁剪器，跨检查点共用——和主会话续跑链同一个理由：跑满一段攒下的观察，
				 * 不该在接着跑的时候清零。裁剪器放在它自己的状态图里，续跑时也还是那一个。
				 */
				repetition: new RepetitionWatch(),
				pruner: sessionPruner(subState),
			};
		/** 跑一段，并记下模型此刻眼里的历史。 */
		const segment = async (messages: Message[]): Promise<AgentRunResult> => {
			const ran = await runTurn({ ...runConfig, messages }, relay);
			produced.push(...ran.messages);
			view = ran.view ?? [...messages, ...ran.messages];
			return ran;
		};

		/*
		 * 到了检查点，清单在往前推就接着跑。
		 *
		 * 判据和主会话的续跑链是同一个，直接用它：清单里还有没做完的、并且这一段确实打了勾，就再
		 * 跑一段；连着两段一项没完成、或者根本没写清单，就停下来交接。这条判据在主会话上用真实事故
		 * 校准过（见 `continuation.ts` 顶上那段），不是另起一个「它是不是在瞎忙」的猜测——那种猜测
		 * 试过两次，两次都误伤了真实工作（`repetition.ts` 顶上）。
		 *
		 * 提示发到它自己的面板上，不进主对话：那是它的事。
		 */
		result = await continueWhileWorkRemains(await segment(history), {
			run: segment,
			messages: () => view,
			todos: () => (subState.get(TODOS_KEY) as TodoItem[] | undefined) ?? [],
			aborted: () => controller.signal.aborted,
			notify: (message) => options.emit({ type: "subagent_event", id, event: { type: "notice", level: "info", message } }),
			resuming: () => {},
			signal: controller.signal,
			// 请求那一层已经按设置重试过了，外面这层不再加码——理由见 `session-turn.ts` 同一处。
			requestRetriesHandled: true,
		});

		/*
		 * 停在检查点、还有活没干完时，讨一份交接回来。
		 *
		 * 有 schema 的子代理只认 `yield`——没调用就等于什么都没交。没有 schema 的，从前连这一轮都
		 * 没有，交回的是它停下前最后说的那句话：一个读文件读到一半被截断的子代理，最后说的多半是
		 * 「让我再看看 xxx」。四个 explore 各跑了半小时、一份报告都没有，就是这么来的。
		 *
		 * 所以再给一轮，工具表里只剩 `yield`——没有 schema 的用交接那一份（做了什么、还剩什么、
		 * 下一步）。它没有别的事可做，只能交。两轮而不是一轮：字段填错时校验会退回来，留一次改正的
		 * 机会比让整轮白费划算。
		 *
		 * 交完它并没有被扔掉：上下文留着（`view` 停在这一轮之前），派它来的那一方可以续跑。
		 *
		 * 只在这一种收尾上做。`stalled` 是它在原地打转，再问一次多半还是同一个圈；上游出错时
		 * 连接本身就是坏的；被人按停的那次，用户要的就是它别再花钱了。
		 */
		if (needsFinalYield(result.reason)) {
			const handoff = yieldTool ?? makeYieldTool(HANDOFF_SCHEMA, { mode: "permissive" });
			const salvage = await runTurn(
				{
					sessionId: id,
					cwd: options.cwd,
					provider: runProvider,
					model: runModel,
					systemPrompt: subAgentPrompt,
					// 只有 yield。剩下的工具都拿走，它就没有第二条路可走了。
					tools: [handoff as unknown as Tool],
					// 模型眼里的那一份：压缩过就是压缩过的。从前拼的是完整原文，压缩过的子代理在这一轮又撑爆一次。
					messages: [...view, finalDemand(checkpoint)],
					thinking: chosen.thinking,
					retryAttempts: options.settings.retryAttempts,
					retryPolicy: () => (options.getSettings?.() ?? options.settings).retryPolicy,
					signal: controller.signal,
					state: subState,
					requestApproval: (request) => options.requestApproval(request),
					compact: compactHistory,
					streamFn: options.streamFn,
					maxTurns: 2,
				},
				relay,
			);
			produced.push(...salvage.messages);
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
		// 状态图会留下来给续跑用，一个已经关掉的语言服务不能跟着留下——续跑时要用，就让它重新起一个。
		subState.delete(CODE_INTEL_KEY);
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
	const cutShort = aborted ? null : incompleteNote(result.reason, result.error, salvaged, checkpoint);
	const answer = cutShort ? [cutShort, delivered].filter(Boolean).join("\n\n") : delivered;

	/*
	 * Aborted is not failed, and neither is out of rounds.
	 *
	 * A sub-agent stopped on purpose has done exactly what was asked of it, and recording that as a
	 * failure would put an error in the parent's transcript for a button the user pressed. A run
	 * that used up its rounds or stopped going anywhere is not a failure either — it did the work,
	 * it just did not get to the end of it, and the note above says so. Only a provider that failed
	 * the request is `failed`.
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
	/*
	 * 不管怎么结束的，上下文都留着。
	 *
	 * 跑到检查点的、上游出错的、原地打转的、被按停的、正常做完的——每一种都可能有人想让它接着来：
	 * 接着干完、换个方向、服务恢复后再试、追问一句它刚才说的东西。留着的代价是内存里多一份引用
	 * （消息对象跟转录是同一批），扔掉的代价是下一个从零开始，把它读过的再读一遍。
	 */
	registry?.keep(id, { agent: definition.name, view, state: subState, envDate });
	await options.emit({
		type: "subagent_done",
		id,
		steps,
		answer,
		status,
		...(result.error ? { error: result.error } : {}),
	});
	return {
		text: answer,
		output: yielded?.value,
		warnings: yielded?.warnings,
		// 没有登记簿就没有地方留上下文，给了 id 也续不上。
		...(registry ? { id } : {}),
		...(cutShort ? { incomplete: true } : {}),
		...(aborted && controller.signal.reason === STOPPED_BY_USER ? { stoppedByUser: true } : {}),
	};
}

/** 面板上按停时 `abort` 带的理由，用来跟「父会话整轮被停」分开。 */
const STOPPED_BY_USER = "stopped-by-user";

/**
 * 要续跑的那一个，以及能不能续。
 *
 * 不能续的各给一句能据以行动的话——`task` 会把它原样交给模型。「只能续跑自己派出去的」在这里
 * 拦：主会话派的，父亲是空；子代理派的，父亲是它自己的 id。
 */
function resumable(options: SubAgentOptions, wanted: string): { id: string; conversation: SubAgentConversation } {
	if (!options.registry) throw new Error("这里不保留子代理的上下文，没法续跑；重新派一个，并把之前交回的结论写进 prompt。");
	const found = options.registry.lookupResumable(wanted);
	if ("refusal" in found) throw new Error(found.refusal);
	if ((found.summary.parentId ?? undefined) !== (options.dispatch?.id ?? undefined)) {
		throw new Error(`子代理 \`${found.id}\` 不是你派出去的，不能续跑它。`);
	}
	return { id: found.id, conversation: found.conversation };
}

/**
 * The message that spends the salvage round.
 *
 * Blunt, and it has to be: the round it opens has one tool on the table and one thing worth doing
 * with it. "不完整也要交" is the important half — a model that has been told it is out of budget
 * will otherwise apologise for not finishing and deliver nothing, which is the failure this whole
 * round exists to prevent.
 *
 * 「上下文会留着」也要说：交接是写给接着干的人看的，包括它自己。知道自己可能被续跑的模型，
 * 会把「下一步」写成能照着走的样子，而不是一句「时间不够了」。
 *
 * `synthetic`, because the runtime is speaking. It has to be a user message for the model to take
 * it as an instruction, and the pane must not draw it as something the person typed.
 */
function finalDemand(rounds: number): Message {
	return {
		role: "user",
		content: [
			{
				type: "text",
				text:
					`（自动追加）到检查点了：这一段的 ${rounds} 轮已经用完，你手上只剩 \`yield\` 一个工具。` +
					"按它的字段把目前的进展交上去：做完了什么、查到的关键事实（带 `path:line`）、还剩什么没做、下一步打算怎么做——" +
					"没有对应字段的写进 `summary`。不完整也要交。" +
					"你的上下文会原样留着，派你来的人可能让你从这里接着做。不调用 `yield`，他就什么都拿不到。",
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
 * Written for the parent model first — it is the one that has to decide whether to resume it, take
 * over, or carry on with a partial answer — and read by a person second. Each names the cause and
 * what is left, because "没有输出" gives neither.
 *
 * 从前这里对跑满的那种说「把任务拆小再派一次」。派它来的模型照做了：新派的那个从零开始，读
 * 同样的文件，又跑满，再派，还是跑满——反馈里「重开三个子代理、个个 60 步、最后主会话自己做了」
 * 就是这句话一手促成的。它的上下文明明还在，该说的是「它还在，可以接着跑」。具体怎么续由
 * `task` 在结果末尾交代（那是说给模型的话，面板上用不着）。
 */
function incompleteNote(reason: AgentRunResult["reason"], error: string | undefined, salvaged: boolean, rounds: number): string | null {
	if (reason === "max_turns") {
		return salvaged
			? `⚠ 到了检查点（这一段 ${rounds} 轮），它还没做完。下面是它交的阶段性交接，不是完整结论。它的上下文都还留着，可以接着跑。`
			: `⚠ 到了检查点（这一段 ${rounds} 轮），它还没做完，也没交出交接，下面是它停下前最后说的话。它的上下文都还留着，可以接着跑。`;
	}
	if (reason === "stalled") {
		return "⚠ 它反复用同样的参数调同一个工具、每次拿到的结果都一样，已经停下。下面是它停下前最后说的话，不是完整结论。它的上下文还留着，可以换个方向让它接着跑。";
	}
	if (reason === "error") {
		return `⚠ 模型服务出错，这次派发没跑完${error ? `：${error}` : ""}。下面是它中断前最后说的话，不是完整结论。它的上下文还留着，服务恢复后可以让它接着跑，不必重派。`;
	}
	return null;
}
