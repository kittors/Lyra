import type { streamAssistant } from "../ai/index.ts";
import type { QueuedTask } from "../agent/events.ts";
import type { Compaction } from "../runtime/compaction.ts";
import type { ArtifactSink } from "../runtime/prune.ts";
import type { TurnMiddleware } from "../runtime/turn.ts";
import type { Skill } from "../skills/loader.ts";
import type { Message, ModelConfig, Provider, ProviderConfig, Tool } from "../types.ts";
import type { SandboxMode, SandboxNetwork } from "../sandbox/policy.ts";

/**
 * The seams.
 *
 * Each key below is a capability that can be provided by one plugin and replaced by another
 * without anything that uses it being edited. Naming them in one file is deliberate: a seam is a
 * promise about a shape, and a promise scattered across the packages that happen to implement it
 * is one nobody can check.
 *
 * A key is added here only when there is a real second implementation in prospect. Seams invented
 * ahead of need are indistinguishable from indirection.
 */

/** `ctx.llm` — which model APIs the app can speak. */
export const LLM = "llm";

export interface LlmRegistry {
	/** Register an adapter for one API shape. Returns the disposer that removes it. */
	register(api: string, provider: Provider): () => void;
	get(api: string): Provider | undefined;
	list(): string[];
}

/** `ctx.tools` — what the agent can do. */
export const TOOLS = "tools";

export interface ToolRegistry {
	/**
	 * Contribute tools.
	 *
	 * Taken as a list because a plugin usually brings a related set — the filesystem tools, the
	 * web tools — and removing them individually is never what anyone wants.
	 */
	register(tools: Tool[]): () => void;
	all(): Tool[];
	byName(name: string): Tool | undefined;
}

/** `ctx.approval` — whether an action proceeds unattended. */
export const APPROVAL = "approval";

export interface ApprovalVerdict {
	risky: boolean;
	/** Why, in the user's language, when it is risky. */
	reason?: string;
}

export interface ApprovalPolicy {
	/**
	 * Judge one action.
	 *
	 * `subject` is the command, path or URL — the thing the decision is actually about, rather
	 * than the prose the model wrapped it in.
	 */
	assess(kind: string, subject: string, cwd: string): ApprovalVerdict;
}

/** `ctx.skills` — the procedures the agent knows how to follow. */
export const SKILLS = "skills";

export interface SkillRegistry {
	/**
	 * Contribute skills.
	 *
	 * Skills normally arrive as directories on disk, which is right for something a user writes.
	 * This is the other door: a plugin that brings its own procedures — a house code review, a
	 * deploy runbook — without asking the user to place files for it.
	 */
	register(skills: Skill[]): () => void;
	all(): Skill[];
}

/** `ctx.sandbox` — where commands actually run. */
export const SANDBOX = "sandbox";

/**
 * A started command.
 *
 * Modelled on what a caller needs rather than on `ChildProcess`, so an implementation that is not
 * a local process — a container, another machine — can satisfy it without pretending to be one.
 */
export interface SandboxProcess {
	/** Available for locally owned processes; remote sandboxes may omit it. */
	readonly pid?: number;
	/** stdout and stderr interleaved, in arrival order, as the shell would have shown them. */
	onOutput(listener: (chunk: string) => void): void;
	onExit(listener: (code: number | null) => void): void;
	/** The command could not be started at all. Exit is not reported after this. */
	onError(listener: (error: Error) => void): void;
	kill(signal?: "SIGTERM" | "SIGKILL"): void;
}

export interface Sandbox {
	/**
	 * Start one command.
	 *
	 * `mode` is what the caller wants enforced, not a hint: an implementation that cannot enforce
	 * it must throw rather than run the command anyway. Omitting it means the caller is not asking
	 * for confinement — the CLI and the tests, which have no permission mode to map from.
	 *
	 * `network` is the same promise about the other axis, and it has to be named here or it cannot
	 * be asked for: an implementation may accept a wider options object than the interface
	 * declares, so `LocalSandbox` honouring `network` while this signature omitted it compiled
	 * fine and left every caller unable to pass it. The setting existed, the enforcement existed,
	 * and nothing connected them.
	 */
	run(
		command: string,
		options: { cwd: string; env?: Record<string, string>; mode?: SandboxMode; network?: SandboxNetwork },
	): SandboxProcess;
}

