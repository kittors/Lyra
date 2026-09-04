/**
 * The runtime that turns settings + a workspace into a running agent.
 *
 * Everything user-facing goes through here: the desktop main process, the sync server and the CLI
 * all drive the same `AgentSession`, so the phone and the desktop cannot drift.
 *
 * What is left in this file is the driving: take a prompt, run a turn, stop, queue, approve. What
 * the session *has done* is `SessionLog` — the transcript and the append-only log kept as one
 * thing — and what it *can do* is `SessionCapabilities`. Both are held rather than inherited, so
 * the boundary is visible at every call site.
 */

import type { AgentEvent, AgentEventSink, QueuedTask } from "../agent/events.ts";
import type { AgentRunConfig } from "../agent/loop.ts";
import type { Settings } from "../config/settings.ts";
import { layerProjectSettings, resolveModel } from "../config/settings.ts";
import { SESSIONS_KEY, type SessionLookup } from "../resources/more-handlers.ts";
import { saveRule, type RuleDestination } from "../rules/save.ts";
import type { Boundary, SessionMeta } from "../session/store.ts";
import type { SessionStorage } from "../session/storage.ts";
import type { ApprovalDecision, ApprovalRequest, Message, ThinkingLevel, Tool, UserContent } from "../types.ts";
import { ApprovalGate, sessionApprovalGate } from "./approvals.ts";
import type { ContextBreakdown } from "./context.ts";
import { describeContext, describeSession, type SessionFacts, type SessionStatus } from "./reporting.ts";
import { CapabilityWatcher } from "./capability-watch.ts";
import { SessionCapabilities } from "./session-capabilities.ts";
import { scratchDir, sessionFacts } from "./session-facts.ts";
import { SessionLog } from "./session-log.ts";
import { compactIfNeeded } from "./compaction.ts";
import { driveTurn, modelHistory, summaryStream } from "./session-turn.ts";
import { SubAgentRegistry } from "./sub-agents.ts";
import { sessionTaskQueue, type TaskQueue } from "./task-queue.ts";
import { stripStaleHandles } from "./model-switch.ts";

export interface AgentSessionOptions {
	cwd: string;
	settings: Settings;
	store: SessionStorage;
	meta?: SessionMeta;
	emit: AgentEventSink;
	/**
	 * Tools that only exist on a particular host — the desktop app contributes browser
	 * automation backed by a real BrowserWindow, which the platform-agnostic core cannot build.
	 */
	extraTools?: Tool[];
	/**
	 * Replaces the provider call, exactly as `AgentRunConfig.streamFn` does one layer down.
	 *
	 * Exposed here so behaviour that lives in the session rather than the loop — the task
	 * queue, in particular — can be exercised without a network round trip.
	 */
	streamFn?: AgentRunConfig["streamFn"];
}

/**
 * 一条消息渲染成一行给人读的文本。
 *
 * 转录里工具调用占绝大多数，而对「上次我们怎么解决这个的」这个问题，有用的是**说过的话**。
 * 工具调用留一行名字：完全不提会让对话看起来像凭空得出结论，而把参数和结果都铺开，
 * 读一次别人的会话就要花掉这次会话的上下文。
 */
function renderMessage(message: Message): string {
	const text = message.content
		.filter((block): block is { type: "text"; text: string } => block.type === "text")
		.map((block) => block.text)
		.join("\n")
		.trim();

	if (message.role === "user") return message.synthetic ? "" : `用户：${text}`;
	if (message.role !== "assistant") return "";

	const calls = message.content.flatMap((block) => (block.type === "toolCall" ? [block.name] : []));
	const parts = [text && `助手：${text}`, calls.length > 0 && `（调用了 ${calls.join("、")}）`].filter(Boolean);
	return parts.join("\n");
}

export class AgentSession {
	readonly store: SessionStorage;
	readonly log: SessionLog;
	readonly can: SessionCapabilities;
	cwd: string;

