import { errorResult } from "../agent/tool-run.ts";
import type { JsonSchema, Tool, ToolResult } from "../types.ts";

export interface AgentDefinition {
	/** Identifier used in the `subagent_type` argument. */
	name: string;
	/** Shown to the model so it can pick the right agent. */
	description: string;
	/** Replaces the main system prompt for this sub-agent. */
	systemPrompt: string;
	/** Tool names the sub-agent may use. `"*"` means every tool the parent has. */
	tools: string[] | "*";
	model?: string;
	source: "builtin" | "workspace" | "user";
	/**
	 * The shape of what this agent returns.
	 *
	 * Present means the run gets a `yield` tool whose parameters are this schema, and the parent
	 * receives a validated object rather than the last paragraph the sub-agent happened to write.
	 * Absent keeps the old behaviour, which is right for agents whose answer genuinely is prose.
	 */
	output?: JsonSchema;
	/**
	 * What to do when the returned object does not match `output` after the retries are used up.
	 *
	 * `permissive` (the default) takes it anyway and attaches the problems; a result that is 90%
	 * right beats no result. `strict` fails the dispatch, for agents whose output feeds something
	 * that cannot cope with a missing field.
	 */
	schemaMode?: "permissive" | "strict";
	/**
	 * Which agents this one may dispatch. Default: none.
	 *
	 * The opposite of omp's default, which grants it to anything holding the `task` tool. Recursive
	 * dispatch is the most expensive switch in the system and the hardest to reason about after the
	 * fact, so it is off unless a definition asks for it — which also means you can tell whether an
	 * agent spawns others by reading its frontmatter instead of its prompt.
	 */
	spawns?: string[] | "*";
}

export const AGENTS_KEY = "agents";

interface TaskArgs {
	description: string;
	prompt: string;
	subagent_type?: string;
}

/**
 * Delegate work to a nested agent with its own context window.
 *
 * The point is context isolation: a search that reads forty files returns one paragraph to
 * the parent instead of forty file dumps.
 */
export const taskTool: Tool<TaskArgs> = {
	name: "task",
	snippet: "Delegate work to a sub-agent with its own context",
	guidelines: [
		"Use task for open-ended searches across many files, so their contents never enter your own context.",
		"The sub-agent cannot ask you questions; put everything it needs in the prompt.",
	],
	description:
		"Run a sub-agent with its own context window and report back only its final answer. " +
		"Use it for open-ended searches across many files, or for work whose intermediate output you do not need. " +
		"The sub-agent cannot ask you questions, so put everything it needs in `prompt`.",
	parameters: {
		type: "object",
		properties: {
			description: { type: "string", description: "3-5 word summary of the task." },
			prompt: { type: "string", description: "Self-contained instructions for the sub-agent." },
			subagent_type: { type: "string", description: "Which agent definition to use. Defaults to `general`." },
		},
		required: ["description", "prompt"],
		additionalProperties: false,
	},
	summarize: (args) => args.description ?? "Sub-agent task",

	async execute(args, ctx): Promise<ToolResult> {
		if (!ctx.spawnSubAgent) return errorResult("Sub-agents are not available in this session.");
		if (typeof args.prompt !== "string" || !args.prompt.trim()) return errorResult("`prompt` is required.");

		/*
		 * `undefined` and `[]` mean different things, and conflating them switched the check off.
		 *
		 * `undefined` is a session that never registered a roster — a CLI path, a test — where
		 * refusing every name would break a caller doing its own resolution. `[]` is a session that
		 * registered one and it is empty, where the only honest answer to any name is that it does
		 * not exist. The old `agents.length > 0` guard read the two the same way, so in the empty
		 * case every name passed and a typo came back as a `general` sub-agent doing something
		 * adjacent to what was asked.
		 */
		const agents = ctx.state.get(AGENTS_KEY) as AgentDefinition[] | undefined;
		const requested = args.subagent_type ?? "general";
		if (agents && !agents.some((a) => a.name === requested)) {
			const available = agents.length > 0 ? agents.map((a) => a.name).join(", ") : "none are defined in this session";
			return errorResult(`Unknown subagent_type "${requested}". Available: ${available}.`);
		}

		try {
			const answer = await ctx.spawnSubAgent({
				description: args.description ?? "Sub-agent task",
				prompt: args.prompt,
				agentType: requested,
			});
			/*
			 * The object rides in `details`, never flattened into the text.
			 *
			 * `content` is what the model reads and `details` is what the UI renders and what
			 * `agent://<id>/<field>` indexes into. Serialising the object into the text as well
			 * would put it in the parent's context twice — once as prose, once as JSON — which is
			 * the cost delegation exists to avoid.
			 */
			return {
				content: [{ type: "text", text: answer.text || "(the sub-agent returned no output)" }],
				details: {
					kind: "task",
					description: args.description,
					agentType: requested,
					output: answer.output,
					warnings: answer.warnings?.length ? answer.warnings : undefined,
				},
			};
		} catch (error) {
			return errorResult(`Sub-agent failed: ${error instanceof Error ? error.message : String(error)}`);
		}
	},
};

