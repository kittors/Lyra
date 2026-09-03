/**
 * The image, full size, arriving from wherever you clicked it.
 *
 * Two transforms, on two elements, for two unrelated jobs.
 *
 * The outer one is the flight. It is FLIP and it has to be, because the two states have different
 * sizes and there is no single property that gets from one to the other honestly. The final layout
 * is computed first — centred, contained within the window — and then the *first* frame is expressed
 * as a transform that lands the image exactly on the thumbnail it came from. One frame later the
 * transform is removed and the browser interpolates. Nothing is ever laid out at an intermediate
 * size, so a large picture costs the same as a small one and neither reflows on the way.
 *
 * The inner one is zoom and pan. It is a separate element because FLIP writes `style.transform`
 * directly and the two would otherwise overwrite each other. Keeping them apart also means the FLIP
 * measurement is of the settled layout box, which a child's transform does not affect — so zooming
 * in and then closing still flies back to the right thumbnail.
 *
 * Closing runs the same path backwards, and only unmounts when it finishes — an overlay that
 * disappears on the click and animates nothing is the thing this replaced.
 */

import { ChevronLeft, ChevronRight, Download, Maximize2, Minus, Pencil, Plus, X } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { clampZoom, ZOOM_MAX, ZOOM_MIN, ZOOM_STEP, zoomAt, type Point } from "./annotate.ts";
import { AnnotateCanvas, AnnotateToolbar, STAGE_FIT, useAnnotator } from "./Annotator.tsx";
import { useLayout } from "../../app/layout.tsx";
import { useApp } from "../../store/index.ts";
import { EASING } from "../../ui/motion/tokens.ts";
import { closeViewer, stepViewer, useViewer, type ViewerImage } from "./viewer-store.ts";

/**
 * Longer than `--ly-t-base`, on purpose.
 *
 * The comment here used to say it *matched* that token. It does not, and has not for a while:
 * `--ly-t-base` is 220ms and this is 260. The number is right — a picture crossing the whole window
 * is travelling further than any panel and 220 makes it look thrown — but the claim was wrong, and
 * nothing would ever have said so. That is what two written-down copies of a value do.
 *
 * Kept as a number because the unmount has to be timed against it.
 */
const DURATION = 260;

/**
 * The app's `out` curve, from the one place it is defined.
 *
 * A picture flying from a thumbnail to the middle of the screen is the most conspicuous motion in
 * the app, and the browser's `ease-out` is a shallow curve that spends its whole length slowing
 * down — which at this size reads as the image being dragged rather than released. This one leaves
 * quickly and settles late, which is what makes it feel like the picture was let go of.
 */
const EASE = EASING.out;

/** The flight's transition, as a string: FLIP has to restore this exact value after suppressing it. */
const FLIGHT = `transform ${DURATION}ms ${EASE}, opacity ${DURATION}ms ${EASE}`;

const CENTRED: Point = { x: 0, y: 0 };

/**
 * How long a step sideways takes.
 *
 * Both pictures are on screen for all of it, so this is the length of one continuous movement
 * rather than of a fade out followed by a fade in.
 */
const SLIDE_MS = 300;

/** The gap between two pictures as they pass, so they read as separate rather than as one smear. */
const SLIDE_GAP = 56;

