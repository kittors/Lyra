import { errorResult } from "../agent/tool-run.ts";
import { DISPATCH_KEY, refuseDispatch, rootDispatch, type DispatchContext } from "../runtime/dispatch-guard.ts";
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
	/**
	 * Which model runs this agent: a role (`@fast`), a model id, or a priority list of either.
	 *
	 * A list is what makes a definition portable. `["@fast", "anthropic/claude-haiku-4-5"]` says
	 * "whatever this machine calls fast, and failing that, this specific one" — a definition naming
	 * only a concrete model works where it was written and nowhere else.
	 *
	 * This field existed and was read by nothing: every sub-agent ran on the dispatching session's
	 * model regardless of what its definition asked for.
	 */
	model?: string | string[];
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

		/*
		 * 深度与自递归，在这里拦。
		 *
		 * 深度的主路径是把 `task` 从工具表里拿掉（见 `sub-agent.ts`）——模型不会想要一个没见过的
		 * 工具。这里是兜底，而且是**自递归**唯一能拦的地方：`explore → reviewer → explore` 这条
		 * 链只有在派生的那一刻才看得见，工具表看不出来。
		 *
		 * 没有链就是主会话——`undefined` 在这里的意思是「第 0 层」，不是「不检查」。
		 */
		const refusal = refuseDispatch((ctx.state.get(DISPATCH_KEY) as DispatchContext | undefined) ?? rootDispatch(), requested);
		if (refusal) return errorResult(refusal);

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
		 * Fan-out work, so `@fast` if the machine has one configured.
		 *
		 * Exploration is the case the role exists for: several of these run at once, each reading
		 * many files, and none of them is doing the reasoning that justifies an expensive model.
		 * Unset roles fall through to the session's model, so this costs nothing by default.
		 */
		model: "@fast",
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
		/*
		 * `@review` is meant to point at a different model family from the one that wrote the code.
		 * A model's blind spots correlate with its own output — asking it to review its own work
		 * gets agreement rather than review.
		 */
		model: "@review",
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
	/*
	 * `verify` 值得单列：验证的输出通常很长——一整段测试日志——放在主会话里挤掉别的东西。
	 * 委派出去，父代理只拿到「过没过 + 失败的那几条」。这是计划 09 §7 的原话，也是这个 agent
	 * 存在的全部理由：它不是为了并行，是为了**上下文隔离**。
	 *
	 * 只给 read 和 bash：一个会修东西的验证者，在报告失败之前就会顺手把失败修掉，而父代理
	 * 问的是「现在是什么状态」，不是「你觉得该怎么改」。
	 */
	{
		name: "verify",
		description: "Run tests, a typecheck, a build or a lint and report the outcome. Never fixes anything — the parent decides what to do with a failure.",
		systemPrompt:
			"You run one verification — a test suite, a typecheck, a build, a lint — and report what happened. " +
			"You do not fix anything, and you do not speculate about causes beyond what the output states. " +
			"Run the command, read its output, then yield. The full log stays with you; the parent only needs " +
			"whether it passed and, if not, each failure on its own: what failed, where, and the assertion or error " +
			"message. Keep `summary` to one sentence.\n\n" +
			/*
			 * 第一次评测抓到的：模型跑 `npm test`，输出被 npm 的错误包装裹住，它报了「0 passed,
			 * 1 failed」——实际是 3 过 1 挂——而且 failures 里没点出是哪条。一个说错的摘要比
			 * 完整日志更糟：父代理会照着它做决定。所以把「去哪儿找数字」说死。
			 */
			"Read the numbers from the runner itself, never from a wrapper around it: `ℹ pass N` / `ℹ fail M` " +
			"(node --test), `Tests: N passed, M failed` (jest/vitest), `N passed, M failed` (pytest). If the command " +
			"went through `npm test` or `pnpm test` and the runner's own summary is buried in wrapper noise, run the " +
			"underlying command directly. Each entry in `failures` takes its `name` from the runner's own failure line " +
			"(the `✖` line, the `FAIL` line, the `FAILED` line) — the test's name as the runner printed it, not your " +
			"paraphrase of it.",
		tools: ["read", "bash"],
		model: "@fast",
		output: {
			type: "object",
			required: ["passed", "summary", "failures"],
			properties: {
				passed: { type: "boolean", description: "Whether the verification succeeded." },
				summary: { type: "string", description: "One sentence: what was run and the count — e.g. `node --test: 41 passed, 2 failed`." },
				command: { type: "string", description: "The exact command that was run." },
				failures: {
					type: "array",
					description: "One entry per failure. Empty when it passed.",
					items: {
						type: "object",
						required: ["name", "message"],
						properties: {
							name: { type: "string", description: "The failing test, file, or check." },
							location: { type: "string", description: "`path:line` when the output gives one." },
							message: { type: "string", description: "The assertion or error message, trimmed to the line that says what went wrong." },
						},
					},
				},
			},
		},
		source: "builtin",
	},
	/*
	 * 只读规划。`@deep`——这是四个角色里唯一一个「贵一点值得」的场合：规划错了，后面每一步
	 * 都在错的方向上花钱。不给写工具，所以它没法「顺手先改一点」。
	 */
	{
		name: "plan",
		description: "Read-only planning. Reads the code and returns steps, risks and open questions — never touches a file.",
		systemPrompt:
			"You plan a change without making it. Read what you need to understand the task, then yield a plan: " +
			"ordered steps each naming the files it touches, the risks you can see, and what you could not determine " +
			"from the code alone. Do not write or edit anything. Do not pad: three real steps beat ten vague ones.",
		tools: ["read", "glob", "grep", "ls"],
		model: "@deep",
		output: {
			type: "object",
			required: ["steps", "risks", "unknowns"],
			properties: {
				steps: {
					type: "array",
					description: "In order. Each one is a change somebody could make without asking a follow-up question.",
					items: {
						type: "object",
						required: ["what"],
						properties: {
							what: { type: "string", description: "The change, concretely." },
							files: { type: "array", items: { type: "string" }, description: "Project-relative paths this step touches." },
						},
					},
				},
				risks: { type: "array", items: { type: "string" }, description: "What could go wrong, and where. Empty is a valid answer." },
				unknowns: { type: "array", items: { type: "string" }, description: "What you could not determine from the code and would need to ask about." },
			},
		},
		source: "builtin",
	},
];
