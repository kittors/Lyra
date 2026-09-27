/**
 * The tooltip's text, as the document-level listener actually writes it.
 *
 * `test/tooltip-wrap.test.ts` covers the arithmetic; this covers the wiring. A hover goes through
 * `installTooltips` exactly as in the app, and the bubble has to carry a `<wbr>` right after each
 * separator of a long filename — and none at all in a short label or a Chinese sentence, where the
 * browser's own line breaking is already right. Without the break opportunities the balancing has
 * nothing to work with, and a long filename goes back to leaving 「d」 on a line of its own.
 */

import assert from "node:assert/strict";
import { after, test } from "node:test";
import { installTooltips } from "../../src/ui/overlay/tooltip.ts";

installTooltips();

const DELAY = 480;

/** Hover an element carrying `label` and return the bubble once it has had time to appear. */
async function hover(label: string): Promise<HTMLElement> {
	const target = document.createElement("button");
	target.type = "button";
	target.dataset.lyTip = label;
	document.body.append(target);
	target.dispatchEvent(new window.PointerEvent("pointerover", { bubbles: true }));
	await new Promise((resolve) => setTimeout(resolve, DELAY));
	const tip = document.querySelector<HTMLElement>(".ly-tooltip");
	// Put the pointer somewhere else so the next hover is a fresh one, and drop the stand-in.
	target.dispatchEvent(new window.PointerEvent("pointerout", { bubbles: true }));
	target.remove();
	assert.ok(tip && !tip.hidden, `the tooltip for ${JSON.stringify(label)} should be showing`);
	return tip;
}

/** The character right before each `<wbr>` in the bubble. */
function breaksAfter(tip: HTMLElement): string[] {
	return [...tip.querySelectorAll("wbr")].map((wbr) => wbr.previousSibling?.textContent?.slice(-1) ?? "");
}

after(() => {
	// A press dismisses the bubble at once, and with it any timer still waiting to run.
	document.dispatchEvent(new window.PointerEvent("pointerdown", { bubbles: true }));
});

test("a long filename's tooltip may break after each of its separators, and reads the same", async () => {
	const name = "REQUIREMENTS_POLICY_PORTAL_v2_final_review_notes.md";
	const tip = await hover(name);
	assert.equal(tip.textContent, name, "the break opportunities add nothing to the text");
	assert.deepEqual(breaksAfter(tip), ["_", "_", "_", "_", "_", "_", "."]);
});

test("a long path may break after its slashes and hyphens", async () => {
	const path = "docs/issue/2026-09-16-tasklist-paused.md";
	const tip = await hover(path);
	assert.equal(tip.textContent, path);
	assert.deepEqual(breaksAfter(tip), ["/", "/", "-", "-", "-", "-", "."]);
});

test("a short label and a Chinese sentence are written as they are", async () => {
	for (const label of ["用默认应用打开", "在访达中显示", "移动文件：拖动或按方向键；垂直于排列方向的按键预览分屏，Enter 确认，Escape 取消"]) {
		const tip = await hover(label);
		assert.equal(tip.textContent, label);
		assert.equal(tip.querySelectorAll("wbr").length, 0, `no break opportunities added to ${label}`);
	}
});