export function ImageViewer() {
	const state = useViewer();
	// What the system took at the top right, which this overlay has to clear on its own.
	const { titlebar } = useLayout();
	const [leaving, setLeaving] = useState(false);
	const [editing, setEditing] = useState(false);
	const figure = useRef<HTMLDivElement>(null);
	const origin = useRef<DOMRect | null>(null);
	/** The thumbnail this came from, hidden while the picture is out of it. */
	const source = useRef<HTMLElement | null>(null);

	// Held across the closing animation, so the image does not vanish before it has shrunk.
	const [held, setHeld] = useState<ReturnType<typeof useViewer>>(null);
	const shown = state ?? held;
	const image = shown?.images[shown.index] ?? null;

	/*
	 * Zoom and offset are one piece of state, not two.
	 *
	 * They only ever change together — every zoom implies the offset that keeps the anchor still —
	 * and holding them apart invites the update that reads one while setting the other. It was
	 * written that way first: `setOffset(previous => { setZoom(...); return ... })`, which calls a
	 * setter from inside an updater. An updater must be a pure function of the state, because React
	 * runs it more than once per commit. As one value it cannot be written that way, and `zoomAt`
	 * already returns exactly this shape.
	 */
	const [view, setView] = useState<{ zoom: number; offset: Point }>({ zoom: 1, offset: CENTRED });
	const { zoom, offset } = view;
	const [panning, setPanning] = useState(false);
	/**
	 * A step in progress: the picture being left behind, and how far the pair has to travel.
	 *
	 * `phase` is the two frames a CSS transition needs — `start` places both pictures with no
	 * transition, `run` turns it on and moves them. Without a rendered start there is nothing to
	 * interpolate from and they simply appear in their final places.
	 */
	const [transit, setTransit] = useState<{
		parting: ViewerImage;
		dir: number;
		span: number;
		phase: "start" | "run";
	} | null>(null);
	const sliding = useRef(0);
	const [spacing, setSpacing] = useState(false);
	const grab = useRef<{ x: number; y: number; from: Point } | null>(null);

	/*
	 * Decoded once the picture has landed — not when 标注 is pressed, and not during the flight.
	 *
	 * Deferring it to the button saved a decode and cost a flash: the canvas mounts before the
	 * source has loaded, and a canvas with no width attribute is 300×150, so pressing 标注 replaced
	 * the picture with a small white box for as long as the decode took.
	 *
	 * Doing it immediately fixed that and cost something worse. Decoding a screenshot and painting
	 * it into a canvas is main-thread work measured in tens of milliseconds, and it started on the
	 * very frame the opening animation did — so the picture juddered its way to the middle of the
	 * screen every single time, which is the one moment the whole component exists to make smooth.
	 *
	 * So: after the flight. By the time anyone has read the picture and reached for 标注 it is long
	 * ready, and nothing competes with the animation.
	 */
	const [decodable, setDecodable] = useState(false);
	const annotator = useAnnotator(decodable || editing ? (image?.src ?? "") : "");

	const resetView = useCallback(() => setView({ zoom: 1, offset: CENTRED }), []);

	useLayoutEffect(() => {
		if (!state) return;
		setHeld(state);
		setLeaving(false);
		if (state.startEditing) setEditing(true);
		if (state.origin) origin.current = state.origin;
		if (state.source) source.current = state.source;
	}, [state]);

	/*
	 * The thumbnail steps aside for as long as its picture is elsewhere.
	 *
	 * Without this the flight is a copy of the thumbnail sailing away from the thumbnail, which
	 * reads as two objects rather than as one being picked up — and on the way back the picture
	 * shrinks onto a thumbnail that is already there, so the last frame is the moment two things
	 * become one. `visibility` rather than `display`: the layout must not move, or the rectangle
	 * this is flying to stops being where the picture is going.
	 */
	useLayoutEffect(() => {
		const thumbnail = shown ? source.current : null;
		if (!thumbnail) return;
		thumbnail.style.visibility = "hidden";
		return () => {
			thumbnail.style.visibility = "";
		};
	}, [shown]);

	// A different picture is a different thing to be looking at; it arrives at its own size.
	const src = image?.src;
	useEffect(() => {
		resetView();
	}, [src, resetView]);

	useEffect(() => {
		if (!shown) {
			setDecodable(false);
			return;
		}
		const timer = window.setTimeout(() => setDecodable(true), DURATION + 80);
		return () => window.clearTimeout(timer);
	}, [shown, src]);

	/*
	 * The neighbours, fetched while this one is being looked at.
	 *
	 * Stepping swaps `src` on an element already on screen, so an undecoded neighbour shows as a
	 * blank frame in the middle of the slide. Asking for them now means the swap is instant — and
	 * they are already in memory as data URLs, so this costs a decode and no network at all.
	 */
	useEffect(() => {
		if (!shown || shown.images.length < 2) return;
		for (const delta of [1, -1]) {
			const next = shown.images[(shown.index + delta + shown.images.length) % shown.images.length];
			if (next) new Image().src = next.src;
		}
	}, [shown]);

	/*
	 * Closed means closed, however it was closed.
	 *
	 * `dismiss` tidies up on its way out, but the store can be closed from anywhere — another part of
	 * the app, or a shortcut that never comes through here. Two things then have to be let go of.
	 *
	 * Edit mode, or the next image arrives with the annotator already up over a picture nobody asked
	 * to annotate. And `held`, the copy kept alive so the closing animation has something to shrink:
	 * only `dismiss` clears it, so a close from elsewhere left the overlay on screen showing a
	 * picture the store no longer has. That also kept the annotator's source unchanged, and with it
	 * every mark from the previous session — reopening the same image brought back annotations that
	 * had been abandoned.
	 *
	 * Not while `leaving`, which is `dismiss` doing this deliberately and slowly.
	 */
	useEffect(() => {
		if (state) return;
		setEditing(false);
		// A step caught mid-flight has a second picture on a layer of its own; closing has to take
		// that with it, or it is left behind over the app with nothing holding it.
		window.clearTimeout(sliding.current);
		setTransit(null);
		if (!leaving) setHeld(null);
	}, [state, leaving]);

	/*
	 * The flight, driven straight at the DOM rather than through React.
	 *
	 * FLIP measures the *final* layout and then expresses the start as a transform away from it. The
	 * measurement therefore has to happen on a frame where no transform is applied — and that is
	 * exactly what a rendered `transform` in JSX cannot guarantee, because the next render measures
	 * an element that is already transformed. Doing that produced a scale of 1 on the second pass
	 * (the box had shrunk to match the thumbnail, so they agreed) and the picture stayed thumbnail
	 * sized for ever, which is the bug this replaced.
	 *
	 * Setting `style.transform` here instead means the element is only ever measured in its settled
	 * state. Reading `offsetWidth` between the two writes forces the browser to accept the start
	 * position as a real style before the transition to the end position begins; without it the two
	 * writes coalesce and nothing animates.
	 */
	useLayoutEffect(() => {
		const el = figure.current;
		const from = origin.current;
		if (!el || !shown || leaving) return;
		if (!from) {
			// Arrived without a source rectangle — an arrow key rather than a click. Nothing to fly
			// from, so it simply appears.
			el.style.transform = "";
			el.style.transition = FLIGHT;
			return;
		}
		const to = el.getBoundingClientRect();
		if (to.width === 0 || to.height === 0) return;

		el.style.transition = "none";
		el.style.transform = atThumbnail(from, to);
		/*
		 * Not quite from nothing, and not quite from solid.
		 *
		 * A single scale means the picture starts out filling the thumbnail's square the way the
		 * thumbnail's own `cover` crop does — which also means the parts the crop cuts off are
		 * hanging outside it on the first frame. Coming up from mostly-transparent covers that, and
		 * it gives the arrival somewhere to travel *from* other than pure geometry.
		 */
		el.style.opacity = "0.4";
		void el.offsetWidth;
		/*
		 * The value, not the empty string.
		 *
		 * This used to clear the inline property and let a class supply the transition. Moving the
		 * transition inline — to put it on the app's own curve — made that clear the only
		 * declaration there was, so the picture arrived at full size on the very first frame: no
		 * flight at all, and nothing in the styles to suggest why.
		 */
		el.style.transition = FLIGHT;
		el.style.transform = "";
		el.style.opacity = "1";
	}, [shown, leaving]);

	/**
	 * Step to the next picture, as one movement with both pictures in it.
	 *
	 * The previous version faded one out and the next one in, at the same place — which reads as
	 * the picture being *replaced*, not as moving along a row, and gave no sense of direction at
	 * all. Here they travel together: the one you were looking at leaves towards the side it is
	 * going, the next arrives from the opposite edge, and for the whole 300ms both are on screen
	 * with a gap between them. That is what a row of photographs does when you walk past it.
	 *
	 * The one leaving is `fixed` to the middle of the window rather than placed inside the figure,
	 * because the figure is sized by whichever picture is current — the moment the index changes it
	 * resizes to the new one, and anything positioned inside it would jump. Two independently
	 * centred layers can be different shapes and still pass each other cleanly.
	 */
	const step = useCallback(
		(delta: number) => {
			if (leaving || !shown) return;
			const parting = shown.images[shown.index];
			if (!parting || shown.images.length < 2) return;

			/*
			 * Far enough that each picture is gone before it stops.
			 *
			 * Measured from the picture on screen rather than fixed, so a narrow portrait shot does
			 * not travel three times its own width to leave, and a wide one does not stop while it
			 * is still visible.
			 */
			const span = (figure.current?.getBoundingClientRect().width ?? window.innerWidth * 0.5) + SLIDE_GAP;

			// A second press mid-step starts a new one from wherever this got to, rather than
			// queueing behind it — holding the arrow key should scroll through, not stutter.
			window.clearTimeout(sliding.current);
			setTransit({ parting, dir: delta, span, phase: "start" });
			stepViewer(delta);
			requestAnimationFrame(() =>
				requestAnimationFrame(() => {
					setTransit((current) => (current ? { ...current, phase: "run" } : null));
					sliding.current = window.setTimeout(() => setTransit(null), SLIDE_MS);
				}),
			);
		},
		[leaving, shown],
	);

	useEffect(() => () => window.clearTimeout(sliding.current), []);

	const dismiss = useCallback(() => {
		if (leaving) return;
		setEditing(false);
		setLeaving(true);
		// Only the current picture flies home to its thumbnail; one still sliding past has no
		// thumbnail of its own to fly to and simply goes.
		window.clearTimeout(sliding.current);
		setTransit(null);
		// Unzoomed on the way out, so the picture shrinks back to the thumbnail along one path rather
		// than flying from a size the layout box knows nothing about.
		resetView();

		const el = figure.current;
		const from = origin.current;
		if (el && from) {
			const to = el.getBoundingClientRect();
			if (to.width > 0) el.style.transform = atThumbnail(from, to);
			/*
			 * Fades a little, never out.
			 *
			 * This used to go to zero over exactly the time the shrink takes, so the picture was
			 * invisible about halfway back and the last half of the journey — the half where it
			 * actually arrives on the thumbnail — played to nobody. What it looked like was the
			 * picture blinking out, which is precisely the "sudden" being complained about.
			 *
			 * It stays visible all the way down instead, and lands on the thumbnail at the moment
			 * the thumbnail comes back. The mirror of the 0.4 the flight out starts from.
			 */
			el.style.opacity = "0.35";
		}

		window.setTimeout(() => {
			setHeld(null);
			origin.current = null;
			if (el) {
				el.style.transform = "";
				el.style.opacity = "";
				el.style.transition = FLIGHT;
			}
			closeViewer();
		}, DURATION);
	}, [leaving, resetView]);

	/**
	 * Zoom about a point on the screen, holding whatever is under it.
	 *
	 * The measurement happens out here and the arithmetic happens in the updater, which means this
	 * depends on nothing and a wheel spun faster than React renders still composes correctly —
	 * each notch sees the state the one before it produced rather than the one it was declared with.
	 */
	const zoomTo = useCallback((next: number, anchor?: Point) => {
		const box = figure.current?.getBoundingClientRect();
		if (!box) {
			setView((v) => ({ ...v, zoom: clampZoom(next) }));
			return;
		}
		const centre = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
		setView((v) => zoomAt(v.zoom, next, v.offset, anchor ?? centre, centre));
	}, []);

	useEffect(() => {
		if (!shown) return;
		const typingIn = (node: EventTarget | null) =>
			node instanceof HTMLElement && (node.tagName === "INPUT" || node.tagName === "TEXTAREA");

		const onKey = (event: KeyboardEvent) => {
			if (typingIn(event.target)) return;
			// Space is held to pan, so it must not also scroll or press whatever has focus.
			if (event.code === "Space") {
				event.preventDefault();
				setSpacing(true);
				return;
			}
			/*
			 * Escape undoes one layer at a time.
			 *
			 * A selection, then annotating, then the viewer. Closing the whole thing because something
			 * was selected throws away the work to answer a much smaller question, and the way back
			 * from that is no way back at all.
			 */
			if (event.key === "Escape") {
				if (editing && annotator.selected !== null) annotator.setSelected(null);
				else if (editing) setEditing(false);
				else dismiss();
				return;
			}
			if (editing) return;
			if (event.key === "ArrowLeft") step(-1);
			if (event.key === "ArrowRight") step(1);
		};
		const onUp = (event: KeyboardEvent) => {
			if (event.code === "Space") setSpacing(false);
		};
		// Losing the window while holding space would otherwise leave it stuck down.
		const release = () => setSpacing(false);

		window.addEventListener("keydown", onKey);
		window.addEventListener("keyup", onUp);
		window.addEventListener("blur", release);
		return () => {
			window.removeEventListener("keydown", onKey);
			window.removeEventListener("keyup", onUp);
			window.removeEventListener("blur", release);
		};
	}, [shown, editing, dismiss, annotator, step]);

	if (!shown || !image) return null;

	const open = !leaving;
	// Dragging pans only when the drag cannot mean anything else: while not editing, or while space
	// is held. Otherwise a drag on the canvas is a stroke, which is what it should be.
	const canPan = spacing || (!editing && zoom > 1);

	/*
	 * Where each of the two pictures is, in the middle of a step.
	 *
	 * `dir` is +1 for the next picture, so on the way to it the one you were looking at moves left
	 * and its replacement comes in from the right — the direction a row of images moves when you
	 * walk forwards along it. On the `start` frame the incoming one is parked off the edge and
	 * nothing has a transition; on `run` both have one and both travel.
	 */
	const enteringX = transit?.phase === "start" ? transit.dir * transit.span : 0;
	const partingX = transit?.phase === "run" ? -transit.dir * transit.span : 0;
	const SLIDE = `transform ${SLIDE_MS}ms ${EASE}`;

	const startPan = (event: React.PointerEvent) => {

		if (!canPan || event.button !== 0) return;
		event.preventDefault();
		event.stopPropagation();
		grab.current = { x: event.clientX, y: event.clientY, from: offset };
		setPanning(true);
		event.currentTarget.setPointerCapture(event.pointerId);
	};

	const movePan = (event: React.PointerEvent) => {
		const from = grab.current;
		if (!from) return;
		setView((v) => ({
			...v,
			offset: { x: from.from.x + (event.clientX - from.x), y: from.from.y + (event.clientY - from.y) },
		}));
	};

	const endPan = () => {
		grab.current = null;
		setPanning(false);
	};

	return createPortal(
		<div
			role="dialog"
			aria-modal
			aria-label="图片预览"
			/*
			 * `no-drag` over the whole overlay.
			 *
			 * The window reserves its top 44px as a drag region, and a drag region hands the press to
			 * the window manager before the page ever sees it. This overlay covers the window, so its
			 * controls sit in that strip — and they were drawn, were on top, passed every hit test the
			 * page can run, and did nothing at all: pressing one moved the window.
			 *
			 * The whole layer rather than each button, because while a modal is up there is nothing
			 * behind it to drag the window by. Dragging resumes the moment it closes.
			 */
			className="no-drag fixed inset-0 z-[100] flex items-center justify-center overflow-hidden"
			onWheel={(event) => {
				// Trackpad pinch arrives as a wheel with ctrlKey held; both gestures mean the same
				// thing here, at different sensitivities.
				const factor = Math.exp(-event.deltaY * (event.ctrlKey ? 0.01 : 0.0022));
				zoomTo(zoom * factor, { x: event.clientX, y: event.clientY });
			}}
		>
			{/*
			 * The backdrop is a button rather than a div with a handler on it: dismissing by clicking
			 * away is a real action, and giving it a real control is what makes it reachable by
			 * keyboard and announced as something that can be pressed.
			 */}
			<button
				type="button"
				aria-label="关闭预览"
				tabIndex={-1}
				onClick={dismiss}
				className="absolute inset-0 cursor-default bg-black/72"
				style={{ opacity: open ? 1 : 0, transition: `opacity ${DURATION}ms ${EASE}` }}
			/>

			{/*
			 * The picture being left behind, on a layer of its own.
			 *
			 * `fixed` and centred on the window, not placed inside the figure: the figure is sized by
			 * whichever picture is *current*, and the index changes the instant a step begins — so
			 * anything living inside it would be re-laid-out to the new picture's shape and jump
			 * sideways at the very moment it is supposed to be gliding. Two independently centred
			 * layers can be different shapes and still pass each other cleanly.
			 *
			 * Below the current picture in the stacking order, and untouchable: it is on its way out
			 * and should never take a click meant for what is arriving.
			 */}
			{transit && (
				<img
					key={transit.parting.src}
					src={transit.parting.src}
					alt=""
					aria-hidden
					draggable={false}
					className={`${STAGE_FIT} pointer-events-none fixed rounded-xl object-contain`}
					style={{
						left: "50%",
						top: "50%",
						transform: `translate(-50%, -50%) translateX(${partingX}px)`,
						transition: transit.phase === "start" ? "none" : SLIDE,
						willChange: "transform",
					}}
				/>
			)}

			<div
				ref={figure}
				className="relative"
				style={{
					transformOrigin: "center",
					transition: FLIGHT,
					/*
					 * Its own compositor layer, for the whole time it is on screen.
					 *
					 * Scaling a screenshot from thumbnail to full size repaints it every frame unless
					 * the layer is promoted, and promoting it *as* the animation starts costs the
					 * first few frames to do so — which is exactly where the judder was. Declared
					 * rather than switched, because this element only exists while the viewer is open.
					 */
					willChange: "transform, opacity",
				}}
			>
				<div
					onPointerDown={startPan}
					onPointerMove={movePan}
					onPointerUp={endPan}
					onPointerCancel={endPan}
					onDoubleClick={() => (zoom === 1 ? zoomTo(2) : resetView())}
					className={canPan ? (panning ? "cursor-grabbing" : "cursor-grab") : undefined}
					style={{
						/*
						 * Pan, zoom and the arrival, in one transform.
						 *
						 * A step puts this picture at the far edge for one frame and then releases it
						 * to the centre; the picture it is replacing travels the other way on its own
						 * layer, below.
						 */
						transform: `translate(${offset.x + enteringX}px, ${offset.y}px) scale(${zoom})`,
						transformOrigin: "center",
						/*
						 * No transition while dragging — that would arrive where the pointer was a
						 * moment ago — and none on the frame the picture is parked off the edge, or it
						 * slides in from wherever the last one happened to leave.
						 */
						transition: panning || transit?.phase === "start" ? "none" : transit ? SLIDE : FLIGHT,
						willChange: "transform",
					}}
				>
					{editing ? (
						<AnnotateCanvas annotator={annotator} zoom={zoom} />
					) : (
						<img
							src={image.src}
							alt={image.alt ?? ""}
							draggable={false}
							/*
							 * The same fit as the canvas, from the same constant. These two used to differ
							 * — 86vh for the picture, 74vh once the toolbar was laid out under it — so
							 * pressing 标注 visibly shrank the image before anything had been drawn.
							 *
							 * No shadow. A black one on a 72%-black backdrop does not read as depth; it
							 * reads as a second, blurry border a few pixels outside the first.
							 */
							className={`${STAGE_FIT} block rounded-xl object-contain`}
						/>
					)}
				</div>
			</div>

			{/* Controls fade in after the image has arrived, so nothing competes with the flight. */}
			<div
				className="pointer-events-none absolute inset-0"
				style={{ opacity: open ? 1 : 0, transition: `opacity ${DURATION}ms ${EASE}` }}
			>
				{!editing && (
					<div
						className="pointer-events-auto absolute top-4 flex items-center gap-1"
						/*
						 * Clear of the window's own buttons, which on Windows and Linux are drawn over
						 * this corner of the page. The viewer covers the whole window, so unlike a pane
						 * it cannot rely on a title bar having moved out of the way — annotate, save and
						 * close sat underneath minimise/maximise/close and could not be pressed. Zero on
						 * macOS, where that corner is the page's.
						 */
						style={{ right: 16 + titlebar.end }}
					>
						{/* Offered for every image: one that cannot be replaced can still be annotated and
						    kept, which is the more common reason to mark up something already sent. */}
						<ViewerButton label="标注" onClick={() => setEditing(true)}>
							<Pencil size={15} strokeWidth={1.9} />
						</ViewerButton>
						<ViewerButton label="另存为" onClick={() => download(image.src)}>
							<Download size={15} strokeWidth={1.9} />
						</ViewerButton>
						<ViewerButton label="关闭 Esc" onClick={dismiss}>
							<X size={16} strokeWidth={1.9} />
						</ViewerButton>
					</div>
				)}

				{/*
				 * Bottom left, clear of the annotation toolbar in the middle. Present in both modes:
				 * zooming in to place a mark precisely is the same need as zooming in to read one.
				 */}
				<div className="pointer-events-auto absolute bottom-6 left-6 flex items-center gap-0.5 rounded-xl border border-white/12 bg-[#1c1c1e]/92 px-1.5 py-1 shadow-[0_8px_32px_rgba(0,0,0,0.45)] backdrop-blur-xl">
					<ViewerButton label="缩小" small disabled={zoom <= ZOOM_MIN} onClick={() => zoomTo(zoom / ZOOM_STEP)}>
						<Minus size={14} strokeWidth={2} />
					</ViewerButton>
					<button
						type="button"
						data-ly-tip="恢复原始大小"
						data-ly-tip-side="top"
						aria-label={`当前缩放 ${Math.round(zoom * 100)}%，点击恢复`}
						onClick={resetView}
						className="min-w-[46px] rounded-lg px-1 py-1 text-center text-detail text-white/75 tabular-nums transition-colors duration-[var(--ly-t-quick)] hover:bg-white/12 hover:text-white"
					>
						{Math.round(zoom * 100)}%
					</button>
					<ViewerButton label="放大" small disabled={zoom >= ZOOM_MAX} onClick={() => zoomTo(zoom * ZOOM_STEP)}>
						<Plus size={14} strokeWidth={2} />
					</ViewerButton>
					<ViewerButton label="适应窗口" small onClick={resetView}>
						<Maximize2 size={13} strokeWidth={2} />
					</ViewerButton>
				</div>

				{shown.images.length > 1 && !editing && (
					<>
						<div className="pointer-events-auto absolute top-1/2 left-4 -translate-y-1/2">
							<ViewerButton label="上一张 ←" onClick={() => step(-1)}>
								<ChevronLeft size={18} strokeWidth={1.9} />
							</ViewerButton>
						</div>
						<div className="pointer-events-auto absolute top-1/2 right-4 -translate-y-1/2">
							<ViewerButton label="下一张 →" onClick={() => step(1)}>
								<ChevronRight size={18} strokeWidth={1.9} />
							</ViewerButton>
						</div>
						<div className="absolute bottom-6 left-1/2 -translate-x-1/2 rounded-full bg-black/45 px-2.5 py-1 text-detail text-white/85 tabular-nums">
							{shown.index + 1} / {shown.images.length}
						</div>
					</>
				)}
			</div>

			{editing && (
				<AnnotateToolbar
					annotator={annotator}
					canReplace={Boolean(image.onReplace)}
					onCancel={() => setEditing(false)}
					onSave={() => {
						/*
						 * Replace where that is possible, save a copy where it is not.
						 *
						 * An image already sent is part of the record and rewriting it in place would
						 * change what was said. So the marked-up copy goes to the clipboard: the next
						 * thing anyone does with an annotated screenshot is paste it somewhere, and a
						 * file in the downloads folder is that same errand with two more steps. 另存为
						 * is still there for when a file is what you actually wanted.
						 */
						const dataUrl = annotator.render();
						if (!dataUrl) return;
						if (image.onReplace) {
							image.onReplace(dataUrl);
						}
						// Always copy marked-up result to clipboard on save if it's not a pure in-place replacement
						// or if user wants clipboard integration
						void toClipboard(dataUrl);
						setEditing(false);
						dismiss();
					}}
				/>
			)}
		</div>,
		document.body,
	);
}

