/**
 * Reading a rule's body on demand.
 *
 * The rulebook exists so a rule can be long. A convention about CSS, or about how this repository
 * writes tests, is a page — and a page in the system prompt is a page paid for on every turn of
 * every conversation, including the ones about something else entirely.
 *
 * So the prompt carries a line per rule, and the body waits here. Without this tool that listing
 * would be a menu with no kitchen behind it.
 */

import { errorResult } from "../agent/tool-run.ts";
import { findRule } from "../rules/session.ts";
import type { RuleSet } from "../rules/types.ts";
import type { Tool, ToolResult } from "../types.ts";

export const RULES_KEY = "rules";

interface RuleArgs {
	name: string;
}

export const ruleTool: Tool<RuleArgs> = {
	name: "rule",
	snippet: "Read a project rule's full text",
	guidelines: ["When a task matches a rule listed in <rulebook>, read it before starting — it is the project's decision, not a suggestion."],
	description:
		"Read the full text of a project rule. Call this when the task matches one of the rules listed in the " +
		"`<rulebook>` section of your instructions. The body comes back as the tool result.",
	parameters: {
		type: "object",
		properties: { name: { type: "string", description: "Exact rule name from the rulebook listing." } },
		required: ["name"],
		additionalProperties: false,
	},
	summarize: (args) => `Rule: ${args.name}`,

	async execute(args, ctx): Promise<ToolResult> {
		const rules = ctx.state.get(RULES_KEY) as RuleSet | undefined;
		// 查找收敛到一处。这里和 `rule://` 各自写过一遍同样的三段拼接，而 `findRule` 的注释里
		// 点名了它们两个——然后谁也没用它。
		const found = rules ? findRule(rules, args.name) : undefined;

		if (!found) {
			/*
			 * Listing only the rulebook, not everything.
			 *
			 * An always-apply rule is already in the prompt and a stream rule fires on its own;
			 * naming them here would invite the model to read things it has, or things that are
			 * deliberately invisible until they matter.
			 */
			const available = (rules?.book ?? []).map((rule) => rule.name);
			return errorResult(
				available.length > 0
					? `没有名为 "${args.name}" 的规则。可读的有：${available.join(", ")}。`
					: `没有名为 "${args.name}" 的规则，这个项目也没有可按需读取的规则。`,
			);
		}

		return {
			content: [{ type: "text", text: `<rule name="${found.name}">\n${found.content}\n</rule>` }],
			details: { kind: "rule", name: found.name, path: found.path, source: found.source },
		};
	},
};
