/**
 * A screenshot left on the desktop: one picture, one close button, nothing else.
 *
 * This page is the whole of a pinned window. It is sized by the main process to the picture's own
 * dimensions before it loads, so there is no layout here to speak of — the image fills the window
 * exactly, and everything else is drawn on top of that.
 *
 * Dragging is done by hand rather than with `-webkit-app-region: drag`, and that is the one design
 * decision in the file. A drag region is handled by the window server, which means the page is not
 * told about the pointer inside it at all: no `pointermove`, and no `:hover`. The close button is
 * supposed to appear when the pointer is over the picture, so a drag region would have traded the
 * feature that was asked for against the one underneath it. Moving the window over IPC costs a
 * message per frame and keeps both.
 */

import { translate } from "../../i18n/translate.ts";
import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { bridge } from "../../services/index.ts";

interface PinnedImage {
	dataUrl: string;
	width: number;
	height: number;
}

export function PinnedShot() {
	const [image, setImage] = useState<PinnedImage | null>(null);
	const [hovered, setHovered] = useState(false);
	/** Whether the window is being dragged, so the picture can say so with its cursor. */
	const [dragging, setDragging] = useState(false);
	/** Where the pointer was when the drag began, in screen coordinates. */
	const from = useRef<{ x: number; y: number } | null>(null);

	/*
	 * Ask for the picture rather than waiting to be given it.
	 *
	 * This component is loaded on demand — it is one image and a button, and every other window in
	 * the app would otherwise carry it — so by the time it mounts, the window has been loaded for a
	 * chunk-fetch. A message pushed from the main process at load time has already been and gone,
	 * and Electron drops one with no listener silently: the window opened at the right size in the
	 * right place, showing nothing, with no error anywhere to say why.
	 */
	useEffect(() => {
		let alive = true;
		void bridge.pinnedShot?.request?.().then(
			(payload) => {
				if (alive && payload) setImage(payload);
			},
			() => {},
		);
		return () => {
			alive = false;
		};
	}, []);

	/*
	 * Say when the picture is actually on screen, not when it arrived.
	 *
	 * The window is created hidden and shown by this message. A transparent window shown before its
	 * contents have painted is a rectangle of desktop with a shadow around it — brief, but pinning
	 * happens at the end of a capture, which is already the busiest frame in the feature.
	 */
	useEffect(() => {
		if (!image) return;
		const img = new Image();
		img.onload = () => requestAnimationFrame(() => bridge.pinnedShot?.ready?.());
		// A picture that cannot be decoded still has to reveal its window, or there is an invisible
		// always-on-top window on screen with no way to close it.
		img.onerror = () => bridge.pinnedShot?.ready?.();
		img.src = image.dataUrl;
	}, [image]);

	/*
	 * The rest of the drag, on the window rather than on the picture.
	 *
	 * Two reasons, and the second one is the reason it is written this way. A pointer moving faster
	 * than the window can follow leaves the image behind between two events, so the drag would stop
	 * halfway. And the obvious fix for that — `setPointerCapture` on the image — is what produced a
	 * renderer that stopped answering input at all, intermittently, in the moment after a drag
	 * ended: a captured pointer inside a window that is itself chasing that pointer. A listener on
	 * the window has neither problem and needs nothing released afterwards.
	 *
	 * `screenX`/`screenY` rather than `clientX`: the window moves as the drag happens, so the
	 * pointer's position *within* it barely changes — a delta measured in client coordinates would
	 * be nearly zero and the window would go nowhere.
	 *
	 * One message per frame. A `pointermove` can arrive more often than the screen refreshes, and
	 * each one asks the main process to move a window; the extra ones cannot be seen and are work
	 * the compositor has to undo.
	 */
	useEffect(() => {
		if (!dragging) return;
		let queued: { dx: number; dy: number } | null = null;
		let frame = 0;
		const flush = () => {
			frame = 0;
			if (!queued) return;
			bridge.pinnedShot?.dragMove?.(queued.dx, queued.dy);
			queued = null;
		};
		const move = (event: PointerEvent) => {
			const start = from.current;
			if (!start) return;
			queued = { dx: Math.round(event.screenX - start.x), dy: Math.round(event.screenY - start.y) };
			if (!frame) frame = requestAnimationFrame(flush);
		};
		const end = () => {
			from.current = null;
			setDragging(false);
		};
		window.addEventListener("pointermove", move);
		window.addEventListener("pointerup", end);
		window.addEventListener("pointercancel", end);
		return () => {
			window.removeEventListener("pointermove", move);
			window.removeEventListener("pointerup", end);
			window.removeEventListener("pointercancel", end);
			if (frame) cancelAnimationFrame(frame);
		};
	}, [dragging]);

	// Escape closes the picture the pointer is on, which is the one that has focus.
	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				event.preventDefault();
				bridge.pinnedShot?.close?.();
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, []);

	if (!image) return <div data-pinned="loading" className="fixed inset-0 bg-transparent" />;

	return (
		<div
			data-pinned="shown"
			// The closed hand covers the whole window while it is being dragged, close button
			// included: the window is chasing the pointer, so the pointer stays inside it throughout.
			className={`fixed inset-0 overflow-hidden select-none ${dragging ? "cursor-grabbing [&_*]:cursor-grabbing" : ""}`}
			onPointerEnter={() => setHovered(true)}
			onPointerLeave={() => {
				// Never while the window is being dragged: the pointer leaves the window constantly
				// during one, because the window is chasing it.
				if (!from.current) setHovered(false);
			}}
			onDragStart={(event) => event.preventDefault()}
		>
			<img
				src={image.dataUrl}
				alt={translate("pinnedShot.title")}
				draggable={false}
				data-pinned-image
				/*
				 * A hairline around the picture, drawn inside it.
				 *
				 * macOS gives a frameless window a shadow and that is enough there; Windows and Linux
				 * give a transparent one nothing at all, so a screenshot of a white document pinned
				 * over a white document has no edge — it reads as part of what is underneath. An inset
				 * line costs the outermost pixel of the image and works the same on all three.
				 */
				className="block h-full w-full shadow-[inset_0_0_0_1px_rgba(255,255,255,0.16)]"
				style={{ cursor: dragging ? "grabbing" : "grab" }}
				/*
				 * The picture is the window's title bar.
				 *
				 * The press is taken here and the rest of the drag is followed on the window — see the
				 * effect above. Not `setPointerCapture`: capturing the pointer on an element inside a
				 * window that is itself chasing the pointer produced a renderer that stopped answering
				 * input altogether, intermittently, right after the drag ended. It cost nothing to
				 * give up, because a window-level listener covers the same ground.
				 */
				onPointerDown={(event) => {
					if (event.button !== 0) return;
					event.preventDefault();
					from.current = { x: event.screenX, y: event.screenY };
					setDragging(true);
					bridge.pinnedShot?.dragStart?.();
				}}
			/>

			{/*
			 * The close button, over the corner of the picture rather than beside it.
			 *
			 * Beside it would need the window to be bigger than the image, and a transparent margin
			 * is not empty space: Electron hit-tests a window by its frame, so that margin would
			 * swallow every click aimed at whatever is behind the picture.
			 */}
			<button
				type="button"
				data-pinned-close
				aria-label={translate("pinnedShot.close")}
				onPointerDown={(event) => event.stopPropagation()}
				onClick={() => bridge.pinnedShot?.close?.()}
				className="absolute top-1.5 right-1.5 flex size-6 items-center justify-center rounded-full border border-white/20 bg-black/65 text-white shadow-[0_2px_10px_rgba(0,0,0,0.45)] backdrop-blur-md transition-[opacity,transform] duration-[var(--ly-t-quick)] hover:bg-black/85"
				style={{
					opacity: hovered ? 1 : 0,
					transform: hovered ? "scale(1)" : "scale(0.9)",
					// Out of the way entirely when it is not shown, so it cannot take a press meant for
					// the picture — and so dragging by the top-right corner still drags.
					pointerEvents: hovered ? "auto" : "none",
				}}
			>
				<X size={13} strokeWidth={2.4} />
			</button>
		</div>
	);
}
