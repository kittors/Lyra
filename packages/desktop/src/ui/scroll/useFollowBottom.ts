/**
 * One scrolling surface's relationship with its own bottom.
 *
 * The rule is in `follow.ts` and is testable without a browser. What is here is everything that
 * needs a DOM: where the reader's intention is heard from, when the position is written, and how
 * the way back is animated.
 *
 * Three surfaces call this — the conversation, the side chat, a delegate's transcript — and before
 * it they each had their own near-copy. The copies had drifted: different slack, only one of them
 * watching for content resizing, only one offering a way back. Anything fixed in one stayed broken
 * in the other two, which is the actual reason this exists.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import {
	followsAfterRestore,
	isAway,
	isDegenerate,
	marker as makeMarker,
	nextState,
	targetScrollTop,
	unreadSince,
	visualBottom,
	type Direction,
	type FollowState,
	type Marker,
	type Reading,
} from "./follow.ts";
import { readFollow, writeFollow, type FollowSnapshot } from "./memory.ts";
import { motionReduced } from "../motion/reduced.ts";

/** How long the ride back down takes. The curve matches `--ly-e-out`, like everything else here. */
const GLIDE_MS = 420;
/**
 * 一次按下能按住多久的锚。
 *
 * 要盖住展开动画走完（`--ly-t-slow` 那一档）加上图片落位，又不能长到把后面一次无关的长高也
 * 按住。滚一下就作废，所以宁可稍长。
 */
const HOLD_MS = 900;
/**
 * 贴着底部时，内容长高了多少以内是「追过去」而不是「一步到位」。
 *
 * 回复写到底部时，每起一行转录长高一行（二十几像素）。从前每一次都当场把位置写到底，于是整段
 * 回复一顿一顿地往上顶，一行一顿。这么小的一截改成追：滑过去而不是跳过去，一行接一行连成一条平稳的
 * 上移，新的那行字也正在淡入，两者合在一起才是一条流。
 *
 * 更大的一块（一张工具卡、一段展开的输出）不用弹簧，按 `SWEEP_MS` 缓出滑过去：弹簧从静止起步，
 * 几百像素要追近半秒。超过一屏的（打开会话、一次倒进来一大篇）仍然一步到位，滑那么远是让人等。
 */
const CHASE_MAX = 200;
/** 比 `CHASE_MAX` 大、不超过一屏的长高，滑过去用多久。 */
const SWEEP_MS = 240;
/**
 * 追的快慢：一个临界阻尼的弹簧，这是它的角频率（每毫秒）。
 *
 * 不用「每帧缩掉剩下距离的一截」那种缓动：那样每起一行，速度从零一下跳到最大再慢慢降下来，一行
 * 一涌，量出来是每行开头一帧 7px、随后 3、2、1。弹簧带着速度走，上一行还没停稳下一行就来了，
 * 速度接着用，连起来是一条匀速的上移。
 *
 * 稳定输出时落后底部约 `2 × 速度 / ω`。慢的时候这点落后正好让每一行滑得软；快的时候固定的 ω 会
 * 越落越远——每秒上千字时量到最后一行被输入框压住近 30px。所以 ω 随最近的输出速度抬高，让落后
 * 保持在 `CHASE_LAG` 上下。速度取的是内容长高的速度，不是弹簧自己的速度：拿自己的速度定刚度会
 * 互相推高，一块大的长高第一帧就冲出去几百像素。
 */
const CHASE_OMEGA = 1 / 45;
/** 输出快时允许落后底部多少像素。转录底下本来留着十几像素的空白，落后在这以内，字不会被挡。 */
const CHASE_LAG = 12;
/** 输出速度按多长的时间窗来估。 */
const FLOW_TAU = 400;

