/**
 * `useFollowBottom` against a DOM, which is where the rule in `follow.ts` meets the events that
 * actually arrive.
 *
 * The state machine is covered exhaustively in `test/scroll-follow.test.ts` and needs no browser.
 * What needs one is the wiring: which listener hears which gesture, what is treated as the reader
 * and what is treated as the program, and whether a transcript that should be riding its own bottom
 * is in fact put back against it.
 *
 * That last question is the reason half of this file exists. Every test written when this code was
 * rewritten asked the *opposite* one — that a transcript scrolled up in is not dragged back down —
 * because the four bugs being fixed were all of that kind. Nothing asserted that following works,
 * so when it stopped working during tool runs, the entire suite stayed green.
 *
 * Geometry is supplied by the harness because happy-dom performs no layout: `scrollHeight` and
 * `clientHeight` are whatever the test says they are, and `scrollTop` clamps against them the way a
 * browser's would.
 */

import assert from "node:assert/strict";
import { act, createElement as h } from "react";
import { test } from "node:test";
import { useFollowBottom, type FollowBottom } from "../../src/ui/scroll/useFollowBottom.ts";
import { writeFollow, readFollow } from "../../src/ui/scroll/memory.ts";
import { mount, type Mounted } from "../helpers/mount.ts";

let controls: FollowBottom;

/** The surface's dimensions, reset before every test by `open()`. */
const geometry = { content: 2400, view: 400 };

/** Where the end of the content meets the foot of the view. */
const bottom = () => Math.max(0, geometry.content - geometry.view);

function Harness({
	id,
	ready = true,
	count = 40,
	tail = "same",
}: {
	id: string;
	ready?: boolean;
	count?: number;
	tail?: string;
}) {
	const follow = useFollowBottom({
		surfaceId: id,
		namespace: "follow-test",
		count: ready ? count : 0,
		tail,
		ready,
	});
	controls = follow;
	return h(
		"div",
		{ className: "ly-scroll-host" },
		h(
			"div",
			{
				className: "ly-scroll-view",
				ref: (el: HTMLDivElement | null) => {
					follow.scrollRef.current = el;
					if (!el) return;
					let top = el.scrollTop;
					Object.defineProperties(el, {
						clientHeight: { configurable: true, get: () => geometry.view },
						scrollHeight: { configurable: true, get: () => (ready ? geometry.content : geometry.view) },
						scrollTop: {
							configurable: true,
							get: () => top,
							// Clamped like a real one: a transcript that shrinks takes its reader with it.
							set: (value: number) => {
								top = Math.max(0, Math.min(value, (ready ? geometry.content : geometry.view) - geometry.view));
							},
						},
					});
				},
			},
			h("div", { ref: follow.tailRef }),
		),
	);
}

/** A mounted surface at a known size, following its own end. */
async function open(id: string, props: { count?: number; tail?: string } = {}) {
	geometry.content = 2400;
	geometry.view = 400;
	const view = await mount(h(Harness, { id, ...props }));
	const el = view.find<HTMLDivElement>(".ly-scroll-view");
	return { view, el };
}

/**
 * One more turn's worth of content, delivered the way the store delivers it.
 *
 * The page gets taller and the signature moves, which is what a token, a new tool card or a message
 * settling looks like from here.
 */
async function arrives(view: Mounted, id: string, n: number, pixels = 300) {
	geometry.content += pixels;
	await view.rerender(h(Harness, { id, count: 40 + n, tail: `tail-${n}` }));
}

/**
 * A scroll this hook did not write: anchoring, clamping, the tail of a fling.
 *
 * Inside `act`, because what it reports — `away`, `unread` — is React state, and an assertion on
 * the next line would otherwise read the values from before the event.
 */
async function movesTo(el: HTMLDivElement, top: number) {
	await act(async () => {
		el.scrollTop = top;
		controls.onScroll(el);
	});
}

/** A wheel notch on the surface. `deltaY` negative is upwards, as in a browser. */
async function wheel(el: Element, deltaY: number, target: Element = el) {
	const event = new Event("wheel", { bubbles: true });
	Object.defineProperty(event, "deltaY", { value: deltaY });
	await act(async () => {
		target.dispatchEvent(event);
	});
}

/** A finger, which reports coordinates rather than a direction. */
async function touch(el: Element, type: "touchstart" | "touchmove", clientY: number) {
	const event = new Event(type, { bubbles: true });
	Object.defineProperty(event, "touches", { value: [{ clientY }] });
	await act(async () => {
		el.dispatchEvent(event);
	});
}

