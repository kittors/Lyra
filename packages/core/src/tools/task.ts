import { errorResult } from "../agent/tool-run.ts";
import { DELEGATION_KEY, dispatchAllowed, type DelegationDecision } from "../runtime/delegation.ts";
import { DISPATCH_KEY, refuseDispatch, rootDispatch, type DispatchContext } from "../runtime/dispatch-guard.ts";
import type { Tool, ToolResult } from "../types.ts";

export { BUILTIN_AGENTS, RENAMED_AGENTS, resolveAgentName, type AgentDefinition } from "../agents-builtin.ts";
import { resolveAgentName, type AgentDefinition } from "../agents-builtin.ts";

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
		// 旧名先翻译一次：三天前的会话里那条 `task` 写的还是 `fast`，它指的人还在。见 `RENAMED_AGENTS`。
		const requested = resolveAgentName(args.subagent_type ?? "general", agents ?? []);
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

		/*
		 * 关掉派活的那一档，第二道。
		 *
		 * 第一道是工具表：没人点名的那一轮 `task` 根本不在里面。这一道挡的是工具**在**桌上的那种
		 * 情况——用户点名了 `@explore`，工具因此留着，而模型顺手又派了两个没人点过的。没有这道，
		 * 「只派点名的那个」就只是提示词里的一句请求，而这一档的用户恰恰是最不希望它只是一句请求
		 * 的人。
		 *
		 * 没登记过决定的会话（CLI、测试）一律放行：`undefined` 在这里的意思是「这个宿主不管这件
		 * 事」，不是「什么都不许派」。
		 */
		const decision = ctx.state.get(DELEGATION_KEY) as DelegationDecision | undefined;
		if (!dispatchAllowed(decision, requested)) {
			const named = decision?.mentioned ?? [];
			return errorResult(
				`用户把子代理关掉了，这一轮只放行他自己点名的${named.length > 0 ? `（${named.map((name) => `\`${name}\``).join("、")}）` : "那些，而这一轮他一个也没点"}。` +
					`\`${requested}\` 不在其中——这件事自己做完，或者告诉用户为什么需要它，让他写 \`@${requested}\`。`,
			);
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