	private settings: Settings;
	/**
	 * 应用给的那一份，没有叠过项目层。
	 *
	 * 留着它，是因为项目层要能重新叠：设置一变，主进程推下来的是全局的那一份，
	 * 拿已经叠过的结果再叠一次，项目的值会被当成全局的值固化下来。
	 */
	private globalSettings: Settings;
	/** 盯着技能和规则目录的那个，没有可听的目录时是 null。 */
	private watcher: CapabilityWatcher | null = null;
	private streamFn?: AgentRunConfig["streamFn"];
	private controller: AbortController | null = null;
	private steering: Message[] = [];
	/**
	 * 说了「等这一轮做完再说」的那些消息。
	 *
	 * 跟 `steering` 分开的理由就是它们的区别：`steering` 会被塞进正在跑的那一轮，而这些要等
	 * 那一轮结束。合成一个队列的话，两种意思里必然有一种表达不出来。
	 */
	private readonly pending: { message: Message; thinking?: ThinkingLevel }[] = [];
	/**
	 * Every sub-agent this session has dispatched, live and finished.
	 *
	 * Owned by the session rather than by the turn that spawned one: a delegated run is worth
	 * reading after the turn that asked for it has ended, and the pane showing it outlives both.
	 * Emitting on change is what keeps a window in step without polling.
	 */
	readonly subAgents = new SubAgentRegistry(() => {
		void this.emit({ type: "subagents", agents: this.subAgents.list() });
	});
	private readonly approvals: ApprovalGate;
	private readonly tasks: TaskQueue = sessionTaskQueue({
		run: (task) => this.prompt([{ type: "text", text: task.text }], { origin: task.origin }),
		busy: () => this.running,
		changed: (tasks) => this.emit({ type: "tasks", tasks }),
	});

	constructor(options: AgentSessionOptions) {
		this.cwd = options.cwd;
		this.settings = options.settings;
		this.globalSettings = options.settings;
		this.store = options.store;
		this.streamFn = options.streamFn;
		this.log = new SessionLog(options.store, options.emit, options.meta);
		this.can = new SessionCapabilities(options.extraTools ?? []);
		this.approvals = sessionApprovalGate({
			mode: () => this.settings.permissionMode,
			cwd: () => this.cwd,
			emit: (event) => this.emit(event),
			alwaysAllow: options.settings.alwaysAllow,
		});
	}

	/** The history, as callers have always read it. */
	get meta(): SessionMeta {
		return this.log.meta;
	}

	get messages(): Message[] {
		return this.log.messages;
	}

	/**
	 * Adopt a transcript read back from disk, and where the model's view of it begins.
	 *
	 * Both, because they are two halves of one fact. Restoring the messages without the boundary
	 * reopens a compacted session on its full history: correct on screen, and back over the context
	 * window on the first prompt — which then compacts again, from scratch, having thrown away the
	 * summary it paid for last time.
	 */
	restore(messages: Message[], compaction: Boundary | null = null): void {
		/*
		 * Handles from before a model change are dropped on the way in, not at the point of use.
		 *
		 * The log on disk is append-only, so a switch cannot edit what is already written — which
		 * means the stale handles come back every time the session is opened. Cleaning here covers
		 * both ways in, from the session hub and from sync, and leaves the encoders unchanged.
		 */
		this.log.restore(stripStaleHandles(messages, this.log.meta?.modelSwitchedAt), compaction);
	}

	get running(): boolean {
		return this.controller !== null;
	}

