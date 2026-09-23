/**
 * 文件树的键盘：按下去的是标着那个字母的键，按的是这台机器的习惯。
 *
 * 复制、剪切、粘贴以前比的是 `event.key === "c"`——俄语布局下同一个键打出来是 "с"（西里尔字母），
 * Ctrl+C 在树里就什么都不做了。
 */

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { act, createElement as h } from "react";

import { FileTree } from "../../src/features/files/FileTree.tsx";
import { I18nProvider } from "../../src/i18n/index.ts";
import { click, fire, mount, type Mounted } from "../helpers/mount.ts";

type Call = [string, ...unknown[]];

/** A project with one file in it, and every file operation recorded rather than performed. */
function project(calls: Call[]) {
	const done = (path?: string) => ({ ok: true, path });
	Reflect.set(window, "lyra", {
		platform: "win32",
		files: {
			list: async (dir: string) => (dir === "/p" ? [{ name: "a.txt", path: "/p/a.txt", isDirectory: false, size: 1 }] : []),
			uniquePath: async (dir: string, name: string) => {
				calls.push(["uniquePath", dir, name]);
				return done("/p/a copy.txt");
			},
			copy: async (from: string, to: string) => {
				calls.push(["copy", from, to]);
				return done(to);
			},
			rename: async (from: string, to: string) => {
				calls.push(["rename", from, to]);
				return done(to);
			},
			trash: async (paths: string[]) => {
				calls.push(["trash", paths]);
				return done();
			},
			remove: async (paths: string[]) => {
				calls.push(["remove", paths]);
				return done();
			},
		},
		system: { openTargets: async () => [] },
		clipboard: { write: async () => {} },
	});
}

/** Long enough for the directory listing to come back and be drawn. */
const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });

async function showTree(): Promise<Mounted> {
	const view = await mount(
		h(I18nProvider, {
			locale: "zh-CN",
			children: h(FileTree, {
				roots: ["/p"],
				openPath: null,
				dirtyPaths: new Set<string>(),
				onOpen() {},
				onMoved() {},
				onRemoved() {},
			}),
		}),
	);
	await settle();
	// Select the file the way a person does: click its row.
	await click(view.find('[data-path="/p/a.txt"]'));
	return view;
}

/** A keydown as Chromium sends it; happy-dom would otherwise report Alt as AltGraph too. */
function key(keyName: string, code: string, init: KeyboardEventInit = {}) {
	const event = new KeyboardEvent("keydown", { key: keyName, code, bubbles: true, cancelable: true, ...init });
	Object.defineProperty(event, "getModifierState", { value: () => false });
	return event;
}

afterEach(() => {
	Reflect.deleteProperty(window, "lyra");
});

test("俄语布局下 Ctrl+C、Ctrl+V 照样是复制粘贴", async () => {
	const calls: Call[] = [];
	project(calls);
	const view = await showTree();
	try {
		const tree = view.find("[data-ly-tree]");
		// ЙЦУКЕН: the C key types Cyrillic "с" and the V key "м".
		await fire(tree, key("с", "KeyC", { ctrlKey: true }));
		await fire(tree, key("м", "KeyV", { ctrlKey: true }));
		await settle();
		assert.deepEqual(
			calls.filter(([name]) => name === "copy"),
			[["copy", "/p/a.txt", "/p/a copy.txt"]],
			"粘贴回同一个文件夹应复制出一份",
		);
	} finally {
		await view.unmount();
	}
});

test("剪切：俄语布局也认；Ctrl+Alt+X 在 Windows 上是 AltGr，不该把文件剪走", async () => {
	const calls: Call[] = [];
	project(calls);
	const view = await showTree();
	try {
		const tree = view.find("[data-ly-tree]");
		// A cut row is drawn faded until it lands somewhere.
		const faded = () => view.find('[data-path="/p/a.txt"]').className.includes("opacity-45");
		// Windows reads Ctrl+Alt as AltGr, which types characters on many layouts (Polish ź is AltGr+X).
		await fire(tree, key("x", "KeyX", { ctrlKey: true, altKey: true }));
		assert.ok(!faded(), "Ctrl+Alt+X 不是剪切");
		await fire(tree, key("ч", "KeyX", { ctrlKey: true }));
		assert.ok(faded(), "俄语布局的 Ctrl+X 是剪切");
	} finally {
		await view.unmount();
	}
});