export interface FollowBottom {
	/** Hand to `Scroller`'s `scrollRef`. */
	scrollRef: React.RefObject<HTMLDivElement | null>;
	/**
	 * Put at the very end of the scrolled content.
	 *
	 * This is what "you have seen the newest message" means, and it has to be an element rather
	 * than an arithmetic test: the reader who scrolls up two screens, reads the three paragraphs
	 * that arrived, and stops there has caught up, and no distance-from-bottom threshold can tell
	 * that apart from someone who has not.
	 *
	 * A callback rather than a ref object, and that is not a style choice. The transcript container
	 * is keyed on the session, so opening one — or a blank conversation acquiring its id after the
	 * first message — throws the whole subtree away and builds a new one. A ref object would be
	 * repointed at the new sentinel silently, leaving the observer watching a node that is no longer
	 * in the document and can therefore never intersect anything again. That is exactly what
	 * happened: the mark-as-read never fired once, so 「有新内容」 stayed lit forever.
	 */
	tailRef: (node: HTMLDivElement | null) => void;
	/** Whether to offer the way back. */
	away: boolean;
	/** How many messages arrived while the reader was away. Zero unless something really arrived. */
	unread: number;
	/** The reader asking to go back: the button, or having just sent something. */
	returnToBottom(instant?: boolean): void;
	/** Explicit navigation owns the scroll position even while a reply is streaming. */
	detach(): void;
	scrollTo(top: number, instant?: boolean): void;
	/** Hand to `Scroller`'s `onScroll`. */
	onScroll(el: HTMLDivElement): void;
	/** Hand to `Scroller`'s `onResize`. */
	onResize(el: HTMLDivElement): void;
	/**
	 * Hand to `Scroller`'s `onUserScroll`: the one gesture the viewport cannot hear for itself.
	 *
	 * The overlay scrollbar is drawn beside the viewport rather than inside it and moves the surface
	 * by assignment, so dragging the thumb produces no wheel, no touch and no key — only a scroll
	 * event, which by the rule in `follow.ts` may not detach anything. `Scroller` is the one place
	 * that knows a drag is a drag, so it says so, instead of leaving it to be inferred from the
	 * position afterwards along with everything else that moves a transcript.
	 */
	onUserScroll(direction: Direction): void;
	/**
	 * Hand to `Scroller`'s `onHold`: what the reader has just put a finger on.
	 *
	 * 展开一段折叠区会让转录长高，而长高本身分不清是「新消息到了」还是「读者点开了手里这一块」。
	 * 这一条就是那个区别：按下时记住按到的元素在视口的哪个高度，接下来这一次长高把它放回原处，
	 * 跟随底部让路。没有它，点开历史里的一个工具组会把读者直接甩到转录末尾。
	 */
	hold(target: EventTarget | null): void;
	/**
	 * Hand to `Scroller`'s `onSettle`: run inside the resize callback, before the frame is painted.
	 *
	 * 和 `onResize` 是同一件事的两半。这一半只改 `scrollTop`，所以能同步跑在 `ResizeObserver`
	 * 的回调里——展开动画每一帧都长高一点，修正晚一帧就是一串看得见的小抖。
	 */
	settle(el: HTMLDivElement): boolean;
}

