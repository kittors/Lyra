/**
 * The composer card uses one inset, not three stacked paddings.
 *
 * Main, side-chat, sub-agent and commit share that inset and the same outer
 * gutter. The pane composers subtract `--ly-pane-chrome` so their cards sit on
 * the same window-bottom line as the main dock.
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

test("composer attachments, text and toolbar share --ly-composer-in", async () => {
	const tokens = await readFile(new URL("../src/styles/tokens.css", import.meta.url), "utf8");
	const composer = await readFile(new URL("../src/styles/composer.css", import.meta.url), "utf8");
	const misc = await readFile(new URL("../src/styles/misc.css", import.meta.url), "utf8");
	const attachments = await readFile(new URL("../src/styles/attachments.css", import.meta.url), "utf8");
	const geometry = await readFile(new URL("../src/features/dock/geometry.ts", import.meta.url), "utf8");
	assert.match(tokens, /--ly-composer-in:\s*12px/);
	assert.match(tokens, /--ly-composer-x:\s*16px/);
	assert.match(tokens, /--ly-composer-out:\s*24px/);
	assert.match(tokens, /--ly-composer-control:\s*28px/);
	assert.match(tokens, /--ly-pane-chrome:\s*4px/);
	assert.match(geometry, /export const PANE_INSET = 3/);
	assert.match(composer, /\.ly-composer-attachments[\s\S]*gap:\s*var\(--ly-composer-in\)/);
	assert.match(composer, /\.ly-composer-attachments[\s\S]*padding:\s*var\(--ly-composer-in\) var\(--ly-composer-x\) 0/);
	assert.match(composer, /\.ly-reveal:not\(\[data-open="true"\]\) \.ly-composer-attachments[\s\S]*padding-block:\s*0/);
	assert.match(composer, /\.ly-composer-bar[\s\S]*padding:\s*0 var\(--ly-composer-x\) var\(--ly-composer-in\)/);
	assert.match(composer, /\.ly-composer-dock[\s\S]*padding:\s*var\(--ly-composer-in\) var\(--ly-composer-out\) var\(--ly-composer-out\)/);
	assert.match(composer, /\.ly-composer-pad[\s\S]*padding:\s*var\(--ly-composer-in\) var\(--ly-composer-out\) calc\(var\(--ly-composer-out\) - var\(--ly-pane-chrome\)\)/);
	assert.match(composer, /\.ly-content-gutter[\s\S]*padding-inline:\s*var\(--ly-composer-out\)/);
	assert.match(composer, /\.ly-composer-control[\s\S]*height:\s*var\(--ly-composer-control\)/);
	assert.match(misc, /\.ly-composer-text[\s\S]*padding:\s*var\(--ly-composer-in\) var\(--ly-composer-x\)/);
	assert.doesNotMatch(misc, /padding:\s*var\(--ly-composer-in\) 16px 8px/);
	assert.match(attachments, /padding:\s*var\(--ly-attachment-bleed\) calc\(var\(--ly-composer-x\) - 4px\) 0/);
	assert.match(attachments, /margin:\s*calc\(var\(--ly-attachment-bleed\) \* -1\) calc\(4px - var\(--ly-composer-x\)\) 0/);
	assert.doesNotMatch(attachments, /padding:\s*8px 12px 0/);
	assert.doesNotMatch(attachments, /padding:\s*10px 12px;/);
});

test("pane composers use the shared pad, not a one-off gutter", async () => {
	const dock = await readFile(new URL("../src/features/composer/Composer.tsx", import.meta.url), "utf8");
	const side = await readFile(new URL("../src/features/sidechat/SideComposer.tsx", import.meta.url), "utf8");
	const sub = await readFile(new URL("../src/features/subagents/SubAgentPanel.tsx", import.meta.url), "utf8");
	const commit = await readFile(new URL("../src/features/git/CommitComposer.tsx", import.meta.url), "utf8");
	const conversation = await readFile(new URL("../src/features/conversation/Conversation.tsx", import.meta.url), "utf8");
	const chat = await readFile(new URL("../src/features/sidechat/SideChat.tsx", import.meta.url), "utf8");
	assert.match(dock, /ly-composer-dock/);
	assert.doesNotMatch(dock, /ly-composer-dock[^>]*(?:px-8|px-4|px-3)/);
	for (const source of [side, sub, commit]) {
		assert.match(source, /ly-composer-pad/);
		assert.doesNotMatch(source, /pb-\[15px\]/);
		assert.doesNotMatch(source, /ly-composer-pad[^>]*(?:pt-2|pb-\[|px-3)/);
	}
	assert.match(side, /ly-composer-attachments/);
	assert.match(sub, /ly-composer-attachments/);
	assert.doesNotMatch(side, /px-3\.5 pt-3/);
	assert.doesNotMatch(sub, /px-3\.5 pt-3/);
	assert.match(conversation, /ly-content-gutter/);
	assert.match(chat, /ly-content-gutter/);
	assert.doesNotMatch(chat, /contentClassName="px-3"/);
});
