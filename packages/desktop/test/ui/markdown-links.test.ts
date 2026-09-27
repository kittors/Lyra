import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement as h } from "react";
import { Markdown } from "../../src/features/conversation/Markdown.tsx";
import { click, fire, mount } from "../helpers/mount.ts";

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

/*
 * The two exits beside a file link: open with the default app, and reveal in Finder.
 *
 * They used to sit on the chip's right edge — 17px buttons, 11.5px icons — directly over the last 30px
 * of the filename. Now they are a bar outside the chip holding the app's small icon buttons. How big
 * they paint, whether they cover text and whether the paragraph jumps can only be measured in a real
 * window (`e2e/file-link-hover-probe.ts`); these tests hold the parts of the DOM that would bring the
 * old problems straight back if they were reverted.
 */
test("a file link's two exits are the app's small icon buttons, in a bar beside the name rather than on it", async () => {
	const view = await mount(h(Markdown, { text: "[README.md](README.md)", baseDir: "/project" }));
	try {
		const wrap = view.find("[data-ly-file-link]");
		const link = wrap.querySelector("a");
		const name = wrap.querySelector("[data-ly-file-name]");
		const bar = wrap.querySelector("[data-ly-file-actions] > [data-ly-file-actions-bar]");
		assert.ok(link && name && bar, "链接、文件名、浮条都该在");
		const buttons = [...bar.querySelectorAll("button")];
		assert.equal(buttons.length, 2);
		for (const button of buttons) {
			const label = button.getAttribute("aria-label");
			assert.ok(label, "每颗都要有无障碍名称");
			assert.equal(button.getAttribute("data-ly-tip"), label, "悬停提示和无障碍名称说的是同一句话");
			assert.match(button.className, /(^|\s)h-\[22px\](\s|$)/, "和 IconButton 的 sm 一样高");
			assert.match(button.className, /(^|\s)w-\[22px\](\s|$)/, "和 IconButton 的 sm 一样宽");
			assert.equal(button.querySelector("svg")?.getAttribute("width"), "14", "图标 14px，不是原来的 11.5");
			assert.ok(!link.contains(button), "出口不在链接里");
			assert.ok(!name.contains(button), "出口不在文件名里");
		}
		assert.equal(wrap.getAttribute("data-ly-file-actions-side"), "above");
		assert.deepEqual(
			buttons.map((button) => button.getAttribute("data-ly-tip-side")),
			["top", "top"],
			"浮条在上面时，按钮的提示也往上开，不压回标签",
		);
	} finally {
		await view.unmount();
	}
});

test("pressing an exit hands the file to the system and leaves the link alone", async () => {
	const calls: string[] = [];
	const previous = Object.getOwnPropertyDescriptor(window, "lyra");
	Object.defineProperty(window, "lyra", {
		configurable: true,
		value: {
			host: "desktop",
			platform: "darwin",
			files: {
				read: async (path: string) => {
					calls.push(`read ${path}`);
					return null;
				},
			},
			system: {
				openTargets: async () => [{ id: "reveal", label: "在访达中显示", aliases: [] }],
				openPath: async (path: string) => {
					calls.push(`openPath ${path}`);
				},
				openIn: async (target: string, path: string) => {
					calls.push(`openIn ${target} ${path}`);
				},
			},
		},
	});
	const view = await mount(h(Markdown, { text: "[README.md](README.md)", baseDir: "/project" }));
	try {
		const [open, reveal] = view.all("[data-ly-file-actions] button");
		assert.ok(open && reveal, "两颗出口都在");
		await click(open);
		await click(reveal);
		assert.deepEqual(
			calls,
			["openPath /project/README.md", "openIn reveal /project/README.md"],
			"按出口只做出口的事，不顺带在内置面板里把文件也读一遍",
		);
	} finally {
		await view.unmount();
		if (previous) Object.defineProperty(window, "lyra", previous);
		else Reflect.deleteProperty(window, "lyra");
	}
});

test("the bar sits over where the pointer came in, keeps right for the keyboard, and drops below when there is no room above", async () => {
	// Wrapped in a box that clips, standing in for the message row and its `contain: paint`.
	const view = await mount(
		h("div", { "data-clip": "", style: { overflowY: "hidden" } }, h(Markdown, { text: "[README.md](README.md)", baseDir: "/project" })),
	);
	try {
		const clip = view.find("[data-clip]");
		const wrap = view.find("[data-ly-file-link]");
		const link = view.find("[data-ly-file-link] a");
		const bar = view.find("[data-ly-file-actions-bar]");
		const box = (top: number, left: number, width: number, height: number) =>
			({ top, left, width, height, x: left, y: top, bottom: top + height, right: left + width, toJSON: () => ({}) }) as DOMRect;
		let chipTop = 300;
		// This DOM does no layout, so the geometry is given here: clipping box 100–700, a 120px chip starting at x=40, a 52px bar.
		Object.defineProperty(clip, "getBoundingClientRect", { configurable: true, value: () => box(100, 0, 800, 600) });
		Object.defineProperty(wrap, "getBoundingClientRect", { configurable: true, value: () => box(chipTop, 40, 120, 18) });
		Object.defineProperty(bar, "offsetWidth", { configurable: true, value: 52 });
		const enter = (clientX: number) => fire(link, new window.PointerEvent("pointerover", { bubbles: true, clientX, clientY: chipTop + 9 }));
		const at = () => wrap.style.getPropertyValue("--ly-file-actions-x");

		await enter(100);
		assert.equal(wrap.getAttribute("data-ly-file-actions-side"), "above", "上面地方够，放上面");
		assert.equal(at(), "34px", "浮条的中心正对指针：100 - 40 - 52 / 2");
		await enter(50);
		assert.equal(at(), "0px", "贴着左头进来，也不往胶囊左边伸出去");
		await enter(158);
		assert.equal(at(), "68px", "贴着右头进来，不往胶囊右边伸出去：120 - 52");

		await fire(link, new window.FocusEvent("focusin", { bubbles: true }));
		assert.equal(at(), "", "键盘进来没有指针可对，靠右");

		chipTop = 110;
		await enter(100);
		assert.equal(wrap.getAttribute("data-ly-file-actions-side"), "below", "离裁剪框上沿只有 10px，放下面");
		assert.equal(link.getAttribute("data-ly-tip-side"), "top", "浮条在下面时，路径提示改到上面，不叠在浮条上");
		assert.deepEqual(
			[...bar.querySelectorAll("button")].map((button) => button.getAttribute("data-ly-tip-side")),
			["bottom", "bottom"],
		);
	} finally {
		await view.unmount();
	}
});
