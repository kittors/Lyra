/**
 * Fullscreen in-place screenshot overlay, drawn with the app's own annotator.
 *
 * Two coordinate spaces meet here and it is worth being explicit about which is which. The
 * selection and every pointer event are in CSS pixels, because that is what the overlay window is
 * measured in. The annotator works in the snapshot's own pixels, which on a Retina screen are twice
 * as many. `AnnotateCanvas` is therefore given an explicit CSS size — the display it is standing
 * on, at 1:1 — rather than being allowed to lay out at its bitmap's size, which would cover twice
 * the area it is meant to.
 *
 * The annotator is handed the *whole* snapshot, not a crop of the selection, and the selected
 * region is a window onto it: an absolutely positioned frame with the full-size canvas shifted
 * underneath it by the selection's own offset. That is what keeps marks anchored to the thing they
 * were drawn on when the selection is moved or resized afterwards — a crop would have to be
 * retaken on every drag, and every mark on it would slide.
 */

import { Check } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ScreenshotSettings } from "@lyra/core";
import {
	AnnotateCanvas,
	AnnotateToolbar,
	useAnnotator,
} from "./Annotator.tsx";
import { ScreenshotLoupe, type LoupeReading } from "./ScreenshotLoupe.tsx";
import { bridge } from "../../services/index.ts";
import {
	clampRect,
	handlePoint,
	hitHandle,
	insideRect,
	moveRect,
	rectFromPoints,
	resizeRect,
	toolbarPosition,
	HANDLES,
	HANDLE_CURSOR,
	type Handle,
	type Point,
	type Rect,
} from "./screenshot-geometry.ts";

const HANDLE_GRAB = 10;
const TOOLBAR_SIZE = { width: 660, height: 48 };
const MIN_SELECTION = 10;
/**
 * How wide the band around the selection's edge is that picks the whole region up.
 *
 * While annotating, the inside of the selection belongs to the pen: a press there draws. The
 * region still has to be movable, so the grab is the border itself — the same place the eye
 * already reads as the edge of the shot, and the same convention every other capture tool uses.
 */
/**
 * How wide the frame's edge is to grab, in display pixels.
 *
 * Was 8, which is narrower than the border it sits on looks and had to be aimed at. Fourteen is
 * about the width of a window's resize edge on this platform, and the mark it decorates is only
 * 1px — the grab area is meant to be generous where the drawing is precise.
 */
const EDGE_GRAB = 14;

/**
 * How tall the size-and-colour bubble is, including the gap above it.
 *
 * A constant rather than a measurement: it is only needed to decide which side of the region the
 * toolbar goes on, that decision has to be made before the bubble exists, and the bubble is one
 * row of 22px controls in a 4px-padded box — a number that changes only if that row is redesigned.
 */
const PROPERTIES_HEIGHT = 34;
/**
 * How long the dimming takes to arrive, and to leave.
 *
 * Short enough not to be a wait before you can drag, long enough to read as a transition rather
 * than a jump — the complaint being answered is a capture that appears all at once.
 */
const ENTER_MS = 160;
const LEAVE_MS = 120;
/**
 * How long 「已复制色值」 stays up *after* the capture has gone, and how long it takes to go itself.
 *
 * It outlives the overlay's contents on purpose. The colour is on the clipboard and there is nothing
 * left to frame, so the capture leaves at once — the same 120ms Escape takes — and the confirmation
 * is left sitting over the real desktop for long enough to read, which is what it is for.
 */
const TOAST_MS = 700;
const TOAST_FADE_MS = 200;

interface ScreenshotInit {
	/**
	 * The screen, as raw RGBA pixels.
	 *
	 * Not an encoded image: PNG-encoding a 2940×1912 screen in the main process so it could be
	 * decoded again here measured 133ms, and it was the biggest thing Lyra itself added to the wait
	 * before a capture appears. That wait is what makes the desktop appear to jump — the picture is
	 * taken at the start of it, so anything that moves on screen while it runs is undone in one
	 * frame when the overlay lands on top.
	 */
	snapshot: { pixels: Uint8Array; width: number; height: number };
	/**
	 * Which capture this is.
	 *
	 * The overlay is one page for the life of the app — shown and hidden rather than built and torn
	 * down, because building it took 147ms that the capture could see. So "a new capture has begun"
	 * is not something this page can work out for itself: it did not just load, and the picture is
	 * no help either, since two captures of an unchanged screen are byte-identical.
	 */
	session: number;
	bounds: { x: number; y: number; width: number; height: number };
	scaleFactor: number;
	/** On-screen windows, front to back, already in this overlay's coordinates. */
	windows?: (Rect & { app: string })[];
	/** Where the pointer already was, so a window is offered before the mouse moves. */
	cursor?: Point;
	settings?: ScreenshotSettings;
}

/**
 * The window under the pointer, which is the first one that contains it.
 *
 * Front to back is the order the Window Server returns them in, and it is the same order a click
 * would resolve — so what highlights is what you would have hit.
 */
function windowAt(windows: (Rect & { app: string })[] | undefined, at: Point): (Rect & { app: string }) | null {
	return windows?.find((w) => insideRect(w, at)) ?? null;
}