	/** Load skills, agents and MCP tools. Safe to call again after settings change. */
	async initialize(): Promise<void> {
		if (!this.log.meta) {
			this.log.meta = await this.store.create(this.cwd, this.settings.defaultModelId ?? "");
		}
		await this.applyProjectConfig();
		await this.can.load(this.cwd, this.settings);
		/*
		 * `session://` 的数据源。
		 *
		 * 在这里而不是 `SessionCapabilities` 里，因为它要的是 store——而能力层刻意不知道会话
		 * 是怎么存的。给的是两个方法而不是整个 store：这个地址要读转录，不该顺手获得删除会话
		 * 的能力。
		 */
		this.can.state.set(SESSIONS_KEY, {
			recent: async (limit) =>
				(await this.store.listSessions())
					.filter((meta) => !meta.archived)
					.sort((a, b) => b.updatedAt - a.updatedAt)
					.slice(0, limit)
					.map((meta) => ({ id: meta.id, title: meta.title ?? "", updatedAt: meta.updatedAt })),
			transcript: async (id) => {
				const meta = (await this.store.listSessions()).find((entry) => entry.id === id);
				if (!meta) return null;
				const messages = await this.store.messages(meta.projectId, id);
				return { title: meta.title ?? "", lines: messages.map(renderMessage).filter(Boolean) };
			},
		} satisfies SessionLookup);
		/*
		 * 扩展的 `session_start`。
		 *
		 * 在 `can.load` 之后：这时扩展自己才刚被加载起来，而一个还没起来的 worker 收不到事件。
		 * 不 await——一个扩展在启动时慢，不该让打开一个对话跟着慢。
		 */
		void this.can.extensions.dispatch("session_start", { cwd: this.cwd, sessionId: this.log.meta.id }).catch(() => {});
		this.startWatching();
	}

	/**
	 * 盯着那些真的放了东西的目录，改了就重读。
	 *
	 * 编辑技能和规则是这套系统里最高频的动作之一：写一条、试一句、再改一版。要求每一版都重启
	 * 窗口，等于要求每一版都重新加载全部插件、重连全部 MCP、丢掉正在看的那个对话。
	 *
	 * `watched` 这份名单一直被收集着——每个 provider 都老实报了，注册表也合并了——只是从来
	 * 没有人接。
	 */
	private startWatching(): void {
		this.watcher?.close();
		if (this.can.watched.length === 0) return;
		this.watcher = new CapabilityWatcher({
			dirs: this.can.watched,
			// 一轮跑到一半绝不换：模型正按当前那份清单做决策。
			idle: () => !this.running,
			reload: () => this.reloadCapabilities(),
		});
	}

	/**
	 * 重读一遍，然后说清楚变了什么。
	 *
	 * 「能力已更新」对着一次 `git checkout` 说了等于没说——那会换掉半个目录。所以报的是数量差
	 * 和新出现的名字。三个数都是 0 也是一个诚实的答案：有人改了某个规则的正文，而名单没变。
	 */
	/**
	 * 重新发现能力，并把变化说出来。
	 *
	 * 公开的，因为它是监听器的动作本身——而测试要验的是「重载会更新 `can` 并且发出通知」，
	 * 不是「`fs.watch` 在这台机器上多久发一次事件」。后者是 Node 的事，在负载高时要等十几秒，
	 * 而一条等它的测试是在赌延迟：`capability-watch.test.ts` 为此把超时调大过三次。
	 */
	async reloadCapabilities(): Promise<void> {
		const before = {
			skills: this.can.skills.length,
			rules: this.can.rules.always.length + this.can.rules.book.length + this.can.rules.stream.length,
			agents: this.can.agents.length,
			names: new Set([...this.can.skills.map((s) => s.name), ...this.can.agents.map((a) => a.name)]),
		};

		await this.can.load(this.cwd, this.settings);
		// 目录名单本身也会变——新建了 `.lyra/rules/` 之后，它才第一次出现在 `watched` 里。
		this.startWatching();

		const rules = this.can.rules.always.length + this.can.rules.book.length + this.can.rules.stream.length;
		await this.emit({
			type: "capabilities_changed",
			skills: this.can.skills.length - before.skills,
			rules: rules - before.rules,
			agents: this.can.agents.length - before.agents,
			added: [...this.can.skills.map((s) => s.name), ...this.can.agents.map((a) => a.name)]
				.filter((name) => !before.names.has(name))
				.slice(0, 4),
		});
	}

