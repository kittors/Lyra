/**
 * 侧栏滑开或收起的那 220ms 里，跟着宽度排版的东西只排一次：排到滑完时的宽度。
 *
 * 创作页的相册从前在侧栏收起的每一帧都按当时的宽度重排，每张图 13 种尺寸，看上去是一堆图在抽着
 * 往外撑。这里拿一个假的滑动顶替侧栏：盒子的宽度随它的时间走，拨到终点时读到的就是滑完的宽度。
 */

import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { act, createElement as h, useRef } from "react";
import { SLIDING_EDGE, useSettledWidth } from "../../src/ui/layout/settled-width.ts";
import { mount, type Mounted } from "../helpers/mount.ts";

const FROM = 700;
const TO = 1000;
const LENGTH = 220;

/** The sidebar's margin transition, as much of an `Animation` as the hook reads. */
class Slide {
	private time: number | null = 40;
	/** How often something moved the slide — the hook should, once per slide, and put it back. */
	seeks = 0;
	playState: AnimationPlayState = "running";
	readonly effect = { getComputedTiming: () => ({ endTime: LENGTH }) };
	readonly finished: Promise<Slide>;
	end!: () => void;
	constructor() {
		this.finished = new Promise((resolve) => {
			this.end = () => {
				this.playState = "finished";
				this.time = LENGTH;
				resolve(this);
			};
		});
	}
	get currentTime(): number | null {
		return this.time;
	}
	set currentTime(value: number | null) {
		this.seeks++;
		this.time = value;
	}
	/** The frame clock moving on, which is not a seek. */
	advance(to: number): void {
		this.time = to;
	}
}

let slide: Slide | null;
let edge: HTMLElement;
let resized: (() => void)[] = [];
let width: PropertyDescriptor | undefined;
let Observer: typeof ResizeObserver;
let view: Mounted | undefined;
/** The box's width when nothing is sliding. */
let rest = TO;

beforeEach(() => {
	slide = null;
	rest = TO;
	edge = document.createElement("div");
	edge.setAttribute(SLIDING_EDGE, "");
	// A finished transition drops out of the list, as Chromium's do.
	Object.assign(edge, { getAnimations: () => (slide && slide.playState !== "finished" ? [slide] : []) });
	document.body.append(edge);
	width = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");
	Object.defineProperty(HTMLElement.prototype, "clientWidth", {
		configurable: true,
		get: () => (slide && slide.playState !== "finished" ? FROM + (TO - FROM) * ((slide.currentTime ?? 0) / LENGTH) : rest),
	});
	Observer = globalThis.ResizeObserver;
	resized = [];
	globalThis.ResizeObserver = class {
		constructor(callback: ResizeObserverCallback) {
			resized.push(() => callback([], this as unknown as ResizeObserver));
		}
		observe() {}
		unobserve() {}
		disconnect() {}
	} as unknown as typeof ResizeObserver;
});

afterEach(async () => {
	await view?.unmount();
	view = undefined;
	edge.remove();
	if (width) Object.defineProperty(HTMLElement.prototype, "clientWidth", width);
	globalThis.ResizeObserver = Observer;
});

function Box() {
	const ref = useRef<HTMLDivElement>(null);
	return h("div", { ref, "data-width": String(useSettledWidth(ref)) });
}

const shown = () => Number(view!.find("[data-width]").getAttribute("data-width"));
/** A frame of the slide: the clock moves on and the box, a little wider, is observed. */
const frame = (to: number) =>
	act(async () => {
		slide?.advance(to);
		for (const callback of resized) callback();
	});

test("没在滑：就是盒子此刻的宽度", async () => {
	view = await mount(h(Box));
	assert.equal(shown(), TO);
});

test("滑到一半挂上来：直接排到滑完的宽度，滑动从原处接着走", async () => {
	slide = new Slide();
	view = await mount(h(Box));
	assert.equal(shown(), TO, "laid out for where the slide ends, not for where it is");
	assert.equal(slide.currentTime, 40, "the slide is put back on the frame it was on");
	assert.equal(slide.playState, "running");
});

test("滑动途中盒子每帧都在变宽：排版不跟着变，也不再去拨那个滑动", async () => {
	slide = new Slide();
	view = await mount(h(Box));
	const seeks = slide.seeks;
	for (const to of [80, 120, 160, 200]) {
		await frame(to);
		assert.equal(shown(), TO, `at ${to}ms the box is ${FROM + ((TO - FROM) * to) / LENGTH}px wide, and the layout stays where the slide ends`);
	}
	assert.equal(slide.seeks, seeks, "the end is read once per slide");
});

test("滑完以后按那时的宽度再量一次", async () => {
	slide = new Slide();
	view = await mount(h(Box));
	// The window was narrowed while the sidebar slid: the end it read then is no longer where it rests.
	rest = 960;
	await act(async () => {
		slide!.end();
		await new Promise((resolve) => setTimeout(resolve, 0));
	});
	assert.equal(shown(), 960);
});
