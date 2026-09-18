/**
 * The delivery card opens this turn's recorded diffs, not Git and not the file viewer.
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

test("the delivery pane is registered, hidden from the chooser, and not persisted", async () => {
	const source = await readFile(new URL("../src/features/dock/panels/builtin.tsx", import.meta.url), "utf8");
	assert.match(source, /kind: "delivery"/);
	assert.match(source, /listed: false/);
	assert.match(source, /ephemeral: true/);
	assert.match(source, /DeliveryPanel/);
	assert.doesNotMatch(source, /kind: "delivery"[\s\S]*mobile: true/);
});

test("the chooser skips unlisted panes and storage skips ephemeral ones", async () => {
	const toolbar = await readFile(new URL("../src/app/window/WindowToolbar.tsx", import.meta.url), "utf8");
	const dock = await readFile(new URL("../src/features/dock/DockView.tsx", import.meta.url), "utf8");
	assert.match(toolbar, /listed !== false/);
	assert.match(dock, /!def\.ephemeral/);
});

test("the pane renders recorded hunks, not the worktree and not the open file", async () => {
	const source = await readFile(new URL("../src/features/dock/panels/builtin.tsx", import.meta.url), "utf8");
	assert.match(source, /data-delivery-diff/);
	assert.match(source, /DiffView/);
	assert.match(source, /useDeliveryReview/);
	assert.doesNotMatch(source, /useOpenFile/);
	assert.doesNotMatch(source, /bridge\.git/);
	const card = await readFile(new URL("../src/features/conversation/TurnDelivery.tsx", import.meta.url), "utf8");
	assert.match(card, /open\("delivery"\)/);
	assert.doesNotMatch(card, /open\("review"\)/);
});

test("a mouse click on a file row does not open the hover preview", async () => {
	const card = await readFile(new URL("../src/features/conversation/TurnDelivery.tsx", import.meta.url), "utf8");
	assert.match(card, /onPointerDown=\{\(\) => hideHover\(\)\}/, "press must cancel a pending hover before focus");
	assert.match(card, /matches\(":focus-visible"\)/, "mouse focus must not open the preview");
	assert.doesNotMatch(
		card,
		/onFocus=\{\(event\) => \{ keepHover\(\); setHover/,
		"unconditional focus-open is the click flash",
	);
});
