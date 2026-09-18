import assert from "node:assert/strict";
import { test } from "node:test";
import { clearDeliveryCache, peekDelivery, rememberDelivery } from "../src/features/conversation/delivery-cache.ts";

const empty = () => ({ files: [], commands: [], serviceJobIds: [], warnings: [], reportPath: null });
const card = (n: number) => ({
	files: Array.from({ length: n }, (_, i) => ({
		path: `/tmp/f${i}.ts`, added: 1, removed: 0, hunks: [], changeIds: [] as string[], canUndo: false,
	})),
	commands: [], serviceJobIds: [], warnings: [], reportPath: null,
});

test("a remembered delivery is what the next paint reads", () => {
	clearDeliveryCache();
	rememberDelivery("s1", 10, card(3));
	assert.equal(peekDelivery("s1", 10)?.files.length, 3);
	assert.equal(peekDelivery("s2", 10), undefined);
});

test("the cache keeps the newest 32 turns and drops the oldest", () => {
	clearDeliveryCache();
	for (let i = 0; i < 40; i++) rememberDelivery("s", i, i === 0 ? card(9) : empty());
	assert.equal(peekDelivery("s", 0), undefined);
	assert.equal(peekDelivery("s", 39)?.files.length, 0);
	clearDeliveryCache();
});