	/**
	 * 把 `<cwd>/.lyra/config.json` 叠到全局设置上。
	 *
	 * 这一层以前只有一个模块和一份测试，产品里没有任何东西读那个文件——「A 项目用便宜模型加
	 * 严格审批、B 项目用强模型加宽松审批」在这个分支上一直只是一段注释。
	 *
	 * 在会话上叠而不是在应用上叠，是因为项目本来就是会话的属性：一个窗口可以同时开着两个项目的
	 * 对话，而设置页只有一个。
	 */
	private async applyProjectConfig(): Promise<void> {
		const layered = await layerProjectSettings(this.globalSettings, this.cwd).catch(() => null);
		if (!layered) return;
		this.settings = layered.settings;

		/*
		 * 被拒的键要说出来，而且要说得像一次拒绝。
		 *
		 * `.lyra/config.json` 是要提交进仓库的，落在里面的凭证就是已公开的凭证。安静地忽略它，
		 * 写的人会以为它生效了——那正是「能正常工作、只是把密钥共享了」的那种错误。
		 */
		if (layered.refused.length > 0) {
			await this.emit({
				type: "notice",
				level: "warn",
				message: `.lyra/config.json 里的 ${layered.refused.join("、")} 被忽略了——这个文件会进仓库，凭证和供应商只能写在全局设置里。`,
			});
		}
		if (layered.error) await this.emit({ type: "notice", level: "warn", message: layered.error });
	}

	async status(): Promise<SessionStatus> {
		return describeSession(this.facts());
	}

	async contextBreakdown(): Promise<ContextBreakdown | null> {
		return describeContext(this.facts());
	}

	private facts(): SessionFacts {
		const { log, can, cwd, settings, running } = this;
		return sessionFacts({ log, can, cwd, settings, running });
	}

	/**
	 * Summarise the conversation now, rather than when it runs out of room.
	 *
	 * What `/compact` calls. The boundary is stored exactly as it is when compaction happens on its
	 * own — there is one way a session's history gets shortened, and this only changes what starts
	 * it.
	 *
	 * Refused mid-turn: the running loop is holding its own copy of the history and would write its
	 * own boundary at the end of the turn, over this one.
	 */
	async compact(): Promise<{ ok: boolean; reason?: string; before?: number; after?: number }> {
		if (this.running) return { ok: false, reason: "对话正在进行中，等它结束再压缩。" };

		const resolved = resolveModel(this.settings, this.log.meta.modelId || this.settings.defaultModelId);
		if (!resolved) return { ok: false, reason: "还没有配置模型。" };

		const history = modelHistory(this.log, resolved.provider, resolved.model);
		if (history.length <= 6) return { ok: false, reason: "对话还太短，没什么可压缩的。" };

		const compaction = await compactIfNeeded(
			history,
			resolved.model,
			resolved.provider,
			summaryStream(this.streamFn, resolved.provider, resolved.model),
			0,
			true,
			// 剪掉的原文存下来，占位标记里给出 `artifact://` 地址。
			{ keep: (tool, content) => this.can.keepArtifact(tool, content) },
		);
		/*
		 * Two different outcomes, and they used to say the same thing.
		 *
		 * `null` means the pass ran and decided the result would not be smaller — on a short or
		 * already-compacted conversation that is the correct answer, not a failure, and telling
		 * someone to "try again later" invites them to keep pressing something that will keep
		 * declining for the same good reason.
		 *
		 * `kept === undefined` is the other one: pruning trimmed some oversized tool output but no
		 * boundary moved, so there is nothing to record. Worth saying plainly too — the window did
		 * get a little smaller, just not by summarising anything.
		 */
		if (!compaction) return { ok: false, reason: "已经够紧凑了，这次压缩不会更小。" };
		if (compaction.kept === undefined) return { ok: false, reason: "只裁掉了几段过长的工具输出，没有需要总结的历史。" };

		this.log.markCompaction(compaction.summary, compaction.kept);
		await this.emit({
			type: "compacted",
			before: history.length,
			after: compaction.messages.length,
			summary: compaction.summary,
			kept: compaction.kept,
		});
		return { ok: true, before: history.length, after: compaction.messages.length };
	}