type DragMode =
	| { kind: "none" }
	| { kind: "creating"; from: Point }
	| { kind: "moving"; from: Point; origin: Rect }
	| { kind: "resizing"; handle: Handle; origin: Rect };

/** Whether a point is on the selection's border rather than out in the middle of it. */
function onEdge(rect: Rect, at: Point, tolerance: number): boolean {
	if (!insideRect(rect, at)) return false;
	return (
		at.x - rect.x <= tolerance ||
		rect.x + rect.width - at.x <= tolerance ||
		at.y - rect.y <= tolerance ||
		rect.y + rect.height - at.y <= tolerance
	);
}

export function ScreenshotOverlay() {
	const [initData, setInitData] = useState<ScreenshotInit | null>(null);
	const [selection, setSelection] = useState<Rect | null>(null);
	const [dragMode, setDragMode] = useState<DragMode>({ kind: "none" });
	const [cursor, setCursor] = useState("crosshair");
	const [isAnnotating, setIsAnnotating] = useState(false);

	const bgCanvasRef = useRef<HTMLCanvasElement | null>(null);
	/**
	 * The window the pointer is over, before a region has been drawn.
	 *
	 * Offering whole windows is most of what makes a capture quick: the common case is "this
	 * window", and dragging a rectangle around one by hand is both slower and less accurate than
	 * the window's own bounds. It stops mattering the moment a region exists — from then on the
	 * region is what is being adjusted.
	 */
	const [hoverWindow, setHoverWindow] = useState<(Rect & { app: string }) | null>(null);

	/**
	 * Where the pointer is and what is under it, for the loupe.
	 *
	 * Kept until a region exists: once there is something to annotate, a magnifier following the
	 * pointer is in the way of the drawing rather than in aid of it.
	 */
	const [pointer, setPointer] = useState<Point | null>(null);
	const [reading, setReading] = useState<LoupeReading | null>(null);
	const [copied, setCopied] = useState(false);

	/** The toolbar's measured size, so it is kept on screen against what it really is. */
	const [toolbarSize, setToolbarSize] = useState<{ width: number; height: number } | null>(null);
	const measureToolbar = useCallback((el: HTMLDivElement | null) => {
		if (!el) return;
		const r = el.getBoundingClientRect();
		if (!r.width || !r.height) return;
		setToolbarSize((was) =>
			was && Math.abs(was.width - r.width) < 1 && Math.abs(was.height - r.height) < 1
				? was
				: { width: Math.ceil(r.width), height: Math.ceil(r.height) },
		);
	}, []);

	/*
	 * The whole screen, decoded once.
	 *
	 * The frozen backdrop below and the annotator both need this bitmap, and `useAnnotator` already
	 * loads it — so the backdrop is painted from *its* image rather than decoding the same data URL
	 * a second time. On a 5K display that is several megabytes and a visible fraction of the delay
	 * before the overlay can be shown at all.
	 */
	const annotator = useAnnotator(initData?.snapshot ?? null, { session: initData?.session });
	const { ready: snapshotReady, image: snapshotImage } = annotator;

	/*
	 * The frozen screen, at the resolution it was captured at.
	 *
	 * The backing store is the snapshot's own pixel count, not the display's logical size: sized
	 * logically, a Retina capture is squeezed to half resolution and then stretched back over the
	 * screen, and the first thing the user sees on pressing the shortcut is their desktop going
	 * blurry.
	 */
	useEffect(() => {
		if (!initData || !snapshotReady) return;
		const img = snapshotImage.current;
		const canvas = bgCanvasRef.current;
		if (!img || !canvas) return;
		const ctx = canvas.getContext("2d");
		if (!ctx) return;

		canvas.width = img.width;
		canvas.height = img.height;
		ctx.drawImage(img.source, 0, 0);

		/*
		 * The numbers that decide whether the frozen picture matches the screen under it.
		 *
		 * The backdrop is stretched to fill the window, so if the snapshot's aspect ratio differs
		 * from the display's — even slightly — everything in it shifts, and the capture opens looking
		 * like the whole desktop moved. `desktopCapturer` scales its thumbnail to *fit* what it is
		 * asked for and does not promise to return that size, which is exactly how that happens.
		 */
		const rect = canvas.getBoundingClientRect();
		bridge.screenshot?.debug?.("backdrop painted", {
			snapshot: { w: img.width, h: img.height, aspect: img.width / img.height },
			window: { w: window.innerWidth, h: window.innerHeight, aspect: window.innerWidth / window.innerHeight, dpr: window.devicePixelRatio },
			canvasCss: { w: Math.round(rect.width), h: Math.round(rect.height) },
			bounds: initData.bounds,
			stretched:
				Math.abs(img.width / img.height - window.innerWidth / window.innerHeight) > 0.001,
			screen: { w: screen.width, h: screen.height, availH: screen.availHeight },
		});

		/*
		 * Said straight away, and deliberately not after a `requestAnimationFrame`.
		 *
		 * Waiting for a frame would be the more careful-looking thing to do and it deadlocks: the
		 * window this runs in is hidden until this very message arrives, a hidden page is not
		 * composited, and a rAF callback in one never runs. The overlay would appear 1.5 seconds
		 * later off the failsafe timer, every time. It is also unnecessary — `drawImage` has already
		 * written the snapshot into the canvas's bitmap, so the first frame after `show()` has it.
		 */
		bridge.screenshot?.ready?.();
	}, [initData, snapshotReady, snapshotImage]);

	/*
	 * The way in and the way out, as a fade rather than a cut.
	 *
	 * The frozen snapshot is not what fades — it is a picture of the screen it is covering, so
	 * showing it instantly is invisible by construction. What fades is the dimming and the hint,
	 * which is the part that says "you are in capture mode now": the screen darkens over a beat
	 * instead of the whole thing arriving in one frame.
	 *
	 * `entered` is driven by the main process rather than by a mount effect, because until the
	 * window is shown this page is not composited and a transition started here has no frames to
	 * run in — it would land on its end state immediately, which is the abruptness being removed.
	 */
	const [entered, setEntered] = useState(false);
	const [leaving, setLeaving] = useState(false);
	/** Whether the colour-pick confirmation is on its way out. See `leaveWithToast`. */
	const [toastLeaving, setToastLeaving] = useState(false);

	useEffect(() => {
		const cleanup = bridge.screenshot?.onShown?.(() => {
			setEntered(true);
			bridge.screenshot?.debug?.("shown", {
				window: { w: window.innerWidth, h: window.innerHeight },
				screen: { w: screen.width, h: screen.height },
				at: Math.round(performance.now()),
			});
			/*
			 * Say when a frame actually exists, which is what the window is waiting for to become
			 * visible at all.
			 *
			 * The window is up but transparent at this point. Its GPU surface was released while it
			 * was hidden and is being rebuilt; shown before that finishes, what the window server puts
			 * up is the old surface stretched to the new size — the capture appearing to scale for an
			 * instant. `ready` cannot stand in for this: it fires when the snapshot has been written
			 * into the canvas's bitmap, which is CPU-side and happens while the window is still hidden.
			 *
			 * Two frames deep on purpose. The first callback runs *before* the frame it belongs to is
			 * composited; the second is scheduled from inside that frame, so by the time it runs one
			 * has been through. Animation frames work here where they would not in `ready`, because
			 * the window is on screen — invisible, but composited.
			 */
			/*
			 * One frame, then let the window be seen.
			 *
			 * The window is up but transparent until this runs. It is a cheap guarantee that what
			 * becomes visible is a page that has drawn, rather than one that is about to — measured at
			 * 4-15ms, so it costs a frame and no more.
			 *
			 * It was two frames, on the theory that a window hidden for a while loses its surface and
			 * shows a stale one stretched while the new one is built. That theory was tested and is
			 * wrong: the first frame after a sixty-second pause arrives in 4ms, the same as one taken
			 * seconds after the last capture. The second frame is not bought anything, so it is gone.
			 */
			const shownAt = performance.now();
			requestAnimationFrame(() => {
				bridge.screenshot?.debug?.("first frame", { ms: Math.round(performance.now() - shownAt) });
				bridge.screenshot?.painted?.();
			});
		});
		/*
		 * The main process is the only thing that knows, and `document.hidden` is not it.
		 *
		 * An Electron window that has never been shown still reports its document as visible — it is
		 * a window, not a background tab. Trusting that here set the end state before the window was
		 * on screen, so the transition had nothing left to run and capture mode arrived in one
		 * frame: the abruptness this is supposed to remove, reintroduced by the safety net.
		 *
		 * The timer is the real safety net. `reveal` sends the message from every path that shows
		 * the window, including the failsafe one, so this should never fire — and if it somehow
		 * does, an overlay that is a little abrupt beats one that is permanently invisible.
		 */
		const safety = setTimeout(() => setEntered(true), 2000);
		return () => {
			cleanup?.();
			clearTimeout(safety);
		};
	}, []);

	/**
	 * Play the way out, then do the thing. Guarded, so a second Escape cannot double-fire it.
	 *
	 * The guard is a ref and the timer is set outside any updater, which is not a style choice. A
	 * state updater has to be a pure function of the state — React calls it more than once per
	 * commit, and may not call it at all when the value it would return is the one already there.
	 * Scheduling the timer inside one is therefore a coin toss on whether the screenshot is ever
	 * delivered: press 完成, watch it fade, and stay in capture mode forever with nothing on the
	 * clipboard. Which is exactly what it did.
	 */
	const leavingRef = useRef(false);
	const leaveThen = useCallback((act: () => void) => {
		if (leavingRef.current) return;
		leavingRef.current = true;
		setLeaving(true);
		setTimeout(act, LEAVE_MS);
	}, []);

	/**
	 * Everything this page holds that belongs to one capture, put back.
	 *
	 * This used to be free: the page had just loaded, so "new capture" and "new everything" were the
	 * same event. The window is permanent now — that is what removed the delay in which the desktop
	 * visibly jumped — so every value left over from the last capture is still here, and each one is
	 * a bug waiting. An old selection. A half-finished drag. `leaving` still true, so the overlay
	 * opens already fading out. `leavingRef` still set, so Escape does nothing at all.
	 *
	 * One function rather than the same list written out at both call sites, because keeping two
	 * copies in step is exactly the mistake that shipped: `toastLeaving` was added to the fade and
	 * to neither list, so the first colour pick set it and nothing ever cleared it — from the second
	 * pick onwards 「已复制色值」 rendered at `opacity: 0` and was never seen again.
	 *
	 * Marks are not here: `useAnnotator` clears those off the same session number.
	 */
	const resetSession = useCallback(() => {
		setSelection(null);
		setDragMode({ kind: "none" });
		setCursor("crosshair");
		setIsAnnotating(false);
		setHoverWindow(null);
		setPointer(null);
		setReading(null);
		setCopied(false);
		setToastLeaving(false);
		setEntered(false);
		setLeaving(false);
		leavingRef.current = false;
	}, []);
	useEffect(() => {
		const cleanup = bridge.screenshot?.onInit((data: ScreenshotInit) => {
			resetSession();
			setInitData(data);
			// Before any movement: the overlay often opens under a pointer that is not going to move.
			setPointer(data.cursor ?? null);
			setHoverWindow(data.cursor ? windowAt(data.windows, data.cursor) : null);
		});
		return cleanup;
	}, [resetSession]);

	/*
	 * The capture is over: put the picture down.
	 *
	 * The window stays for the life of the app now, and what it was holding is a full-resolution
	 * copy of the display — over twenty megabytes on a Retina screen, kept for as long as nobody
	 * takes another screenshot. Clearing `initData` also empties the annotator, since the source it
	 * loads from becomes "".
	 *
	 * The main process only sends this once the window is *off* screen, which matters: this blanks
	 * the canvas, and doing that a moment early is a white flash over the desktop.
	 */
	useEffect(() => {
		const cleanup = bridge.screenshot?.onHidden?.(() => {
			resetSession();
			setInitData(null);
		});
		return cleanup;
	}, [resetSession]);

	// Cancel / close screenshot
	const handleCancel = useCallback(() => {
		leaveThen(() => bridge.screenshot?.cancel?.());
	}, [leaveThen]);

	/**
	 * Leave the way Escape does, and let the confirmation outlive the capture.
	 *
	 * Taking a colour used to hold the whole overlay up for 850ms so the message could be read, and
	 * only then start leaving — nearly a second of frozen screen after the errand was finished. What
	 * it should be is the other way round: the capture goes at once, exactly as Escape makes it go,
	 * and the message stays a moment longer over the real desktop.
	 *
	 * So the two are separated. `leaving` takes the dimming, the loupe and the frozen picture away on
	 * the same 120ms Escape uses; the toast lives outside that layer and is dismissed on its own
	 * clock. In between, the window is still there — transparent, showing nothing but the message —
	 * and `colourPicked` tells the main process to let presses through it, so the moment the screen
	 * looks normal it behaves normally too.
	 */
	const leaveWithToast = useCallback(() => {
		if (leavingRef.current) return;
		leavingRef.current = true;
		setLeaving(true);
		bridge.screenshot?.colourPicked?.();
		setTimeout(() => setToastLeaving(true), LEAVE_MS + TOAST_MS);
		setTimeout(() => bridge.screenshot?.cancel?.(), LEAVE_MS + TOAST_MS + TOAST_FADE_MS);
	}, []);

	// Escape shortcut, and ⌘C while the loupe is reading a colour.
	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				e.preventDefault();
				handleCancel();
				return;
			}
			/*
			 * The colour under the crosshair, on the clipboard.
			 *
			 * Only before a region exists, which is exactly when the loupe is on screen — once there
			 * is something to annotate, copy belongs to whatever is being edited.
			 */
			if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "c" && reading && !selection) {
				e.preventDefault();
				/*
				 * Taking a colour is the whole errand, so it ends the capture.
				 *
				 * You came for the value, it is on the clipboard, and there is nothing left to frame
				 * — staying in capture mode afterwards means the user has to dismiss a thing they are
				 * already done with. The confirmation stays up for a beat so the answer is visible
				 * before the screen goes back to normal.
				 */
				void navigator.clipboard?.writeText(reading.hex).then(
					() => {
						setCopied(true);
						leaveWithToast();
					},
					() => setCopied(false),
				);
			}
		};
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [handleCancel, reading, selection, leaveWithToast]);

	/**
	 * The selection and the marks on it, cut out of the annotated canvas at its own resolution.
	 *
	 * Read straight off the live canvas rather than through `render()` and a second decode: the
	 * canvas is already exactly the picture that is wanted, minus everything outside the frame.
	 */
	const handleFinish = useCallback(() => {
		const source = annotator.canvas.current;
		if (!source || !selection || !initData) return;

		const scale = source.width / initData.bounds.width;
		const out = document.createElement("canvas");
		out.width = Math.max(1, Math.round(selection.width * scale));
		out.height = Math.max(1, Math.round(selection.height * scale));
		const ctx = out.getContext("2d");
		if (!ctx) return;

		ctx.drawImage(
			source,
			Math.round(selection.x * scale),
			Math.round(selection.y * scale),
			out.width,
			out.height,
			0,
			0,
			out.width,
			out.height,
		);

		// Rendered before the fade, so the picture is of the marks and not of them half faded out.
		const png = out.toDataURL("image/png");
		leaveThen(() => bridge.screenshot?.finish?.(png, initData.settings));
	}, [annotator, selection, initData, leaveThen]);

	// Selection pointer events
	const handlePointerDown = (e: React.PointerEvent) => {
		if (!initData) return;
		/*
		 * A press on a control is not a press on the screen.
		 *
		 * The toolbar floats *outside* the selection — below it, by `toolbarPosition` — so without
		 * this every press on it falls through to the rule at the bottom of this function and is
		 * read as "start a new region somewhere else". Pressing any tool button therefore threw the
		 * selection away and went back to the empty crosshair, which is the whole of "点一个按钮就
		 * 立马出现新的截图". Nothing about it is visible to a test that clicks buttons through the
		 * DOM: `element.click()` dispatches a click and no pointer event at all.
		 */
		if ((e.target as HTMLElement).closest?.("[data-screenshot-ui]")) return;
		const pt: Point = { x: e.clientX, y: e.clientY };

		/*
		 * Taking the press means the canvas must not also have it.
		 *
		 * This runs in the capture phase, so it sees the press before `AnnotateCanvas` does. That
		 * matters for the edge band: there is no handle element out there, so the press lands on the
		 * canvas, which starts a stroke — and then bubbles up here and moves the selection. Dragging
		 * the frame therefore drew a line every time. Stopping propagation is what makes adjusting
		 * the region and drawing on it two different gestures instead of one gesture doing both.
		 */
		const take = () => {
			e.stopPropagation();
			(e.target as HTMLElement).setPointerCapture?.(e.pointerId);
		};

		if (selection) {
			const handle = hitHandle(selection, pt, HANDLE_GRAB);
			if (handle) {
				setDragMode({ kind: "resizing", handle, origin: selection });
				take();
				return;
			}
			if (insideRect(selection, pt)) {
				// Before there is anything to annotate the whole region is a grab; afterwards only its
				// edge is, because the middle is the canvas.
				if (!isAnnotating || onEdge(selection, pt, EDGE_GRAB)) {
					setDragMode({ kind: "moving", from: pt, origin: selection });
					take();
				}
				// Otherwise the press belongs to `AnnotateCanvas`, and is deliberately left to reach it.
				return;
			}
		}

		/*
		 * Once a region exists, everything outside it is dead.
		 *
		 * It used to start a new region from scratch, throwing away the one that was framed and every
		 * mark on it — a whole capture lost to a press a few pixels outside the frame, which is easy
		 * to do while reaching for the toolbar. The region is adjusted by its handles and moved by its
		 * edge; nothing out here is meant to do anything, and the cursor says so.
		 *
		 * Escape is how you start over, and it is what the hint says.
		 */
		if (selection) {
			e.stopPropagation();
			return;
		}

		// With no region yet, a press anywhere begins one.
		setIsAnnotating(false);
		setDragMode({ kind: "creating", from: pt });
		setSelection({ x: pt.x, y: pt.y, width: 0, height: 0 });
		take();
	};

	const handlePointerMove = (e: React.PointerEvent) => {
		if (!initData) return;
		const pt: Point = { x: e.clientX, y: e.clientY };

		/*
		 * The loupe follows the pointer until there is a region, and then gets out of the way.
		 *
		 * Sampled from the backdrop canvas: it holds the snapshot at its own resolution, so the
		 * coordinates reported are the picture's own and the colour is the one that will be saved.
		 */
		if (!selection) {
			setPointer(pt);
			const bg = bgCanvasRef.current;
			const scale = bg && initData.bounds.width ? bg.width / initData.bounds.width : 1;
			const px = Math.round(pt.x * scale);
			const py = Math.round(pt.y * scale);
			const ctx = bg?.getContext("2d", { willReadFrequently: true });
			if (ctx && px >= 0 && py >= 0 && px < (bg?.width ?? 0) && py < (bg?.height ?? 0)) {
				const [r, g, b] = ctx.getImageData(px, py, 1, 1).data;
				const hex = `#${[r, g, b].map((n) => (n ?? 0).toString(16).padStart(2, "0")).join("").toUpperCase()}`;
				setReading({ x: px, y: py, hex });
			}
			setCopied(false);
		} else if (pointer) {
			setPointer(null);
		}

		if (dragMode.kind === "creating") {
			const rect = clampRect(rectFromPoints(dragMode.from, pt), initData.bounds);
			setSelection(rect);
		} else if (dragMode.kind === "moving") {
			const dx = pt.x - dragMode.from.x;
			const dy = pt.y - dragMode.from.y;
			const rect = moveRect(dragMode.origin, dx, dy, initData.bounds);
			setSelection(rect);
		} else if (dragMode.kind === "resizing") {
			const rect = clampRect(
				resizeRect(dragMode.origin, dragMode.handle, pt),
				initData.bounds,
			);
			setSelection(rect);
		} else if (!selection) {
			/*
			 * Nothing drawn yet, so offer whatever is under the pointer.
			 *
			 * Only in this state: once a region exists it is the thing being worked on, and having
			 * windows light up behind it would be offering to throw it away.
			 */
			setHoverWindow(windowAt(initData.windows, pt));
			setCursor("crosshair");
		} else if (selection) {
			// Update hover cursor
			const handle = hitHandle(selection, pt, HANDLE_GRAB);
			if (handle) {
				setCursor(HANDLE_CURSOR[handle]);
				return;
			}
			if (insideRect(selection, pt)) {
				// The canvas sets its own cursor for the tool in hand; this is only about the frame.
				setCursor(!isAnnotating || onEdge(selection, pt, EDGE_GRAB) ? "move" : "default");
				return;
			}
			// Outside a region that already exists: nothing here does anything, and a crosshair would
			// promise that it does. See the matching rule in `handlePointerDown`.
			setCursor("not-allowed");
		} else {
			setCursor("crosshair");
		}
	};

	const handlePointerUp = () => {
		if (dragMode.kind === "creating" && selection) {
			if (selection.width < MIN_SELECTION || selection.height < MIN_SELECTION) {
				/*
				 * A press that went nowhere takes the window under it, if there is one.
				 *
				 * The two gestures share a beginning and are told apart by what happened next: drag
				 * and you framed a region by hand, release without moving and you pointed at a
				 * window. With no window there — the desktop, or a display whose windows could not be
				 * read — it stays what it always was, the way to clear a selection.
				 */
				const whole = hoverWindow ? clampRect(hoverWindow, initData!.bounds) : null;
				if (whole && whole.width >= MIN_SELECTION && whole.height >= MIN_SELECTION) {
					setSelection(whole);
					setIsAnnotating(true);
				} else {
					setSelection(null);
				}
			} else {
				setIsAnnotating(true);
			}
			setHoverWindow(null);
		}
		setDragMode({ kind: "none" });
	};

	/*
	 * Between captures. The window still exists — it is never destroyed any more — so this is what
	 * it looks like when nothing is being captured: transparent, empty, and holding no picture.
	 *
	 * `data-capture` says which of the two states this is, because from outside the page they are
	 * otherwise indistinguishable: the window's debugger target is listed either way, so a test
	 * asking "did the capture end?" by looking for the target would always be told no.
	 */
	if (!initData) {
		return <div data-capture="idle" className="fixed inset-0 bg-transparent" />;
	}

	const { bounds } = initData;
	// Snapshot pixels → screen pixels, which is the scale the annotator's hit tolerances are in.
	const zoom = annotator.width > 0 ? bounds.width / annotator.width : 1;
	/*
	 * Placed against the bar's real width, not a guess at it.
	 *
	 * `toolbarPosition` keeps the bar on screen by clamping against the width it is told, so a
	 * constant that has drifted from the truth clamps to the wrong place — the bar was 742pt wide
	 * and declared 660, which put its last 82pt, the 完成 button among them, off the right edge of
	 * the screen with no way to reach it. Measured after the first paint and remembered, so this
	 * cannot drift again as controls are added.
	 */
	/*
	 * The bubble counts towards the placement, whether or not one is open right now.
	 *
	 * Measuring only the open one would make the bar jump the moment a tool with properties was
	 * chosen — the placement would change under the pointer that just chose it. Reserving the room
	 * unconditionally costs a few pixels of gap in the rare case nothing opens, and keeps the bar
	 * still.
	 */
	const toolbarAt = selection
		? toolbarPosition(selection, bounds, { ...TOOLBAR_SIZE, ...toolbarSize }, { height: PROPERTIES_HEIGHT })
		: null;

	return (
		<div
			className="fixed inset-0 select-none overflow-hidden"
			/*
			 * How many windows can be pointed at, exposed for the probe.
			 *
			 * "Clicking a window does nothing" and "there were no windows to click" look identical
			 * from outside, and only one of them is a fault in here.
			 */
			data-window-count={initData.windows?.length ?? 0}
			data-capture="active"
			style={{ cursor, WebkitUserDrag: "none" } as React.CSSProperties}
			/*
			 * A press-and-move here is a selection, never a drag of the page.
			 *
			 * The overlay is a canvas over an image, and the browser's own drag-and-drop reads
			 * exactly that gesture as dragging the picture somewhere — which replaces the crosshair
			 * with the "you cannot drop this here" cursor for as long as the button is down. There is
			 * nowhere to drop anything: this window is the whole screen.
			 */
			onDragStart={(e) => e.preventDefault()}
			// Capture, so the frame's own gestures are decided before the canvas can start a stroke.
			onPointerDownCapture={handlePointerDown}
			onPointerMove={handlePointerMove}
			onPointerUp={handlePointerUp}
		>
			{/*
			 * The frozen screen, shown instantly and deliberately not faded.
			 *
			 * It is a picture of what is already there, so there is nothing to fade *from* — it is
			 * everything drawn on top of it that arrives.
			 */}
			<canvas
				ref={bgCanvasRef}
				draggable={false}
				className="absolute inset-0 block h-full w-full pointer-events-none"
				/*
				 * Taken away the instant leaving starts, without a fade.
				 *
				 * It is a copy of the screen underneath it, so removing it is invisible — and it has to
				 * go, because what follows a colour pick is the confirmation sitting over the *real*
				 * desktop for another beat. Leave the frozen copy up and the desktop behind it is
				 * unresponsive-looking for as long as the message is: clicks land, nothing appears to
				 * happen, because what is on screen is a photograph.
				 */
				style={{ opacity: leaving ? 0 : 1 }}
			/>

			{/*
			 * `pointer-events-none`, and everything inside it that is meant to be touched says so
			 * itself. A full-screen layer that swallowed presses would put itself between the user
			 * and the overlay's own handlers — the selection is dragged on the root, not here.
			 */}
			<div
				className="pointer-events-none absolute inset-0"
				style={{
					opacity: leaving || !entered ? 0 : 1,
					transition: `opacity ${leaving ? LEAVE_MS : ENTER_MS}ms ease-out`,
				}}
			>
			{/* Dim mask around selection */}
			{selection && (
				<svg className="pointer-events-none absolute inset-0 h-full w-full">
					<defs>
						<mask id="cutout">
							<rect width="100%" height="100%" fill="white" />
							<rect
								x={selection.x}
								y={selection.y}
								width={selection.width}
								height={selection.height}
								fill="black"
							/>
						</mask>
					</defs>
					<rect width="100%" height="100%" fill="rgba(0, 0, 0, 0.3)" mask="url(#cutout)" />
				</svg>
			)}

			{/*
			 * Nothing is said in words before a region exists.
			 *
			 * A window lighting up as the pointer crosses it explains the gesture better than a
			 * sentence does, and a banner in the middle of the screen sits on top of the very thing
			 * being captured. Only the dimming remains, which is what says "capture mode".
			 */}
			{!selection && !hoverWindow && <div className="pointer-events-none absolute inset-0 bg-black/25" />}

			{/*
			 * The window on offer, drawn as the region it would become.
			 *
			 * Undimmed inside the frame and dimmed outside it, which is the same language the
			 * selection itself uses — so pressing does not change what you are looking at, only its
			 * status. The size is shown because it is the fact that decides whether this is the right
			 * window when two of an application's windows overlap.
			 */}
			{!selection && hoverWindow && (
				<>
					<svg className="pointer-events-none absolute inset-0 h-full w-full">
						<defs>
							<mask id="window-cutout">
								<rect width="100%" height="100%" fill="white" />
								<rect x={hoverWindow.x} y={hoverWindow.y} width={hoverWindow.width} height={hoverWindow.height} fill="black" />
							</mask>
						</defs>
						<rect width="100%" height="100%" fill="rgba(0, 0, 0, 0.3)" mask="url(#window-cutout)" />
					</svg>
					<div
						data-window-highlight
						className="pointer-events-none absolute border-2 border-[var(--color-accent)]"
						style={{ left: hoverWindow.x, top: hoverWindow.y, width: hoverWindow.width, height: hoverWindow.height }}
					>
						<span className="absolute left-1/2 -top-7 -translate-x-1/2 whitespace-nowrap rounded-md bg-black/70 px-2 py-0.5 text-caption text-white tabular-nums backdrop-blur-sm">
							{Math.round(hoverWindow.width)} × {Math.round(hoverWindow.height)}
						</span>
					</div>
				</>
			)}

			{/*
			 * The annotator, seen through the selection.
			 *
			 * The outer frame is the region and clips to it; the inner one carries the full-screen
			 * canvas back up and left by the region's offset, so the part showing through is exactly
			 * the part that will be saved. Clipping also takes the canvas out of hit testing outside
			 * the frame, which is what leaves a press out there free to start a new selection.
			 */}
			{isAnnotating && selection && (
				<div
					className="pointer-events-auto absolute overflow-hidden"
					style={{
						left: selection.x,
						top: selection.y,
						width: selection.width,
						height: selection.height,
					}}
				>
					<div className="absolute" style={{ left: -selection.x, top: -selection.y }}>
						<AnnotateCanvas
							annotator={annotator}
							zoom={zoom}
							className="bg-transparent"
							style={{ width: bounds.width, height: bounds.height }}
						/>
					</div>
				</div>
			)}

			{/*
			 * The loupe, while there is still a choice to make about where the region goes.
			 *
			 * Outside the dimmed layer, because a magnifier showing a dimmed version of the screen
			 * would misreport the colour it is there to report.
			 */}
			{!selection && pointer && (
				<ScreenshotLoupe
					source={bgCanvasRef.current}
					at={pointer}
					scale={bgCanvasRef.current && bounds.width ? bgCanvasRef.current.width / bounds.width : 1}
					viewport={bounds}
					reading={reading}
					copied={copied}
				/>
			)}

			{/* Selected region borders & resize handles */}
			{selection && (
				<div
					data-selection
					className="pointer-events-none absolute border border-[var(--color-accent)] shadow-[0_0_0_1px_rgba(0,0,0,0.35)]"
					style={{
						left: selection.x,
						top: selection.y,
						width: selection.width,
						height: selection.height,
					}}
				>
					{/*
					 * Four strips along the edge, whose only job is to carry the cursor.
					 *
					 * Setting `cursor: move` on this container did nothing once there was anything to
					 * annotate: the annotation canvas covers the whole region and carries its own
					 * cursor (`cursor-crosshair`, or the tool's), and CSS takes the cursor from the
					 * element under the pointer — a child always wins. So the edge said "crosshair"
					 * while behaving as a grab handle, on every capture, not just when the aim was off.
					 *
					 * Real elements above the canvas fix both halves at once: the cursor is theirs, and
					 * the press lands on them instead of starting a stroke. They do not stop the event,
					 * so it still reaches the overlay's own handler, which reads it as a move exactly
					 * as before.
					 */}
					{(
						[
							["top", { left: 0, right: 0, top: -EDGE_GRAB / 2, height: EDGE_GRAB }],
							["bottom", { left: 0, right: 0, bottom: -EDGE_GRAB / 2, height: EDGE_GRAB }],
							["left", { top: 0, bottom: 0, left: -EDGE_GRAB / 2, width: EDGE_GRAB }],
							["right", { top: 0, bottom: 0, right: -EDGE_GRAB / 2, width: EDGE_GRAB }],
						] as const
					).map(([side, box]) => (
						<div key={side} className="pointer-events-auto absolute cursor-move" style={box} />
					))}

					{HANDLES.map((h) => {
						const pt = handlePoint({ x: 0, y: 0, width: selection.width, height: selection.height }, h);
						return (
							<div
								key={h}
								className="pointer-events-auto absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-[var(--color-accent)] shadow-sm"
								style={{ left: pt.x, top: pt.y, cursor: HANDLE_CURSOR[h] }}
							/>
						);
					})}
				</div>
			)}

			{/*
			 * Marked as a control, and belt-and-braces about it.
			 *
			 * `data-screenshot-ui` is what `handlePointerDown` looks for; stopping the press here as
			 * well means it never reaches the overlay's handlers at all, so no rule added there
			 * later can start reading the toolbar as part of the screen either.
			 *
			 * Only the press, never the move or the release. Stopping all three looks tidier and
			 * breaks dragging: the bar sits directly below the selection, so resizing by the
			 * bottom-right handle ends with the pointer over it — and a `pointerup` swallowed there
			 * never reaches the overlay, which is left believing the drag is still going.
			 */}
			{isAnnotating && toolbarAt && (
				<div
					ref={measureToolbar}
					data-screenshot-ui
					className="pointer-events-auto absolute z-[120]"
					style={{ left: toolbarAt.x, top: toolbarAt.y }}
					onPointerDown={(e) => e.stopPropagation()}
				>
					<AnnotateToolbar
						annotator={annotator}
						onCancel={handleCancel}
						onSave={handleFinish}
						canReplace={false}
						saveLabel="完成"
						cancelLabel="取消"
						requireDirty={false}
						/*
						 * The bubble opens away from the region, which is the opposite of where the bar
						 * is. The bar sits below the selection whenever there is room, and a bubble that
						 * always opened upwards landed in the gap between the two — on top of the bottom
						 * of the very region being annotated.
						 */
						propertiesSide={toolbarAt?.side === "below" ? "below" : "above"}
						className="pointer-events-auto relative flex items-center gap-0.5 rounded-xl border border-white/12 bg-[#1c1c1e]/92 px-1.5 py-1 shadow-[0_8px_32px_rgba(0,0,0,0.45)] backdrop-blur-xl transition-[opacity,transform] duration-[var(--ly-t-base)] ease-out"
					/>
				</div>
			)}
			</div>

			{/*
			 * "Copied", in the middle of the screen — and deliberately outside the layer above.
			 *
			 * Everything in that layer is the capture, and the capture leaves the instant a colour is
			 * taken, on the same 120ms Escape uses. This does not: the value is on the clipboard and
			 * the message is the answer, so it stays a beat longer over the real desktop and then goes
			 * on its own. Inside the fading layer it left *with* the capture, which meant the whole
			 * overlay had to be held up for most of a second first so it could be read at all.
			 *
			 * Centred rather than beside the pointer because by now the pointer is not where the user
			 * is looking.
			 */}
			{copied && (
				<div
					className="pointer-events-none absolute inset-0 flex items-center justify-center"
					style={{
						opacity: toastLeaving ? 0 : 1,
						transition: `opacity ${TOAST_FADE_MS}ms ease-out`,
					}}
				>
					<div className="flex animate-[ly-tool-in_var(--ly-t-base)_ease-out] flex-col items-center gap-2 rounded-2xl bg-black/75 px-9 py-7 text-white shadow-[0_10px_40px_rgba(0,0,0,0.45)] backdrop-blur-md">
						<Check size={44} strokeWidth={2.2} />
						<span className="text-label">已复制色值</span>
					</div>
				</div>
			)}
		</div>
	);
}
