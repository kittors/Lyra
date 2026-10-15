/**
 * The image, full size, arriving from wherever you clicked it.
 *
 * Two transforms, on two elements, for two unrelated jobs.
 *
 * The outer one is the flight. It is FLIP and it has to be, because the two states have different
 * sizes and there is no single property that gets from one to the other honestly. The final layout
 * is measured first — centred, contained within the window — and the flight is an animation from
 * the thumbnail (see `flight.ts`) to that box. Nothing is ever laid out at an intermediate size, so
 * a large picture costs the same as a small one and neither reflows on the way.
 *
 * The inner one is zoom and pan. It is a separate element so the two never overwrite each other,
 * and so the flight measures the settled layout box, which a child's transform does not affect —
 * zooming in and then closing still flies back to the right thumbnail.
 *
 * The box is always the `<img>`'s. The annotation canvas is a layer over it, never a replacement:
 * when it replaced the picture, the box measured for the flight was whichever of the two happened
 * to be mounted — and an undecoded canvas is 300×150, so 编辑 on a generated picture started the
 * flight at 2.8× the thumbnail and shrank it into place. See docs/architecture/image-viewer.md.
 *
 * Closing runs the same path backwards, and only unmounts when it lands — an overlay that
 * disappears on the click and animates nothing is the thing this replaced.
 */

import { useI18n } from "../../i18n/index.ts";
import { translate } from "../../i18n/translate.ts";
import { ChevronLeft, ChevronRight, Download, Maximize2, Minus, Pencil, Plus, X } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { clampZoom, wheelZoomFactor, ZOOM_MAX, ZOOM_MIN, ZOOM_STEP, zoomAt, type Point } from "./annotate.ts";
import { useAnnotator } from "./Annotator.tsx";
import { AnnotateCanvas, STAGE_FIT } from "./AnnotateCanvas.tsx";
import { AnnotateToolbar, BAR_SURFACE } from "./AnnotateToolbar.tsx";
import { atRest, atThumbnail, paintedBox, type Box, type FlightKeyframe, type Thumb } from "./flight.ts";
import { useLayout } from "../../app/layout.tsx";
import { useApp } from "../../store/index.ts";
import { EASING } from "../../ui/motion/tokens.ts";
import { closeViewer, stepViewer, useViewer, type ViewerImage } from "./viewer-store.ts";
import { portal } from "../../ui/overlay/portal.ts";
import { holdScrim } from "../../ui/overlay/scrims.ts";
import { useMovableBar } from "./useMovableBar.ts";

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

/** The zoom layer's transition, so un-zooming on the way out travels with the flight. */
const FLIGHT = `transform ${DURATION}ms ${EASE}`;

