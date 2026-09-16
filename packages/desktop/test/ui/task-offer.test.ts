import assert from "node:assert/strict";
import { test } from "node:test";
import { act, createElement as h } from "react";
import { Mark } from "../../src/features/task/Mark.tsx";
import { STEP_HOVER_MS, useDelayedOffer } from "../../src/features/task/hover-offer.ts";
import { SessionStatus } from "../../src/features/conversation/SessionStatus.tsx";
import { fire, mount } from "../helpers/mount.ts";

function OfferProbe() {
	const offer = useDelayedOffer(true);
	return h("div", { onMouseEnter: offer.enter, onMouseLeave: offer.leave, "data-offer": offer.show ? "on" : "off" }, "row");
}

test("a passing pointer does not offer the action, a one-second sit does", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const view = await mount(h(OfferProbe));
	try {
		// React binds enter/leave to mouseover/mouseout. `mouseenter` does not reach the handler.
		await fire(view.find("[data-offer]"), new MouseEvent("mouseover", { bubbles: true }));
		assert.equal(view.find("[data-offer]").getAttribute("data-offer"), "off");
		await act(async () => {
			t.mock.timers.tick(STEP_HOVER_MS - 1);
		});
		assert.equal(view.find("[data-offer]").getAttribute("data-offer"), "off");
		await act(async () => {
			t.mock.timers.tick(1);
		});
		assert.equal(view.find("[data-offer]").getAttribute("data-offer"), "on");
		await fire(view.find("[data-offer]"), new MouseEvent("mouseout", { bubbles: true }));
		assert.equal(view.find("[data-offer]").getAttribute("data-offer"), "off");
	} finally {
		t.mock.timers.reset();
		await view.unmount();
	}
});

test("an idle in-progress step is a still dot, not a spinner or pause bars", async () => {
	const view = await mount(h(Mark, { status: "in_progress", idle: true }));
	try {
		assert.equal(view.host.querySelector("svg"), null);
		assert.match(view.host.innerHTML, /bg-accent/);
		assert.doesNotMatch(view.host.innerHTML, /w-\[2px\]/);
	} finally {
		await view.unmount();
	}
});

test("session status idle and done marks share a 7px disc", async () => {
	const idle = await mount(h(SessionStatus, { activity: null }));
	const done = await mount(h(SessionStatus, { activity: "done" }));
	try {
		assert.equal(idle.find("[data-ly-status-mark=idle]").className.includes("h-[7px]"), true);
		assert.equal(done.find("[data-ly-status-mark=done]").className.includes("h-[7px]"), true);
		assert.equal(idle.host.querySelector("[data-ly-status-mark=idle]")?.className.includes("h-[6px]"), false);
	} finally {
		await idle.unmount();
		await done.unmount();
	}
});
