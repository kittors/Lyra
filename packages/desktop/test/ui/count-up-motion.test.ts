import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement as h } from "react";
import { useCountUp } from "../../src/ui/primitives/useCountUp.ts";
import { mount } from "../helpers/mount.ts";

function Counter({ target }: { target: number }) {
	return h("output", {}, useCountUp(target));
}

test("reduced motion presents a new count immediately without scheduling animation frames", async (t) => {
	document.documentElement.dataset.reduceMotion = "on";
	const frame = t.mock.method(globalThis, "requestAnimationFrame");
	const view = await mount(h(Counter, { target: 0 }));
	try {
		await view.rerender(h(Counter, { target: 12000 }));
		assert.equal(view.text(), "12000");
		assert.equal(frame.mock.callCount(), 0);
	} finally {
		await view.unmount();
		delete document.documentElement.dataset.reduceMotion;
	}
});
