/**
 * 画廊：空的时候说图从哪来；有图时按天排开，点开一张看它的链路，点链路换图，搜索，关掉。
 *
 * 这套 DOM 不排版，元素都是零宽——网格靠宽度分行，舞台靠尺寸定图框，所以这里给一个固定的宽高。
 * 动效按「减少动态效果」走：飞行和淡入淡出量的是真窗口，这里量的是画出来的是什么。
 */

import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { act, createElement as h } from "react";
import type { Gallery, GalleryPicture } from "@lyra/core";
import { LayoutProvider } from "../../src/app/layout.tsx";
import { EditBar } from "../../src/features/gallery/EditBar.tsx";
import { GalleryView } from "../../src/features/gallery/GalleryView.tsx";
import { openPicture, refreshGallery, setGalleryQuery, useGallery } from "../../src/features/gallery/store.ts";
import { I18nProvider } from "../../src/i18n/index.ts";
import { zhCN } from "../../src/i18n/messages/zh-CN.ts";
import { useApp, type AppState } from "../../src/store/index.ts";
import { click, fire, mount, press, type Mounted } from "../helpers/mount.ts";

const name = (letter: string) => `${letter.repeat(40)}.jpg`;
const DAY = name("a");
const NIGHT = name("b");
const SUNSET = name("c");
const DOG = name("d");
const HAT = name("e");

const today = new Date();
const midnight = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
// Inside today however early the test runs, and well inside yesterday.
const at = (minutes: number) => midnight + minutes * 60_000;

function picture(media: string, sessionId: string, when: number, ask: string, sources: string[] = []): GalleryPicture {
	return {
		media,
		mimeType: "image/jpeg",
		width: 1408,
		height: 792,
		seq: 1,
		toolCallId: `call_${media.slice(0, 4)}`,
		index: 0,
		count: 1,
		at: when,
		prompt: `brief for ${ask}`,
		model: { id: "m", name: "gemini-3.1-flash-image", provider: "relay" },
		aspectRatio: "16:9",
		durationMs: 2600,
		sources,
		untraced: 0,
		ask: { text: ask, at: when - 1000, seq: 1, attachments: [] },
		sessionId,
	};
}

const BOATS: Gallery = {
	pictures: [
		picture(DOG, "dogs", at(-600), "画一只小狗"),
		picture(HAT, "dogs", at(-540), "给它戴个帽子", [DOG]),
		picture(DAY, "boats", at(1), "画一只红色纸船"),
		picture(NIGHT, "boats", at(2), "把它改成夜晚", [DAY]),
		picture(SUNSET, "boats", at(3), "回到白天那张，改成黄昏", [DAY]),
	],
	inputs: [],
	sessions: [
		{ id: "boats", title: "纸船", archived: false, createdAt: 1, updatedAt: 2 },
		{ id: "dogs", title: "小狗", archived: false, createdAt: 1, updatedAt: 2 },
	],
};

let previous: AppState;
let view: Mounted | undefined;
let listed: Gallery;
const width = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");
const height = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight");

beforeEach(() => {
	previous = useApp.getState();
	listed = BOATS;
	Object.defineProperty(window, "lyra", {
		configurable: true,
		value: {
			// A fresh copy each time, as one over IPC is: the same list must not pass as the same object.
			gallery: { list: async () => structuredClone(listed) },
			agent: { onEvent: () => () => {} },
			sessions: { onChanged: () => () => {} },
		},
	});
	Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 1000 });
	Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 600 });
	document.documentElement.dataset.reduceMotion = "on";
	useApp.setState({ view: "gallery" });
	useGallery.setState({ gallery: null, status: "idle", error: "", open: null, query: "" });
});

afterEach(async () => {
	await view?.unmount();
	view = undefined;
	if (width) Object.defineProperty(HTMLElement.prototype, "clientWidth", width);
	if (height) Object.defineProperty(HTMLElement.prototype, "clientHeight", height);
	delete document.documentElement.dataset.reduceMotion;
	useApp.setState(previous, true);
});

async function open(): Promise<Mounted> {
	const mounted = await mount(h(I18nProvider, { locale: "zh-CN", children: h(LayoutProvider, { children: h(GalleryView) }) }));
	await act(async () => {});
	await act(async () => {});
	return mounted;
}

const tiles = () => view!.all("[data-ly-gallery-tile]").map((tile) => tile.getAttribute("data-ly-gallery-tile"));
const steps = () => view!.all("[data-ly-lineage-step]").map((step) => step.getAttribute("data-ly-lineage-step"));

test("没有图的时候，说清楚图会从哪里来", async () => {
	listed = { pictures: [], inputs: [], sessions: [] };
	view = await open();
	const empty = view.find("[data-ly-gallery-empty]");
	assert.ok(empty.textContent?.includes(zhCN["gallery.empty"]));
	assert.ok(empty.textContent?.includes(zhCN["gallery.emptyHint"]));
	assert.equal(view.all("[data-ly-gallery-tile]").length, 0);
	assert.equal(view.all("[data-ly-gallery] input").length, 0, "nothing to search, so no search field");
});