// ---------------------------------------------------------------------------
// Following, and what may not interrupt it
//
// The reported bug: during a long run of tool calls, with no answer being written yet, the
// transcript stops riding the bottom and offers 「有新内容」. Every test here is a thing that
// happens on its own during a streaming turn and used to end the follow.
// ---------------------------------------------------------------------------

test("a new surface rides its own bottom as content arrives", async () => {
	const { view, el } = await open("streaming");
	assert.equal(el.scrollTop, bottom(), "a fresh conversation starts at the end");

	for (let n = 1; n <= 4; n++) {
		await arrives(view, "streaming", n);
		assert.equal(el.scrollTop, bottom(), `still pinned after ${n} arrivals`);
	}
	await view.unmount();
});

test("releasing the mouse elsewhere in the window does not end the follow — the reported bug", async () => {
	/*
	 * `pointerup` used to be listened for on `window`, and it opened a 300ms window in which any
	 * position change counted as the reader scrolling. Clicking the sidebar, a panel, or the composer
	 * fired it, and the next reflow of the streaming turn landed inside the window and detached.
	 */
	const { view, el } = await open("elsewhere");

	await act(async () => {
		window.dispatchEvent(new Event("pointerup", { bubbles: true }));
		window.dispatchEvent(new Event("pointerdown", { bubbles: true }));
	});
	// Anchoring pulls the surface back as something above the reader folds away.
	await movesTo(el, bottom() - 400);

	await arrives(view, "elsewhere", 1);
	assert.equal(el.scrollTop, bottom(), "the click was not on this surface and decides nothing");
	await view.unmount();
});

test("a press inside the transcript does not end the follow", async () => {
	/*
	 * `pointerdown` used to be listened for on the scroll *host*, so it caught every press that
	 * bubbled out of the transcript — expanding a tool card, opening a thinking block, selecting a
	 * line of text — and each of those is followed by a reflow.
	 */
	const { view, el } = await open("press");
	await act(async () => {
		el.dispatchEvent(new Event("pointerdown", { bubbles: true }));
		el.dispatchEvent(new Event("pointerup", { bubbles: true }));
	});
	await movesTo(el, bottom() - 250);

	await arrives(view, "press", 1);
	assert.equal(el.scrollTop, bottom());
	await view.unmount();
});

test("scroll anchoring pulling the surface back does not end the follow", async () => {
	/*
	 * The transcript keeps `overflow-anchor` on purpose, and anchoring works by writing `scrollTop`.
	 * A tool group folding shut above the reader moves it backwards by however much the group lost —
	 * one scroll event, direction upwards, nobody's hand near it.
	 */
	const { view, el } = await open("anchoring");
	geometry.content -= 500;
	await movesTo(el, bottom() - 300);

	await arrives(view, "anchoring", 1, 0);
	assert.equal(el.scrollTop, bottom(), "the follow survived a reflow above the reader");
	await view.unmount();
});

test("a transcript clamped by its own shrinking keeps following", async () => {
	// Only the newest runs stay mounted, so every arrival unmounts the oldest and the page can end
	// up shorter than it was. The browser clamps, which arrives here as a scroll nobody asked for.
	const { view, el } = await open("clamped");
	geometry.content = 1200;
	await movesTo(el, 4000);
	assert.equal(el.scrollTop, bottom(), "clamping landed on the new end");

	await arrives(view, "clamped", 1);
	assert.equal(el.scrollTop, bottom());
	await view.unmount();
});

test("content growing under a signature that does not move is still followed", async () => {
	/*
	 * A running tool streams into a card that is already on screen: no message changes and the count
	 * of tool runs does not move, so the layout effect does not run. The resize observer is what
	 * catches it, and this is the only test that covers that path.
	 */
	const { view, el } = await open("resize-only");
	geometry.content += 600;
	await act(async () => controls.onResize(el));
	assert.equal(el.scrollTop, bottom(), "the observer put it back on the end");
	await view.unmount();
});

test("a viewport shrinking under a composer that grew keeps following", async () => {
	const { view, el } = await open("composer");
	geometry.view = 200;
	await act(async () => controls.onResize(el));
	assert.equal(el.scrollTop, bottom());
	await view.unmount();
});

// ---------------------------------------------------------------------------
// Leaving, which only a named gesture may do
// ---------------------------------------------------------------------------

test("one wheel notch upwards detaches, and later content stays put", async () => {
	const { view, el } = await open("wheel-up");
	await wheel(el, -40);
	el.scrollTop = bottom() - 40;
	const held = el.scrollTop;

	await arrives(view, "wheel-up", 1);
	assert.equal(el.scrollTop, held, "the reader's position is theirs now, and stays put");
	assert.notEqual(el.scrollTop, bottom(), "the content that arrived did not drag them down to it");
	await view.unmount();
});

