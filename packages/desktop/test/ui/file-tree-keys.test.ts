/**
 * 文件树的键盘和拖拽：按下去的是标着那个字母的键，按的是这台机器的习惯。
 *
 * 复制、剪切、粘贴以前比的是 `event.key === "c"`——俄语布局下同一个键打出来是 "с"（西里尔字母），
 * Ctrl+C 在树里就什么都不做了。删除和拖拽复制照搬的是访达：PC 上单按 Delete 没反应，
 * 按住 Alt 拖才是复制，而资源管理器和 Linux 的文件管理器用的都是 Ctrl。
 */

import assert from "node:assert/strict";
import { after, afterEach, before, test } from "node:test";
import { act, createElement as h } from "react";

import { FileTree } from "../../src/features/files/FileTree.tsx";
import { I18nProvider } from "../../src/i18n/index.ts";
import { withKeyboard } from "../helpers/keyboard.ts";
import { click, fire, mount, type Mounted } from "../helpers/mount.ts";

type Call = [string, ...unknown[]];

/** A project with one file in it, and every file operation recorded rather than performed. */
function project(calls: Call[]) {
	const done = (path?: string) => ({ ok: true, path });
	Reflect.set(window, "lyra", {
		platform: "win32",
		files: {
			list: async (dir: string) =>
				dir === "/p"
					? [
							{ name: "sub", path: "/p/sub", isDirectory: true, size: 0 },
							{ name: "a.txt", path: "/p/a.txt", isDirectory: false, size: 1 },
						]
					: [],
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

/*
 * The context menu places itself at a point with `new DOMRect`. Provided here in case the shared DOM
 * does not, and put back exactly as it was afterwards — deleting it would take away a global the
 * shared DOM may well provide.
 */
const domRect = Object.getOwnPropertyDescriptor(globalThis, "DOMRect");
before(() => Object.defineProperty(globalThis, "DOMRect", { value: window.DOMRect, configurable: true, writable: true }));
after(() => {
	if (domRect) Object.defineProperty(globalThis, "DOMRect", domRect);
	else Reflect.deleteProperty(globalThis, "DOMRect");
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

/** The delete confirmation is a modal; it is portalled to the body, not drawn inside the tree. */
const asking = () => document.querySelector("[data-ly-modal]") !== null;

test("PC 上单按 Delete 就是删除，和资源管理器一样", async () => {
	project([]);
	await withKeyboard("Win32", async () => {
		const view = await showTree();
		try {
			await fire(view.find("[data-ly-tree]"), key("Delete", "Delete"));
			assert.ok(asking(), "单按 Delete 应当问要不要删除");
		} finally {
			await view.unmount();
		}
	});
});

test("Windows 上的删除确认和右键菜单，说的是回收站和资源管理器，不是访达", async () => {
	project([]);
	await withKeyboard("Win32", async () => {
		const menu = await showTree();
		try {
			await fire(menu.find('[data-path="/p/a.txt"]'), new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }));
			const items = [...document.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent ?? "");
			assert.ok(items.includes("在资源管理器中显示"), items.join(" | "));
		} finally {
			await menu.unmount();
		}

		const view = await showTree();
		try {
			await fire(view.find("[data-ly-tree]"), key("Delete", "Delete"));
			const dialog = document.querySelector('[role="dialog"]')?.textContent ?? "";
			assert.ok(dialog.includes("回收站"), dialog);
			assert.ok(!dialog.includes("访达") && !dialog.includes("废纸篓"), dialog);
		} finally {
			await view.unmount();
		}
	});
});

test("Mac 上单按 Delete 不删，要 ⌘⌫——访达就是这样，免得一碰就删", async () => {
	project([]);
	const view = await showTree();
	try {
		const tree = view.find("[data-ly-tree]");
		await fire(tree, key("Delete", "Delete"));
		assert.ok(!asking(), "Mac 上单按 Delete 不该删除");
		await fire(tree, key("Backspace", "Backspace", { metaKey: true }));
		assert.ok(asking(), "⌘⌫ 应当问要不要删除");
	} finally {
		await view.unmount();
	}
});

/** A `DataTransfer` that remembers what the drag put in it, which is all the tree reads back. */
function dataTransfer() {
	const data = new Map<string, string>();
	return {
		types: [] as string[],
		files: [] as File[],
		dropEffect: "none",
		effectAllowed: "all",
		setData(type: string, value: string) {
			data.set(type, value);
			if (!this.types.includes(type)) this.types.push(type);
		},
		getData: (type: string) => data.get(type) ?? "",
	};
}

function dragEvent(type: string, transfer: ReturnType<typeof dataTransfer>, held: { ctrlKey?: boolean; altKey?: boolean } = {}) {
	const event = new Event(type, { bubbles: true, cancelable: true });
	Object.defineProperties(event, {
		dataTransfer: { value: transfer },
		ctrlKey: { value: held.ctrlKey ?? false },
		altKey: { value: held.altKey ?? false },
		metaKey: { value: false },
		shiftKey: { value: false },
	});
	return event;
}

/** Drag a.txt onto the folder beside it, holding whatever `held` says. */
async function dragIntoFolder(view: Mounted, held: { ctrlKey?: boolean; altKey?: boolean }) {
	const transfer = dataTransfer();
	await fire(view.find('[data-path="/p/a.txt"]'), dragEvent("dragstart", transfer));
	await fire(view.find('[data-path="/p/sub"]'), dragEvent("drop", transfer, held));
	await settle();
}

test("PC 上按住 Ctrl 拖是复制，按住 Alt 拖仍是移动", async () => {
	const calls: Call[] = [];
	project(calls);
	await withKeyboard("Win32", async () => {
		const view = await showTree();
		try {
			await dragIntoFolder(view, { ctrlKey: true });
			assert.deepEqual(calls.filter(([name]) => name === "copy" || name === "rename"), [["copy", "/p/a.txt", "/p/sub/a.txt"]]);
			calls.length = 0;
			// Several Linux window managers take Alt+drag to move the window; it is not a copy here.
			await dragIntoFolder(view, { altKey: true });
			assert.deepEqual(calls.filter(([name]) => name === "copy" || name === "rename"), [["rename", "/p/a.txt", "/p/sub/a.txt"]]);
		} finally {
			await view.unmount();
		}
	});
});

test("Mac 上仍是按住 ⌥ 拖复制，和访达一样", async () => {
	const calls: Call[] = [];
	project(calls);
	const view = await showTree();
	try {
		await dragIntoFolder(view, { altKey: true });
		assert.deepEqual(calls.filter(([name]) => name === "copy" || name === "rename"), [["copy", "/p/a.txt", "/p/sub/a.txt"]]);
	} finally {
		await view.unmount();
	}
});

test("右键菜单里删除的键，写的就是这台机器上真正管用的那个", async () => {
	project([]);
	const hints = async () => {
		const view = await showTree();
		try {
			await fire(view.find('[data-path="/p/a.txt"]'), new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }));
			const items = [...document.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent ?? "");
			return {
				trash: items.find((text) => text.startsWith("删除")),
				forever: items.find((text) => text.startsWith("永久删除")),
			};
		} finally {
			await view.unmount();
		}
	};
	await withKeyboard("Win32", async () => {
		const pc = await hints();
		assert.ok(pc.trash?.endsWith("Delete") && !pc.trash.includes("Ctrl"), `PC：${pc.trash}`);
		assert.ok(pc.forever?.endsWith("Shift+Delete"), `PC：${pc.forever}`);
	});
	const mac = await hints();
	assert.ok(mac.trash?.endsWith("⌘⌫"), `Mac：${mac.trash}`);
	assert.ok(mac.forever?.endsWith("⇧⌘⌫"), `Mac：${mac.forever}`);
});
