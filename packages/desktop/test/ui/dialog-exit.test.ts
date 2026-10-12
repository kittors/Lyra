/**
 * A dialog closed by its own button leaves the way Escape and the scrim always made it leave.
 *
 * Buttons used to call `onClose` straight, which unmounted the dialog in that frame. `Dialog` now
 * hands `dismiss` to its actions: the exit plays, and `onClose` runs on its `animationend` — which
 * happy-dom never fires, so the tests deliver it.
 *
 * And an exit starts where the card is drawn. The exit keyframes used to name a `from` of fully
 * opaque, so a dialog closed during its 180ms entrance jumped back up before fading.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test, type TestContext } from "node:test";
import { createElement as h } from "react";

import { Dialog, DialogAction } from "../../src/ui/overlay/Dialog.tsx";
import { click, fire, mount, press } from "../helpers/mount.ts";

async function opened(t: TestContext, onClose: () => void) {
	const view = await mount(
		h(Dialog, {
			onClose,
			title: "新建项目",
			actions: (dismiss: () => void) => h(DialogAction, { onClick: () => dismiss(), children: "取消" }),
		}),
	);
	t.after(() => view.unmount());
	const card = document.querySelector<HTMLElement>("[data-ly-modal]");
	assert.ok(card, "the dialog was not drawn");
	return card;
}

test("a button handed `dismiss` plays the exit before the dialog is closed", async (t) => {
	let closes = 0;
	const card = await opened(t, () => closes++);
	const cancel = [...card.querySelectorAll("button")].find((button) => button.textContent === "取消");
	assert.ok(cancel);

	await click(cancel);
	assert.equal(closes, 0, "closed before its exit had played");
	assert.ok(card.classList.contains("ly-dialog-out"), card.className);

	await fire(card, new Event("animationend", { bubbles: true }));
	assert.equal(closes, 1);
});

test("an exit starts from the frame on screen, not from fully opaque", async (t) => {
	const card = await opened(t, () => {});
	const scrim = card.parentElement!;
	// Caught 50ms into the entrance: part-way faded in, still rising.
	// The global one is what the component calls (the DOM shim binds it once, apart from `window`'s).
	const real = globalThis.getComputedStyle;
	globalThis.getComputedStyle = ((element: Element) => {
		const style = real(element);
		if (element !== card && element !== scrim) return style;
		return { ...style, opacity: element === card ? "0.36" : "0.5", transform: element === card ? "matrix(0.99, 0, 0, 0.99, 0, 3)" : "none" } as CSSStyleDeclaration;
	}) as typeof globalThis.getComputedStyle;
	t.after(() => {
		globalThis.getComputedStyle = real;
	});

	await press(document.body, "Escape");
	assert.equal(card.style.opacity, "0.36");
	assert.equal(card.style.transform, "matrix(0.99, 0, 0, 0.99, 0, 3)");
	assert.equal(scrim.style.opacity, "0.5");

	// Those inline values are only where it starts if the keyframes name no start of their own.
	const css = readFileSync(new URL("../../src/styles/overlay.css", import.meta.url), "utf8");
	for (const name of ["ly-dialog-out", "ly-scrim-out"]) {
		const body = css.slice(css.indexOf(`@keyframes ${name}`)).split(/\n}\n/)[0];
		assert.ok(!/\bfrom\b|\b0%/.test(body), `${name} names a start, and a dialog closed mid-entrance jumps to it`);
	}
});
