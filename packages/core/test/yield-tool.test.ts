/**
 * Structured output: what the validator accepts, what it refuses, and what happens when a
 * sub-agent cannot get it right.
 *
 * The retry path is the part worth pinning. A validation failure comes back as an ordinary tool
 * error naming the field, the model usually fixes it next call, and after the budget runs out the
 * default is to take the object anyway with the problems attached. Each of those three is a
 * decision that could plausibly have gone the other way, and each is invisible from the outside
 * until it matters.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { makeYieldTool, renderYield, validateAgainstSchema, yieldInstruction, YIELD_KEY, type YieldOutcome } from "../src/runtime/yield-tool.ts";
import type { JsonSchema, ToolContext } from "../src/types.ts";

const SCHEMA: JsonSchema = {
	type: "object",
	required: ["summary", "files"],
	properties: {
		summary: { type: "string" },
		files: {
			type: "array",
			items: {
				type: "object",
				required: ["path", "why"],
				properties: { path: { type: "string" }, why: { type: "string" } },
			},
		},
		count: { type: "integer" },
		severity: { type: "string", enum: ["high", "low"] },
	},
};

function ctx(): ToolContext {
	return { cwd: "/", sessionId: "s", state: new Map() } as unknown as ToolContext;
}

function textOf(result: { content: { type: string; text?: string }[] }): string {
	return result.content.map((c) => c.text ?? "").join("");
}

// ---------------------------------------------------------------------------
// The validator
// ---------------------------------------------------------------------------

test("a well-formed object passes", () => {
	assert.deepEqual(validateAgainstSchema({ summary: "找到了", files: [{ path: "a.ts", why: "入口" }] }, SCHEMA), []);
});

test("a missing required field is named, not just counted", () => {
	const errors = validateAgainstSchema({ files: [] }, SCHEMA);
	assert.equal(errors.length, 1);
	assert.match(errors[0], /summary/, "the message says which field, so the retry is a one-line fix");
});

test("a wrong type reports both what was wanted and what arrived", () => {
	const errors = validateAgainstSchema({ summary: 42, files: [] }, SCHEMA);
	assert.match(errors[0], /summary/);
	assert.match(errors[0], /字符串/);
	assert.match(errors[0], /number/);
});

test("errors inside an array say which element", () => {
	const errors = validateAgainstSchema({ summary: "x", files: [{ path: "a.ts", why: "ok" }, { path: "b.ts" }] }, SCHEMA);
	assert.equal(errors.length, 1);
	assert.match(errors[0], /files\[1\]/, "the index is in the path");
	assert.match(errors[0], /why/);
});

test("enum values are checked", () => {
	assert.deepEqual(validateAgainstSchema({ summary: "x", files: [], severity: "high" }, SCHEMA), []);
	const errors = validateAgainstSchema({ summary: "x", files: [], severity: "urgent" }, SCHEMA);
	assert.match(errors[0], /severity/);
});

test("integer is distinguished from number", () => {
	assert.deepEqual(validateAgainstSchema({ summary: "x", files: [], count: 3 }, SCHEMA), []);
	assert.match(validateAgainstSchema({ summary: "x", files: [], count: 3.5 }, SCHEMA)[0], /整数/);
});

test("an unknown keyword is not a rejection", () => {
	/*
	 * This validator covers the keywords an agent's frontmatter actually uses. Anything else has to
	 * pass through: treating an unrecognised keyword as a failure would reject results the model
	 * got right, for a schema feature we simply have not implemented.
	 */
	const exotic: JsonSchema = { type: "object", properties: { x: { type: "string", pattern: "^a", minLength: 5 } } };
	assert.deepEqual(validateAgainstSchema({ x: "b" }, exotic), [], "pattern and minLength are ignored rather than enforced");
});

test("an extra field is not an error", () => {
	assert.deepEqual(validateAgainstSchema({ summary: "x", files: [], extra: 1 }, SCHEMA), []);
});

// ---------------------------------------------------------------------------
// The tool
// ---------------------------------------------------------------------------

