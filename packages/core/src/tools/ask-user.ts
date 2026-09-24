import { errorResult } from "../agent/tool-run.ts";
import type { AskUserOption, QuestionFields, Tool, ToolContext, ToolResult } from "../types.ts";

interface AskUserArgs extends QuestionFields {
	question: string;
	options: (string | AskUserOption)[];
}

function validOption(value: unknown): value is string | AskUserOption {
	if (typeof value === "string") return Boolean(value.trim());
	return typeof value === "object" && value !== null && "label" in value && typeof value.label === "string" && Boolean(value.label.trim())
		&& (!("description" in value) || value.description === undefined || typeof value.description === "string")
		&& (!("recommended" in value) || value.recommended === undefined || typeof value.recommended === "boolean");
}

export const askUserTool: Tool<AskUserArgs> = {
	name: "ask_user",
	snippet: "Ask the user for a decision with single or multiple choices",
	guidelines: [
		"Use ask_user for clarification or a decision; full access grants permissions, not answers to questions.",
		"Mark a recommendation when useful. Skipping is not consent: without an explicit default, continue only work that does not depend on the missing answer.",
	],
	description: "Ask the user a question. Choices may have descriptions and a recommended badge. The user selects choices, writes an answer, or skips without authorizing anything. Full access still waits for their answer.",
	parameters: {
		type: "object",
		properties: {
			question: { type: "string", description: "The question and the context needed to answer it." },
			options: { type: "array", items: { anyOf: [{ type: "string" }, { type: "object", properties: { label: { type: "string" }, description: { type: "string" }, recommended: { type: "boolean" } }, required: ["label"], additionalProperties: false }] } },
			selectionMode: { type: "string", enum: ["single", "multi"] },
			allowCustomInput: { type: "boolean" },
			allowSkip: { type: "boolean", description: "Allow an explicit skipped response. Defaults to true." },
			defaultOptionIndex: { type: "integer", minimum: 0, description: "An explicit default used only when the user chooses Skip; a recommendation alone is not a default." },
		},
		required: ["question", "options"],
		additionalProperties: false,
	},
	summarize: (args) => `Ask user: ${String(args.question ?? "").slice(0, 40)}`,
	async execute(args, ctx: ToolContext): Promise<ToolResult> {
		if (!ctx.requestApproval) return errorResult("This host cannot ask the user. No answer was received.");
		if (typeof args.question !== "string" || !args.question.trim() || !Array.isArray(args.options) || !args.options.every(validOption)) return errorResult("Provide a question and choices with nonempty labels.");
		const options = args.options.map((option) => typeof option === "string" ? option.trim() : { ...option, label: option.label.trim() });
		const labels = options.map((option) => typeof option === "string" ? option : option.label);
		if ((!options.length && args.allowCustomInput === false) || new Set(labels).size !== labels.length) return errorResult("Provide distinct choices, or enable custom input.");
		if (args.selectionMode !== undefined && args.selectionMode !== "single" && args.selectionMode !== "multi") return errorResult("selectionMode must be single or multi.");
		if (args.defaultOptionIndex !== undefined && (!Number.isInteger(args.defaultOptionIndex) || args.defaultOptionIndex < 0 || args.defaultOptionIndex >= options.length)) return errorResult("defaultOptionIndex must identify an existing choice.");
		const decision = await ctx.requestApproval({
			kind: "interactive", title: "需要你的意见", detail: args.question.trim(), subject: "ask_user", options,
			allowCustomInput: args.allowCustomInput !== false, selectionMode: args.selectionMode ?? "single",
			allowSkip: args.allowSkip !== false, defaultOptionIndex: args.defaultOptionIndex,
		});
		if (decision === "skip") return { content: [{ type: "text", text: "The user skipped this question. No answer or permission was granted. Continue only work that does not depend on this answer." }], details: { kind: "question", skipped: true } };
		/*
		 * Nobody answered — and whatever you do next, say that in your reply.
		 *
		 * The sentence used to stop at "No answer was received", which is true and completely
		 * invisible: the card is gone by then, and a turn that ends with a tidy summary looks
		 * exactly like one that was never blocked on anything. The person comes back to a plan
		 * that stopped one step short and no account of why. The instruction is here rather than
		 * in the prompt because this is the only place that knows the question went unanswered.
		 */
		if (typeof decision !== "object") return errorResult("The question was declined, or it expired with nobody at the keyboard. No answer was received. Whatever you do next, say so plainly in your reply — that you asked, that no answer came, and what you did instead — because the question is no longer on screen and nothing else will mention it.");
		const answer = Array.isArray(decision.answer) ? JSON.stringify(decision.answer) : decision.answer;
		return { content: [{ type: "text", text: decision.skipped ? `The user skipped and accepted the explicit default: ${answer}` : answer }], details: { kind: "question", answer: decision.answer, skipped: decision.skipped === true } };
	},
};