test("wheeling back down to the end takes up following again", async () => {
	const { view, el } = await open("wheel-down");
	await wheel(el, -300);
	el.scrollTop = bottom() - 300;
	await arrives(view, "wheel-down", 1);
	assert.notEqual(el.scrollTop, bottom(), "detached, as the gesture asked");

	// Down to the end, and the arrival at the bottom is what says "follow again".
	await wheel(el, 300);
	await movesTo(el, bottom());
	await arrives(view, "wheel-down", 2);
	assert.equal(el.scrollTop, bottom(), "back on the end and riding it");
	await view.unmount();
});

test("a wheel inside a nested scroller is not this surface's gesture", async () => {
	/*
	 * A tool result and a code block scroll independently inside the transcript. Their wheel events
	 * bubble through the viewport, and treating them as the transcript's own is how reading a long
	 * command output used to stop the conversation following.
	 */
	const { view, el } = await open("nested");
	const inner = document.createElement("div");
	inner.className = "ly-scroll-view";
	el.append(inner);

	await wheel(el, -120, inner);
	await arrives(view, "nested", 1);
	assert.equal(el.scrollTop, bottom(), "the inner scroller kept its own gesture");
	inner.remove();
	await view.unmount();
});

test("keyboard scrolling detaches from future content growth", async () => {
	const { view, el } = await open("keyboard");
	assert.equal(el.scrollTop, bottom(), "new conversations follow the end");
	await act(async () => {
		el.dispatchEvent(new KeyboardEvent("keydown", { key: "PageUp", bubbles: true }));
		el.scrollTop = 1600;
		controls.onScroll(el);
	});
	await arrives(view, "keyboard", 1);
	assert.equal(el.scrollTop, 1600);
	await view.unmount();
});

test("the same keys inside a field belong to the field", async () => {
	const { view, el } = await open("field");
	const input = document.createElement("textarea");
	el.append(input);
	await act(async () => {
		input.dispatchEvent(new KeyboardEvent("keydown", { key: "PageUp", bubbles: true }));
	});
	await arrives(view, "field", 1);
	assert.equal(el.scrollTop, bottom(), "a caret moving is not the transcript scrolling");
	input.remove();
	await view.unmount();
});

test("dragging the scrollbar thumb upwards detaches", async () => {
	/*
	 * The thumb moves the surface by assignment and produces no wheel, no touch and no key. Since a
	 * bare position change may no longer detach anything, `Scroller` reports the drag as the gesture
	 * it is — without which pulling the thumb up during a streaming turn would be undone by the next
	 * token.
	 */
	const { view, el } = await open("thumb");
	await act(async () => controls.onUserScroll("up"));
	el.scrollTop = bottom() - 500;
	const held = el.scrollTop;

	await arrives(view, "thumb", 1);
	assert.equal(el.scrollTop, held, "the drag held its position");
	assert.notEqual(el.scrollTop, bottom(), "and the next token did not undo it");
	await view.unmount();
});

test("a hand on the thumb at the bottom is not a request to leave", async () => {
	// `onUserScroll("unknown")` is the press itself, before any movement. From the end there is
	// nothing to detach from, and pressing without dragging must not offer a way back.
	const { view, el } = await open("thumb-press");
	await act(async () => controls.onUserScroll("unknown"));
	await arrives(view, "thumb-press", 1);
	assert.equal(el.scrollTop, bottom());
	await view.unmount();
});

test("a hand on the thumb halfway up is", async () => {
	const { view, el } = await open("thumb-press-up");
	await movesTo(el, 800);
	await act(async () => controls.onUserScroll("unknown"));
	await arrives(view, "thumb-press-up", 1);
	assert.equal(el.scrollTop, 800);
	await view.unmount();
});

test("a finger dragged downwards detaches, and upwards returns", async () => {
	// A finger moving down the screen pulls the content down, which shows what is above: that is a
	// scroll upwards. `touchmove` carries coordinates only, so the direction is computed here.
	const { view, el } = await open("touch");
	await touch(el, "touchstart", 500);
	await touch(el, "touchmove", 560);
	el.scrollTop = bottom() - 200;
	await arrives(view, "touch", 1);
	assert.notEqual(el.scrollTop, bottom(), "the finger took the surface off the end");

	await touch(el, "touchmove", 400);
	await movesTo(el, bottom());
	await arrives(view, "touch", 2);
	assert.equal(el.scrollTop, bottom(), "and back onto it");
	await view.unmount();
});

// ---------------------------------------------------------------------------
// The way back, and what it clears
// ---------------------------------------------------------------------------