export function useFollowBottom({
	surfaceId,
	count,
	tail,
	namespace,
	ready = true,
	live,
}: {
	/** Which conversation, side chat or delegate this is. `null` while there is nothing to show. */
	surfaceId: string | null;
	/** How many rows the transcript has. */
	count: number;
	/** Something that changes when the last row does — see `Marker`. */
	tail: string;
	/** Which family of surfaces to remember against; see `memory.ts`. */
	namespace: string;
	/** A restored offset is meaningful only after this surface's content has arrived. */
	ready?: boolean;
	/**
	 * Whether this transcript is being written right now. Only then is growth output, and only
	 * output is chased: at rest it is a card or an image landing late — the delivery card fetches
	 * its files after mount — and sliding for that drags the whole history up from below.
	 */
	live: boolean;
}): FollowBottom {
	const scrollRef = useRef<HTMLDivElement>(null);
	/*
	 * Held in state, so that a new sentinel re-runs the observer effect.
	 *
	 * The extra render this costs happens only when the element itself is replaced — a session
	 * swap — and it is the difference between the observer watching what is on screen and watching
	 * a detached node. Reading it out of a ref in an effect with an empty dependency list looked
	 * equivalent and was not.
	 */
	const [tailEl, setTailEl] = useState<HTMLDivElement | null>(null);
	const tailRef = useCallback((node: HTMLDivElement | null) => setTailEl(node), []);

	/*
	 * The state is a ref, not React state.
	 *
	 * It is read in a layout effect on every streamed token and written from a wheel handler; a
	 * re-render for either would be a re-render of the whole transcript. What has to be drawn is
	 * derived from it — `away` and `unread` below — and those change rarely.
	 */
	const state = useRef<FollowState>("following");
	const [away, setAway] = useState(false);
	const [unread, setUnread] = useState(0);

	/** What the reader has caught up to. Null means "everything", which is where a surface starts. */
	const seen = useRef<Marker | null>(null);
	/**
	 * The transcript as it stands, for the callbacks that run outside a render — the sentinel
	 * observer, mainly. Updated inside layout effects rather than during render, so a render React
	 * discards cannot leave a marker behind for a transcript that was never committed.
	 */
	const current = useRef<Marker>(makeMarker(count, tail));

	/**
	 * The last position this hook wrote, so the scroll event it causes is not mistaken for the
	 * reader moving. Cleared on the next frame — scroll events are dispatched before rAF, so
	 * anything still holding this value at that point never produced one.
	 */
	const written = useRef<number | null>(null);
	const lastTop = useRef(0);
	const glide = useRef(0);
	/** 贴底追赶的那一帧，和上一次送到底时内容与视口的高度——分辨「内容长高了一小截」要用。 */
	const chase = useRef(0);
	const size = useRef({ content: 0, view: 0 });
	/** 最近小幅长高的总量，按 `FLOW_TAU` 衰减；除以 `FLOW_TAU` 就是输出速度（像素/毫秒）。 */
	const flow = useRef({ amount: 0, at: 0 });
	/** 正在进行的一次缓出滑动：从哪儿、什么时候开始。终点是实时的底部。 */
	const sweep = useRef<{ from: number; at: number } | null>(null);
	const restoredSurface = useRef<string | null | undefined>(undefined);
	const selectedSurface = useRef<string | null | undefined>(undefined);
	const restore = useRef<FollowSnapshot | undefined>(undefined);
	const clearWritten = useRef(0);
	/** Read by `pin`, which is memoised and must not be rebuilt on every token. */
	const writing = useRef(live);
	writing.current = live;

	/**
	 * 手指上一次的位置，给 touchmove 定方向用。
	 *
	 * 触摸和滚轮不一样：`wheel` 自带 `deltaY`，`touchmove` 只给坐标，方向得自己算。手指往上抹，
	 * 内容跟着往上走，露出来的是更下面的东西——所以 clientY 变小是 "down"。
	 */
	const touchY = useRef(0);

	/*
	 * 刚被按下的那个东西，和它当时在视口里的高度。
	 *
	 * 展开一段折叠区会让转录长高，而长高会走 `onResize`——那里只问一句「在不在跟随底部」，在就
	 * 滚到底。于是点开一个历史里的折叠区，读者被直接带到转录末尾：量过一次「调用工具 42 个」，
	 * 点中的那个按钮当场飞出视口 1952px；「再显示 1 个文件」则是整段文字平移 36px。人说的「点
	 * 一下就在跳」就是这个。
	 *
	 * 按下时记住它的位置，长高之后把它放回原处——点开的那一段自然向下延展，手指底下的东西一动
	 * 不动。这是「跟随底部」唯一该让路的时候：读者正在看的是手里这一块，不是末尾。
	 */
	const anchor = useRef<{ el: HTMLElement; top: number; until: number } | null>(null);

	const read = (el: HTMLDivElement): Reading => ({
		scrollTop: el.scrollTop,
		scrollHeight: el.scrollHeight,
		clientHeight: el.clientHeight,
	});

	/** Move the surface, and remember that it was us. */
	const write = useCallback((el: HTMLDivElement, top: number) => {
		el.scrollTop = top;
		// Read back rather than trusting the assignment: the browser clamps, and comparing against
		// the clamped value is what makes the check in `onScroll` reliable on a transcript that has
		// just shrunk.
		written.current = el.scrollTop;
		lastTop.current = el.scrollTop;
		cancelAnimationFrame(clearWritten.current);
		clearWritten.current = requestAnimationFrame(() => {
			written.current = null;
		});
	}, []);

	/**
	 * 把锚点放回按下时那个高度。返回 true 表示这一次长高由锚点做主，跟随底部不要插手。
	 *
	 * 只碰 `scrollTop`，不碰任何 React 状态——它要能在 `ResizeObserver` 的回调里**同步**跑完。
	 * 那个回调发生在布局之后、绘制之前，是这一帧最后一次还来得及改位置的机会；推到 rAF 里就晚
	 * 了一帧，当帧已经拿旧位置画过一遍，展开动画走完就是肉眼可见的一串小抖（量到 14px）。
	 *
	 * 返回 true 的时机也是要点：不光锚点漂了要挪，**没漂也得拦住**跟随底部。一段在底部附近展开
	 * 的折叠区照样把 `scrollHeight` 撑大，不拦就被原样拉到底。
	 */
	const settle = useCallback(
		(el: HTMLDivElement): boolean => {
			const held = anchor.current;
			if (!held) return false;
			if (performance.now() > held.until || !held.el.isConnected) {
				anchor.current = null;
				return false;
			}
			/*
			 * 自己把它挪回去，不要指望浏览器原生的 scroll anchoring。
			 *
			 * 试过只拦不挪：展开一个大工具组（长高 952px）时原生锚定确实顶住了，一动不动；而展开
			 * 底部那张文件卡（36px）它整整漏掉 36px，按钮被推走多少就是多少。两种一起量才看得出
			 * 来——只测大的那个会得出「原生的就够了」这个错结论。
			 */
			const drift = held.el.getBoundingClientRect().top - held.top;
			if (Math.abs(drift) >= 1) write(el, el.scrollTop + drift);
			return true;
		},
		[write],
	);

	/** Redraw whatever is derived from where we are. */
	const publish = useCallback((reading: Reading) => {
		if (isDegenerate(reading)) return;
		// Only a reader who has settled somewhere above is offered the way back. Mid-glide the
		// button would be offering to do what is already happening.
		setAway(state.current === "detached" && isAway(reading));
	}, []);

	/**
	 * 跟随底部时把位置送到底：小幅长高用弹簧追，大一些的缓出滑过去，其余一步到位——见 `CHASE_MAX`。
	 *
	 * 两个入口共用它：内容签名变了（布局 effect）和尺寸变了（`onResize`），流式输出时两者每帧
	 * 都会来，所以「已经在追」本身就是继续追的理由，第二个入口不能把它打断成一步到位。
	 *
	 * 视口变了不追：输入框长高两行时，最后一行要立刻跟着让出来，不然会被输入框挡住一阵。
	 */
	const pin = useCallback(
		(el: HTMLDivElement) => {
			const reading = read(el);
			const grew = reading.scrollHeight - size.current.content;
			const known = size.current.content > 0;
			const sameView = reading.clientHeight === size.current.view;
			size.current = { content: reading.scrollHeight, view: reading.clientHeight };
			const now = performance.now();
			flow.current = {
				amount: flow.current.amount * Math.exp(-(now - flow.current.at) / FLOW_TAU) + (grew > 0 && grew <= CHASE_MAX ? grew : 0),
				at: now,
			};
			const target = targetScrollTop("following", reading);
			if (target === null) return;

			const moving = chase.current !== 0;
			const slide =
				writing.current && known && sameView && grew >= 0 && grew <= reading.clientHeight && target > reading.scrollTop && (moving || grew > 0) && !motionReduced();
			if (!slide) {
				cancelAnimationFrame(chase.current);
				chase.current = 0;
				sweep.current = null;
				write(el, target);
				return;
			}
			if (grew > CHASE_MAX) sweep.current = { from: reading.scrollTop, at: now };
			if (moving) return;

			// 位置自己记一份小数：浏览器会把 `scrollTop` 取整到物理像素，每帧挪不到半个像素的那几帧
			// 读回来原地不动，拿读回来的值接着算就永远差那一点。
			let position = reading.scrollTop;
			let velocity = 0;
			let last = 0;
			const step = (now: number) => {
				chase.current = 0;
				// 读者滚开了、按住了东西、或者换了会话：不追了。
				if (state.current !== "following" || anchor.current || !el.isConnected) {
					sweep.current = null;
					return;
				}
				const here = read(el);
				if (isDegenerate(here)) return;
				// 别人挪过（浏览器夹住、原生锚定），以实际位置为准。
				if (Math.abs(here.scrollTop - position) > 1) position = here.scrollTop;
				// 第一帧没有上一帧可比，按一帧算；切到后台回来的那一帧夹住，不一步跳完。
				const dt = last ? Math.min(50, Math.max(0, now - last)) : 16;
				last = now;
				const end = visualBottom(here);
				let next: number;
				const sliding = sweep.current;
				if (sliding) {
					// 三次缓出，和回到底部那一段同一条曲线；结束时速度是零，接回弹簧不会顿。
					const progress = Math.min(1, (now - sliding.at) / SWEEP_MS);
					next = (sliding.from - end) * (1 - progress) ** 3;
					velocity = 0;
					if (progress >= 1) sweep.current = null;
				} else {
					const rate = (flow.current.amount * Math.exp(-(now - flow.current.at) / FLOW_TAU)) / FLOW_TAU;
					const omega = Math.max(CHASE_OMEGA, (2 * rate) / CHASE_LAG);
					// 临界阻尼弹簧的精确解，步长再大也不会冲过头或者发散。
					const offset = position - end;
					const decay = Math.exp(-omega * dt);
					const pull = velocity + omega * offset;
					next = (offset + pull * dt) * decay;
					velocity = (velocity - omega * pull * dt) * decay;
				}
				if (next >= -0.5) {
					// 多写一个像素让浏览器夹到真正的底，理由见 `targetScrollTop`。
					write(el, end + 1);
					publish(read(el));
					return;
				}
				position = end + next;
				write(el, position);
				chase.current = requestAnimationFrame(step);
			};
			chase.current = requestAnimationFrame(step);
		},
		[write, publish],
	);

	// ---------------------------------------------------------------------------
	// The reader's intention
	// ---------------------------------------------------------------------------

	/**
	 * Everything that can change the state, in one place.
	 *
	 * Called from native listeners rather than React's synthetic events, because the whole point is
	 * to hear the gesture *before* the frame it causes: a wheel notch and a streamed token race
	 * each other, and losing that race is what made scrolling up during a reply feel like the wheel
	 * had stopped working.
	 */
	const intend = useCallback(
		(direction: Direction) => {
			const el = scrollRef.current;
			if (!el) return;
			const reading = read(el);
			const before = state.current;
			state.current = nextState(before, { kind: "user-scroll", direction }, reading);
			// Leaving `returning` for any reason means the ride is off.
			if (before === "returning" && state.current !== "returning") cancelAnimationFrame(glide.current);
			// 自己滚开了，手里那个锚就不是「正在看的东西」了。
			anchor.current = null;
			publish(reading);
		},
		[publish],
	);

	/*
	 * Three listeners, and every one of them hears a gesture with a name.
	 *
	 * What is *not* here is the point. There used to be `pointerdown` on the host and
	 * `pointermove`/`pointerup`/`pointercancel` on the window, feeding a "the reader has a hand on
	 * something" flag that let `onScroll` read a position change as a gesture. None of those is a
	 * scroll. `pointerup` on the window fires for a click on the sidebar, a button in a panel, the
	 * composer — the whole application — and each one opened a 300ms window in which the next reflow
	 * of a streaming turn ended the follow. `pointerdown` on the host was no better: it sits above
	 * the viewport, so expanding a tool card or selecting a line of text inside the transcript went
	 * through it too. And the flag had no way back if its `pointerup` was swallowed by a native
	 * context menu or lost to a window blur, at which point the surface detached on the next reflow
	 * and stayed that way.
	 *
	 * Dragging the thumb is the one real gesture they existed to catch, and `Scroller` now reports
	 * it through `onUserScroll`. So they are gone rather than narrowed.
	 */
	useEffect(() => {
		const el = scrollRef.current;
		if (!el) return;

		/** Whether a gesture landed on this surface rather than on one nested inside it. */
		const mine = (event: Event) =>
			!(event.target instanceof Element) || event.target.closest(".ly-scroll-view") === el;

		const onWheel = (event: WheelEvent) => {
			if (event.deltaY === 0) return;
			// A tool result or code block can scroll independently inside the transcript.
			if (!mine(event)) return;
			intend(event.deltaY < 0 ? "up" : "down");
		};
		// A finger down is a claim on the surface before it has moved at all.
		const onTouchStart = (event: TouchEvent) => {
			if (!mine(event)) return;
			touchY.current = event.touches[0]?.clientY ?? 0;
			intend("unknown");
		};
		const onTouchMove = (event: TouchEvent) => {
			if (!mine(event)) return;
			const y = event.touches[0]?.clientY;
			if (y === undefined) return;
			const moved = y - touchY.current;
			touchY.current = y;
			// A finger held still is not a direction; anything else is, however small.
			if (moved === 0) return;
			intend(moved > 0 ? "up" : "down");
		};
		/*
		 * Keys arrive here by bubbling, not by focus.
		 *
		 * The viewport carries no `tabIndex` and never holds focus itself — but it is an ancestor of
		 * everything in the transcript, so `PageUp` pressed while a tool card's expander has focus
		 * passes through, and that is a scroll like any other. Fields are excluded because in one
		 * the same keys move a caret instead.
		 */
		const onKey = (event: KeyboardEvent) => {
			if (event.target instanceof Element && event.target.closest("textarea, input, [contenteditable=true]")) return;
			if (!["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(event.key)) return;
			intend(["ArrowUp", "PageUp", "Home"].includes(event.key) || (event.key === " " && event.shiftKey) ? "up" : "down");
		};

		// Passive: none of them is prevented, and saying so keeps the wheel off the main thread's
		// critical path.
		el.addEventListener("wheel", onWheel, { passive: true });
		el.addEventListener("touchstart", onTouchStart, { passive: true });
		el.addEventListener("touchmove", onTouchMove, { passive: true });
		el.addEventListener("keydown", onKey);
		return () => {
			el.removeEventListener("wheel", onWheel);
			el.removeEventListener("touchstart", onTouchStart);
			el.removeEventListener("touchmove", onTouchMove);
			el.removeEventListener("keydown", onKey);
		};
	}, [intend]);

	// ---------------------------------------------------------------------------
	// What the scroller reports
	// ---------------------------------------------------------------------------

	const onScroll = useCallback(
		(el: HTMLDivElement) => {
			if (!ready || restoredSurface.current !== surfaceId) return;
			const reading = read(el);
			lastTop.current = reading.scrollTop;

			if (isDegenerate(reading)) return;

			// Our own write, arriving as an event. It says nothing about what the reader wants.
			if (written.current !== null && Math.abs(reading.scrollTop - written.current) < 1) {
				written.current = null;
				publish(reading);
				return;
			}

			/*
			 * Everything else that moved the surface, treated as one thing — because here it is one
			 * thing.
			 *
			 * The tail of a fling, the browser clamping a transcript that just lost its oldest run,
			 * anchoring holding a line still while a thinking block folds open above it: by the time
			 * they reach this handler they are a position and nothing else. `arrived` is the only
			 * honest claim to make from that, and it can only put the surface back on the end, never
			 * take it off. Gestures are heard where they happen, in `intend`.
			 */
			state.current = nextState(state.current, { kind: "arrived" }, reading);
			publish(reading);
		},
		[publish, ready, surfaceId],
	);

	/**
	 * The box or its contents changed size.
	 *
	 * This is the callback the side chat and the delegate panel never had, and the one the
	 * conversation only used to update a flag with. Following has to be *applied* here, not merely
	 * re-tested: the composer growing by two lines moves the bottom without moving the content, and
	 * a surface that only re-tests concludes the reader has wandered off.
	 */
	const onResize = useCallback(
		(el: HTMLDivElement) => {
			if (!ready || selectedSurface.current !== surfaceId) return;
			const reading = read(el);
			if (isDegenerate(reading)) return;
			if (restoredSurface.current !== surfaceId) {
				restoredSurface.current = surfaceId;
				if (state.current === "detached" && restore.current) write(el, restore.current.scrollTop);
			}
			// 手里按着东西的时候，跟随底部让路——细节见 `settle`。
			if (settle(el)) {
				publish(read(el));
				return;
			}
			if (state.current === "following") pin(el);
			publish(read(el));
		},
		[publish, write, ready, surfaceId, settle, pin],
	);

	/**
	 * 按在转录上的那一下：记住按到的是谁，以及它此刻在视口的哪个高度。
	 *
	 * 挂在捕获阶段，比任何 `onClick` 都早——展开的那一帧要用的是**按下时**的位置，等到点击冒泡
	 * 上来，布局可能已经变了。
	 *
	 * 不挑按钮也不挑元素：不改变高度的点击根本不会走到 `onResize`，锚点在超时后自己过期，什么
	 * 也不会发生。挑，反而要在这里重写一遍「哪些东西点了会变高」，而那份名单一定会漏。
	 */
	const hold = useCallback((target: EventTarget | null) => {
		if (!(target instanceof HTMLElement)) return;
		anchor.current = { el: target, top: target.getBoundingClientRect().top, until: performance.now() + HOLD_MS };
	}, []);

	// ---------------------------------------------------------------------------
	// Going back
	// ---------------------------------------------------------------------------

	const returnToBottom = useCallback((instant = false) => {
		const el = scrollRef.current;
		if (!el) return;
		const reading = read(el);
		if (isDegenerate(reading)) return;

		cancelAnimationFrame(glide.current);
		state.current = nextState(state.current, { kind: "user-return" }, reading);

		const land = () => {
			const settled = read(el);
			// A pixel past the end, for the reason spelled out in `targetScrollTop`: the integer
			// bottom is up to a pixel short of the real one, and landing short is what the ride back
			// would leave behind — the same sub-pixel gap the follow writes were leaving.
			write(el, visualBottom(settled) + 1);
			state.current = nextState(state.current, { kind: "settle" }, settled);
			seen.current = current.current;
			setUnread(0);
			publish(read(el));
		};

		// Sending a message is a snap, not a 420ms flight: the glide from a collapsed window
		// was the second half of the send-time bounce. Already there, or asked not to be moved
		// around, lands the same way. Either way the unread mark still clears.
		if (instant || state.current !== "returning" || motionReduced()) {
			land();
			return;
		}

		const from = reading.scrollTop;
		const started = performance.now();
		const step = (now: number) => {
			// Interrupted: `intend` has already taken the state away and cancelled the frame, but a
			// frame already scheduled can still arrive.
			if (state.current !== "returning") return;
			const progress = Math.min(1, (now - started) / GLIDE_MS);
			const eased = 1 - (1 - progress) ** 3;
			// Re-read every frame: a reply still streaming grows the page underneath the animation,
			// so a target fixed at the start arrives somewhere that is no longer the end.
			const target = visualBottom(read(el));
			write(el, from + (target - from) * eased);
			if (progress < 1) {
				glide.current = requestAnimationFrame(step);
				return;
			}
			land();
		};
		glide.current = requestAnimationFrame(step);
		setAway(false);
	}, [publish, write]);

	useEffect(() => () => {
		cancelAnimationFrame(glide.current);
		cancelAnimationFrame(chase.current);
		cancelAnimationFrame(clearWritten.current);
	}, []);

	// ---------------------------------------------------------------------------
	// Catching up
	// ---------------------------------------------------------------------------

	/*
	 * Seeing the end is what marks it read — not being at the bottom.
	 *
	 * Scrolling up two screens to read what arrived and stopping there is catching up, and no
	 * distance test can tell it from not having caught up. The sentinel is the last thing in the
	 * content, so it entering the viewport is the fact itself rather than a proxy for it.
	 */
	useEffect(() => {
		const root = scrollRef.current;
		if (!root || !tailEl) return;
		const observer = new IntersectionObserver(
			(entries) => {
				if (!entries.some((entry) => entry.isIntersecting)) return;
				seen.current = current.current;
				setUnread(0);
			},
			{ root },
		);
		observer.observe(tailEl);
		return () => observer.disconnect();
	}, [tailEl]);

	// ---------------------------------------------------------------------------
	// Swapping what the surface shows
	// ---------------------------------------------------------------------------

	/**
	 * Declared before the effect that follows the bottom, because it must run before it.
	 *
	 * React runs layout effects in declaration order, and getting this the wrong way round is the
	 * bug that made the remembered position useless: the follow effect ran first, wrote the
	 * *outgoing* surface's position into the *incoming* surface's memory, and the restore then
	 * faithfully read back what had just been written.
	 *
	 * Saving happens in the cleanup rather than at the top of the next run. Cleanups run after the
	 * DOM has been updated but before any layout effect has touched `scrollTop`, so what is read
	 * there is still the outgoing surface's position — and, unlike a check against a remembered
	 * previous id, it also fires when the component unmounts, which is what switching to the pull
	 * request view does to the whole transcript.
	 */
	useLayoutEffect(() => {
		cancelAnimationFrame(glide.current);
		cancelAnimationFrame(chase.current);
		chase.current = 0;
		sweep.current = null;
		size.current = { content: 0, view: 0 };
		cancelAnimationFrame(clearWritten.current);
		written.current = null;
		touchY.current = 0;
		restoredSurface.current = undefined;
		selectedSurface.current = surfaceId;
		current.current = makeMarker(count, tail);
		restore.current = surfaceId ? readFollow(namespace, surfaceId) : undefined;
		state.current = restore.current?.following === false ? "detached" : "following";
		seen.current = restore.current?.seen ?? null;
		setUnread(0);
		setAway(false);

		return () => {
			// A glide belongs to the outgoing surface. Its intention is saved below, while its frames
			// must stop before the incoming surface reuses the same state and element refs.
			cancelAnimationFrame(glide.current);
			cancelAnimationFrame(chase.current);
			chase.current = 0;
			/*
			 * The position comes from `lastTop`, not from the element.
			 *
			 * Two reasons, and the second one is not obvious. React detaches a child's ref before it
			 * runs the parent's layout cleanup, so on unmount `scrollRef.current` is already null here
			 * — and unmounting is exactly what happens to the whole transcript when the pane switches
			 * to the pull request view. And a reading taken while the pane is merely hidden reports
			 * zero, which if stored would put the reader at the top of the transcript next time they
			 * opened it. `lastTop` is written by every scroll and every write we make, and never by a
			 * degenerate measurement, so it is the last position this surface was actually at.
			 */
			// A loading placeholder must never replace a real reading position.
			if (!surfaceId || restoredSurface.current !== surfaceId) return;
			writeFollow(namespace, surfaceId, {
				following: followsAfterRestore(state.current),
				scrollTop: lastTop.current,
				seen: seen.current,
			} satisfies FollowSnapshot);
		};
		// `count` and `tail` are read for the marker but deliberately not depended on: this effect is
		// about the surface changing, and re-running it on every token would re-read the memory and
		// undo the reader's position.
		// oxlint-disable-next-line exhaustive-deps
	}, [surfaceId, namespace, publish, write]);

	/**
	 * Content changed: follow it, or count it.
	 *
	 * The count is computed rather than incremented, from two numbers that describe the transcript
	 * rather than its identity. Opening a session hands React the same messages twice — once from
	 * the cache, once when the disk read lands — and an unread flag driven by identity called the
	 * second one new content. That is the 「有新内容」 that appears on a conversation you have
	 * merely revisited.
	 */
	useLayoutEffect(() => {
		current.current = makeMarker(count, tail);
		const el = scrollRef.current;
		if (!el || !ready) return;
		const reading = read(el);
		if (isDegenerate(reading)) return;
		if (restoredSurface.current !== surfaceId) {
			restoredSurface.current = surfaceId;
			if (state.current === "detached" && restore.current) write(el, restore.current.scrollTop);
		}

		if (state.current === "following") {
			pin(el);
			seen.current = current.current;
			setUnread(0);

		} else {
			setUnread(unreadSince(seen.current, current.current));
		}
		publish(read(el));
	}, [count, tail, publish, write, ready, surfaceId, pin]);

	const detach = useCallback(() => {
		cancelAnimationFrame(glide.current);
		state.current = "detached";
	}, []);
	const scrollTo = useCallback((top: number, instant = false) => {
		detach();
		const el = scrollRef.current;
		if (!el) return;
		const target = Math.max(0, Math.min(top, el.scrollHeight - el.clientHeight));
		if (instant || motionReduced()) {
			write(el, target);
			publish(read(el));
			return;
		}
		// Native smooth scroll takes over a second across long answers; navigation shares the
		// app's bounded glide and its cancellation on input, unmount and session selection.
		const from = el.scrollTop;
		const started = performance.now();
		const step = (now: number) => {
			const progress = Math.min(1, (now - started) / GLIDE_MS);
			write(el, from + (target - from) * (1 - (1 - progress) ** 3));
			publish(read(el));
			if (progress < 1) glide.current = requestAnimationFrame(step);
		};
		glide.current = requestAnimationFrame(step);
	}, [detach, publish, write]);
	return { scrollRef, tailRef, away, unread, returnToBottom, onScroll, onResize, onUserScroll: intend, detach, scrollTo, hold, settle };
}