test("a valid submission is stored and reported as accepted", async () => {
	const tool = makeYieldTool(SCHEMA);
	const context = ctx();
	const result = await tool.execute({ summary: "好了", files: [] }, context);

	assert.equal(result.isError, undefined);
	const stored = context.state.get(YIELD_KEY) as YieldOutcome;
	assert.equal(stored.value.summary, "好了");
	assert.deepEqual(stored.warnings, []);
});

test("an invalid submission is refused with the reasons, and nothing is stored", async () => {
	const tool = makeYieldTool(SCHEMA);
	const context = ctx();
	const result = await tool.execute({ files: [] }, context);

	assert.ok(result.isError, "it comes back as a tool error, which is the channel the model reacts to");
	assert.match(textOf(result), /summary/);
	assert.equal(context.state.get(YIELD_KEY), undefined, "a rejected result must not look like a delivered one");
});

test("a corrected retry is accepted", async () => {
	const tool = makeYieldTool(SCHEMA);
	const context = ctx();
	await tool.execute({ files: [] }, context);
	const second = await tool.execute({ summary: "补上了", files: [] }, context);

	assert.equal(second.isError, undefined);
	assert.equal((context.state.get(YIELD_KEY) as YieldOutcome).value.summary, "补上了");
});

test("after the retries run out, permissive keeps the object and attaches the problems", async () => {
	/*
	 * A result that is 90% right is more use than a failure — but the parent is about to act on the
	 * object, and acting on one with a hole in it while believing it complete is worse than either.
	 * So the warnings travel with the value.
	 */
	const tool = makeYieldTool(SCHEMA, { maxAttempts: 2 });
	const context = ctx();
	await tool.execute({ files: [] }, context);
	const final = await tool.execute({ files: [] }, context);

	assert.equal(final.isError, undefined, "the third attempt is accepted rather than refused again");
	const stored = context.state.get(YIELD_KEY) as YieldOutcome;
	assert.equal(stored.warnings.length, 1, "and it carries what was wrong with it");
	assert.match(textOf(final), /不符合要求/);
});

test("strict mode fails the dispatch instead", async () => {
	const tool = makeYieldTool(SCHEMA, { maxAttempts: 2, mode: "strict" });
	const context = ctx();
	await tool.execute({ files: [] }, context);
	const final = await tool.execute({ files: [] }, context);

	assert.ok(final.isError);
	assert.equal(context.state.get(YIELD_KEY), undefined, "nothing is delivered");
});

test("the tool's parameters are the declared schema, so the model fills the real fields", () => {
	const tool = makeYieldTool(SCHEMA);
	assert.deepEqual(tool.parameters, SCHEMA);
});

// ---------------------------------------------------------------------------
// Prompt and rendering
// ---------------------------------------------------------------------------

test("the instruction names the required fields and says non-delivery is the failure mode", () => {
	const text = yieldInstruction(SCHEMA);
	assert.match(text, /summary/);
	assert.match(text, /files/);
	assert.match(text, /看不到/, "the point being that prose without a yield delivers nothing");
});

test("rendering leads with the summary and puts the long report last", () => {
	const rendered = renderYield({
		value: {
			summary: "登录分三段。",
			files: [{ path: "src/auth.ts:42", why: "入口" }],
			report: "很长的报告正文。",
		},
		warnings: [],
	});

	const lines = rendered.split("\n");
	assert.equal(lines[0], "登录分三段。", "the summary is what a reader sees first");
	assert.match(rendered, /src\/auth\.ts:42/);
	assert.ok(rendered.indexOf("很长的报告正文") > rendered.indexOf("src/auth.ts"), "the report comes after the structure");
});

test("accepted-with-problems is visible in the rendering, not only in the data", () => {
	const rendered = renderYield({ value: { summary: "凑合" }, warnings: ["结果 缺少必需的字段 `files`。"] });
	assert.match(rendered, /⚠/);
	assert.match(rendered, /files/);
});