	/** Drop the cached symbol index so the next `symbol` lookup re-reads it from disk. */
	invalidateSymbolIndex(): void {
		this.can.invalidateSymbolIndex();
	}

	/**
	 * Keep a suggested rule, and make it apply from the next turn on.
	 *
	 * The reload is the part that must not be skipped. Writing the file and leaving the session
	 * with the rules it loaded at startup gives the worst version of this feature: somebody accepts
	 * the offer, watches the same mistake happen in the very next message, and concludes the whole
	 * thing does nothing.
	 *
	 * Accepting also clears the refusal streak — they want these, they just did not want those two.
	 */
	async keepSuggestedRule(scope: RuleDestination, name: string, content: string): Promise<{ path: string; renamed?: string }> {
		const saved = await saveRule(scope, this.cwd, name, content);
		this.can.correctionBudget.recordAcceptance();
		await this.can.reloadRules(this.cwd, this.settings);
		return saved;
	}

	/** They said no. Two in a row and this session stops asking. */
	declineSuggestedRule(): void {
		this.can.correctionBudget.recordRefusal();
	}

	updateSettings(settings: Settings): void {
		this.globalSettings = settings;
		this.settings = settings;
		for (const subject of settings.alwaysAllow) this.approvals.allow(subject);
		/*
		 * 项目层重新叠一遍，不等这次调用。
		 *
		 * 它要读一次盘，而这个方法是同步的（每一个改设置的路径都在调它）。不重新叠的话，
		 * 在设置页改任何一项，都会把这个会话的项目配置默默清掉——而屏幕上没有任何东西说这件事。
		 */
		void this.applyProjectConfig();
	}

	/**
	 * Pick or change the model this session runs on, at any point.
	 *
	 * Persisted into the session log so subsequent turns use the new model. Changing it partway
	 * through also records where that happened: the reasoning handles written before it belong to
	 * the previous provider and cannot be replayed to this one. See `stripStaleHandles`.
	 */
	async setModel(modelId: string): Promise<boolean> {
		const switching = this.log.messages.length > 0 && this.log.meta.modelId !== modelId;
		const meta: SessionMeta = {
			...this.log.meta,
			modelId,
			...(switching ? { modelSwitchedAt: this.log.messages.length } : {}),
		};
		this.log.meta = meta;
		await this.log.append({ type: "meta", meta });
		// The running session holds the same messages the next turn will encode, so clean those too.
		if (switching) {
			this.log.restore(stripStaleHandles(this.log.messages, meta.modelSwitchedAt), this.log.compaction);
		}
		return true;
	}

	/**
	 * How hard this conversation asks the model to think, from here on.
	 *
	 * Written into the log like the model is, for the same reason: it is a property of the
	 * conversation rather than of the window that happens to be showing it, so it has to survive a
	 * restart, reach the phone through the same sync every other change reaches it through, and
	 * apply to a turn started from anywhere.
	 *
	 * `null` gives the conversation back to the app default rather than pinning it to whatever the
	 * default happens to be right now — a distinction that only shows itself later, when the
	 * default moves and a session that was never given an opinion should move with it.
	 */
	async setThinking(thinking: ThinkingLevel | null): Promise<void> {
		/*
		 * `undefined`, not `delete`.
		 *
		 * A `meta` record is merged over the store's copy (`Object.assign` in `appendExclusive`),
		 * so a key that is simply missing leaves the previous value standing — clearing the level
		 * by deleting the field wrote a record that changed nothing. Present-and-undefined
		 * overwrites, and `JSON.stringify` drops it on the way to disk, so the reloaded log has no
		 * level at all, which is what was meant.
		 */
		const meta: SessionMeta = { ...this.log.meta, thinking: thinking ?? undefined };
		this.log.meta = meta;
		await this.log.append({ type: "meta", meta });
	}

	// -------------------------------------------------------------------------
	// Running a turn
	// -------------------------------------------------------------------------

