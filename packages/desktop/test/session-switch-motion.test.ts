import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

test("every sidebar press hydrates the pane, not only the first in a 360ms burst", async () => {
	const actions = await readFile(new URL("../src/features/split/actions.ts", import.meta.url), "utf8");
	assert.ok(!/settleTimer/.test(actions), "a quiet-window timer left the transcript on the previous row");
	assert.match(actions, /void commitSettle\(meta\)/, "each press must swap the pane in this turn");
});

test("session switch remounts the transcript without an enter fade", async () => {
	const conversation = await readFile(new URL("../src/features/conversation/Conversation.tsx", import.meta.url), "utf8");
	const pane = await readFile(new URL("../src/features/split/SplitPane.tsx", import.meta.url), "utf8");
	assert.match(pane, /RetainedViews/, "a warm visit must keep the tree, not remount twenty turns");
	assert.match(conversation, /ly-transcript ly-no-enter/, "historical rows stay quiet");
	assert.ok(!/ly-session-enter/.test(conversation), "a 340ms fade after a click is the lag");
	assert.ok(!/sessionEnter/.test(conversation), "toggling a class after paint is the flicker");
	assert.ok(!/requestAnimationFrame\(\(\) => setSessionEnter/.test(conversation), "rAF toggle painted the new page first");
});

test("the file-change card does not unfold its height on arrival", async () => {
	const source = await readFile(new URL("../src/features/conversation/TurnDelivery.tsx", import.meta.url), "utf8");
	assert.ok(!/data-ly-delivery-slot/.test(source), "a reserved 0-height slot is the top-down unfold");
	assert.ok(!/ly-reveal mt-3/.test(source), "ly-reveal on the card is the accordion the screenshot showed");
	assert.match(source, /peekDelivery/, "coming back must paint the card at its real height");
});

test("file-change clicks open this turn's diff pane, not Git or a modal", async () => {
	const source = await readFile(new URL("../src/features/conversation/TurnDelivery.tsx", import.meta.url), "utf8");
	assert.doesNotMatch(source, /<Overlay/);
	assert.doesNotMatch(source, /setReview/);
	assert.doesNotMatch(source, /open\("review"/);
	assert.match(source, /open\("delivery"/);
	assert.match(source, /openInFilePane/, "the implementation report still opens as a file");
});
