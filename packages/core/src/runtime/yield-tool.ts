/**
 * How a sub-agent hands back a result, and how that result is checked.
 *
 * What it replaces: the parent took the sub-agent's last assistant message and got a paragraph.
 * Somewhere in that paragraph were the file paths, the finding and the conclusion, and the parent
 * had to read them back out — with line numbers sometimes attached, paths sometimes relative and
 * sometimes absolute, sometimes in backticks. **The tokens the parent spent parsing that, and the
 * chance of getting it wrong, cancelled out much of what delegating was supposed to save.**
 *
 * A `yield` tool whose parameters *are* the agent's declared output schema fixes both halves at
 * once. The result arrives as an object. And "has it finished" stops being a guess about whether
 * the prose sounded conclusive: calling `yield` is finishing, and not calling it is not.
 *
 * One mechanism for every provider rather than `response_format` for the ones that have it. A
 * second path would be a second set of failure modes to learn, exercised on whichever provider the
 * user happens to have configured.
 */

import type { JsonSchema, Tool, ToolResult } from "../types.ts";

export const YIELD_TOOL_NAME = "yield";
/** Where the validated object is parked for the caller to pick up. */
export const YIELD_KEY = "yieldResult";

export interface YieldOutcome {
	value: Record<string, unknown>;
	/** Problems that were accepted rather than rejected. Empty when the object validated cleanly. */
	warnings: string[];
}

/**
 * A structural check against the subset of JSON Schema an agent definition can express.
 *
 * Deliberately not a JSON Schema library. What a `output:` block in frontmatter actually uses is
 * types, `required`, `properties`, `items` and `enum`, and a dependency that also implements
 * `$ref`, `allOf` and format assertions would be carrying a specification to check five keywords.
 * Anything unrecognised is allowed through — an unknown keyword must not become a rejection of a
 * result the model got right.
 */
export function validateAgainstSchema(value: unknown, schema: JsonSchema, path = ""): string[] {
	const where = path || "结果";
	const errors: string[] = [];

	if (schema.type === "object") {
		if (typeof value !== "object" || value === null || Array.isArray(value)) {
			return [`${where} 应该是一个对象，实际是 ${describe(value)}。`];
		}
		const record = value as Record<string, unknown>;
		for (const key of schema.required ?? []) {
			if (!(key in record) || record[key] === undefined) errors.push(`${where} 缺少必需的字段 \`${key}\`。`);
		}
		for (const [key, sub] of Object.entries(schema.properties ?? {})) {
			if (key in record && record[key] !== undefined) {
				errors.push(...validateAgainstSchema(record[key], sub, path ? `${path}.${key}` : key));
			}
		}
		return errors;
	}

	if (schema.type === "array") {
		if (!Array.isArray(value)) return [`${where} 应该是一个数组，实际是 ${describe(value)}。`];
		const items = Array.isArray(schema.items) ? schema.items[0] : schema.items;
		if (items) {
			value.forEach((entry, index) => {
				errors.push(...validateAgainstSchema(entry, items, `${path}[${index}]`));
			});
		}
		return errors;
	}

	if (schema.enum && Array.isArray(schema.enum) && !schema.enum.includes(value as never)) {
		return [`${where} 只能是 ${schema.enum.map((v) => JSON.stringify(v)).join("、")} 之一，实际是 ${JSON.stringify(value)}。`];
	}

	if (schema.type === "string" && typeof value !== "string") return [`${where} 应该是字符串，实际是 ${describe(value)}。`];
	if (schema.type === "number" || schema.type === "integer") {
		if (typeof value !== "number") return [`${where} 应该是数字，实际是 ${describe(value)}。`];
		if (schema.type === "integer" && !Number.isInteger(value)) return [`${where} 应该是整数，实际是 ${value}。`];
	}
	if (schema.type === "boolean" && typeof value !== "boolean") return [`${where} 应该是布尔值，实际是 ${describe(value)}。`];

	return errors;
}

function describe(value: unknown): string {
	if (value === null) return "null";
	if (Array.isArray(value)) return "数组";
	return typeof value;
}

/**
 * Build the `yield` tool for one agent definition.
 *
 * The retry budget is the interesting parameter. A validation failure comes back to the sub-agent
 * as an ordinary tool error naming the missing field, which is a thing models fix on the next
 * attempt most of the time. Letting it retry forever would turn one bad schema into a run that
 * burns its whole turn budget arguing with a validator, so it gets two.
 */