function ViewerButton({
	label,
	onClick,
	disabled,
	small,
	children,
}: {
	label: string;
	onClick: () => void;
	disabled?: boolean;
	small?: boolean;
	children: React.ReactNode;
}) {
	return (
		<button
			type="button"
			data-ly-tip={label}
			data-ly-tip-side="top"
			aria-label={label}
			disabled={disabled}
			onClick={onClick}
			className={`flex items-center justify-center rounded-lg text-white/85 transition-colors duration-[var(--ly-t-quick)] hover:text-white disabled:opacity-30 ${
				small ? "h-7 w-7 hover:bg-white/12" : "h-8 w-8 bg-black/45 hover:bg-black/65"
			}`}
		>
			{children}
		</button>
	);
}

/**
 * The marked-up copy, ready to paste.
 *
 * PNG because that is what `ClipboardItem` takes and what every paste target understands. Falls
 * back to saving a file if the clipboard refuses — which it does when the window is not focused,
 * and losing the annotation to a permissions rule would be the worst of the options.
 */
async function toClipboard(dataUrl: string) {
	try {
		await navigator.clipboard.write([new ClipboardItem({ "image/png": decode(dataUrl) })]);
		useApp.getState().notify("已复制到剪贴板，可以直接粘贴");
	} catch {
		// The clipboard refuses while the window is not focused, and refuses entirely on some
		// platforms. Losing the annotation to that would be the worst of the outcomes.
		download(dataUrl);
		useApp.getState().notify("剪贴板不可用，已改为下载", "warn");
	}
}

