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
import { resolveModel } from "../config/settings.ts";
import { saveRule, type RuleDestination } from "../rules/save.ts";
import type { Boundary, SessionMeta } from "../session/store.ts";
import type { SessionStorage } from "../session/storage.ts";
import type { ApprovalDecision, ApprovalRequest, Message, ThinkingLevel, Tool, UserContent } from "../types.ts";
import { ApprovalGate, sessionApprovalGate } from "./approvals.ts";
import type { ContextBreakdown } from "./context.ts";
import { describeContext, describeSession, type SessionFacts, type SessionStatus } from "./reporting.ts";
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

export class AgentSession {
	readonly store: SessionStorage;
	readonly log: SessionLog;
	readonly can: SessionCapabilities;
	cwd: string;

	private settings: Settings;
	private streamFn?: AgentRunConfig["streamFn"];
	private controller: AbortController | null = null;
	private steering: Message[] = [];
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
		await this.can.load(this.cwd, this.settings);
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
		this.settings = settings;
		for (const subject of settings.alwaysAllow) this.approvals.allow(subject);
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
			this.steering.push(message);
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
		await this.can.dispose();
	}
}