export function makeYieldTool(
	schema: JsonSchema,
	options: { maxAttempts?: number; mode?: "permissive" | "strict" } = {},
): Tool<Record<string, unknown>> {
	const maxAttempts = options.maxAttempts ?? 3;
	let attempts = 0;

	return {
		name: YIELD_TOOL_NAME,
		snippet: "Submit your result",
		description:
			"Submit your finished result. This is the ONLY way the work reaches whoever dispatched you — " +
			"anything you write outside this call is not delivered. Fill in every required field.",
		guidelines: [
			"When the task is done, call `yield` with the result. A reply that does not call it delivers nothing.",
		],
		parameters: schema,
		summarize: () => "Submitting result",

		async execute(args, ctx): Promise<ToolResult> {
			attempts += 1;
			const errors = validateAgainstSchema(args, schema);

			if (errors.length === 0) {
				ctx.state.set(YIELD_KEY, { value: args, warnings: [] } satisfies YieldOutcome);
				return { content: [{ type: "text", text: "结果已提交。" }] };
			}

			if (attempts < maxAttempts) {
				/*
				 * The errors go back as a tool error, which is the one channel the model already
				 * knows how to react to. Naming the field is what makes the retry cheap: "缺少
				 * summary" is a one-line fix, "格式不对" is another guess.
				 */
				return {
					content: [{ type: "text", text: `结果不符合要求，没有提交。请修正后重新调用 \`yield\`：\n${errors.map((e) => `- ${e}`).join("\n")}` }],
					isError: true,
				};
			}

			if (options.mode === "strict") {
				return {
					content: [{ type: "text", text: `结果连续 ${maxAttempts} 次不符合要求，这次派生失败：\n${errors.map((e) => `- ${e}`).join("\n")}` }],
					isError: true,
				};
			}

			/*
			 * Permissive is the right default, and the warning is what makes it safe.
			 *
			 * A result that is 90% right is more use than a failure. But the parent will act on the
			 * object, and acting on one with a missing field while believing it complete is worse
			 * than either — so the warnings travel with it and the UI shows them.
			 */
			ctx.state.set(YIELD_KEY, { value: args, warnings: errors } satisfies YieldOutcome);
			return {
				content: [{ type: "text", text: `结果已提交，但有 ${errors.length} 处不符合要求，已按原样接受。` }],
			};
		},
	};
}

/**
 * The paragraph appended to a sub-agent's prompt when it has a schema.
 *
 * Blunt on purpose. The failure it prevents is a sub-agent that does the work, writes a good
 * summary as prose, never calls `yield`, and delivers nothing — which costs the entire run and is
 * indistinguishable from a crash unless you read the transcript.
 */
export function yieldInstruction(schema: JsonSchema): string {
	const required = schema.required ?? [];
	return [
		"",
		"## 交付",
		"",
		"做完之后**必须调用 `yield`** 提交结果。它是你唯一的交付方式——不调用 `yield` 的回复，派你来的人看不到。",
		required.length > 0 ? `必填字段：${required.map((r) => `\`${r}\``).join("、")}。` : "",
		"字段的含义看 `yield` 的参数说明。填不出来的字段就如实说明，不要编。",
	]
		.filter(Boolean)
		.join("\n");
}

/**
 * Render a validated object as something a person can read.
 *
 * The parent gets the object in `details`, but the transcript is read by people, and a wall of
 * JSON is where a reader stops reading. `summary` first because that is what a sub-agent is for,
 * and `report` last because it is the long one.
 */
export function renderYield(outcome: YieldOutcome): string {
	const { value, warnings } = outcome;
	const lines: string[] = [];

	if (typeof value.summary === "string") lines.push(value.summary.trim());

	for (const [key, entry] of Object.entries(value)) {
		if (key === "summary" || key === "report" || entry === undefined || entry === null) continue;
		if (Array.isArray(entry)) {
			if (entry.length === 0) continue;
			lines.push("", `**${key}**`);
			for (const item of entry) {
				lines.push(typeof item === "object" && item !== null ? `- ${objectLine(item as Record<string, unknown>)}` : `- ${String(item)}`);
			}
			continue;
		}
		if (typeof entry === "object") continue;
		lines.push("", `**${key}**: ${String(entry)}`);
	}

	if (typeof value.report === "string" && value.report.trim()) lines.push("", value.report.trim());

	if (warnings.length > 0) {
		lines.push("", `⚠ 这个结果有 ${warnings.length} 处不符合约定的格式：`, ...warnings.map((w) => `- ${w}`));
	}

	return lines.join("\n").trim();
}

function objectLine(item: Record<string, unknown>): string {
	const entries = Object.entries(item).filter(([, v]) => v !== undefined && v !== null);
	const head = entries.find(([k]) => k === "path" || k === "name" || k === "title");
	const rest = entries.filter(([k, v]) => k !== head?.[0] && typeof v !== "object");
	const tail = rest.map(([k, v]) => `${k}: ${String(v)}`).join("，");
	return head ? `\`${String(head[1])}\`${tail ? ` — ${tail}` : ""}` : tail;
}