/**
 * `ctx.loop` — how a turn is actually driven.
 *
 * The shape is `AgentLoop`, defined next to the loop that implements it.
 */
export const LOOP = "loop";

/** `ctx.session` — who gets to amend a turn before it is sent. */
export const SESSION = "session";

export interface TurnPipeline {
	/** Add a step. Returns the disposer that removes it. */
	use(step: TurnMiddleware): () => void;
	all(): TurnMiddleware[];
}

/** `ctx.scheduler` — which piece of queued work runs next. */
export const SCHEDULER = "scheduler";

/**
 * Choose the next task to run.
 *
 * A seam because "the oldest one" is only obviously right when everything in the queue is the same
 * kind of thing. A queue mixing a user's question with an overnight batch wants the question first;
 * one feeding a build farm may want the cheapest first. Returning `undefined` means nothing is
 * ready — which is also how a scheduler holds work back until some condition is met.
 */
export interface TaskScheduler {
	next(queued: QueuedTask[]): QueuedTask | undefined;
}

/** `ctx.compaction` — how history is kept inside the model's window. */
export const COMPACTION = "compaction";

/**
 * What to do when the conversation no longer fits.
 *
 * Summarising the middle is one answer, not the answer: dropping tool output, spilling to a file
 * the agent can grep, or asking the user are all reasonable, and which is right depends on the
 * work. Returning `null` means "nothing needed", so a strategy also decides when to act.
 */
/**
 * Everything a compaction decision needs, as one object.
 *
 * It is an object rather than a parameter list because the parameter list is what went wrong. The
 * seam used to take four arguments while the direct call took nine, so `compactWith` silently
 * dropped five of them the moment a host bound a strategy — and the desktop binds one. What the
 * desktop lost was not cosmetic: `overhead` is the system prompt and the tool schemas, and a
 * budget computed without them lands over the line it was aiming for and then compacts on every
 * single turn; `artifacts` is what makes the `artifact://` address in a pruned placeholder real;
 * `summarizer` is the `@compact` model role. Three features were off on the only host that ships.
 *
 * A field added here now reaches every implementation or fails to compile.
 */
export interface CompactionRequest {
	messages: Message[];
	model: ModelConfig;
	provider: ProviderConfig;
	/**
	 * `streamFn` is the same seam the loop uses to reach the model.
	 *
	 * Passed through rather than reached for, because summarising is itself a model call: a host
	 * that replaced how requests are made must have replaced this one too, or a session with a
	 * stubbed provider quietly dials out when it runs out of room.
	 */
	streamFn?: typeof streamAssistant;
	/** What the request carries besides the conversation: the system prompt and every tool schema. */
	overhead?: number;
	/** Compact now, whatever the conversation currently weighs — what `/compact` sets. */
	force?: boolean;
	/** Where cut-out originals are kept so `artifact://` can fetch them back. */
	artifacts?: ArtifactSink;
	/** `/compact <instructions>`, and the signal that cancels it. */
	manual?: { instructions?: string; signal?: AbortSignal };
	/** Selects the summarizer without changing the active model's threshold or tail budget. */
	summarizer?: { provider: ProviderConfig; model: ModelConfig };
}

export interface CompactionStrategy {
	/** Returning `null` means "nothing needed", so a strategy also decides when to act. */
	compact(request: CompactionRequest): Promise<Compaction | null>;
}

/**
 * `ctx.storage` — where things that outlive a session are kept.
 *
 * The shape is `SessionStorage`, defined next to the store that first had it. Kept there rather
 * than here because it is a working interface with a working implementation, not a promise.
 */
export const STORAGE = "storage";

/**
 * Events every seam agrees on.
 *
 * Names are `subsystem/verb` in the past tense for things that happened, and imperative for
 * things being decided — the tense says whether a listener can still change the outcome.
 */
export const EVENTS = {
	/** A capability arrived or left. */
	serviceAdded: "service/added",
	serviceRemoved: "service/removed",
	/** A plugin finished applying. */
	pluginStarted: "plugin/started",
	/** Around-middleware over a single tool call: listeners may inspect, wrap or replace it. */
	toolCall: "tools/call",
	/** A turn is about to be sent; listeners may amend the context that goes with it. */
	turnPrepare: "agent/prepare",
} as const;
