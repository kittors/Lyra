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

/** How long the ride back down takes. The curve matches `--ly-e-out`, like everything else here. */
const GLIDE_MS = 420;

/**
 * 一次输入之后，多久之内到达的滚动还算是它引起的。
 *
 * 拖滚动条的时候 `pointermove` 一直在发，这个数只需要盖住两次移动之间的空档；甩惯性则是 `wheel`
 * 起的头，第一下就已经改了状态，后面跟不跟得上都无所谓。300ms 是宽裕的余量，同时短到浏览器自己
 * 挪的那一下——它总是紧跟着内容变化，而不是紧跟着一个手势——落在窗口之外。
 */
const INPUT_GRACE_MS = 300;

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
	returnToBottom(): void;
	/** Hand to `Scroller`'s `onScroll`. */
	onScroll(el: HTMLDivElement): void;
	/** Hand to `Scroller`'s `onResize`. */
	onResize(el: HTMLDivElement): void;
}

export function useFollowBottom({
	surfaceId,
	count,
	tail,
	namespace,
	ready = true,
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
	const restoredSurface = useRef<string | null | undefined>(undefined);
	const selectedSurface = useRef<string | null | undefined>(undefined);
	const restore = useRef<FollowSnapshot | undefined>(undefined);
	const clearWritten = useRef(0);

	/**
	 * 最近一次确实来自人的动作，以及手指/鼠标是不是还按着。
	 *
	 * 这两个存在，是因为「滚动位置变了」和「读者想看别处」根本不是一回事——而下面 `onScroll` 里
	 * 靠位置差推方向的那段，曾经把两者当成一回事。
	 *
	 * 浏览器的滚动锚定就是这么被误伤的：文稿区特意留着锚定（上面的思考块展开时，你正在读的那行
	 * 不该跟着跑），而锚定做这件事的手段就是改 `scrollTop`。于是上方一块内容收起来——收一个工具
	 * 组、合一个思考块、流式渲染时重排一次——浏览器把 scrollTop 往回挪，`onScroll` 读到位置变小，
	 * 判定「用户往上滚了」，跟随就此断掉。量过：上方从 600px 缩到 200px，scrollTop 从 1200 变
	 * 800，一个 scroll 事件，方向朝上。人什么都没做。
	 *
	 * 所以位置差只在最近确实有输入时才作数。没有输入的位置变化是浏览器自己挪的，它不说明任何意图。
	 */
	const lastInput = useRef(0);
	const dragging = useRef(false);

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

	/** Redraw whatever is derived from where we are. */
	const publish = useCallback((reading: Reading) => {
		if (isDegenerate(reading)) return;
		// Only a reader who has settled somewhere above is offered the way back. Mid-glide the
		// button would be offering to do what is already happening.
		setAway(state.current === "detached" && isAway(reading));
	}, []);

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
			publish(reading);
		},
		[publish],
	);

	useEffect(() => {
		const el = scrollRef.current;
		if (!el) return;

		const mark = () => {
			lastInput.current = performance.now();
		};

		const onWheel = (event: WheelEvent) => {
			if (event.deltaY === 0) return;
			// A tool result or code block can scroll independently inside the transcript.
			if (event.target instanceof Element && event.target.closest(".ly-scroll-view") !== el) return;
			mark();
			intend(event.deltaY < 0 ? "up" : "down");
		};
		// A finger down is a claim on the surface before it has moved at all.
		const onTouch = () => {
			mark();
			intend("unknown");
		};

		/*
		 * 按下就算在操作，抬起才算结束。
		 *
		 * 拖滚动条只会以 scroll 事件的形式到达——没有 wheel，也没有 touch。按住的这段时间里每一次
		 * 位置变化都是这只手造成的，所以不看时间窗，直接认。
		 *
		 * 抬起听的是 window：滑块拖到容器外面松手是常事，只听容器会把标记永远留在按下的状态。
		 */
		const onDown = () => {
			dragging.current = true;
			mark();
		};
		const onKey = (event: KeyboardEvent) => {
			if (event.target instanceof Element && event.target.closest("textarea, input, [contenteditable=true]")) return;
			if (!["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(event.key)) return;
			mark();
			intend(["ArrowUp", "PageUp", "Home"].includes(event.key) || (event.key === " " && event.shiftKey) ? "up" : "down");
		};
		const onUp = () => {
			dragging.current = false;
			mark();
		};
		const onMove = (event: PointerEvent) => {
			if (event.buttons !== 0) mark();
		};

		/*
		 * Keys are not listened for here, and that is not an oversight.
		 *
		 * The viewport carries no `tabIndex`, so it never holds focus and never receives a key
		 * event; a listener would be dead code that reads as coverage. Making `End` and `PageUp`
		 * work means making the transcript focusable first, which is a separate change with its own
		 * consequences for the tab order.
		 */
		// Passive: neither is prevented, and saying so keeps the wheel off the main thread's
		// critical path.
		el.addEventListener("wheel", onWheel, { passive: true });
		el.addEventListener("touchstart", onTouch, { passive: true });
		el.addEventListener("touchmove", mark, { passive: true });
		// The overlay thumb is a sibling of the viewport, so its gesture belongs to the host.
		const host = el.parentElement;
		host?.addEventListener("pointerdown", onDown, { passive: true });
		el.addEventListener("keydown", onKey);
		window.addEventListener("pointermove", onMove, { passive: true });
		window.addEventListener("pointerup", onUp, { passive: true });
		window.addEventListener("pointercancel", onUp, { passive: true });
		return () => {
			el.removeEventListener("wheel", onWheel);
			el.removeEventListener("touchstart", onTouch);
			el.removeEventListener("touchmove", mark);
			host?.removeEventListener("pointerdown", onDown);
			el.removeEventListener("keydown", onKey);
			window.removeEventListener("pointermove", onMove);
			window.removeEventListener("pointerup", onUp);
			window.removeEventListener("pointercancel", onUp);
		};
	}, [intend]);

	// ---------------------------------------------------------------------------
	// What the scroller reports
	// ---------------------------------------------------------------------------

	const onScroll = useCallback(
		(el: HTMLDivElement) => {
			if (!ready || restoredSurface.current !== surfaceId) return;
			const reading = read(el);
			const previous = lastTop.current;
			lastTop.current = reading.scrollTop;

			if (isDegenerate(reading)) return;

			// Our own write, arriving as an event. It says nothing about what the reader wants.
			if (written.current !== null && Math.abs(reading.scrollTop - written.current) < 1) {
				written.current = null;
				publish(reading);
				return;
			}

			/*
			 * A backstop for the gestures the listeners above cannot name.
			 *
			 * Dragging the scrollbar thumb and a trackpad's inertia both arrive only as scroll
			 * events. The direction is recoverable from the movement, and that is enough: upwards
			 * detaches, downwards re-attaches on arrival. The wheel listener is still worth having
			 * because it fires earlier — this is correctness, that is timing.
			 *
			 * Skipped while gliding: every frame of the ride writes `scrollTop`, and only some of
			 * those writes are still holding `written` by the time their event lands.
			 */
			/*
			 * 只有确实有人在操作时，位置差才说明方向。
			 *
			 * 没有这个前提，浏览器的滚动锚定就会冒充读者：它挪一次 scrollTop，这里读成「往上滚」，
			 * 跟随立刻断掉——而收起一个工具组就足以触发。见上面 `lastInput` 那段。
			 */
			const byHand = dragging.current || performance.now() - lastInput.current < INPUT_GRACE_MS;
			if (state.current !== "returning" && reading.scrollTop !== previous && byHand) {
				const direction: Direction = reading.scrollTop < previous ? "up" : "down";
				state.current = nextState(state.current, { kind: "user-scroll", direction }, reading);
			}

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
			const target = targetScrollTop(state.current, reading);
			if (target !== null) write(el, target);
			publish(read(el));
		},
		[publish, write, ready, surfaceId],
	);

	// ---------------------------------------------------------------------------
	// Going back
	// ---------------------------------------------------------------------------

	const returnToBottom = useCallback(() => {
		const el = scrollRef.current;
		if (!el) return;
		const reading = read(el);
		if (isDegenerate(reading)) return;

		cancelAnimationFrame(glide.current);
		state.current = nextState(state.current, { kind: "user-return" }, reading);

		const land = () => {
			const settled = read(el);
			write(el, visualBottom(settled));
			state.current = nextState(state.current, { kind: "settle" }, settled);
			seen.current = current.current;
			setUnread(0);
			publish(read(el));
		};

		// Already there, or asked not to be moved around. Either way the unread mark still clears.
		if (state.current !== "returning" || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
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
		cancelAnimationFrame(clearWritten.current);
		written.current = null;
		dragging.current = false;
		lastInput.current = -Infinity;
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
			const target = targetScrollTop("following", reading);
			if (target !== null) write(el, target);
			seen.current = current.current;
			setUnread(0);

		} else {
			setUnread(unreadSince(seen.current, current.current));
		}
		publish(read(el));
	}, [count, tail, publish, write, ready, surfaceId]);

	return { scrollRef, tailRef, away, unread, returnToBottom, onScroll, onResize };
}