export const BUILTIN_AGENTS: AgentDefinition[] = [
	{
		name: "general",
		description: "General-purpose agent for multi-step research and code changes.",
		systemPrompt:
			"You are a sub-agent working on one delegated task. Complete it fully, then reply with a concise report of " +
			"what you found or changed. Your final message is the only thing the parent agent sees, so it must stand alone.",
		tools: "*",
		source: "builtin",
	},
	{
		name: "explore",
		description: "Read-only search agent. Use it to locate code across many files without polluting your context.",
		systemPrompt:
			"You are a read-only exploration agent. Search broadly, read only what you need, and never modify files. " +
			"Do not paste large file contents.",
		tools: ["read", "glob", "grep", "ls", "bash"],
		source: "builtin",
		/*
		 * `summary` and `report` are separate on purpose, and the split is the whole design.
		 *
		 * `summary` is what the parent reads to decide what to do next, so it has to stay short
		 * enough to be worth delegating for. `report` is the deliverable a person reads, and it is
		 * as long as the task needs. One field trying to be both is either too long to be a summary
		 * or too short to be the answer.
		 */
		output: {
			type: "object",
			required: ["summary", "files"],
			properties: {
				summary: { type: "string", description: "The conclusion, in two or three sentences. Written for the agent that dispatched you." },
				files: {
					type: "array",
					description: "The files that answer the question. Leave empty only if there genuinely are none.",
					items: {
						type: "object",
						required: ["path", "why"],
						properties: {
							path: { type: "string", description: "Project-relative path, optionally with a `:12-34` line range." },
							why: { type: "string", description: "What is in this file that matters here." },
						},
					},
				},
				architecture: { type: "string", description: "How these pieces connect, when that is part of the answer." },
				report: {
					type: "string",
					description:
						"The full deliverable, when the task asked for a report, a table or a list — written out at the depth asked for. " +
						"Not a summary of it; `summary` already does that. Omit for a quick lookup.",
				},
			},
		},
	},
	{
		name: "review",
		description: "Code review agent that reports defects with file and line references.",
		systemPrompt:
			"You are a code review agent. Inspect the changes you are pointed at and report concrete defects: " +
			"correctness bugs, missing error handling, security issues. Do not report style preferences.",
		tools: ["read", "glob", "grep", "ls", "bash"],
		source: "builtin",
		output: {
			type: "object",
			required: ["summary", "findings"],
			properties: {
				summary: { type: "string", description: "What you looked at and what you concluded, in two or three sentences." },
				findings: {
					type: "array",
					description: "One entry per concrete defect. Empty when you found none — say so in `summary` rather than inventing one.",
					items: {
						type: "object",
						required: ["file", "problem", "failure"],
						properties: {
							file: { type: "string", description: "Path with line, as `src/auth.ts:42`." },
							severity: { type: "string", enum: ["high", "medium", "low"], description: "How much it matters." },
							problem: { type: "string", description: "What is wrong, in one sentence." },
							failure: { type: "string", description: "Concrete inputs or state that make it go wrong. Not a restatement of the problem." },
						},
					},
				},
			},
		},
	},
];
