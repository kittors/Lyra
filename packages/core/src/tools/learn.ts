/**
 * Writing down something worth knowing next time.
 *
 * The hard part of this tool is not storing the string. It is getting the model to call it for the
 * right things — and the failure that matters is not silence, it is a memory file full of facts
 * that expire. A note saying `parseFrontmatter` lives in `skills/loader.ts` is true today, is
 * injected into every prompt in this project from now on, and will be quietly wrong after the next
 * refactor. **A stale fact in memory is worse than a missing one, because the model acts on it.**
 *
 * So the description spends most of its length on what not to record, and the test for what stays
 * is whether reading the code would tell you: if it would, the code is the record.
 */

import { errorResult } from "../agent/tool-run.ts";
import { MAX_LESSON_CHARS, recordLesson } from "../runtime/project-memory.ts";
import type { Tool, ToolResult } from "../types.ts";

interface LearnArgs {
	lesson: string;
	context?: string;
}

export const learnTool: Tool<LearnArgs> = {
	name: "learn",
	snippet: "Remember a lesson for next time",
	guidelines: [
		"When the user corrects your approach in a way that will apply again in this repository, record it with `learn`.",
	],
	description:
		"Record something about this project that will be useful in a future session. It is injected into the prompt " +
		"from the next session onwards.\n\n" +
		"Record:\n" +
		"- a correction the user made that will apply again in this repository\n" +
		"- a convention that is not visible from the code (the build command, why something is done an odd way)\n" +
		"- a trap you fell into and got out of, that you would fall into again\n\n" +
		"Do NOT record:\n" +
		"- where code lives, what a function is called, what a file contains — reading the code answers those, " +
		"and a note about them goes stale silently\n" +
		"- anything specific to this one task\n" +
		"- anything already in the git history\n\n" +
		"A stale entry is worse than a missing one, because it will be believed.",
	parameters: {
		type: "object",
		properties: {
			lesson: { type: "string", description: "The lesson. One or two sentences, specific and actionable." },
			context: { type: "string", description: "When it applies, if that is not obvious. Optional." },
		},
		required: ["lesson"],
		additionalProperties: false,
	},
	summarize: (args) => `Learn: ${(args.lesson ?? "").slice(0, 40)}`,

	async execute(args, ctx): Promise<ToolResult> {
		if (typeof args.lesson !== "string" || !args.lesson.trim()) return errorResult("`lesson` is required.");
		if (args.lesson.length > MAX_LESSON_CHARS) {
			return errorResult(`\`lesson\` is ${args.lesson.length} characters; the limit is ${MAX_LESSON_CHARS}. Say it more briefly.`);
		}

		try {
			const { action, total } = await recordLesson(ctx.cwd, { text: args.lesson, context: args.context });
			/*
			 * "Recorded" and "you already knew that" are different answers, and saying the first when
			 * the second is true leaves the model writing variations of one sentence.
			 */
			const verb = action === "merged" ? "已经记过类似的，这次把它更新了" : "记下了";
			return {
				content: [
					{
						type: "text",
						text: `${verb}。这个项目现在有 ${total} 条。**从下一个会话开始生效**——这一轮不重建提示词。`,
					},
				],
				details: { kind: "learn", action, total },
			};
		} catch (error) {
			return errorResult(`Could not record it: ${error instanceof Error ? error.message : String(error)}`);
		}
	},
};
