import assert from "node:assert/strict";
import { test } from "node:test";
import { createCaptureActions } from "../src/features/image/capture-actions.ts";

test("a pending download cannot lock the next capture or unlock its download", () => {
	const actions = createCaptureActions();
	actions.reset(1);
	assert.equal(actions.startDownload(1), true);
	assert.equal(actions.startDownload(1), false, "duplicate clicks share one download");
	actions.reset();
	actions.reset(2);
	assert.equal(actions.startDownload(2), true, "a network drive may still be writing the previous capture");
	assert.equal(actions.isCurrent(1), false);
	actions.finishDownload(1);
	assert.equal(actions.startDownload(2), false, "the old completion must not unlock the current request");
	actions.finishDownload(2);
	assert.equal(actions.startDownload(2), true, "a failed write can be retried in the same capture");
});

test("a previous capture's toast cannot fade or cancel the next capture", (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const actions = createCaptureActions();
	const effects: string[] = [];
	actions.reset(1);
	actions.after(3620, () => effects.push("fade"));
	actions.after(3820, () => effects.push("cancel"));
	t.mock.timers.tick(1000);
	actions.reset(2);
	t.mock.timers.tick(4000);
	assert.deepEqual(effects, [], "the second selection must survive the old download confirmation");
	actions.after(120, () => effects.push("current cancel"));
	t.mock.timers.tick(120);
	assert.deepEqual(effects, ["current cancel"]);
});

test("hiding or unmounting the overlay retires its pending callbacks", (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const actions = createCaptureActions();
	let calls = 0;
	actions.reset(1);
	actions.after(120, () => calls++);
	actions.reset();
	t.mock.timers.tick(1000);
	assert.equal(calls, 0);
	assert.equal(actions.isCurrent(1), false);
	assert.equal(actions.startDownload(1), false);
});