	/**
	 * Send a prompt. If the agent is already running, the message is queued as steering and
	 * picked up between turns instead of starting a second concurrent run.
	 */
	/**
	 * Say something to a sub-agent that is still running.
	 *
	 * Not a second conversation: the message is spliced between its turns, so it finishes the step
	 * it is on, reads this with its context intact, and carries on. False when there is no such
	 * sub-agent or it has already finished — the caller decides whether that is worth saying.
	 *
	 * The effect on the parent is indirect and that is the whole design. One executor per
	 * workspace: steering changes what the sub-agent reports back, and the parent acts on the
	 * report. Two agents writing to one working tree is a conflict waiting to happen.
	 */
	steerSubAgent(id: string, text: string): boolean {
		const message = this.subAgents.steer(id, text);
		if (!message) return false;
		/*
		 * Announced, or a window watching this sub-agent would not see what was said to it.
		 *
		 * The roster event that `steer` triggers carries summaries and no transcripts, so without
		 * this the message sat in the sub-agent's history unseen until something re-read the whole
		 * thing — and the reply, when it came, would arrive as an answer to a question that was
		 * never on screen.
		 */
		void this.emit({ type: "subagent_message", id, message });
		return true;
	}

	/** Stop one sub-agent. The parent and its siblings carry on. */
	abortSubAgent(id: string): boolean {
		return this.subAgents.abort(id);
	}

	/**
	 * Take one off the roster — stopping it first if it is still going.
	 *
	 * A running sub-agent that was merely un-listed would go on running with nothing able to reach
	 * it, so this never silently orphans one; see `SubAgentRegistry.dismiss`.
	 */
	dismissSubAgent(id: string): "removed" | "stopping" | "unknown" {
		return this.subAgents.dismiss(id);
	}

	/** Clear the finished ones, leaving anything still running. */
	dismissFinishedSubAgents(): number {
		return this.subAgents.dismissFinished();
	}

	async prompt(
		content: UserContent[],
		options: {
			thinking?: ThinkingLevel;
			origin?: "side-chat";
			/**
			 * The message is the app asking on the user's behalf, not the user typing.
			 *
			 * 「继续」 is the case: it says the same thing the user would have typed, and it is not
			 * something they wrote. Marked so the transcript does not put words in their mouth, and
			 * so the three places that look for "the last thing actually asked for" — retrying,
			 * compaction's standing instruction, whether a conversation has any real content — all
			 * see past it to the request it is continuing.
			 */
			synthetic?: boolean;
			/**
			 * 会话正忙时怎么办。默认 `steer`——插进正在跑的那一轮。
			 *
			 * `followUp` 是另一种意思：**不打断，排到这一轮后面**。「跑完之后顺手把测试也跑一遍」
			 * 属于后者，而现在说出来跟等五分钟再说出来的区别，是要不要一直守在这儿。
			 *
			 * 空闲时两者一样，都是开一个新回合——差别只存在于有东西正在跑的时候，而这正是它
			 * 唯一需要被区分的时候。
			 */
			deliver?: "steer" | "followUp";
		} = {},
	): Promise<void> {
		const message: Message = {
			role: "user",
			content,
			timestamp: Date.now(),
			...(options.origin ? { origin: options.origin } : {}),
			...(options.synthetic ? { synthetic: true } : {}),
		};

		if (this.running) {
			/*
			 * 插话，还是排队。
			 *
			 * 插话是默认，因为绝大多数在回合中途说的话都是「等等，不是那样」——那种话晚说
			 * 五分钟就白说了。而 `followUp` 说的是「这一轮做完再说」，把它插进去反而会打断
			 * 那件本来就该先做完的事。
			 */
			if (options.deliver === "followUp") this.pending.push({ message, thinking: options.thinking });
			else this.steering.push(message);
			return;
		}

		await this.log.commit(message);
		await this.emit({ type: "message_start", message });
		await this.emit({ type: "message_end", message });

		// Names the conversation after its opening line — unless it already has a name someone
		// chose, which this must not overwrite. See `SessionMeta.titleSetByUser`.
		if (!this.log.meta.titleSetByUser && this.log.messages.filter((m) => m.role === "user").length === 1) {
			await this.setTitleFromPrompt(content);
		}

		await this.run(options.thinking);
		await this.drainPending();
	}

