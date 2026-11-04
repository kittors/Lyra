/**
 * Which of a conversation's pictures a request carries at full size, as a gist, or as a line.
 *
 * The three things that must hold: the person's newest pictures are never stepped down; an old
 * picture, once stepped down, stays down on every later request (otherwise the request's prefix — and
 * the prompt cache with it — changes back and forth); and a cut leaves room, so the next picture does
 * not cut again.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { planImageTiers, type BudgetMessage, type BudgetSlot, type ImageBudget, type ImageTier } from "../src/images/request-budget.ts";

const BUDGET: ImageBudget = { fullBytes: 1000, fullCount: 4, gistCount: 4, lowWater: 0.5 };

/** A conversation as turns: each is the pictures in the prompt, then the pictures each tool step returned. */
function conversation(turns: { prompt: number; steps?: number[] }[]): { messages: BudgetMessage[]; slots: BudgetSlot[] } {
	const messages: BudgetMessage[] = [];
	const slots: BudgetSlot[] = [];
	const add = (role: BudgetMessage["role"], pictures: number, endsTurn?: boolean) => {
		const at = messages.length;
		messages.push(role === "assistant" ? { role, endsTurn } : { role });
		for (let i = 0; i < pictures; i++) slots.push({ bytes: 100, message: at });
	};
	for (const [index, turn] of turns.entries()) {
		add("user", turn.prompt);
		for (const pictures of turn.steps ?? []) {
			add("assistant", 0, false);
			add("toolResult", pictures);
		}
		// The last turn is the one being asked: it has no reply yet.
		if (index < turns.length - 1) add("assistant", 0, true);
	}
	return { messages, slots };
}

const count = (tiers: ImageTier[], tier: ImageTier) => tiers.filter((t) => t === tier).length;

test("a conversation under the budget sends every picture at full size", () => {
	const { messages, slots } = conversation([{ prompt: 2 }, { prompt: 1 }, { prompt: 1 }]);
	assert.deepEqual(planImageTiers(messages, slots, BUDGET, true), ["full", "full", "full", "full"]);
});

test("the pictures in the turn being asked are never stepped down, however many", () => {
	const { messages, slots } = conversation([{ prompt: 9 }]);
	assert.deepEqual(planImageTiers(messages, slots, BUDGET, true), Array(9).fill("full"));
});

test("once that turn is answered they are history, and the oldest step down to the low-water mark", () => {
	const { messages, slots } = conversation([{ prompt: 9 }, { prompt: 0 }]);
	const tiers = planImageTiers(messages, slots, BUDGET, true);
	// Cut back to half of four: the newest two stay, seven become gists — then the gists overflow too.
	assert.deepEqual(tiers.slice(-2), ["full", "full"]);
	assert.equal(count(tiers, "full"), 2);
	assert.equal(count(tiers, "gist"), 2, "four gists allowed, cut back to two");
	assert.equal(count(tiers, "note"), 5);
	// Oldest first at every step.
	assert.deepEqual(tiers, ["note", "note", "note", "note", "note", "gist", "gist", "full", "full"]);
});

test("without a codec there are no gists: a stepped-down picture becomes a line straight away", () => {
	const { messages, slots } = conversation([{ prompt: 6 }, { prompt: 0 }]);
	assert.deepEqual(planImageTiers(messages, slots, BUDGET, false), ["note", "note", "note", "note", "full", "full"]);
});

test("within one long turn the oldest tool screenshots step down, the newest one never", () => {
	// Browser automation: the prompt has no picture, every step returns one.
	const { messages, slots } = conversation([{ prompt: 0, steps: [1, 1, 1, 1, 1, 1, 1] }]);
	const tiers = planImageTiers(messages, slots, BUDGET, true);
	assert.equal(tiers.at(-1), "full", "the screenshot the model just asked for");
	assert.ok(count(tiers, "full") <= BUDGET.fullCount);
	assert.ok(tiers.indexOf("full") > tiers.lastIndexOf("gist"), "full ones are all newer than every gist");
});

test("the prompt's own pictures stay while that turn's tool screenshots come and go", () => {
	const { messages, slots } = conversation([{ prompt: 2, steps: [1, 1, 1, 1, 1, 1] }]);
	const tiers = planImageTiers(messages, slots, BUDGET, true);
	assert.deepEqual(tiers.slice(0, 2), ["full", "full"], "asked about in this turn");
	assert.equal(tiers.at(-1), "full");
	assert.ok(count(tiers.slice(2), "gist") + count(tiers.slice(2), "note") > 0, "older screenshots of the same turn did step down");
});

test("bytes bind as well as count", () => {
	const messages: BudgetMessage[] = [{ role: "user" }, { role: "assistant", endsTurn: true }, { role: "user" }];
	const slots: BudgetSlot[] = [{ bytes: 900, message: 0 }, { bytes: 300, message: 0 }, { bytes: 200, message: 2 }];
	// 1400 bytes is over 1000; cut to 500: the 900 goes, the 300 and the new 200 stay.
	assert.deepEqual(planImageTiers(messages, slots, BUDGET, true), ["gist", "full", "full"]);
});

test("a cut leaves room: the picture after it does not cut again", () => {
	const once = conversation([{ prompt: 5 }, { prompt: 0 }]);
	const before = planImageTiers(once.messages, once.slots, BUDGET, true);
	const more = conversation([{ prompt: 5 }, { prompt: 1 }]);
	const after = planImageTiers(more.messages, more.slots, BUDGET, true);
	assert.deepEqual(after.slice(0, 5), before, "the old pictures are where the first cut left them");
	assert.equal(after[5], "full");
});

test("an old picture never steps back up: every request agrees with every earlier one", () => {
	const rank: Record<ImageTier, number> = { full: 0, gist: 1, note: 2 };
	let seed = 11;
	const random = (n: number) => ((seed = (seed * 16807) % 2147483647) % n);
	for (let run = 0; run < 40; run++) {
		const turns = Array.from({ length: 2 + random(8) }, () => ({ prompt: random(4), steps: Array.from({ length: random(4) }, () => random(3)) }));
		let previous: ImageTier[] = [];
		for (let upTo = 1; upTo <= turns.length; upTo++) {
			const { messages, slots } = conversation(turns.slice(0, upTo));
			const tiers = planImageTiers(messages, slots, BUDGET, true);
			for (let i = 0; i < previous.length; i++) {
				assert.ok(rank[tiers[i]] >= rank[previous[i]], `run ${run}, picture ${i}: ${previous[i]} → ${tiers[i]}`);
			}
			previous = tiers;
		}
	}
});
