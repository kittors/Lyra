import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

test("session switch remounts the transcript so the fade starts from opacity 0", async () => {
	const source = await readFile(new URL("../src/features/conversation/Conversation.tsx", import.meta.url), "utf8");
	assert.match(source, /key=\{activeSessionId\}/, "wrapper must remount or the animation will not restart");
	assert.match(source, /ly-transcript ly-no-enter ly-session-enter/, "one wrapper fade, children stay quiet");
	assert.ok(!/sessionEnter/.test(source), "toggling a class after paint is the flicker");
	assert.ok(!/requestAnimationFrame\(\(\) => setSessionEnter/.test(source), "rAF toggle painted the new page first");
});

test("session arrival is opacity only, from 0, using the slow token", async () => {
	const css = await readFile(new URL("../src/styles/motion.css", import.meta.url), "utf8");
	const block = css.match(/@keyframes ly-session-in \{[\s\S]*?\}\n/)?.[0] ?? "";
	assert.match(block, /opacity:\s*0/);
	assert.ok(!/translateY/.test(block), "a translate on a tall transcript is the jump");
	assert.match(css, /\.ly-session-enter \{[\s\S]*var\(--ly-t-slow\)/);
	assert.match(css, /\.ly-session-enter \{[\s\S]*\bboth\b/);
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
