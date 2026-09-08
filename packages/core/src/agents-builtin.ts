import type { JsonSchema } from "./types.ts";

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


export const BUILTIN_AGENTS: AgentDefinition[] = [
	{
		name: "general",
		description: "通用研究与代码修改",
		systemPrompt:
			"You are a sub-agent working on one delegated task. Complete it fully, then reply with a concise report of " +
			"what you found or changed. Your final message is the only thing the parent agent sees, so it must stand alone.",
		tools: "*",
		source: "builtin",
	},
	{
		name: "explore",
		description: "只读搜索与代码定位",
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
		description: "检查代码缺陷与风险",
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
		description: "执行检查并报告结果",
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
		description: "只读分析与实施规划",
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
	{
		name: "simple", description: "边界清楚的小改动，直接做完", model: "@fast", tools: "*", source: "builtin",
		systemPrompt: "Complete the delegated task efficiently. Read the necessary context, make only requested changes, verify them and report the result concisely.",
	},
	{
		name: "reason", description: "先想清楚再动手的难题", model: "@deep", tools: "*", source: "builtin",
		systemPrompt: "Investigate the delegated problem carefully. Ground decisions in evidence, implement the requested solution, verify the result and report remaining uncertainty.",
	},
];

/**
 * 改过名的内置智能体，旧名 → 新名。
 *
 * `fast` 和 `deep` 是按**模型跑得多快**起的名，而其余五个是按**它负责什么**起的——同一张表里两套
 * 命名法，读的人得先知道 `@fast` 指的是哪一种「快」。更绕的是 `fast`/`deep` 同时还是模型角色名
 * （见 `model-roles.ts` 的 `ModelRole`），所以 `fast` 这个智能体的定义里写着 `model: "@fast"`，
 * 自己引用自己的同名角色。改成 `simple`／`reason` 之后，名字说的是任务的形状，模型仍由角色决定。
 *
 * 表要留着，不能改完就算：名字是**调用名**——模型按它派活，历史会话里存着旧名，用户改过的自定义
 * 版本也是按名字挂在内置定义上的。旧名进来仍然要能找到人，否则翻回三天前的会话，那一条 `task`
 * 指向的智能体就凭空消失了。
 */
export const RENAMED_AGENTS: Readonly<Record<string, string>> = { fast: "simple", deep: "reason" };

/**
 * 反过来查：这个名字以前叫什么。
 *
 * 派活是「拿旧名找新定义」，读设置是「拿新名找旧配置」——用户给 `fast` 挑过的模型存在
 * `subAgentProfiles.fast`（以及更早的 `modelRoles.fast`）里，改名之后 `simple` 得知道去那儿看一眼，
 * 否则一次改名就把每个人调好的模型悄悄退回「随主会话」。见 `agentProfile`。
 */
export const PREVIOUS_AGENT_NAME: Readonly<Record<string, string>> = Object.fromEntries(
	Object.entries(RENAMED_AGENTS).map(([before, after]) => [after, before]),
);

/** 名单里没有 `asked` 时，试试它是不是某个旧名。 */
export function resolveAgentName(asked: string, known: readonly { name: string }[]): string {
	if (known.some((agent) => agent.name === asked)) return asked;
	const renamed = RENAMED_AGENTS[asked];
	return renamed && known.some((agent) => agent.name === renamed) ? renamed : asked;
}
