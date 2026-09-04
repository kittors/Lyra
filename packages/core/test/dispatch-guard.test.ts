/**
 * The three limits on delegation.
 *
 * Each of these failures is expensive and quiet: twelve parallel dispatches, a cycle, or a tree
 * that keeps going down all look like the system working hard right up until the bill.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
	childDispatch,
	concurrencyNote,
	DispatchGate,
	refuseDispatch,
	rootDispatch,
	DEFAULT_MAX_DEPTH,
} from "../src/runtime/dispatch-guard.ts";

test("the main conversation may dispatch", () => {
	assert.equal(refuseDispatch(rootDispatch(), "explore"), undefined);
});

test("a sub-agent may dispatch once, and not past the depth limit", () => {
	const first = childDispatch(rootDispatch(), "explore");
	assert.equal(refuseDispatch(first, "review"), undefined, "depth 1 is still inside the default limit of 2");

	const second = childDispatch(first, "review");
	const refusal = refuseDispatch(second, "general");
	assert.ok(refusal, "depth 2 is the limit");
	assert.match(refusal, /上限是 2/, "the message names the limit rather than only saying no");
	assert.match(refusal, /自己做完/, "and says what to do instead");
});

test("the depth limit is configurable", () => {
	const one = childDispatch(rootDispatch(), "explore");
	assert.ok(refuseDispatch(one, "review", { maxDepth: 1 }));
	assert.equal(refuseDispatch(one, "review", { maxDepth: 3 }), undefined);
});

test("an agent cannot appear twice in one chain", () => {
	/*
	 * `explore → reviewer → explore` is a prompt written wrong rather than a plan, and it spends
	 * money at a rate that makes failing loudly the kind option.
	 */
	const chain = childDispatch(childDispatch(rootDispatch(), "explore"), "reviewer");
	const refusal = refuseDispatch(chain, "explore", { maxDepth: 5 });
	assert.ok(refusal);
	assert.match(refusal, /explore → reviewer → explore/, "the message shows the cycle it found");
});

test("a sibling of the same name at a different point in the tree is fine", () => {
	/*
	 * Two branches each dispatching `explore` is ordinary fan-out. Only a repeat *within one chain*
	 * is a cycle, and a check that looked at the whole tree would forbid the common case.
	 */
	const left = childDispatch(rootDispatch(), "explore");
	const right = childDispatch(rootDispatch(), "review");
	assert.equal(refuseDispatch(right, "explore"), undefined);
	assert.equal(left.chain.length, 1);
});

test("the gate runs up to the limit at once and queues the rest", async () => {
	const gate = new DispatchGate(2);
	const order: string[] = [];
	const release: (() => void)[] = [];

	const start = (name: string) =>
		gate.run(async () => {
			order.push(`start:${name}`);
			await new Promise<void>((resolve) => release.push(resolve));
			order.push(`end:${name}`);
		});

	const a = start("a");
	const b = start("b");
	const c = start("c");
	await new Promise((r) => setTimeout(r, 0));

	assert.deepEqual(order, ["start:a", "start:b"], "the third waited");
	assert.equal(gate.running, 2);
	assert.equal(gate.queued, 1);

	release.shift()!();
	await a;
	await new Promise((r) => setTimeout(r, 0));
	assert.ok(order.includes("start:c"), "finishing one lets the queued one in");

	release.forEach((fn) => fn());
	await Promise.all([b, c]);
	assert.equal(gate.running, 0);
});

test("a throw releases the slot", async () => {
	const gate = new DispatchGate(1);
	await assert.rejects(() =>
		gate.run(async () => {
			throw new Error("boom");
		}),
	);
	assert.equal(gate.running, 0, "a failed dispatch must not permanently consume a slot");
	await gate.run(async () => {});
});

test("the prompt note states the number, because a queue is invisible from inside", () => {
	const note = concurrencyNote(4, DEFAULT_MAX_DEPTH);
	assert.match(note, /4 个/);
	assert.match(note, /更晚到/, "it explains the consequence rather than just stating a rule");
});
