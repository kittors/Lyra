import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement as h } from "react";
import { AttachmentStrip } from "../../src/features/composer/attachments/AttachmentStrip.tsx";
import { mount } from "../helpers/mount.ts";

const file = {
	key: "1",
	name: "shot.png",
	kind: "image" as const,
	src: "ly-media://m/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png?thumb=128",
};

test("conversation thumbs use the browser lazy loader", async () => {
	const view = await mount(h(AttachmentStrip, { files: [file], onOpen: () => {} }));
	try {
		const img = view.find("img");
		assert.equal(img.getAttribute("src"), file.src);
		assert.equal(img.getAttribute("loading"), "lazy");
		assert.equal(view.host.querySelector("[data-ly-lazy=pending]"), null);
	} finally {
		await view.unmount();
	}
});

test("composer thumbs load immediately", async () => {
	const view = await mount(h(AttachmentStrip, { files: [file], onRemove: () => {} }));
	try {
		assert.equal(view.find("img").getAttribute("src"), file.src);
		assert.equal(view.find("img").getAttribute("loading"), "eager");
	} finally {
		await view.unmount();
	}
});
