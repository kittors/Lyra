/**
 * Which `subagent_type` values the `task` tool accepts.
 *
 * The check is the only thing standing between a typo and a sub-agent that runs with the wrong
 * instructions and reports back as if nothing were wrong — the delegated run does not fail, it
 * just does something adjacent to what was asked. So the boundary conditions are pinned here
 * rather than left to whichever session happens to exercise them.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { AGENTS_KEY, type AgentDefinition, taskTool } from "../src/tools/task.ts";
import type { ToolContext } from "../src/types.ts";

const DEFINED: AgentDefinition[] = [
	{ name: "general", description: "general", systemPrompt: "", tools: "*" },
	{ name: "explore", description: "explore", systemPrompt: "", tools: "*" },
];

/** A context whose `spawnSubAgent` records what it was handed instead of running anything. */
function context(agents?: AgentDefinition[]): { ctx: ToolContext; spawned: string[] } {
	const spawned: string[] = [];
	const state = new Map<string, unknown>();
	if (agents) state.set(AGENTS_KEY, agents);
	return {
		spawned,
		ctx: {
			cwd: process.cwd(),
			sessionId: "roster",
			state,
			spawnSubAgent: async (input: { agentType?: string }) => {
				spawned.push(input.agentType ?? "(none)");
				return "done";
			},
		} as unknown as ToolContext,
	};
}

function text(result: Awaited<ReturnType<typeof taskTool.execute>>): string {
	return result.content
		.filter((c): c is { type: "text"; text: string } => c.type === "text")
		.map((c) => c.text)
		.join("");
}

test("a name on the roster is accepted and reaches the spawn", async () => {
	const { ctx, spawned } = context(DEFINED);
	const result = await taskTool.execute({ description: "d", prompt: "p", subagent_type: "explore" }, ctx);
	assert.equal(result.isError, undefined);
	assert.deepEqual(spawned, ["explore"]);
});

test("a name that is not on the roster is refused, and the refusal lists what is", async () => {
	const { ctx, spawned } = context(DEFINED);
	const result = await taskTool.execute({ description: "d", prompt: "p", subagent_type: "explorer" }, ctx);
	assert.ok(result.isError, "it is an error");
	assert.match(text(result), /explorer/, "the message quotes what was asked for");
	assert.match(text(result), /general, explore/, "and lists the names that exist");
	assert.deepEqual(spawned, [], "nothing was spawned");
});

test("an empty roster refuses every name rather than waving them all through", async () => {
	/*
	 * The regression this pins: the guard used to read `agents.length > 0`, so a session that
	 * registered an empty roster accepted anything at all. `[]` is a statement — this session has
	 * no sub-agents — and the only honest answer to any name is that it does not exist.
	 */
	const { ctx, spawned } = context([]);
	const result = await taskTool.execute({ description: "d", prompt: "p", subagent_type: "anything" }, ctx);
	assert.ok(result.isError, "it is an error");
	assert.match(text(result), /none are defined/, "and says the roster is empty rather than printing an empty list");
	assert.deepEqual(spawned, []);
});

test("a session that never registered a roster still delegates", async () => {
	/*
	 * `undefined` is not `[]`. A CLI path or a test that never set the key is not saying "there are
	 * none", it is saying "I resolve these myself" — refusing there would break the caller.
	 */
	const { ctx, spawned } = context(undefined);
	const result = await taskTool.execute({ description: "d", prompt: "p", subagent_type: "whatever" }, ctx);
	assert.equal(result.isError, undefined);
	assert.deepEqual(spawned, ["whatever"]);
});

test("no subagent_type means general", async () => {
	const { ctx, spawned } = context(DEFINED);
	await taskTool.execute({ description: "d", prompt: "p" }, ctx);
	assert.deepEqual(spawned, ["general"]);
});
