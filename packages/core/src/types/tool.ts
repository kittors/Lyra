/**
 * What a tool is, what it is given, and what it may have to ask first.
 *
 * A tool is a spec the model sees plus a function the runtime calls. Everything it needs to do its
 * job — where it runs, how to say something, how to ask permission, how to delegate — arrives in
 * one context object rather than through imports, which is what lets a host substitute any of it.
 */

import type { SandboxMode } from "../sandbox/policy.ts";
import type { ResourceRouter } from "../resources/router.ts";
import type { UserContent } from "./message.ts";

export interface SubAgentAnswer {
	text: string;
	output?: Record<string, unknown>;
	warnings?: string[];
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

/** JSON Schema subset accepted by every provider we target. */
export interface JsonSchema {
	type?: string;
	properties?: Record<string, JsonSchema>;
	items?: JsonSchema | JsonSchema[];
	required?: string[];
	enum?: unknown[];
	description?: string;
	default?: unknown;
	additionalProperties?: boolean | JsonSchema;
	[key: string]: unknown;
}

export interface ToolSpec {
	name: string;
	description: string;
	parameters: JsonSchema;
}

export interface ToolResult {
	/** What the model sees. */
	content: UserContent[];
	/** What the UI renders. Never serialized into the provider payload. */
	details?: unknown;
	isError?: boolean;
	/** End the agent turn after this tool, even if the model wanted to keep going. */
	terminate?: boolean;
}

export interface ToolContext {
	/** Absolute working directory for this session. */
	cwd: string;
	sessionId: string;
	signal?: AbortSignal;
	/** Push an in-progress result so the UI can stream long-running tools. */
	onProgress?: (partial: ToolResult) => void;
	/** Ask the user to approve a side-effecting operation. */
	requestApproval?: (request: ApprovalRequest) => Promise<ApprovalDecision>;
	/**
	 * How much of the filesystem this turn's commands may change.
	 *
	 * Set by the host from the permission mode. Absent means the host composed no sandbox, and a
	 * tool that would have been confined runs the way it always did — which is what keeps the CLI
	 * and the tests working without building one.
	 */
	sandboxMode?: SandboxMode;
	/** Internal hosts the user allowed by name; see `Settings.allowedHosts`. */
	allowedHosts?: readonly string[];
	/**
	 * Run a nested agent (used by the `task` tool).
	 *
	 * Returns prose plus, when the agent declared an output schema and yielded against it, the same
	 * answer as an object. The parent tool passes the object through in `details` rather than
	 * flattening it, so the renderer and `agent://` can both index into it.
	 */
	spawnSubAgent?: (input: SubAgentInput) => Promise<SubAgentAnswer>;
	/** Shared per-session scratch space (todo list, file read cache, ...). */
	state: Map<string, unknown>;
	/**
	 * The session's address space: `skill://`, `rule://`, `scratch://`, `lyra://`.
	 *
	 * Per session rather than a module singleton, because a sub-agent has its own skill set and a
	 * shared router would resolve `skill://x` against whichever session touched it last.
	 *
	 * Optional so a bare context — the CLI, a test — still works: with no router, `read` treats
	 * every argument as a file path, which is what it did before addresses existed.
	 */
	resources?: ResourceRouter;
	/** Where `scratch://` writes. Absent in sessions with no scratch space. */
	scratchDir?: string;
	/**
	 * Store a web preview and return where it went.
	 *
	 * Provided by the host, because where these files live is the host's business — they are
	 * conversation artifacts kept under the app's own directory, never in the user's project.
	 */
	writePreview?: (input: {
		id: string;
		title: string;
		files: { path: string; content: string }[];
		entry?: string;
	}) => Promise<{ id: string; sessionId: string; title: string; entry: string; dir: string }>;
	logger?: Logger;
}

export interface ApprovalRequest {
	kind: "bash" | "write" | "edit" | "mcp" | "network";
	title: string;
	detail: string;
	/**
	 * Why this is being asked, in the asker's own words.
	 *
	 * The difference between a prompt somebody can answer and one they can only guess at. A path
	 * and a mode describe what would happen; this says what it is for — and when the asker is the
	 * model requesting an escalation, it is the model's own sentence, shown verbatim.
	 */
	reason?: string;
	/** Command / path the approval applies to, used for "always allow" rules. */
	subject: string;
}

export type ApprovalDecision = "once" | "always" | "reject";

export interface SubAgentInput {
	description: string;
	prompt: string;
	agentType?: string;
	model?: string;
}

export interface Tool<TArgs = Record<string, unknown>> extends ToolSpec {
	/**
	 * One line for the system prompt's tool list. The full `description` goes to the provider's
	 * tool schema; this is what the model reads when scanning what it has available.
	 */
	snippet: string;
	/**
	 * Behavioural rules this tool contributes to the prompt's Guidelines section. Keeping them
	 * next to the tool means a tool that is not loaded cannot leave stale advice behind.
	 */
	guidelines?: string[];
	/** "sequential" forces the loop to run this tool alone, in call order. */
	executionMode?: "parallel" | "sequential";
	/** Tools that mutate the workspace go through the approval flow. */
	mutating?: boolean;
	execute(args: TArgs, ctx: ToolContext): Promise<ToolResult>;
	/** One-line summary shown in the UI while the tool runs. */
	summarize?(args: TArgs): string;
}

export interface Logger {
	debug(msg: string, meta?: unknown): void;
	info(msg: string, meta?: unknown): void;
	warn(msg: string, meta?: unknown): void;
	error(msg: string, meta?: unknown): void;
}