	/**
	 * 排在这一轮后面的那些，按进来的顺序发。
	 *
	 * 一条 `followUp` 跑完可能又带出下一条，所以是循环而不是一次——而 `run` 本身在跑的时候
	 * `this.running` 为真，所以循环里不会有第二个回合同时开始。
	 */
	private async drainPending(): Promise<void> {
		while (this.pending.length > 0) {
			const next = this.pending.shift();
			if (!next) break;
			if (this.controller?.signal.aborted) break;
			await this.log.commit(next.message);
			await this.emit({ type: "message_start", message: next.message });
			await this.emit({ type: "message_end", message: next.message });
			await this.run(next.thinking);
		}
	}

	/**
	 * What this turn asks for: the caller's word, then the conversation's, then the app's.
	 *
	 * Resolved here rather than at each entry point so every way of starting a turn — the desktop,
	 * the phone through sync, a scheduled task, 「继续」 — reads the conversation's own level
	 * without each of them having to remember to.
	 */
	private thinkingFor(requested?: ThinkingLevel): ThinkingLevel | undefined {
		return requested ?? this.log.meta.thinking ?? undefined;
	}

	private async run(requested?: ThinkingLevel): Promise<void> {
		const thinking = this.thinkingFor(requested);
		const resolved = resolveModel(this.settings, this.log.meta.modelId || this.settings.defaultModelId);
		if (!resolved) {
			await this.emit({
				type: "notice",
				level: "error",
				message: "No model is configured. Add a provider in Settings → Models first.",
			});
			await this.emit({ type: "agent_end", reason: "error", error: "no_model" });
			return;
		}

		this.controller = new AbortController();
		try {
			await driveTurn({
				cwd: this.cwd,
				settings: this.settings,
				log: this.log,
				can: this.can,
				provider: resolved.provider,
				model: resolved.model,
				signal: this.controller.signal,
				thinking,
				streamFn: this.streamFn,
				scratchDir: scratchDir(this.log.meta.id),
				requestApproval: (request) => this.requestApproval(request),
				emit: (event) => this.emit(event),
				drainSteering: () => this.steering.splice(0, this.steering.length),
				subAgents: this.subAgents,
			});
		} finally {
			this.controller = null;
			// Anything still waiting for approval would hang forever once the run is over.
			this.approvals.rejectAll();
		}

		/*
		 * 这一轮跑的时候磁盘上改过的东西，现在换进来。
		 *
		 * 「流式中不替换」那条约束的另一半：排了队就得有人放出来，否则那次改动会一直等到下一次
		 * 文件事件——而人保存完文件就等着看效果，不会再去动它一次。
		 */
		void this.watcher?.resume();

		// The queue moves the moment the workspace is free again. Skipped while draining,
		// because that loop is already the thing calling us.
		void this.tasks.drain();
	}

	abort(): void {
		this.controller?.abort();
		/*
		 * Explicitly, as well as through the chain.
		 *
		 * Each sub-agent's controller is chained to this one, so aborting here already reaches them
		 * — but "stop means stop" is worth stating rather than inferring from a listener two files
		 * away, and a sub-agent left running past the session it belongs to has nothing that could
		 * ever reach it again.
		 */
		this.subAgents.abortAll();
		this.approvals.rejectAll();
		/*
		 * 排队等着的那些也一并取消。
		 *
		 * 「停止」说的是这个对话现在停下，而不是「停下当前这一轮，然后把我排的三条接着跑完」
		 * ——后者会在人按下按钮之后继续花钱，而屏幕上刚刚显示了已停止。
		 */
		this.pending.length = 0;
		// Stop means stop. Letting the queue carry on after the button was pressed would be
		// the opposite of what pressing it asks for.
		void this.tasks.cancelAll();
	}

	// -------------------------------------------------------------------------
	// Dispatched work
	// -------------------------------------------------------------------------

	get taskQueue(): QueuedTask[] {
		return this.tasks.list();
	}

