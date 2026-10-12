/**
 * A title changed twice in quick succession types from the newer one, not back from the older.
 *
 * The rewrite started from `shown` as the effect's render saw it. A second title arriving mid-rewrite
 * landed the row on the first new title (the cleanup does that on purpose) — and then the next rewrite
 * began from the render before the landing, deleting characters of the title before last: the old
 * title flashed back in between the two new ones.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement as h } from "react";

import { useTypedText } from "../../src/ui/motion/TypedText.tsx";
import { mount } from "../helpers/mount.ts";

const seen: string[] = [];
function Title({ text }: { text: string }) {
	const shown = useTypedText(text);
	seen.push(shown);
	return h("span", null, shown);
}

/**
 * Real time, outside `act`: inside it React holds every update until the scope ends, so twenty frames
 * of a rewrite render as one — the last — and a flash in the middle cannot be seen.
 */
async function wait(ms: number) {
	const flag = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
	flag.IS_REACT_ACT_ENVIRONMENT = false;
	try {
		await new Promise<void>((resolve) => setTimeout(resolve, ms));
	} finally {
		flag.IS_REACT_ACT_ENVIRONMENT = true;
	}
}

test("the second rewrite starts from the title it landed on, and the oldest one never comes back", async () => {
	seen.length = 0;
	const view = await mount(h(Title, { text: "Alpha old title" }));
	try {
		await view.rerender(h(Title, { text: "Beta new" }));
		// Two frames into the first rewrite: half of the old title is still on screen.
		await wait(60);
		const mark = seen.length;
		await view.rerender(h(Title, { text: "Gamma last" }));
		await wait(1200);

		const after = seen.slice(mark);
		assert.equal(after.at(-1), "Gamma last");
		const landing = after.indexOf("Beta new");
		assert.ok(landing >= 0, `never landed on the title in between: ${after.join(" | ")}`);
		const back = after.slice(landing).filter((value) => value.startsWith("Al"));
		assert.deepEqual(back, [], `the old title came back after landing: ${after.join(" | ")}`);
	} finally {
		await view.unmount();
	}
});