/** The backdrop and the controls: on the flight's clock, and faded in from nothing on arrival. */
const FADE = `opacity ${DURATION}ms ${EASE}`;
/** The backdrop's black, as `bg-black/72` draws it; the window's own buttons are dimmed by the same. */
const BACKDROP_ALPHA = 0.72;

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
	const { t } = useI18n();
	const state = useViewer();
	// What the system took at the top right, which this overlay has to clear on its own.
	const { titlebar } = useLayout();
	const [leaving, setLeaving] = useState(false);
	const [editing, setEditing] = useState(false);
	const figure = useRef<HTMLDivElement>(null);
	const origin = useRef<DOMRect | null>(null);
	/** The thumbnail this came from, hidden while the picture is out of it. */
	const source = useRef<HTMLElement | null>(null);
	/** The store's state as of the last commit, for a way back that lands after something else opened. */
	const latest = useRef(state);
	useLayoutEffect(() => {
		latest.current = state;
	});

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
	 *
	 * Opening straight into 编辑 waits too. It used to decode at once, and that is what let the
	 * undecoded canvas be measured mid-flight. The canvas is only a layer over the picture now, kept
	 * hidden until it has something to show, so waiting costs nothing that can be seen.
	 */
	const [decodable, setDecodable] = useState(false);
	const annotator = useAnnotator(decodable ? (image?.src ?? "") : "");
	/** The zoom control, which the annotation toolbar keeps clear of wherever it is put. */
	const zoomPill = useRef<HTMLDivElement>(null);
	const bar = useMovableBar(zoomPill);

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
	 * The flight out, as a Web Animation rather than a transition.
	 *
	 * A transition needs its start written, a reflow forced, and its end written, in that order and
	 * nowhere else — and the measurement has to land on a frame where the box is settled. Both of
	 * those were lost at different times: clearing the inline transition once made the picture
	 * arrive with no flight at all, and measuring after 编辑 had swapped the picture for an undecoded
	 * canvas started the flight at 2.8× the thumbnail. `animate()` takes both ends at once, needs no
	 * reflow, and leaves nothing behind on the element when it finishes.
	 *
	 * Keyed on `state`, and only for a state that came with an origin: that is an arrival from a
	 * thumbnail. A step to the next picture has none and is the slide's business, not a flight; it
	 * used to re-run this with the first thumbnail still on file and fly the new picture out of it.
	 */
	useLayoutEffect(() => {
		const el = figure.current;
		if (!el || !state?.origin) return;
		// A way back still holding the last picture on its thumbnail would outlast this flight.
		for (const running of el.getAnimations()) running.cancel();
		const thumb = thumbOf(source.current, state.origin);
		const to = el.getBoundingClientRect();
		if (!thumb || to.width === 0 || to.height === 0) return;
		el.animate([atThumbnail(thumb, to), atRest(restingRadius(el))], { duration: DURATION, easing: EASE });
	}, [state]);

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

	/*
	 * The way back.
	 *
	 * The mode is left alone until it has landed. Leaving 标注 first, as this used to, unmounted the
	 * toolbar on the click and put the viewer's own buttons up in the corner for the length of the
	 * fade — one bar vanishing and three buttons appearing, on the way *out*. Everything that is not
	 * the picture fades together instead, and the picture keeps whatever it was showing.
	 *
	 * It stays solid all the way down. It used to fade to 0.35 to match the 0.4 the flight out
	 * started from, and on a light conversation that read as a washed-out copy parked on the
	 * thumbnail for the last several frames, then a snap to solid when the thumbnail came back. The
	 * clip in `atThumbnail` makes the last frame the thumbnail exactly, so there is nothing to hide.
	 */
	const dismiss = useCallback(() => {
		if (leaving) return;
		setLeaving(true);
		// Only the current picture flies home to its thumbnail; one still sliding past has no
		// thumbnail of its own to fly to and simply goes.
		window.clearTimeout(sliding.current);
		setTransit(null);
		// Unzoomed on the way out, so the picture shrinks back to the thumbnail along one path rather
		// than flying from a size the layout box knows nothing about.
		resetView();

		const leavingState = latest.current;
		let landed = false;
		const land = () => {
			if (landed) return;
			landed = true;
			// Something else was opened while this one was on its way home; that one stays.
			if (latest.current && latest.current !== leavingState) return;
			setHeld(null);
			setLeaving(false);
			setEditing(false);
			origin.current = null;
			closeViewer();
		};

		const el = figure.current;
		const thumb = thumbOf(source.current, origin.current);
		if (el && thumb) {
			/*
			 * From wherever it is now. Closed while still arriving, the picture turns round where it
			 * is rather than first jumping to the middle: the running flight is read, then dropped.
			 */
			const now = getComputedStyle(el);
			const from: FlightKeyframe = {
				transform: now.transform,
				clipPath: now.clipPath === "none" ? atRest(restingRadius(el)).clipPath : now.clipPath,
			};
			for (const running of el.getAnimations()) running.cancel();
			const to = el.getBoundingClientRect();
			if (to.width > 0 && to.height > 0) {
				const back = el.animate([from, atThumbnail(thumb, to)], { duration: DURATION, easing: EASE, fill: "forwards" });
				back.onfinish = land;
			}
		}
		// The animation's own end is the signal; this only covers one that never runs at all.
		window.setTimeout(land, DURATION + 120);
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

	/*
	 * Windows draws minimise/maximise/close over this, outside the page; the backdrop cannot reach
	 * them, so they are dimmed with it — and brighten as it starts to fade. See `scrims.ts`.
	 */
	useEffect(() => (shown && !leaving ? holdScrim("#000000", BACKDROP_ALPHA) : undefined), [shown, leaving]);

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

	return portal(<div
			role="dialog"
			aria-modal
			aria-label={t("viewer.title")}
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
				// thing here, at different sensitivities — and Ctrl+wheel looks like a pinch. See
				// `wheelZoomFactor` for why one event is capped.
				zoomTo(zoom * wheelZoomFactor(event.deltaY, event.ctrlKey), { x: event.clientX, y: event.clientY });
			}}
		>
			{/*
			 * The backdrop is a button rather than a div with a handler on it: dismissing by clicking
			 * away is a real action, and giving it a real control is what makes it reachable by
			 * keyboard and announced as something that can be pressed.
			 */}
			<button
				type="button"
				aria-label={t("viewer.close")}
				tabIndex={-1}
				onClick={dismiss}
				/*
				 * Opacity as a class, with a starting style, rather than inline.
				 *
				 * Inline it was `1` from the backdrop's very first frame, so the window went 72% dark on
				 * the click while the way out faded — a transition only runs from a value that was
				 * painted, and a freshly mounted element has none. `starting:` gives it one, and an
				 * inline opacity would outrank it.
				 */
				className={`absolute inset-0 cursor-default bg-black/72 starting:opacity-0 ${open ? "opacity-100" : "opacity-0"}`}
				style={{ transition: FADE }}
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
					/*
					 * Its own compositor layer, for the whole time it is on screen.
					 *
					 * Scaling a screenshot from thumbnail to full size repaints it every frame unless
					 * the layer is promoted, and promoting it *as* the animation starts costs the
					 * first few frames to do so — which is exactly where the judder was. Declared
					 * rather than switched, because this element only exists while the viewer is open.
					 */
					willChange: "transform",
				}}
			>
				<div
					onPointerDown={startPan}
					onPointerMove={movePan}
					onPointerUp={endPan}
					onPointerCancel={endPan}
					onDoubleClick={() => (zoom === 1 ? zoomTo(2) : resetView())}
					className={`relative ${canPan ? (panning ? "cursor-grabbing" : "cursor-grab") : ""}`}
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
					<img
						src={image.src}
						alt={image.alt ?? ""}
						draggable={false}
						/*
						 * Always here, in both modes: this is what the box is. See the header.
						 *
						 * No shadow. A black one on a 72%-black backdrop does not read as depth; it
						 * reads as a second, blurry border a few pixels outside the first.
						 */
						className={`${STAGE_FIT} block rounded-xl object-contain`}
					/>
					{/*
					 * The marks, on a layer exactly over the picture.
					 *
					 * Sized by the picture beneath rather than by its own bitmap, so it can never move
					 * the box; hidden until the bitmap is decoded and drawn, because before that the
					 * canvas is 300×150 of nothing; and faded with the rest on the way out, so a
					 * picture abandoned mid-annotation lands on its thumbnail as the thumbnail.
					 */}
					{editing && (
						<div
							className="absolute inset-0"
							style={{ visibility: annotator.ready ? "visible" : "hidden", opacity: leaving ? 0 : 1, transition: FADE }}
						>
							{/* Both dimensions from the picture's box: the canvas's own pixels no longer match the picture's. */}
							<AnnotateCanvas annotator={annotator} zoom={zoom} className="h-full w-full rounded-xl" />
						</div>
					)}
				</div>
			</div>

			{/* Controls fade in with the backdrop, from nothing — see the backdrop for why it is a class. */}
			<div
				className={`pointer-events-none absolute inset-0 starting:opacity-0 ${open ? "opacity-100" : "opacity-0"}`}
				style={{ transition: FADE }}
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
						<ViewerButton label={t("viewer.annotate")} onClick={() => setEditing(true)}>
							<Pencil size={15} strokeWidth={1.9} />
						</ViewerButton>
						<ViewerButton label={t("viewer.saveAs")} onClick={() => download(image.src)}>
							<Download size={15} strokeWidth={1.9} />
						</ViewerButton>
						<ViewerButton label={t("viewer.closeEsc")} onClick={dismiss}>
							<X size={16} strokeWidth={1.9} />
						</ViewerButton>
					</div>
				)}

				{/*
				 * Bottom left, clear of the annotation toolbar in the middle. Present in both modes:
				 * zooming in to place a mark precisely is the same need as zooming in to read one.
				 */}
				{/*
				 * The same height as the annotation toolbar, which shares this edge with it: a 38pt pill
				 * beside a 50pt bar read as two families of control, the smaller one an afterthought.
				 */}
				<div ref={zoomPill} data-ly-viewer-zoom="" className="pointer-events-auto absolute bottom-3 left-6 flex items-center gap-1 rounded-2xl border border-white/12 bg-[#1c1c1e]/92 px-2 py-1.5 shadow-[0_8px_32px_rgba(0,0,0,0.45)] backdrop-blur-xl">
					<ViewerButton label={t("viewer.zoomOut")} pill disabled={zoom <= ZOOM_MIN} onClick={() => zoomTo(zoom / ZOOM_STEP)}>
						<Minus size={16} strokeWidth={2} />
					</ViewerButton>
					<button
						type="button"
						data-ly-tip={t("viewer.actualSize")}
						data-ly-tip-side="top"
						aria-label={t("viewer.zoomIs", { percent: Math.round(zoom * 100) })}
						onClick={resetView}
						className="h-9 min-w-[54px] rounded-lg px-1.5 text-center text-label text-white/80 tabular-nums transition-colors duration-[var(--ly-t-quick)] hover:bg-white/12 hover:text-white"
					>
						{Math.round(zoom * 100)}%
					</button>
					<ViewerButton label={t("viewer.zoomIn")} pill disabled={zoom >= ZOOM_MAX} onClick={() => zoomTo(zoom * ZOOM_STEP)}>
						<Plus size={16} strokeWidth={2} />
					</ViewerButton>
					<ViewerButton label={t("viewer.fit")} pill onClick={resetView}>
						<Maximize2 size={15} strokeWidth={2} />
					</ViewerButton>
				</div>

				{shown.images.length > 1 && !editing && (
					<>
						<div className="pointer-events-auto absolute top-1/2 left-4 -translate-y-1/2">
							<ViewerButton label={t("viewer.prev")} onClick={() => step(-1)}>
								<ChevronLeft size={18} strokeWidth={1.9} />
							</ViewerButton>
						</div>
						<div className="pointer-events-auto absolute top-1/2 right-4 -translate-y-1/2">
							<ViewerButton label={t("viewer.next")} onClick={() => step(1)}>
								<ChevronRight size={18} strokeWidth={1.9} />
							</ViewerButton>
						</div>
						<div className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-black/45 px-2.5 py-1 text-detail text-white/85 tabular-nums">
							{shown.index + 1} / {shown.images.length}
						</div>
					</>
				)}
			</div>

			{editing && (
				/*
				 * Held by a fixed box of its own, placed in window coordinates, so it can be dragged anywhere
				 * in the window — see `useMovableBar`, which also eases it into place when it settles, so a
				 * bar let go on the zoom control slides off it.
				 */
				<div ref={bar.measure} data-annotate-bar="" className="pointer-events-none fixed z-[120]" style={bar.style}>
				<AnnotateToolbar
					annotator={annotator}
					size="large"
					onGrab={bar.startDrag}
					grabbing={bar.dragging}
					className={BAR_SURFACE}
					canReplace={Boolean(image.onReplace)}
					delivers={!image.onReplace && Boolean(image.onAttach)}
					/*
					 * Handing the picture on unmarked is a real request — "make another like this one" — but
					 * not before the canvas has the picture in it: an undecoded canvas reads back as a blank
					 * 300×150 PNG. Not ready, and so not dirty either, the button waits like any other.
					 */
					requireDirty={Boolean(image.onReplace) || !image.onAttach || !annotator.ready}
					// Out with everything else on the way back; the bar fades itself in on arrival.
					style={leaving ? { opacity: 0, pointerEvents: "none" } : undefined}
					onCancel={() => setEditing(false)}
					onSave={() => {
						/*
						 * Replace where that is possible, hand on where that is wanted, copy otherwise.
						 *
						 * An image already sent is part of the record and rewriting it in place would
						 * change what was said. A picture in a conversation goes to that conversation's
						 * composer, because the next thing anyone does with a marked-up drawing is ask
						 * for it to be drawn again with the marks taken into account — `image_generate`
						 * reads the newest picture in the conversation as `#1`. Anything else goes to
						 * the clipboard, the commonest next step for an annotated screenshot.
						 */
						const save = () => {
							const dataUrl = annotator.render();
							if (!dataUrl) return;
							if (image.onReplace) {
								image.onReplace(dataUrl);
								void toClipboard(dataUrl);
							} else if (image.onAttach) {
								image.onAttach(dataUrl);
							} else {
								void toClipboard(dataUrl);
							}
							dismiss();
						};
						/*
						 * A caption still being typed is committed first, and the canvas given a frame
						 * to take it.
						 *
						 * The toolbar never takes focus — that is what lets you change the size of the
						 * caption you are writing — so pressing save with the cursor still in one used
						 * to produce a copy without it. `render()` reads the canvas, and until the
						 * repaint effect has run the caption is only in a `<textarea>` above it.
						 */
						if (annotator.flushText()) requestAnimationFrame(() => requestAnimationFrame(save));
						else save();
					}}
				/>
				</div>
			)}
		</div>);
}

