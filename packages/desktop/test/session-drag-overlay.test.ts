import assert from "node:assert/strict";
import { test } from "node:test";

import { cancelSessionDrag, offerSessionDrag } from "../src/features/split/session-drag.ts";
import { useSplitOverlay } from "../src/features/split/overlay.ts";

test("cancelling a carry clears the split overlay so the conversation is usable again", () => {
	useSplitOverlay.getState().show("split-a", "split", "right");
	offerSessionDrag(
		{ id: "split-a", title: "A" },
		{ pointerId: 1, clientX: 10, clientY: 10, button: 0, pointerType: "mouse" },
	);
	cancelSessionDrag();
	assert.equal(useSplitOverlay.getState().kind, null);
	assert.equal(useSplitOverlay.getState().sessionId, null);
});