test("content arriving while away is counted, and clears on return", async () => {
	const { view, el } = await open("unread");
	await wheel(el, -600);
	el.scrollTop = 400;
	await arrives(view, "unread", 1);
	await arrives(view, "unread", 2);
	assert.ok(controls.unread > 0, `something arrived while the reader was up here (unread=${controls.unread})`);
	assert.equal(controls.away, true, "and there is a way back on offer");

	await act(async () => controls.returnToBottom());
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, GLIDE + 40));
	});
	assert.equal(el.scrollTop, bottom());
	assert.equal(controls.unread, 0, "arriving at the end is catching up");
	assert.equal(controls.away, false);
	await view.unmount();
});

test("a transcript handed over again is not new content", async () => {
	// Opening a session sets its messages twice — from the cache, then from disk — and the second
	// set is a different array holding the same content.
	const { view, el } = await open("resettle", { count: 40, tail: "same" });
	await wheel(el, -600);
	el.scrollTop = 400;
	await view.rerender(h(Harness, { id: "resettle", count: 40, tail: "same" }));
	assert.equal(controls.unread, 0, "nothing arrived; nothing to catch up on");
	await view.unmount();
});

test("nothing arriving means the button offers navigation, not news", async () => {
	const { view, el } = await open("quiet");
	await wheel(el, -600);
	await movesTo(el, 400);
	assert.equal(controls.away, true, "far enough up to be offered a way back");
	assert.equal(controls.unread, 0, "but there is no news, so no dot");
	await view.unmount();
});

test("the way back is not offered from just short of the end", async () => {
	// Between the slack and the away threshold: detached, and saying nothing about it.
	const { view, el } = await open("band");
	await wheel(el, -100);
	await movesTo(el, bottom() - 100);
	assert.equal(controls.away, false);
	await view.unmount();
});

const GLIDE = 420;

test("the app's reduce-motion preference makes return to bottom immediate", async () => {
	document.documentElement.dataset.reduceMotion = "on";
	writeFollow("follow-test", "reduced", { following: false, scrollTop: 600, seen: null });
	const { view, el } = await open("reduced");
	try {
		await act(async () => controls.returnToBottom());
		assert.equal(el.scrollTop, bottom());
	} finally {
		await view.unmount();
		delete document.documentElement.dataset.reduceMotion;
	}
});

test("a gesture during the ride back ends it where it is", async () => {
	const { view, el } = await open("interrupt");
	await movesTo(el, 200);
	await act(async () => controls.returnToBottom());
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 60));
	});
	await wheel(el, -40);
	const stopped = el.scrollTop;
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, GLIDE));
	});
	assert.equal(el.scrollTop, stopped, "the animation did not resume after the wheel");
	assert.notEqual(el.scrollTop, bottom());
	await view.unmount();
});

// ---------------------------------------------------------------------------
// Remembering a surface across a swap
// ---------------------------------------------------------------------------

test("a saved position is restored after asynchronous content, never against the placeholder", async () => {
	writeFollow("follow-test", "cold", { following: false, scrollTop: 900, seen: null });
	geometry.content = 2400;
	geometry.view = 400;
	const view = await mount(h(Harness, { id: "cold", ready: false }));
	assert.equal(view.find(".ly-scroll-view").scrollTop, 0);
	await view.rerender(h(Harness, { id: "cold", ready: true }));
	assert.equal(view.find(".ly-scroll-view").scrollTop, 900);
	await view.unmount();
	assert.equal(readFollow("follow-test", "cold")?.scrollTop, 900);
});

test("leaving a loading session preserves its saved reading position", async () => {
	writeFollow("follow-test", "loading", { following: false, scrollTop: 700, seen: null });
	geometry.content = 2400;
	geometry.view = 400;
	const view = await mount(h(Harness, { id: "loading", ready: false }));
	await view.rerender(h(Harness, { id: "elsewhere" }));
	assert.equal(readFollow("follow-test", "loading")?.scrollTop, 700);
	await view.unmount();
});

test("an in-progress return animation cannot scroll the next session", async () => {
	writeFollow("follow-test", "ride", { following: false, scrollTop: 600, seen: null });
	writeFollow("follow-test", "reader", { following: false, scrollTop: 800, seen: null });
	geometry.content = 2400;
	geometry.view = 400;
	const view = await mount(h(Harness, { id: "ride" }));
	await act(async () => controls.returnToBottom());
	await view.rerender(h(Harness, { id: "reader" }));
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 70));
	});
	assert.equal(view.find(".ly-scroll-view").scrollTop, 800);
	assert.equal(readFollow("follow-test", "ride")?.following, true, "returning is an intention to follow the end");
	await view.unmount();
});

