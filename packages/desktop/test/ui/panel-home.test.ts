import assert from "node:assert/strict";
import { test } from "node:test";
import { restoredHomeTree } from "../../src/features/dock/popout.ts";
import { insert, leafOf, remove, resize } from "../../src/features/dock/tree.ts";

test("returning a panel reconstructs nested dimensions rather than merely its nearest edge", () => {
	let before = insert(leafOf("conversation"), "terminal", { kind: "conversation", side: "right" });
	before = insert(before, "browser", { kind: "terminal", side: "top" });
	before = resize(before, [], 0, 0.3);
	const rest = remove(before, "browser");
	const home = { before, rest };
	assert.deepEqual(restoredHomeTree(home, rest, "browser"), before);
	const changed = insert(rest, "files", { kind: "terminal", side: "bottom" });
	assert.equal(restoredHomeTree(home, changed, "browser"), null, "intervening user changes must not be overwritten");
	assert.equal(restoredHomeTree({ before: { broken: true }, rest }, rest, "browser"), null);
});