/**
 * A `data:` URL to a `Blob`, by hand.
 *
 * `fetch(dataUrl)` is the tidy way to do this and it does not work here: the renderer's content
 * policy rejects `data:` as a fetch target, so every copy failed with `TypeError: Failed to fetch`
 * and fell through to the download it was meant to replace. `atob` has no such opinion.
 */
function decode(dataUrl: string): Blob {
	const comma = dataUrl.indexOf(",");
	const binary = atob(dataUrl.slice(comma + 1));
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return new Blob([bytes], { type: "image/png" });
}

/**
 * The transform that puts the full-size picture back on its thumbnail.
 *
 * **One scale, not two.** The obvious FLIP writes `scale(from.width / to.width, from.height /
 * to.height)`, and that is right only when the two boxes have the same proportions. These do not:
 * a thumbnail is a 64px square showing a `cover` crop, and the picture it stands for is usually
 * wide. Those two ratios differ by half, so the first frame of every flight was the image squashed
 * to the thumbnail's shape — and the animation's job became un-distorting it. That is the stiffness:
 * the picture appeared to be stretched into place rather than to travel.
 *
 * One ratio keeps it the shape it actually is for the whole flight, and `max` is the one to use —
 * it matches the `cover` the thumbnail is drawn with, so the picture starts out filling that square
 * exactly as the thumbnail does, rather than sitting inside it with margins the thumbnail has not
 * got.
 */
function atThumbnail(from: DOMRect, to: DOMRect): string {
	const dx = from.left + from.width / 2 - (to.left + to.width / 2);
	const dy = from.top + from.height / 2 - (to.top + to.height / 2);
	const scale = Math.max(from.width / to.width, from.height / to.height, 0.01);
	return `translate(${dx}px, ${dy}px) scale(${scale})`;
}

/** A `data:` URL is already the file; an anchor is the whole of "save as" for one. */
function download(src: string) {
	const link = document.createElement("a");
	link.href = src;
	link.download = `image-${Date.now()}.png`;
	link.click();
}