test("a pane mounted while hidden restores when it becomes measurable", async () => {
	writeFollow("follow-test", "hidden", { following: false, scrollTop: 500, seen: null });
	geometry.content = 2400;
	geometry.view = 0;
	const view = await mount(h(Harness, { id: "hidden" }));
	geometry.view = 400;
	await act(async () => controls.onResize(view.find<HTMLDivElement>(".ly-scroll-view")));
	assert.equal(view.find(".ly-scroll-view").scrollTop, 500);
	await view.unmount();
});

test("a reading taken while hidden neither moves nor decides anything", async () => {
	const { view, el } = await open("blink");
	geometry.view = 0;
	await movesTo(el, 0);
	geometry.view = 400;

	await arrives(view, "blink", 1);
	assert.equal(el.scrollTop, bottom(), "a pane briefly reporting nothing is not the reader leaving");
	await view.unmount();
});

// ---------------------------------------------------------------------------
// 手指底下那一块，和跟随底部之间的优先次序
//
// 展开一段折叠区会让转录长高，而长高在 `onResize` 里跟「新消息到了」长得一模一样——处理方式却
// 正好相反。真窗口量过：点开一个 952px 的工具组，点中的按钮当场飞出视口 1952px，因为跟随底部
// 把读者一路带到了转录末尾。下面几条守的就是这个次序。
// ---------------------------------------------------------------------------

/** 一个位置由测试说了算的元素——happy-dom 不做布局，`getBoundingClientRect` 本来全是 0。 */
function placed(top: number): { el: HTMLElement; move(to: number): void } {
	const el = document.createElement("button");
	let at = top;
	document.body.appendChild(el);
	el.getBoundingClientRect = () => ({ top: at, bottom: at + 20, left: 0, right: 0, width: 0, height: 20, x: 0, y: at, toJSON: () => ({}) }) as DOMRect;
	return { el, move: (to: number) => { at = to; } };
}

test("没按住任何东西时，长高照旧跟到底", async () => {
	const { view, el } = await open("grow-free");
	assert.equal(el.scrollTop, bottom());
	geometry.content += 500;
	await act(async () => controls.onResize(el));
	assert.equal(el.scrollTop, bottom(), "这是跟随底部本来该做的事，不能被锚定顺手改掉");
	await view.unmount();
});

test("按住一块再展开，跟随底部让路，点中的那个留在原处", async () => {
	const { view, el } = await open("held");
	const was = el.scrollTop;
	const anchor = placed(100);
	controls.hold(anchor.el);
	/*
	 * 长高 500，而按住的那个只被推下 200——展开区一部分在它上方，一部分在它下方。
	 *
	 * 两个数字必须不一样，否则这条测试分不开对错：推下的量恰好等于长高的量时，「把锚点挪回原处」
	 * 和「一路滚到底」算出来是同一个 `scrollTop`，改坏了也照样绿。
	 */
	geometry.content += 500;
	anchor.move(300);
	await act(async () => controls.onResize(el));
	assert.equal(el.scrollTop, was + 200, "没有把它挪回按下时那个高度");
	assert.notEqual(el.scrollTop, bottom(), "跟随底部把读者带到末尾了——这正是那 1952px");
	await view.unmount();
});

test("按住的东西没被推动，也照样拦住跟随底部", async () => {
	const { view, el } = await open("held-still");
	const was = el.scrollTop;
	controls.hold(placed(100).el);
	// 在底部附近展开：锚点一动不动，`scrollHeight` 却撑大了。只看漂移就会漏掉这一种。
	geometry.content += 500;
	await act(async () => controls.onResize(el));
	assert.equal(el.scrollTop, was, "锚点没漂移不等于可以放跟随底部过去");
	await view.unmount();
});

test("自己滚开之后，手里那个锚就不算数了", async () => {
	const { view, el } = await open("held-then-scrolled");
	controls.hold(placed(100).el);
	await wheel(el, -120);
	geometry.content += 500;
	await act(async () => controls.onResize(el));
	assert.notEqual(el.scrollTop, bottom(), "滚上去的人不该被长高拽回底部");
	await view.unmount();
});

test("按住的元素已经不在页面上了，锚点作废", async () => {
	const { view, el } = await open("held-gone");
	const anchor = placed(100);
	controls.hold(anchor.el);
	anchor.el.remove();
	geometry.content += 500;
	await act(async () => controls.onResize(el));
	assert.equal(el.scrollTop, bottom(), "一个已经摘掉的锚不该再挡着跟随底部");
	await view.unmount();
});
