import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement as h, createRef } from "react";
import { CommandText } from "../../src/features/composer/CommandText.tsx";
import { mount } from "../helpers/mount.ts";

test("attachment marks paint the chip around the name, not the closing bracket", async () => {
	const mirror = createRef<HTMLDivElement>();
	const mark = "【图片 1】";
	const view = await mount(
		h(CommandText, {
			value: `${mark}后面`,
			decoration: { attachments: [{ start: 0, end: mark.length, kind: "image" }] },
			mirror,
		}),
	);
	try {
		const token = view.find(".ly-attachment-token");
		const body = token.querySelector(".ly-token-body");
		const paint = token.querySelector(".ly-token-paint");
		const brackets = token.querySelectorAll(".ly-token-bracket");
		assert.ok(body);
		assert.ok(paint);
		assert.equal(brackets.length, 2);
		assert.ok(paint.contains(brackets[0]!));
		assert.equal(paint.contains(brackets[1]!), false);
		assert.equal(paint.nextElementSibling, brackets[1]);
		assert.equal(paint.textContent, "【图片 1");
		assert.equal(brackets[1]!.textContent, "】");
		assert.equal(token.getAttribute("data-kind"), "image");
	} finally {
		await view.unmount();
	}
});
