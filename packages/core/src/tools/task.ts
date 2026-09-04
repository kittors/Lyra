import { errorResult } from "../agent/tool-run.ts";
import type { Tool, ToolResult } from "../types.ts";

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
			return {
				content: [{ type: "text", text: answer || "(the sub-agent returned no output)" }],
				details: { kind: "task", description: args.description, agentType: requested },
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
			"Reply with the file paths and line numbers that answer the question, plus a two-sentence summary. " +
			"Do not paste large file contents.",
		tools: ["read", "glob", "grep", "ls", "bash"],
		source: "builtin",
	},
	{
		name: "review",
		description: "Code review agent that reports defects with file and line references.",
		systemPrompt:
			"You are a code review agent. Inspect the changes you are pointed at and report concrete defects: " +
			"correctness bugs, missing error handling, security issues. For each finding give file:line, what breaks, " +
			"and a concrete failing input. Do not report style preferences. If you find nothing, say so.",
		tools: ["read", "glob", "grep", "ls", "bash"],
		source: "builtin",
	},
];