function ViewerButton({
	label,
	onClick,
	disabled,
	pill,
	children,
}: {
	label: string;
	onClick: () => void;
	disabled?: boolean;
	/** Inside the zoom pill, which is its background: no fill of its own, and the pill's height. */
	pill?: boolean;
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
				pill ? "h-9 w-9 hover:bg-white/12" : "h-8 w-8 bg-black/45 hover:bg-black/65"
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
		useApp.getState().notify(translate("viewer.copied"));
	} catch {
		// The clipboard refuses while the window is not focused, and refuses entirely on some
		// platforms. Losing the annotation to that would be the worst of the outcomes.
		download(dataUrl);
		useApp.getState().notify(translate("viewer.clipboardUnavailable"), "warn");
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
 * The thumbnail as it is on screen now: the part of it the picture is painted in, and its corners.
 *
 * Read from the element rather than taken from the rectangle recorded at the click, because the way
 * back can be minutes later — a reply streaming in underneath scrolls the conversation, and a picture
 * flying home to where its thumbnail *used* to be lands on whatever is there now. The recorded
 * rectangle is only the fallback for a thumbnail that is gone.
 *
 * The picture inside rather than the element that was clicked: a trace's image sits in a button as
 * wide as the panel, and flying out of the button started the picture wider than anything that had
 * been on screen.
 */
function thumbOf(element: HTMLElement | null, recorded: DOMRect | null): Thumb | null {
	if (element?.isConnected) {
		const frame = element.getBoundingClientRect();
		const img = element instanceof HTMLImageElement ? element : element.querySelector("img");
		let box: Box = frame;
		let radius = parseFloat(getComputedStyle(element).borderTopLeftRadius) || 0;
		if (img) {
			const style = getComputedStyle(img);
			box = intersect(paintedBox(img.getBoundingClientRect(), { width: img.naturalWidth, height: img.naturalHeight }, style.objectFit), frame);
			radius = Math.max(radius, parseFloat(style.borderTopLeftRadius) || 0);
		}
		if (box.width > 0 && box.height > 0) return { box, radius };
	}
	return recorded && recorded.width > 0 && recorded.height > 0 ? { box: recorded, radius: 0 } : null;
}

/** The corners the picture has at rest in the viewer — the `<img>`'s own, which the flight ends on. */
function restingRadius(figure: HTMLElement): number {
	const img = figure.querySelector("img");
	return img ? parseFloat(getComputedStyle(img).borderTopLeftRadius) || 0 : 0;
}

function intersect(a: Box, b: Box): Box {
	const x = Math.max(a.x, b.x);
	const y = Math.max(a.y, b.y);
	return { x, y, width: Math.max(0, Math.min(a.x + a.width, b.x + b.width) - x), height: Math.max(0, Math.min(a.y + a.height, b.y + b.height) - y) };
}

/** A `data:` URL is already the file; an anchor is the whole of "save as" for one. */
function download(src: string) {
	const link = document.createElement("a");
	link.href = src;
	link.download = `image-${Date.now()}.png`;
	link.click();
}
