import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement as h } from "react";
import { Markdown } from "../../src/features/conversation/Markdown.tsx";
import { click, mount } from "../helpers/mount.ts";

test("named local Markdown artifacts open through the file reader and preserve their labels", async () => {
	const paths: string[] = [];
	const previous = Object.getOwnPropertyDescriptor(window, "lyra");
	Object.defineProperty(window, "lyra", { configurable: true, value: { files: { read: async (path: string) => { paths.push(path); return null; } } } });
	const view = await mount(h(Markdown, { text: "[实现说明](/project/docs/result.md:12)", baseDir: "/project" }));
	try {
		assert.equal(view.find("a").textContent, "实现说明");
		assert.ok(view.find("a svg"));
		await click(view.find("a"));
		assert.deepEqual(paths, ["/project/docs/result.md"]);
	} finally {
		await view.unmount();
		if (previous) Object.defineProperty(window, "lyra", previous); else Reflect.deleteProperty(window, "lyra");
	}
});

test("backticked file links show the filename inside the chip and keep the path on the tooltip", async () => {
	const view = await mount(h(Markdown, { text: "[`docs/result.md`](docs/result.md:1)", baseDir: "/project" }));
	try {
		const wrap = view.find("[data-ly-file-link]");
		const link = wrap.querySelector("a");
		const icon = wrap.querySelector("a svg");
		const name = wrap.querySelector("[data-ly-file-name]");
		assert.ok(link);
		assert.ok(icon);
		assert.ok(name);
		assert.equal(name.textContent, "result.md");
		assert.equal(link.getAttribute("data-ly-tip"), "docs/result.md");
		assert.ok(link.contains(icon));
		assert.ok(link.contains(name));
		assert.equal(wrap.querySelector("code"), null);
	} finally {
		await view.unmount();
	}
});

test("plain file links use the same chip as backticked ones", async () => {
	const view = await mount(h(Markdown, { text: "[README.md](README.md)", baseDir: "/project" }));
	try {
		const wrap = view.find("[data-ly-file-link]");
		assert.ok(wrap.querySelector("a svg"));
		assert.equal(wrap.querySelector("[data-ly-file-name]")?.textContent, "README.md");
	} finally {
		await view.unmount();
	}
});

test("unsafe schemes and malformed encoded paths never become clickable file links", async () => {
	const view = await mount(h(Markdown, { text: "[unsafe](javascript:alert) [broken](/project/%E0%A4.md)", baseDir: "/project" }));
	try { assert.equal(view.host.querySelector("a"), null); assert.match(view.text(), /unsafe.*broken/); }
	finally { await view.unmount(); }
});
