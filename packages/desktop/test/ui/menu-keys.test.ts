/**
 * Menus answer the arrow keys.
 *
 * They had only Escape. Opened with the mouse, focus stayed on the trigger: ↓ went nowhere and
 * Enter pressed the trigger again — on the Windows test machine choosing 「向右移动分屏」 from the
 * keyboard did nothing at all. Now ↓ moves into the first row, the arrows walk the rows, → and ←
 * go in and out of a submenu, and a menu with a search field moves a highlight under the caret.
 */

import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { act, createElement as h, useRef, useState } from "react";
import { LayoutProvider } from "../../src/app/layout.tsx";
import { I18nProvider } from "../../src/i18n/index.ts";
import { MenuBody, MenuItem, MenuSearch, Popover } from "../../src/ui/overlay/Popover.tsx";
import { mount, type Mounted } from "../helpers/mount.ts";

let view: Mounted | undefined;
beforeEach(() => {
	// Nothing here talks to the main process; the layout only asks the bridge whether it exists.
	Object.defineProperty(window, "lyra", { configurable: true, writable: true, value: {} });
});
afterEach(async () => {
	await view?.unmount();
	view = undefined;
	Reflect.deleteProperty(window, "lyra");
});

const wrap = (child: React.ReactNode) => h(I18nProvider, { locale: "zh-CN", children: h(LayoutProvider, { children: child }) });

async function press(key: string): Promise<KeyboardEvent> {
	const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
	await act(async () => {
		(document.activeElement ?? document.body).dispatchEvent(event);
	});
	return event;
}

/** A popover holding a menu body, children passed as props the way the components declare them. */
const menu = (props: { anchor: HTMLElement; onClose(): void; placement?: "right" }, ...rows: React.ReactNode[]) =>
	h(Popover, { ...props, children: h(MenuBody, { children: rows }) });

const frames = (n: number) => act(() => new Promise<void>((resolve) => setTimeout(resolve, 16 * n + 10)));
const focused = () => (document.activeElement?.textContent ?? "").trim() || document.activeElement?.tagName;

function Basic() {
	const [anchor, setAnchor] = useState<HTMLElement | null>(null);
	return h("div", null,
		h("button", { ref: setAnchor, id: "trigger" }, "⋯"),
		anchor && menu({ anchor, onClose() {} },
			h(MenuItem, { onClick() {}, children: "甲" }),
			h(MenuItem, { disabled: true, onClick() {}, children: "乙" }),
			h(MenuItem, { onClick() {}, children: "丙" }),
		));
}

test("↓ from the trigger moves into the menu; the arrows walk the enabled rows and wrap", async () => {
	view = await mount(wrap(h(Basic)));
	(document.getElementById("trigger") as HTMLButtonElement).focus();
	const first = await press("ArrowDown");
	assert.equal(focused(), "甲");
	assert.equal(first.defaultPrevented, true, "the page does not scroll under the menu");
	await press("ArrowDown");
	assert.equal(focused(), "丙", "a disabled row is stepped over");
	await press("ArrowDown");
	assert.equal(focused(), "甲", "and it wraps");
	await press("ArrowUp");
	assert.equal(focused(), "丙");
	await press("Home");
	assert.equal(focused(), "甲");
	await press("End");
	assert.equal(focused(), "丙");
});

function WithSubmenu() {
	const [anchor, setAnchor] = useState<HTMLElement | null>(null);
	const [open, setOpen] = useState(false);
	const row = useRef<HTMLDivElement>(null);
	return h("div", null,
		h("button", { ref: setAnchor, id: "trigger" }, "⋯"),
		anchor && menu({ anchor, onClose() {} },
			h(MenuItem, { onClick() {}, children: "重命名" }),
			h("div", { ref: row },
				h(MenuItem, { submenu: true, onClick: () => setOpen(true), children: "打开方式" }),
				open && row.current && menu({ anchor: row.current, onClose: () => setOpen(false), placement: "right" },
					h(MenuItem, { onClick() {}, children: "分屏" }),
					h(MenuItem, { onClick() {}, children: "新窗口" }),
				),
			),
		));
}

test("→ opens a row's submenu and moves into it; ← comes back to that row", async () => {
	view = await mount(wrap(h(WithSubmenu)));
	(document.getElementById("trigger") as HTMLButtonElement).focus();
	await press("ArrowDown");
	await press("ArrowDown");
	assert.equal(focused(), "打开方式");
	await press("ArrowRight");
	await frames(4);
	assert.equal(focused(), "分屏");
	await press("ArrowDown");
	assert.equal(focused(), "新窗口", "the submenu's own rows, not the parent's");
	await press("ArrowLeft");
	assert.equal(focused(), "打开方式");
});

test("→ on a row with no submenu does nothing", async () => {
	view = await mount(wrap(h(Basic)));
	(document.getElementById("trigger") as HTMLButtonElement).focus();
	await press("ArrowDown");
	const right = await press("ArrowRight");
	assert.equal(focused(), "甲");
	assert.equal(right.defaultPrevented, false);
});

function Searchable({ picked }: { picked: string[] }) {
	const [anchor, setAnchor] = useState<HTMLElement | null>(null);
	const [query, setQuery] = useState("");
	return h("div", null,
		h("button", { ref: setAnchor, id: "trigger" }, "模型"),
		anchor && h(Popover, {
			anchor,
			onClose() {},
			children: [
				h(MenuSearch, { key: "search", value: query, onChange: setQuery }),
				h(MenuBody, {
					key: "rows",
					children: [
						h(MenuItem, { key: "1", onClick: () => picked.push("一号"), children: "一号" }),
						h(MenuItem, { key: "2", onClick: () => picked.push("二号"), children: "二号" }),
					],
				}),
			],
		}));
}

test("in a menu with a search field the caret stays put; the arrows move a highlight and Enter takes it", async () => {
	const picked: string[] = [];
	view = await mount(wrap(h(Searchable, { picked })));
	const field = document.querySelector<HTMLInputElement>(".ly-menu-search input");
	assert.ok(field);
	field.focus();
	await press("ArrowDown");
	await press("ArrowDown");
	assert.equal(document.activeElement, field, "the caret is still in the field");
	const lit = [...document.querySelectorAll<HTMLElement>('[data-ly-active="true"]')].map((row) => row.textContent?.trim());
	assert.deepEqual(lit, ["二号"]);
	const enter = await press("Enter");
	assert.deepEqual(picked, ["二号"]);
	assert.equal(enter.defaultPrevented, true);
});

test("typing elsewhere — a composer with a menu open beside it — keeps its own arrows", async () => {
	function Beside() {
		const [anchor, setAnchor] = useState<HTMLElement | null>(null);
		return h("div", null,
			h("textarea", { id: "composer" }),
			h("button", { ref: setAnchor }, "⋯"),
			anchor && menu({ anchor, onClose() {} }, h(MenuItem, { onClick() {}, children: "甲" })));
	}
	view = await mount(wrap(h(Beside)));
	const composer = document.getElementById("composer") as HTMLTextAreaElement;
	composer.focus();
	const down = await press("ArrowDown");
	assert.equal(document.activeElement, composer);
	assert.equal(down.defaultPrevented, false);
});
