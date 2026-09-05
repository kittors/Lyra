import { errorResult } from "../agent/tool-run.ts";
import type { Tool, ToolContext, ToolResult } from "../types.ts";

export interface TodoItem {
	content: string;
	status: "pending" | "in_progress" | "completed";
	/** Present-tense form shown while the item is active, e.g. "Wiring the router". */
	activeForm?: string;
}

export const TODOS_KEY = "todos";

export function readTodos(state: Map<string, unknown>): TodoItem[] {
	return (state.get(TODOS_KEY) as TodoItem[] | undefined) ?? [];
}

interface TodoArgs {
	todos: TodoItem[];
}

export const todoTool: Tool<TodoArgs> = {
	name: "todo_write",
	snippet: "Track a multi-step task list",
	guidelines: [
		"Use todo_write for work with three or more steps. Mark a step done in the same reply as the next real action, or in the reply that finishes the work — never in a reply of its own.",
		"A plan belongs in the list, not in prose. Steps written out in the reply instead scroll away, and nothing afterwards knows the work was left unfinished.",
		"Exactly one task may be in_progress at a time.",
		"Never make todo_write a turn's only tool call. Batch the update with the next real step (a read, an edit, a command) in the same reply — a reply that only updates the list is a wasted round trip.",
	],
	description:
		"Record and update the task list for the current piece of work. Call it when a task has three or more steps. " +
		"Write the plan here in the same reply as your first real action, and mark steps done in the same reply as the " +
		"next action (or the one that finishes the work) — a reply that only updates the list wastes a round trip. " +
		"Exactly one item may be `in_progress` at a time. " +
		"Send the complete list every time — it replaces the previous one. " +
		"Never let this be the only tool call in a reply: update the list in the same reply as the next real step.",
	parameters: {
		type: "object",
		properties: {
			todos: {
				type: "array",
				description: "The full task list, in order.",
				items: {
					type: "object",
					properties: {
						content: { type: "string", description: "Imperative description, e.g. 'Add the sync endpoint'." },
						status: { type: "string", enum: ["pending", "in_progress", "completed"] },
						activeForm: { type: "string", description: "Present continuous form, e.g. 'Adding the sync endpoint'." },
					},
					required: ["content", "status"],
					additionalProperties: false,
				},
			},
		},
		required: ["todos"],
		additionalProperties: false,
	},
	summarize: (args) => {
		const active = args.todos?.find((t) => t.status === "in_progress");
		return active ? (active.activeForm ?? active.content) : "Update task list";
	},

	async execute(args, ctx: ToolContext): Promise<ToolResult> {
		if (!Array.isArray(args.todos)) return errorResult("`todos` must be an array.");
		const inProgress = args.todos.filter((t) => t.status === "in_progress");
		if (inProgress.length > 1) {
			return errorResult(`Only one task may be in_progress; ${inProgress.length} were marked. Pick one.`);
		}

		ctx.state.set(TODOS_KEY, args.todos);
		const done = args.todos.filter((t) => t.status === "completed").length;
		const summary = args.todos
			.map((t) => `${t.status === "completed" ? "[x]" : t.status === "in_progress" ? "[~]" : "[ ]"} ${t.content}`)
			.join("\n");

		return {
			content: [{ type: "text", text: `Task list updated (${done}/${args.todos.length} done):\n${summary}` }],
			details: { kind: "todo", todos: args.todos },
		};
	},
};