test("按天排开，新的在前；一条链上的每张都标着这条链有几步", async () => {
	view = await open();
	assert.deepEqual(
		view.all("[data-ly-gallery-day] h2").map((heading) => heading.firstChild?.textContent),
		["今天", "昨天"],
	);
	assert.deepEqual(tiles(), [SUNSET, NIGHT, DAY, HAT, DOG]);
	const chips = Object.fromEntries(view.all("[data-ly-gallery-tile]").map((tile) => [tile.getAttribute("data-ly-gallery-tile"), tile.querySelector(".ly-gallery-chip")?.textContent ?? ""]));
	assert.deepEqual(chips, { [SUNSET]: "3", [NIGHT]: "3", [DAY]: "3", [HAT]: "2", [DOG]: "2" });
	assert.ok(view.find("[data-ly-gallery-count]").textContent?.includes("5"));
});

test("再进来读到的还是那些图：沿用手里那份，相册不整个重画", async () => {
	view = await open();
	const held = useGallery.getState().gallery;
	assert.ok(held);
	// Every visit reads again — the page's listeners are off while it is hidden.
	await act(async () => {
		await refreshGallery();
	});
	assert.equal(useGallery.getState().gallery, held, "the same list read again keeps the object every tile was rendered from");
	listed = { ...BOATS, pictures: BOATS.pictures.filter((entry) => entry.media !== DOG) };
	await act(async () => {
		await refreshGallery();
	});
	assert.notEqual(useGallery.getState().gallery, held, "a list that changed replaces it");
	assert.deepEqual(tiles(), [SUNSET, NIGHT, DAY, HAT]);
});

test("点开一张：看到它的链路，分支整段排在后面，当前这张标出来", async () => {
	view = await open();
	await click(view.find(`[data-ly-gallery-tile="${NIGHT}"]`));
	await act(async () => {});
	assert.equal(document.querySelector("[data-ly-gallery-detail]")?.getAttribute("data-ly-gallery-detail"), NIGHT);
	assert.deepEqual(steps(), [DAY, NIGHT, SUNSET]);
	assert.equal(view.find("[aria-current='step']").getAttribute("data-ly-lineage-step"), NIGHT);
	assert.deepEqual(
		view.all("[data-ly-lineage-words]").map((words) => words.textContent),
		["画一只红色纸船", "把它改成夜晚", "回到白天那张，改成黄昏"],
	);
	assert.ok(view.find("[data-ly-gallery-prompt]").textContent?.includes("把它改成夜晚"));
	assert.equal(document.activeElement?.closest("[data-ly-gallery-detail]") !== null, true, "the keyboard came with the picture");
	assert.equal(view.find("[data-ly-gallery-grid]").closest("[inert]") !== null, true, "the album under it takes no keys");
});

test("点链路里的一步换成那一张；方向键沿着相册走；Esc 关掉", async () => {
	view = await open();
	await act(async () => openPicture(SUNSET));
	await click(view.find(`[data-ly-lineage-step="${DAY}"]`));
	assert.equal(useGallery.getState().open, DAY);
	await press(document.body, "ArrowRight");
	assert.equal(useGallery.getState().open, HAT, "after the day picture comes yesterday's newest");
	await press(document.body, "Escape");
	await act(async () => {});
	assert.equal(useGallery.getState().open, null);
	assert.equal(document.querySelector("[data-ly-gallery-detail]"), null);
});

test("搜索按说过的话、提示词和对话名过滤", async () => {
	view = await open();
	await act(async () => setGalleryQuery("夜晚"));
	assert.deepEqual(tiles(), [NIGHT]);
	await act(async () => setGalleryQuery("小狗"));
	assert.deepEqual(tiles(), [HAT, DOG], "the conversation's title counts");
	await act(async () => setGalleryQuery("没有这张"));
	assert.ok(view.text().includes(zhCN["gallery.noMatch"]));
});

test("编辑栏：回车发出去；输入法组字时的回车不发；只有标注没有字也能发", async () => {
	const sent: string[] = [];
	const bar = (marked: string | null) =>
		h(I18nProvider, {
			locale: "zh-CN",
			children: h(EditBar, { marked, onAnnotate: () => {}, onUnmark: () => {}, onSend: async (words: string) => (sent.push(words), true) }),
		});
	view = await mount(bar(null));
	const field = view.find<HTMLInputElement>("[data-ly-gallery-words]");
	const send = view.find<HTMLButtonElement>("[data-ly-gallery-send] button");
	assert.equal(send.disabled, true, "nothing to send yet");
	Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, "把帽子换成红色");
	await fire(field, new Event("input", { bubbles: true }));
	await press(field, "Enter", { isComposing: true });
	assert.deepEqual(sent, [], "an IME's Enter commits its text, it does not send");
	await press(field, "Enter");
	await act(async () => {});
	assert.deepEqual(sent, ["把帽子换成红色"]);
	assert.equal(field.value, "", "sent, so the field is empty again");
	await view.rerender(bar("data:image/png;base64,iVBORw0KGgo="));
	assert.equal(view.find<HTMLButtonElement>("[data-ly-gallery-send] button").disabled, false, "the marks are a request on their own");
});
