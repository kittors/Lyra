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

test("an agent named in the composer shows its face over the @, and the mirror keeps every character in place", async () => {
	const mirror = createRef<HTMLDivElement>();
	const value = "让 @explore 找一下，@README.md 也看看";
	const start = value.indexOf("@explore");
	const file = value.indexOf("@README.md");
	const view = await mount(
		h(CommandText, {
			value,
			decoration: {
				mentions: [
					{ start, end: start + "@explore".length, kind: "subagent", avatar: { shape: "drop", color: "green" } },
					{ start: file, end: file + "@README.md".length },
				],
			},
			mirror,
		}),
	);
	try {
		// 镜像层上的字必须和 textarea 里一字不差：脸不能占一个字符，`@` 也不能被删。
		assert.equal(mirror.current?.textContent, value);
		const faces = view.all(".ly-mention-face");
		assert.equal(faces.length, 1, "only the agent gets a face; a file mention stays text");
		assert.equal(faces[0].textContent, "@");
		assert.equal(faces[0].querySelector<HTMLElement>(".ly-avatar")?.dataset.avatar, "drop-green");
	} finally {
		await view.unmount();
	}
});
