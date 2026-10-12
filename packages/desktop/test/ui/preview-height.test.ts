/**
 * How a preview card settles on a height, given when its page loads and when it speaks.
 *
 * Drawn after the fold, the card mounts the moment the call returns, and on a busy machine the page
 * inside — a frame with a process of its own — took longer to start than the card was willing to
 * wait. The card then took its 440 default for an answer: settled, remembered, and from then on
 * only allowed to grow, so the page's real 362 that came a moment later was thrown away. The
 * timing is the window probe's to reproduce (`e2e/preview-outside-fold-probe.ts`, scene `slow`);
 * these pin the rules, with the clock in hand.
 */

import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";
import { act, createElement as h } from "react";
import { PreviewCard, type PreviewInfo } from "../../src/features/files/PreviewCard.tsx";
import { I18nProvider } from "../../src/i18n/index.ts";
import { mount, type Mounted } from "../helpers/mount.ts";

const PREVIEW: PreviewInfo = { id: "pup1", sessionId: "s1", title: "柴柴小布丁", entry: "index.html" };
const KEY = `ly-preview-height:${PREVIEW.sessionId}/${PREVIEW.id}`;

let view: Mounted | undefined;

beforeEach(() => {
	localStorage.clear();
	mock.timers.enable({ apis: ["setTimeout"] });
});

afterEach(async () => {
	await view?.unmount();
	view = undefined;
	mock.timers.reset();
	localStorage.clear();
});

const frame = () => view!.find<HTMLIFrameElement>("iframe");
/** The card's own height, as set on it — what the transcript lays out. */
const height = () => frame().parentElement!.parentElement!.style.height;
/** Whether the page is let through to be seen: the frame stays transparent until then. */
const shown = () => frame().className.includes("opacity-100");

// The DOM's own event classes: Node's global `MessageEvent` is undici's, and refuses a window as its source.
const dom = window as unknown as { Event: typeof Event; MessageEvent: typeof MessageEvent };
const tick = (ms: number) => act(async () => mock.timers.tick(ms));
const loaded = () => act(async () => void frame().dispatchEvent(new dom.Event("load")));
const reports = (asked: number) =>
	act(async () => void window.dispatchEvent(new dom.MessageEvent("message", { data: { __dwPreviewHeight: asked }, source: frame().contentWindow })));

async function card(): Promise<void> {
	view = await mount(h(I18nProvider, { locale: "zh-CN", children: h(PreviewCard, { preview: PREVIEW }) }));
}

test("页面加载之前不算等待：挂上三秒还没加载，加载后的第一次报告照样定高度", async () => {
	await card();
	await tick(3000);
	assert.equal(shown(), false, "nothing to show before the page has loaded");
	assert.equal(localStorage.getItem(KEY), null, "a wait that ran out before the page existed was remembered as its height");

	await loaded();
	await reports(362);
	await tick(400);
	assert.equal(height(), "362px");
	assert.equal(shown(), true);
	assert.equal(localStorage.getItem(KEY), "362");
});

test("加载后一直没有消息，先按默认高度露出来，但不记住；之后来的第一次报告仍可以让卡片变矮", async () => {
	await card();
	await loaded();
	await tick(1500);
	assert.equal(shown(), true, "a page that never reports still has to be seen");
	assert.equal(height(), "440px");
	assert.equal(localStorage.getItem(KEY), null, "the default stood in for a measurement and was remembered as one");

	await reports(362);
	await tick(400);
	assert.equal(height(), "362px", "the late answer could only make the card taller, and the card stayed at 440");
	assert.equal(localStorage.getItem(KEY), "362");
});

test("等待期满时已经收到报告，就等它落定，不先露出默认高度再跳一下", async () => {
	await card();
	await loaded();
	await tick(1300);
	await reports(362);
	await tick(200);
	assert.equal(shown(), false, "shown at 440 for the 200ms before its own answer settled");
	await tick(200);
	assert.equal(height(), "362px");
	assert.equal(shown(), true);
});

test("「重新运行」之后重新量：新页面的报告定下新高度，不会留下一个永远空着的框", async () => {
	await card();
	await loaded();
	await reports(362);
	await tick(400);
	assert.equal(height(), "362px");

	await act(async () => view!.find<HTMLButtonElement>('button[aria-label="重新运行"]').click());
	assert.equal(shown(), false, "a fresh run is measured before it is seen");
	await loaded();
	await reports(300);
	await tick(400);
	assert.equal(height(), "300px", "the new page's first report was taken for a late one from the old, settled survey");
	assert.equal(shown(), true);
});
