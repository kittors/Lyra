import { errorResult } from "../agent/tool-run.ts";
import { SUBAGENTS_KEY } from "../resources/handlers.ts";
import { DELEGATION_KEY, dispatchAllowed, type DelegationDecision } from "../runtime/delegation.ts";
import { DISPATCH_KEY, refuseDispatch, rootDispatch, type DispatchContext } from "../runtime/dispatch-guard.ts";
import type { SubAgentRegistry } from "../runtime/sub-agents.ts";
import type { SubAgentAnswer, Tool, ToolResult } from "../types.ts";

export { BUILTIN_AGENTS, resolveAgentName, type AgentDefinition } from "../agents-builtin.ts";
import { resolveAgentName, type AgentDefinition } from "../agents-builtin.ts";

export const AGENTS_KEY = "agents";

interface TaskArgs {
	description: string;
	prompt: string;
	subagent_type?: string;
	resume?: string;
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
		"A sub-agent that stopped before finishing keeps its context. Continue it with `resume` instead of dispatching the same work again — a new one starts from zero and re-reads everything.",
	],
	description:
		"Run a sub-agent with its own context window and report back only its final answer. " +
		"Use it for open-ended searches across many files, or for work whose intermediate output you do not need. " +
		"The sub-agent cannot ask you questions, so put everything it needs in `prompt`. " +
		"Each call starts a fresh sub-agent with an empty context, unless you pass `resume` with the id of one you dispatched earlier: " +
		"then that same sub-agent continues with everything it already read and did, and `prompt` is what you tell it next.",
	parameters: {
		type: "object",
		properties: {
			description: { type: "string", description: "3-5 word summary of the task." },
			prompt: {
				type: "string",
				description: "Self-contained instructions for the sub-agent. When resuming, what it should do next.",
			},
			subagent_type: { type: "string", description: "Which agent definition to use. Defaults to `general`. Ignored when resuming." },
			resume: {
				type: "string",
				description:
					"The id of a sub-agent you dispatched earlier (given at the end of its result). It continues from where it stopped, with its whole context — use this rather than dispatching the same work again.",
			},
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
		/*
		 * 续跑：它是谁由它当初被派出去时定下，不看这次的 `subagent_type`。
		 *
		 * 能在这里认出来就在这里拦——找不到、还在跑、上下文已经没了，都给一句能据以行动的话，
		 * 而不是一条「Sub-agent failed」。认不出来的（嵌套在子代理里、状态图里没有登记簿），交给
		 * `runSubAgent` 自己认，它同样只放行自己派出去的那些。
		 */
		const resuming = typeof args.resume === "string" && args.resume.trim() ? args.resume.trim() : undefined;
		const found = resuming ? (ctx.state.get(SUBAGENTS_KEY) as SubAgentRegistry | undefined)?.lookupResumable(resuming) : undefined;
		if (found && "refusal" in found) return errorResult(found.refusal);
		// 旧名先翻译一次：三天前的会话里那条 `task` 写的还是 `fast`，它指的人还在。见 `RENAMED_AGENTS`。
		const requested = found ? found.summary.agent : resolveAgentName(args.subagent_type ?? "general", agents ?? []);
		if (!resuming && agents && !agents.some((a) => a.name === requested)) {
			const available = agents.length > 0 ? agents.map((a) => a.name).join(", ") : "none are defined in this session";
			return errorResult(`Unknown subagent_type "${requested}". Available: ${available}.`);
		}
		// 名字只在认出来的时候可信；没认出来的续跑，下面两道按名字的关卡交给 `runSubAgent`。
		const named = !resuming || found !== undefined;

		/*
		 * 深度与自递归，在这里拦。
		 *
		 * 深度的主路径是把 `task` 从工具表里拿掉（见 `sub-agent.ts`）——模型不会想要一个没见过的
		 * 工具。这里是兜底，而且是**自递归**唯一能拦的地方：`explore → reviewer → explore` 这条
		 * 链只有在派生的那一刻才看得见，工具表看不出来。
		 *
		 * 没有链就是主会话——`undefined` 在这里的意思是「第 0 层」，不是「不检查」。
		 */
		const refusal = named ? refuseDispatch((ctx.state.get(DISPATCH_KEY) as DispatchContext | undefined) ?? rootDispatch(), requested) : null;
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
		if (named && !dispatchAllowed(decision, requested)) {
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
				...(resuming ? { resume: resuming } : {}),
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
				/*
				 * The fallback is now only for a clean finish that said nothing at all.
				 *
				 * Every other ending describes itself — see `incompleteNote` in `sub-agent.ts`. What is
				 * left is a run that stopped because it had nothing more to do and neither yielded nor
				 * wrote a word. Saying that in those terms matters: the parent's next move after "it
				 * finished and said nothing" is not the one it makes after "it was cut off partway".
				 */
				content: [
					{
						type: "text",
						text: withResumeHint(answer.text || "（子代理没有留下任何输出：既没有调用 `yield` 交付结果，也没有说任何话。）", answer),
					},
				],
				details: {
					kind: "task",
					description: args.description,
					agentType: requested,
					output: answer.output,
					warnings: answer.warnings?.length ? answer.warnings : undefined,
					...(answer.id ? { subAgentId: answer.id } : {}),
					...(resuming ? { resumed: true } : {}),
				},
			};
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			// 续跑被拒是一句该据以行动的话（找不到、还在跑、不是你派的），不是一次「失败」。
			return errorResult(resuming ? message : `Sub-agent failed: ${message}`);
		}
	},
};

/**
 * 结果末尾那一句：它还在，怎么接着用它。
 *
 * 只说给模型听——面板上的人有「接着跑」按钮，这段话不进登记簿、不进面板。没做完的那种要说得
 * 最重：「从零重派」是反馈里白烧 token 的那条路，而模型不被明说就会走它——它只知道任务没完成，
 * 不知道那个子代理还在。做完了的也给一个 id，追问一句它刚才的结论不该从头再查一遍。
 */
function withResumeHint(text: string, answer: SubAgentAnswer): string {
	if (!answer.id) return text;
	if (answer.stoppedByUser) return `${text}\n\n（这个子代理是用户在面板上手动停下的。除非用户要求，不要续跑它。）`;
	if (answer.incomplete) {
		return (
			`${text}\n\n要它接着干：再调一次 \`task\`，传 \`resume: "${answer.id}"\`，prompt 里写接着做什么（可以照它交接里的下一步）。` +
			"它会带着全部上下文从停下的地方继续，只多付新增的轮次。**不要**重新派一个做同样的事——新派的从零开始，会把它读过的东西再读一遍。" +
			"剩下的不多，也可以自己接手。"
		);
	}
	return `${text}\n\n（子代理 id：\`${answer.id}\`。要追问它、或让它在这个基础上接着做，用 \`task\` 的 \`resume\`。）`;
}
