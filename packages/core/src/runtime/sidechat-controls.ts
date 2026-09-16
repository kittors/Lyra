import { textResult } from "../agent/tool-run.ts";
import type { Tool } from "../types.ts";
import type { AgentSession } from "./session.ts";

/**
 * Delegating work without giving the side chat filesystem access.
 *
 * It does not touch the workspace — it puts a note in the main session's queue and returns.
 * Everything that could actually change a file happens later, in the main session, under the
 * same approval rules as anything the user typed themselves.
 */
export function dispatchTaskTool(main: AgentSession): Tool<{ instruction: string }> {
	return {
		name: "dispatch_task",
		description:
			"把一件需要动手的事交给主会话执行（改文件、跑命令、查代码等）。主会话会在完成当前工作后按顺序执行。" +
			"instruction 必须是一条完整、可独立执行的指令——主会话看不到侧边聊天的上下文。",
		snippet: "dispatch_task — 把需要动手的工作交给主会话排队执行",
		parameters: {
			type: "object",
			properties: {
				instruction: {
					type: "string",
					description: "交给主会话的完整指令，写成可以直接执行的一句话或一段话。",
				},
			},
			required: ["instruction"],
		},
		summarize: (args) => `派给主会话：${String(args.instruction ?? "").slice(0, 40)}`,
		async execute(args) {
			const instruction = String(args.instruction ?? "").trim();
			if (!instruction) return textResult("指令为空，没有派出任何任务。");
			const task = await main.enqueueTask(instruction);
			return textResult(
				main.running
					? "已排入主会话的任务队列，它会在当前工作完成后执行。"
					: "主会话当前空闲，已经开始执行。",
				task,
			);
		},
	};
}

/**
 * Reaching the main session's controls, rather than its queue.
 *
 * `dispatch_task` is for work: it goes to the back of the queue and runs when the session is free.
 * That is exactly wrong for the things you say *about* a run in progress. Asked to pause, the side
 * chat had only the queue to reach for — so 「请暂停手头的所有自动执行任务」 was filed behind the
 * very work it was asking to stop, and would have been carried out, if at all, once there was
 * nothing left to pause. The panel reported success and nothing happened.
 *
 * These take effect immediately, because that is what a control is. They cannot change a file, run
 * a command or read anything: the whole surface is stop, carry on, and what is it doing.
 */
export function controlMainTool(main: AgentSession): Tool<{ action: string; discardPlan?: boolean }> {
	return {
		name: "control_main",
		description:
			"立即控制主会话的执行状态，不排队、马上生效。" +
			"pause：让主会话停下手头正在跑的工作（和用户点暂停按钮一样）。" +
			"用户明确取消旧目标时，pause 配合 discardPlan: true 可同时废除旧清单；单纯暂停不要清除清单。" +
			"resume：让它接着做——如果有被暂停时中断的派出任务，会把那个任务重新排上，否则让它从中断处继续。" +
			"status：查主会话现在是在忙还是空着，以及队列里还剩什么。" +
			"需要它去『做』一件新的事，用 dispatch_task，不要用这个。",
		snippet: "control_main — 直接暂停 / 继续主会话，或看它在忙什么",
		parameters: {
			type: "object",
			properties: {
				discardPlan: { type: "boolean", description: "Only with pause, when the user explicitly cancels or replaces the old task plan." },
				action: {
					type: "string",
					enum: ["pause", "resume", "status"],
					description: "pause 暂停，resume 继续，status 查看当前状态。",
				},
			},
			required: ["action"],
		},
		summarize: (args) => {
			const action = String(args.action ?? "");
			if (action === "pause") return "让主会话停下";
			if (action === "resume") return "让主会话接着做";
			return "查看主会话状态";
		},
		async execute(args) {
			const action = String(args.action ?? "").trim();

			if (action === "pause") {
				if (args.discardPlan === true) {
					await main.discardTaskPlan();
					return textResult("主会话已停止，旧任务清单已取消。历史记录保留，未完成事项没有被标记为完成。");
				}
				if (!main.running) return textResult("主会话现在没有在执行任何东西，不需要暂停。");
				main.abort();
				return textResult("已经让主会话停下了。它手头的工作已中止，派出的任务也一并中断——需要的话可以让我继续。");
			}

			if (action === "resume") {
				/*
				 * A task interrupted by the pause is what "carry on" means, when there is one.
				 *
				 * Pausing cancels the dispatched task along with the turn, and resuming only the
				 * conversation leaves that task cancelled — the work the panel asked for silently
				 * never happens. Same rule the main window's 继续 follows.
				 */
				const interrupted = main.interruptedTask();
				if (interrupted) {
					await main.resumeTask(interrupted.id);
					return textResult(`已把被中断的任务重新排上：${interrupted.text.slice(0, 60)}`);
				}
				if (main.running) return textResult("主会话正在执行，不用继续。");
				/*
				 * `synthetic`, because nobody typed it.
				 *
				 * It keeps the sentence out of the transcript — the user pressed nothing and wrote
				 * nothing — and keeps the turn's elapsed time and tokens counting from where the work
				 * actually started rather than restarting at this message.
				 */
				await main.prompt([{ type: "text", text: "继续，从中断的地方接着做。" }], { synthetic: true });
				return textResult("已经让主会话接着做了。");
			}

			if (action === "status") {
				const queued = main.taskQueue.filter((t) => t.status === "queued").length;
				const running = main.taskQueue.find((t) => t.status === "running");
				const interrupted = main.interruptedTask();
				const parts = [main.running ? "主会话正在执行" : "主会话当前空闲"];
				if (running) parts.push(`正在跑派出的任务：${running.text.slice(0, 40)}`);
				if (queued > 0) parts.push(`队列里还有 ${queued} 个任务在等`);
				if (interrupted) parts.push(`有一个被中断的任务可以继续：${interrupted.text.slice(0, 40)}`);
				return textResult(parts.join("；") + "。");
			}

			return textResult(`不认识的动作「${action}」。可用的是 pause、resume、status。`);
		},
	};
}
