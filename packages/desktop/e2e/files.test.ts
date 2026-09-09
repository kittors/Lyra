/**
 * Changing files, in the app that will actually be shipped.
 *
 * The unit tests cover the rules — what a legal name is, which paths are inside a project. What
 * they cannot cover is the part that only exists once there is a main process: whether the handler
 * is registered, whether the preload forwards it, and whether the bytes on disk afterwards are what
 * the panel claimed. Every assertion here reads the real filesystem rather than the tree's idea of
 * it, because the tree's idea of it is the thing most likely to be wrong.
 *
 * The layout check at the end belongs with these for one reason: it is the other half of the same
 * complaint. A filter that stretches across a panel it does not filter is a claim about scope, and
 * a claim about scope is worth a regression test.
 */

import assert from "node:assert/strict";
import { realpathSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { startApp, type RunningApp } from "./app.ts";

let app: RunningApp;
let project: string;

/** Written into the profile before launch, so the app opens with a project already known. */
async function seed(home: string): Promise<void> {
	const root = join(home, "project");
	await mkdir(join(root, "src", "deep"), { recursive: true });
	await mkdir(join(root, "docs"), { recursive: true });
	await writeFile(join(root, "src", "main.ts"), "export const a = 1\n");
	await writeFile(join(root, "src", "deep", "inner.txt"), "nested\n");
	await writeFile(join(root, "docs", "notes.md"), "# notes\n");
	/*
	 * A window wide enough for the panel to have two columns in it.
	 *
	 * The default is 980, where a full-screen panel is still under the width at which the tree and
	 * the file sit side by side — so the layout claim below would be tested against the stacked
	 * arrangement, which is not the arrangement it is about. `window.json` is read at launch.
	 */
	await writeFile(join(home, "window.json"), JSON.stringify({ width: 1280, height: 860, x: 0, y: 0 }));
	await writeFile(
		join(home, "settings.json"),
		JSON.stringify({
			version: 1,
			providers: [],
			mcpServers: [],
			projects: [{ id: "e2e", name: "project", path: root, pinned: true, lastOpenedAt: 1 }],
			defaultModelId: null,
			permissionMode: "auto",
			thinking: "medium",
			retryAttempts: 3,
			hooks: [],
			scheduledTasks: [],
			disabledPlugins: [],
			alwaysAllow: [],
			sync: { enabled: false, port: 4517, token: null },
		}),
	);
}

before(async () => {
	app = await startApp({ port: 9445, seed });
	/*
	 * 规范写法，和主进程回给渲染进程的那个一致。
	 *
	 * 边界检查现在两侧都解软链再比，因此返回的也是解过的那一个——`resolveInside` 的约定本来就是
	 * 「调用方对被检查过的那个字符串做 IO」。macOS 上 `mkdtemp` 给的是 `/var/…`，解开是
	 * `/private/var/…`，拿没解的那个去比路径会差一个前缀。
	 */
	project = realpathSync(join(app.home, "project"));
});

after(async () => {
	await app?.stop();
});

/** Run an expression with the project's path already in scope, since every one of them needs it. */
function inProject<T>(body: string): Promise<T> {
	return app.evaluate<T>(`(async () => { const P = ${JSON.stringify(project)}; ${body} })()`);
}

/**
 * The gestures, as the person using the app makes them.
 *
 * Injected before every UI expression rather than repeated in each: right-clicking a row and
 * picking an item off the menu is four lines of DOM every time, and four lines repeated eight
 * times is where a test suite starts disagreeing with itself about what "click 删除" means.
 *
 * `label` normalises whitespace because a menu row renders its text and its shortcut as separate
 * blocks — `innerText` puts a newline between them, and matching on "复制 " then never matches.
 */
const UI = `
	const wait = (ms) => new Promise((r) => setTimeout(r, ms));
	const label = (el) => el.innerText.replace(/\\s+/g, " ").trim();
	const rows = () => [...document.querySelectorAll("[role=treeitem]")];
	const row = (suffix) => rows().find((r) => r.getAttribute("data-path").endsWith(suffix));
	const item = (text) => [...document.querySelectorAll("[role=menuitem]")].find((i) => label(i).startsWith(text));
	const click = (el) => el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
	const openMenu = (el) => {
		const b = el.getBoundingClientRect();
		el.dispatchEvent(new MouseEvent("contextmenu", {
			bubbles: true, cancelable: true, button: 2,
			clientX: Math.round(b.left + 40), clientY: Math.round(b.top + 8),
		}));
	};
	const type = async (input, text) => {
		const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
		setter.call(input, text);
		input.dispatchEvent(new Event("input", { bubbles: true }));
		// 两个事件之间必须让 React 渲染一次。setState 是批到这次事件之后才生效的，紧接着同步发
		// Enter，提交读到的还是上一轮闭包里的空名字——于是文件按空名字建，或者被拒，磁盘上什么
		// 都没有，报出来是「ENOENT」，看着像功能坏了。
		await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
		input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
	};
	const key = (init) => document.querySelector("[data-ly-tree]").dispatchEvent(
		new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }),
	);
	const confirm = (verb) => [...document.querySelectorAll("[role=dialog] button")].find((b) => label(b) === verb)?.click();
	const toasts = () => [...document.querySelectorAll("[role=alert], [role=status]")];
`;

/** Drive the window with `UI` in scope. Everything here is an `await`-able page turn. */
function ui<T>(body: string): Promise<T> {
	return app.evaluate<T>(`(async () => { ${UI} const P = ${JSON.stringify(project)}; ${body} })()`);
}

/**
 * Open the files pane, with the project's own tree showing.
 *
 * Two clicks now: the dock's panel menu, then the row for the files pane. There is no tab strip
 * any more — every panel is a pane in the dock, and which panes exist is chosen from that menu.
 */
async function openFilePanel(): Promise<void> {
	await ui(`
		if (!document.querySelector("[data-ly-tree]")) {
			document.querySelector('button[aria-label="面板"]').click();
			await wait(120);
			const item = [...document.querySelectorAll('[role="menuitem"]')].find((b) => b.innerText.trim().startsWith("文件"));
			item?.click();
			await wait(600);
		}
		if (!row("/src")) await wait(500);
		if (!row("src/main.ts")) { click(row("/src")); await wait(500); }
	`);
}

test("a file is created, and it is on disk", async () => {
	const result = await inProject<{ ok: boolean; path?: string }>(
		`return window.lyra.files.create(P + "/src", "made.ts", "file")`,
	);
	assert.equal(result.ok, true, result.path ?? "create failed");
	assert.equal(await readFile(join(project, "src", "made.ts"), "utf8"), "");
});

test("the same name twice is refused as a question, not as an error", async () => {
	const again = await inProject<{ ok: boolean; code?: string }>(
		`return window.lyra.files.create(P + "/src", "made.ts", "file")`,
	);
	assert.equal(again.ok, false);
	// `exists` is what the panel keys its replace prompt off; any other code and it would give up.
	assert.equal(again.code, "exists");
});

test("renaming moves the bytes and leaves nothing behind", async () => {
	const result = await inProject<{ ok: boolean }>(
		`return window.lyra.files.rename(P + "/src/made.ts", P + "/docs/renamed.ts")`,
	);
	assert.equal(result.ok, true);
	assert.ok(!(await readdir(join(project, "src"))).includes("made.ts"), "the source is gone");
	assert.ok((await readdir(join(project, "docs"))).includes("renamed.ts"), "and the target is there");
});

test("a copy keeps both, and a free name is found for the second", async () => {
	const free = await inProject<{ ok: boolean; path?: string }>(
		`return window.lyra.files.uniquePath(P + "/src", "main.ts")`,
	);
	assert.equal(free.path, join(project, "src", "main copy.ts"));

	const copied = await inProject<{ ok: boolean }>(
		`return window.lyra.files.copy(P + "/src/main.ts", P + "/src/main copy.ts")`,
	);
	assert.equal(copied.ok, true);
	const both = await readdir(join(project, "src"));
	assert.ok(both.includes("main.ts") && both.includes("main copy.ts"));
});

test("a directory cannot be moved inside itself", async () => {
	const result = await inProject<{ ok: boolean; code?: string }>(
		`return window.lyra.files.rename(P + "/src", P + "/src/deep/src")`,
	);
	assert.equal(result.ok, false);
	assert.equal(result.code, "descendant");
	// The point of the check: `rename` on some filesystems would have done it.
	assert.ok((await readdir(join(project, "src"))).includes("deep"), "src is intact");
});

test("`..` cannot walk out of the project, to read or to write", async () => {
	/*
	 * The regression this exists for: the boundary used to be a string prefix, and
	 * `<project>/../../etc/passwd` starts with `<project>/`. Reading it that way was a leak; with
	 * delete and rename on the same doorway it would have been considerably worse.
	 */
	const escaped = await inProject<{ read: unknown; created: { ok: boolean; code?: string } }>(`
		return {
			read: await window.lyra.files.read(P + "/../../etc/hosts"),
			created: await window.lyra.files.create(P + "/..", "escaped.txt", "file"),
		}
	`);
	assert.equal(escaped.read, null, "reading outside the project answered with contents");
	assert.equal(escaped.created.ok, false);
	assert.equal(escaped.created.code, "denied");
	assert.ok(!(await readdir(app.home)).includes("escaped.txt"), "nothing was written outside");
});

test("a name the filesystem would refuse is refused with a reason", async () => {
	const bad = await inProject<{ ok: boolean; code?: string; error?: string }>(
		`return window.lyra.files.create(P, "a/b", "file")`,
	);
	assert.equal(bad.ok, false);
	assert.equal(bad.code, "invalid");
	assert.match(bad.error ?? "", /\//, "the message says which character");
});

test("permanent delete removes a whole directory", async () => {
	const result = await inProject<{ ok: boolean }>(`return window.lyra.files.remove([P + "/docs"])`);
	assert.equal(result.ok, true);
	assert.ok(!(await readdir(project)).includes("docs"));
});

test("the clipboard round-trips through the main process", async () => {
	// The renderer's own `navigator.clipboard.readText` needs a permission nothing grants, so
	// paste in a context menu depends entirely on this path working in a packaged app.
	const text = await app.evaluate<string>(
		`(async () => { await window.lyra.clipboard.write("往返"); return window.lyra.clipboard.read(); })()`,
	);
	assert.equal(text, "往返");
});

/** What the layout check reads off the window, plus the steps it took to get there. */
test("opening a file gives it a pane of its own, beside the tree rather than inside it", async () => {
	/*
	 * The tree and the open file used to be two halves of one panel, with their own breakpoint and
	 * their own draggable seam — one component reimplementing, for two boxes only, what the dock
	 * does for every pane. As two panes they can be split either way, resized, closed or made full
	 * screen independently, and the tree gets the whole panel when nothing is open.
	 */
	await openFilePanel();

	const before = await app.evaluate<string[]>(`[...document.querySelectorAll("[data-dock-pane]")].map((el) => el.dataset.dockPane)`);
	assert.ok(before.includes("files"), "the tree is open");
	assert.ok(!before.includes("file"), "and nothing has been opened in it yet");

	// Click a file in the tree — the ordinary way anyone opens one.
	await ui(`
		const target = row("README.md") ?? row("src/main.ts");
		if (!target) throw new Error("no file to open");
		click(target);
		await wait(700);
	`);

	const opened = await app.evaluate<{
		panes: string[];
		files: { left: number; top: number; width: number; height: number } | null;
		file: { left: number; top: number; width: number; height: number } | null;
		hasEditor: boolean;
		closable: boolean;
	}>(`(() => {
		const box = (kind) => {
			const el = document.querySelector('[data-dock-pane="' + kind + '"]');
			if (!el) return null;
			const b = el.getBoundingClientRect();
			return { left: b.left, top: b.top, width: b.width, height: b.height };
		};
		const header = document.querySelector('[data-dock-header="file"]');
		return {
			panes: [...document.querySelectorAll("[data-dock-pane]")].map((el) => el.dataset.dockPane),
			files: box("files"),
			file: box("file"),
			// The file's contents, rather than the tree's: proof it landed in the new pane.
			hasEditor: Boolean(document.querySelector('[data-dock-pane="file"] .ly-cm, [data-dock-pane="file"] .ly-markdown')),
			closable: Boolean(header && [...header.querySelectorAll("button")].some((b) => (b.getAttribute("aria-label") ?? "").startsWith("关闭"))),
		};
	})()`);

	assert.ok(opened.panes.includes("file"), "the file opened a pane of its own");
	assert.ok(opened.files && opened.file, "and both panes are on screen");
	// Two panes, not one box inside another: they do not overlap.
	const [tree, file] = [opened.files!, opened.file!];
	const apart = file.left >= tree.left + tree.width - 1 || tree.left >= file.left + file.width - 1 ||
		file.top >= tree.top + tree.height - 1 || tree.top >= file.top + file.height - 1;
	assert.ok(apart, `the panes sit apart: tree ${JSON.stringify(tree)}, file ${JSON.stringify(file)}`);
	assert.ok(opened.hasEditor, "and the file's contents are in the new pane");
	assert.ok(opened.closable, "which can be closed like any other pane");

	// The tree no longer holds a viewer of its own.
	const insideTree = await app.evaluate<boolean>(
		`Boolean(document.querySelector('[data-dock-pane="files"] .ly-cm, [data-dock-pane="files"] .ly-markdown'))`,
	);
	assert.equal(insideTree, false, "the tree pane is only a tree now");
});

test("新建文件 puts a field in the tree, and Enter creates what was typed", async (t) => {
	await openFilePanel();
	const state = await ui<{ field: boolean; selected: string[]; editor: boolean }>(`
		openMenu(row("/src")); await wait(400);
		item("新建文件").click(); await wait(400);
		const field = document.querySelector("[data-ly-tree] input.ly-name-input");
		if (!field) return { field: false, selected: [], editor: false };
		await type(field, "through-the-menu.ts"); await wait(800);
		return {
			field: true,
			// 提交读的是组件 state，为空就静默取消——把输入框最后的样子带出来，好分清是没输进去
			// 还是输进去了没提交。
			typed: field.value,
			stillThere: Boolean(document.querySelector("[data-ly-tree] input.ly-name-input")),
			selected: rows().filter((r) => r.getAttribute("aria-selected") === "true").map((r) => r.getAttribute("data-path")),
			editor: Boolean(document.querySelector(".ly-cm .cm-editor")),
		};
	`);

	assert.equal(state.field, true, "no inline field appeared");
	t.diagnostic(JSON.stringify(state));
	assert.equal(await readFile(join(project, "src", "through-the-menu.ts"), "utf8"), "");
	assert.deepEqual(state.selected, [join(project, "src", "through-the-menu.ts")], "the new file is selected");
	assert.equal(state.editor, true, "and open in the pane beside the tree");
});

test("F2 renames in place, with the extension left out of the selection", async () => {
	const state = await ui<{ range: [number, number] | null }>(`
		click(row("src/through-the-menu.ts")); await wait(300);
		key({ key: "F2" }); await wait(400);
		const field = document.querySelector("[data-ly-tree] input.ly-name-input");
		if (!field) return { range: null };
		const range = [field.selectionStart, field.selectionEnd];
		await type(field, "renamed-in-place.ts"); await wait(800);
		return { range };
	`);

	// `through-the-menu` is 16 characters; `.ts` is not part of what a rename means to retype.
	assert.deepEqual(state.range, [0, 16], "the stem was not the pre-selected part");
	const listed = await readdir(join(project, "src"));
	assert.ok(listed.includes("renamed-in-place.ts") && !listed.includes("through-the-menu.ts"));
});

test("创建副本 makes a copy beside it with a free name", async () => {
	await ui(`
		openMenu(row("src/renamed-in-place.ts")); await wait(400);
		item("创建副本").click(); await wait(900);
	`);
	const listed = await readdir(join(project, "src"));
	assert.ok(listed.includes("renamed-in-place copy.ts"), `no copy in ${listed.join(", ")}`);
});

test("⌘⌫ asks first, and the answer decides what happens on disk", async () => {
	const asked = await ui<string>(`
		click(row("src/renamed-in-place copy.ts")); await wait(300);
		key({ key: "Backspace", metaKey: true }); await wait(500);
		const dialog = document.querySelector("[role=dialog]");
		return dialog ? label(dialog) : "";
	`);
	assert.match(asked, /renamed-in-place copy\.ts/, "the question does not name what it would delete");
	assert.match(asked, /废纸篓/, "and does not say where it would go");

	// Cancelling leaves it alone — the half of a confirmation that is easy to get wrong.
	await ui(`confirm("取消"); await wait(400);`);
	assert.ok((await readdir(join(project, "src"))).includes("renamed-in-place copy.ts"), "cancel deleted it anyway");

	await ui(`
		key({ key: "Backspace", metaKey: true }); await wait(500);
		confirm("移到废纸篓"); await wait(900);
	`);
	assert.ok(!(await readdir(join(project, "src"))).includes("renamed-in-place copy.ts"), "confirm did not delete it");
});

test("cut and paste moves a file between folders", async () => {
	await inProject(`return window.lyra.files.create(P, "elsewhere", "directory")`);
	// The folder was made through the API, so the tree has not heard about it yet.
	await ui(`
		openMenu(row("/src")); await wait(300);
		item("刷新").click(); await wait(600);
		click(row("src/renamed-in-place.ts")); await wait(300);
		key({ key: "x", metaKey: true }); await wait(300);
		click(row("/elsewhere")); await wait(400);
		key({ key: "v", metaKey: true }); await wait(900);
	`);

	assert.ok((await readdir(join(project, "elsewhere"))).includes("renamed-in-place.ts"), "it did not arrive");
	assert.ok(!(await readdir(join(project, "src"))).includes("renamed-in-place.ts"), "and it did not leave");
});

// --- toasts -------------------------------------------------------------------------------------

test("a refused operation says so, above everything else on screen", async () => {
	const shown = await ui<{
		text: string;
		zIndex: number;
		highestElsewhere: number;
		highestName: string;
		hitByItself: boolean;
		inBody: boolean;
		centred: boolean;
	}>(`
		openMenu(row("/src")); await wait(350);
		item("复制 ⌘C").click(); await wait(350);
		openMenu(row("src/deep")); await wait(350);
		item("粘贴").click(); await wait(800);

		const card = toasts()[0];
		const host = card.parentElement;
		const box = card.getBoundingClientRect();
		const hit = document.elementFromPoint(Math.round(box.left + box.width / 2), Math.round(box.top + box.height / 2));
		// Everything that is not this stack, ranked. Named, so a failure says what would cover it.
		const others = [...document.querySelectorAll("body *")]
			.filter((el) => el !== host && !host.contains(el))
			.map((el) => ({ z: Number(getComputedStyle(el).zIndex), name: el.tagName + "." + String(el.className).slice(0, 40) }))
			.filter((el) => Number.isFinite(el.z))
			.sort((a, b) => b.z - a.z);

		return {
			text: label(card),
			zIndex: Number(getComputedStyle(host).zIndex),
			highestElsewhere: others[0]?.z ?? 0,
			highestName: others[0]?.name ?? "(nothing)",
			hitByItself: card.contains(hit),
			inBody: host.parentElement === document.body,
			centred: Math.abs((box.left + box.right) / 2 - window.innerWidth / 2) <= 2,
		};
	`);

	assert.match(shown.text, /不能把文件夹复制到它自己里面/);
	assert.equal(shown.inBody, true, "it is not portalled out of the layout that would clip it");
	assert.ok(
		shown.zIndex > shown.highestElsewhere,
		`a toast at ${shown.zIndex} can be covered by ${shown.highestName} at ${shown.highestElsewhere}`,
	);
	// The z-index is a claim; this is the observation. Nothing is painted over its middle.
	assert.equal(shown.hitByItself, true, "something is on top of the toast");
	assert.equal(shown.centred, true);
});

test("nothing between the shell and the page can trap a layer above the toast", async () => {
	/*
	 * `z-index` only settles arguments inside one stacking context, so "the toast is at 1000" is
	 * only the whole story while the things it must outrank are in the same context. The image
	 * viewer (100) and its annotator (120) are drawn inside `.ly-shell`; if anything on the way up
	 * to `<body>` ever grows a `transform`, an `opacity` below 1 or a `will-change`, that subtree
	 * becomes its own context and the viewer starts covering toasts — with every number unchanged
	 * and nothing to notice.
	 */
	const trapped = await app.evaluate<{ node: string; makes: string[] }[]>(`(() => {
		const makes = (el) => {
			const c = getComputedStyle(el);
			return [
				c.transform !== "none" && "transform",
				c.filter !== "none" && "filter",
				c.opacity !== "1" && "opacity",
				c.isolation === "isolate" && "isolation",
				c.willChange !== "auto" && "will-change",
				c.mixBlendMode !== "normal" && "mix-blend-mode",
				c.contain.includes("paint") && "contain:paint",
				c.zIndex !== "auto" && c.position !== "static" && "z-index",
			].filter(Boolean);
		};
		const chain = [];
		for (let el = document.querySelector(".ly-shell"); el && el !== document.body; el = el.parentElement) {
			chain.push({ node: el.tagName + (el.id ? "#" + el.id : ""), makes: makes(el) });
		}
		return chain.filter((step) => step.makes.length > 0);
	})()`);

	assert.deepEqual(
		trapped,
		[],
		`these would put the image viewer in its own stacking context: ${JSON.stringify(trapped)}`,
	);
});

test("the same failure twice is one card that counts, not two cards", async () => {
	const stack = await ui<{ cards: number; text: string }>(`
		for (let attempt = 0; attempt < 2; attempt++) {
			openMenu(row("src/deep")); await wait(300);
			item("粘贴").click(); await wait(600);
		}
		return { cards: toasts().length, text: toasts().map(label).join(" | ") };
	`);

	assert.equal(stack.cards, 1, `expected one card, got: ${stack.text}`);
	assert.match(stack.text, /×\s*\d/, "the repeat is not counted anywhere");
});

test("hovering holds a toast open, and the close button takes it away", async () => {
	const held = await ui<{ afterHover: number; afterClose: number }>(`
		const card = toasts()[0];
		// React synthesises enter/leave from delegated over/out, so those are what have to be sent.
		card.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, relatedTarget: document.body }));
		// Well past the longest lifetime: without the hold it would be long gone.
		await wait(10000);
		const afterHover = toasts().length;

		card.dispatchEvent(new MouseEvent("mouseout", { bubbles: true, relatedTarget: document.body }));
		card.querySelector("button[aria-label=关闭]").click();
		await wait(500);
		return { afterHover, afterClose: toasts().length };
	`);

	assert.equal(held.afterHover, 1, "the toast expired while the pointer was on it");
	assert.equal(held.afterClose, 0, "the close button left it on screen");
});

test("a toast goes on its own once nothing is holding it", async () => {
	const gone = await ui<{ atFirst: number; later: number }>(`
		openMenu(row("src/deep")); await wait(300);
		item("粘贴").click(); await wait(600);
		const atFirst = toasts().length;
		await wait(10000);
		return { atFirst, later: toasts().length };
	`);

	assert.equal(gone.atFirst, 1);
	assert.equal(gone.later, 0, "it is still there, so nothing would ever clear a stack of them");
});

test("the tree and the file are a pair: stacked together, side by side full screen", async () => {
	/*
	 * They are one tool between them — a tree with nothing open is a list, and a file with no tree
	 * is one file you cannot leave. So the file opens *against* the tree rather than wherever new
	 * panes go, and making either full screen brings the other: the point of enlarging a file is to
	 * read it properly, which is no use if you then cannot reach the next one.
	 *
	 * Stacked while they share a column, because splitting a column again leaves a tree too narrow
	 * for a filename. Side by side once they have the dock to themselves.
	 */
	await openFilePanel();
	await ui(`
		const target = row("README.md") ?? row("src/main.ts");
		if (!target) throw new Error("no file to open");
		click(target);
		await wait(700);
	`);

	const beside = await app.evaluate<Record<string, { left: number; top: number; width: number; height: number }>>(`(() => {
		const out = {};
		for (const el of document.querySelectorAll("[data-dock-pane]")) {
			if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue;
			const b = el.getBoundingClientRect();
			out[el.dataset.dockPane] = { left: b.left, top: b.top, width: b.width, height: b.height };
		}
		return out;
	})()`);
	assert.ok(beside.files && beside.file, "both are open");
	assert.ok(Math.abs(beside.file.left - beside.files.left) < 2, "the file is in the tree's column");
	assert.ok(beside.file.top > beside.files.top, "under it, rather than beside it in a narrower column");
	assert.ok(
		Math.abs(beside.file.height - beside.files.height) < 4,
		`and evenly, since you are looking at both: ${Math.round(beside.files.height)} / ${Math.round(beside.file.height)}`,
	);

	// Full screen from the file's own header.
	const maximise = `(async () => {
		const header = document.querySelector('[data-dock-header="file"]');
		[...header.querySelectorAll("button")].find((b) => (b.getAttribute("aria-label") ?? "").startsWith("全屏") || (b.getAttribute("aria-label") ?? "").startsWith("退出全屏")).click();
		await new Promise((r) => setTimeout(r, 600));
	})()`;
	await app.evaluate(maximise);

	const full = await app.evaluate<{ visible: string[]; span: number; dock: number; files: number; file: number; side: boolean }>(`(() => {
		const visible = [];
		const width = {};
		let left = Infinity;
		let right = -Infinity;
		for (const el of document.querySelectorAll("[data-dock-pane]")) {
			if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue;
			visible.push(el.dataset.dockPane);
			const b = el.getBoundingClientRect();
			width[el.dataset.dockPane] = b.width;
			left = Math.min(left, b.left);
			right = Math.max(right, b.right);
		}
		const dock = document.querySelector("[data-dock-panes]").getBoundingClientRect();
		const boxes = ["files", "file"].map((k) => document.querySelector('[data-dock-pane="' + k + '"]').getBoundingClientRect());
		return {
			visible,
			span: right - left,
			dock: dock.width,
			files: width.files ?? 0,
			file: width.file ?? 0,
			side: Math.abs(boxes[0].top - boxes[1].top) < 2 && boxes[1].left > boxes[0].left,
		};
	})()`);
	assert.deepEqual(full.visible.sort(), ["file", "files"], "the pair fills the dock, and nothing else is drawn");
	assert.ok(Math.abs(full.span - full.dock) < 4, "between them they cover it");
	/*
	 * The file takes most of the room, as it does in every editor. Checked here rather than in the
	 * ordinary layout, where a narrow dock puts both of them on their 300px floor and the ratio
	 * cannot be seen.
	 */
	assert.ok(full.file > full.files, `the file is the larger of the two: ${Math.round(full.files)} / ${Math.round(full.file)}`);

	// And back.
	await app.evaluate(maximise);
	const restored = await app.evaluate<string[]>(`
		[...document.querySelectorAll("[data-dock-pane]")].filter((el) => el.checkVisibility({ opacityProperty: true, visibilityProperty: true })).map((el) => el.dataset.dockPane)
	`);
	assert.ok(restored.includes("conversation"), "the conversation is back");
});

test("the boundary inside a maximised pair can still be dragged", async () => {
	/*
	 * Full screen used to raise its panes above everything, which buried the splitter between them
	 * — a maximised tree and file could not be resized at all. The panes it is not showing are
	 * hidden outright, so there was never anything for the extra layer to cover.
	 *
	 * The share also has to be translated on the way back. The focused layout re-shares the pair to
	 * fill the dock, so what is read off the handle sums to 1 there and to less than that in the
	 * tree being stored.
	 */
	await openFilePanel();
	await ui(`
		const target = row("README.md") ?? row("src/main.ts");
		click(target);
		await wait(700);
	`);
	await app.evaluate(`(async () => {
		const header = document.querySelector('[data-dock-header="file"]');
		[...header.querySelectorAll("button")].find((b) => (b.getAttribute("aria-label") ?? "").startsWith("全屏")).click();
		await new Promise((r) => setTimeout(r, 600));
	})()`);

	const widths = () =>
		app.evaluate<Record<string, number>>(`(() => {
			const out = {};
			for (const el of document.querySelectorAll("[data-dock-pane]")) {
				if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue;
				out[el.dataset.dockPane] = el.getBoundingClientRect().width;
			}
			return out;
		})()`);

	const before = await widths();
	assert.ok(before.files && before.file, "the pair is what is on screen");

	// The seam has to be reachable: nothing may be drawn over it.
	const onTop = await app.evaluate<string | null>(`(() => {
		const h = document.querySelector('[data-dock-panes] [role="separator"][aria-orientation="vertical"]');
		if (!h) return null;
		const b = h.getBoundingClientRect();
		const el = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
		return el ? el.getAttribute("role") : null;
	})()`);
	assert.equal(onTop, "separator", "the splitter is what the pointer would land on");

	await app.evaluate(`(async () => {
		const handle = document.querySelector('[data-dock-panes] [role="separator"][aria-orientation="vertical"]');
		const b = handle.getBoundingClientRect();
		const x = b.left + b.width / 2;
		const y = b.top + b.height / 2;
		const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
		handle.dispatchEvent(new PointerEvent("pointerdown", {
			pointerId: 12, isPrimary: true, bubbles: true, cancelable: true, clientX: x, clientY: y, buttons: 1,
		}));
		await frame();
		await frame();
		for (let step = 1; step <= 8; step++) {
			window.dispatchEvent(new PointerEvent("pointermove", {
				pointerId: 12, isPrimary: true, bubbles: true, clientX: x - (240 * step) / 8, clientY: y, buttons: 1,
			}));
			await frame();
		}
		window.dispatchEvent(new PointerEvent("pointerup", { pointerId: 12, isPrimary: true, bubbles: true, clientX: x - 240, clientY: y, buttons: 0 }));
		await new Promise((r) => setTimeout(r, 500));
	})()`);

	const after = await widths();
	assert.ok(
		after.files < before.files - 100,
		`the tree narrowed: ${Math.round(before.files)} to ${Math.round(after.files)} (file ${Math.round(before.file)} to ${Math.round(after.file)})`,
	);
	assert.ok(after.file > before.file + 100, "and the file took the room");
	assert.ok(
		Math.abs(after.files + after.file - (before.files + before.file)) < 4,
		"between them they still fill the dock",
	);

	await app.evaluate(`(async () => {
		window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
		await new Promise((r) => setTimeout(r, 400));
	})()`);
});

test("dragged apart, the pair is two ordinary panes again", async (t) => {
	/*
	 * The pairing is declared in the registry, but honouring it regardless of where the panes have
	 * been moved would mean full screen occasionally swallowing whatever sits between them.
	 */
	// Three columns need 420 + 300 + 300px after the sidebar; 1280px would stack them instead.
	await app.send("Emulation.setDeviceMetricsOverride", { width: 1400, height: 860, deviceScaleFactor: 1, mobile: false });

	/*
	 * From an empty dock, because this asserts on the *whole* row of panes.
	 *
	 * The layout is remembered, and these tests share one profile — so a panel opened by an earlier
	 * test is still there when this one runs, and the assertion failed on a pane it never mentioned.
	 * Closing them here states the precondition instead of inheriting it.
	 */
	await app.evaluate(`(async () => {
		for (let guard = 0; guard < 12; guard++) {
			const close = document.querySelector('[data-dock-header]:not([data-dock-header="conversation"]) button[aria-label^="关闭"]');
			if (!close) break;
			close.click();
			await new Promise((r) => setTimeout(r, 140));
		}
		await new Promise((r) => setTimeout(r, 300));
	})()`);

	await openFilePanel();
	await ui(`
		const target = row("README.md") ?? row("src/main.ts");
		click(target);
		await wait(700);
	`);

	// Send the file to the far left, putting the conversation between it and the tree.
	await app.evaluate(`(async () => {
		const grip = document.querySelector('[data-dock-grip="file"]');
		grip.focus();
		grip.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", altKey: true, bubbles: true, cancelable: true }));
		await new Promise((r) => setTimeout(r, 600));
	})()`);

	const order = await app.evaluate<string[]>(`
		[...document.querySelectorAll("[data-dock-pane]")]
			.filter((el) => el.checkVisibility({ opacityProperty: true, visibilityProperty: true }))
			.sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left)
			.map((el) => el.dataset.dockPane)
	`);
	t.diagnostic(JSON.stringify(await app.evaluate(`({ width: innerWidth, dock: document.querySelector("[data-dock-panes]").getBoundingClientRect().toJSON(), panes: [...document.querySelectorAll("[data-dock-pane]")].map(el => ({ kind: el.dataset.dockPane, box: el.getBoundingClientRect().toJSON() })) })`)));
	assert.deepEqual(order, ["file", "conversation", "files"], "they are no longer neighbours");

	// At the former fixture width, responsive stacking preserves the separation along the y axis.
	await app.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 860, deviceScaleFactor: 1, mobile: false });
	await app.evaluate(`new Promise(resolve => { let frames = 20; const tick = () => --frames ? requestAnimationFrame(tick) : resolve(); requestAnimationFrame(tick); })`);
	const stacked = await app.evaluate<{ kind: string; left: number; top: number; bottom: number }[]>(`[...document.querySelectorAll("[data-dock-pane]")]
		.filter(el => getComputedStyle(el).display !== "none")
		.map(el => { const r = el.getBoundingClientRect(); return { kind: el.dataset.dockPane, left: r.left, top: r.top, bottom: r.bottom }; })
		.sort((a, b) => a.top - b.top)`);
	t.diagnostic(JSON.stringify({ width: 1280, stacked }));
	assert.deepEqual(stacked.map(pane => pane.kind), ["file", "conversation", "files"], "the conversation still separates the stacked pair");
	for (let index = 1; index < stacked.length; index++) {
		assert.ok(Math.abs(stacked[index].left - stacked[0].left) < 1, "all three panes share a column");
		assert.ok(Math.abs(stacked[index].top - stacked[index - 1].bottom) < 1, "stacked panes meet without a gap or overlap");
	}

	await app.evaluate(`(async () => {
		const header = document.querySelector('[data-dock-header="file"]');
		[...header.querySelectorAll("button")].find((b) => (b.getAttribute("aria-label") ?? "").startsWith("全屏")).click();
		await new Promise((r) => setTimeout(r, 600));
	})()`);

	const visible = await app.evaluate<string[]>(`
		[...document.querySelectorAll("[data-dock-pane]")].filter((el) => el.checkVisibility({ opacityProperty: true, visibilityProperty: true })).map((el) => el.dataset.dockPane)
	`);
	assert.deepEqual(visible, ["file"], "so full screen is just the one pane");

	// Leave the dock as it was found: these two tests are the only ones here that rearrange it.
	await app.evaluate(`(async () => {
		window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
		await new Promise((r) => setTimeout(r, 400));
	})()`);
});