	async enqueueTask(text: string, origin: QueuedTask["origin"] = "side-chat"): Promise<QueuedTask> {
		return this.tasks.enqueue(text, origin);
	}

	async cancelTask(taskId: string): Promise<boolean> {
		return this.tasks.cancel(taskId);
	}

	/** Take a finished task off the receipt list. The transcript keeps what happened. */
	async dismissTask(taskId: string): Promise<boolean> {
		return this.tasks.dismiss(taskId);
	}

	/** Put an interrupted or failed task back in the queue. See `TaskQueue.resume`. */
	async resumeTask(taskId: string): Promise<boolean> {
		return this.tasks.resume(taskId);
	}

	/**
	 * The task this session was working on when it stopped, if there is one.
	 *
	 * What makes 「继续」 in the main conversation mean the right thing. Pausing a session that was
	 * running a dispatched task cancels the task too, and continuing afterwards used to resume only
	 * the conversation — the task stayed cancelled, the side panel went on saying so, and the work
	 * the panel had dispatched was simply not done. Newest first: if several were interrupted, the
	 * one that was running is the one to pick up.
	 */
	interruptedTask(): QueuedTask | null {
		for (let i = this.tasks.list().length - 1; i >= 0; i--) {
			const task = this.tasks.list()[i]!;
			if (task.status === "cancelled" && task.cancelledBy === "stop") return task;
		}
		return null;
	}

	private emit(event: AgentEvent): Promise<void> {
		return this.log.emit(event);
	}

	// -------------------------------------------------------------------------
	// Approvals
	// -------------------------------------------------------------------------

	private requestApproval(request: ApprovalRequest): Promise<ApprovalDecision> {
		return this.approvals.request(request);
	}

	resolveApproval(requestId: string, decision: ApprovalDecision): boolean {
		return this.approvals.resolve(requestId, decision);
	}

	listPendingApprovals(): { id: string; request: ApprovalRequest }[] {
		return this.approvals.list();
	}

	// -------------------------------------------------------------------------
	// Misc
	// -------------------------------------------------------------------------

	/**
	 * Replace a message and run again from there.
	 *
	 * Editing what you asked invalidates the answer and everything built on it, so the tail is
	 * discarded rather than left dangling above a contradictory reply.
	 */
	async editAndResend(
		messageIndex: number,
		content: UserContent[],
		options: { thinking?: ThinkingLevel } = {},
	): Promise<void> {
		if (this.running) return;
		if (!(await this.log.truncateFrom(messageIndex))) return;

		await this.emit({ type: "rewound", messageCount: this.log.messages.length });
		await this.prompt(content, options);
	}

	private async setTitleFromPrompt(content: UserContent[]): Promise<void> {
		const text = content.find((c) => c.type === "text")?.text ?? "";
		const title = text.replace(/\s+/g, " ").trim().slice(0, 60) || "New session";
		await this.log.append({ type: "title", title });
		await this.emit({ type: "title", title });
	}

	/**
	 * Name the conversation by hand, and have it stay named.
	 *
	 * The title record is what the store already understands, so this is only the writing half.
	 * The other half is `titleSetByUser`: without it the first prompt renames the session after
	 * itself and the name typed a moment earlier is gone. Recorded through a `meta` write of its
	 * own so a phone syncing with `?since=N` learns it too.
	 */
	async rename(title: string): Promise<void> {
		const cleanTitle = title.trim();
		if (!cleanTitle) return;
		await this.log.append({ type: "title", title: cleanTitle });
		if (!this.log.meta.titleSetByUser) {
			const meta: SessionMeta = { ...this.log.meta, titleSetByUser: true };
			this.log.meta = meta;
			await this.log.append({ type: "meta", meta });
		}
		await this.emit({ type: "title", title: cleanTitle });
	}

	async dispose(): Promise<void> {
		this.abort();
		// 没人关的 fs.watch 会一直拿着描述符，而一天里会开关几十个会话。
		this.watcher?.close();
		this.watcher = null;
		await this.can.dispose();
	}
}
