/**
 * The app's own video player: a clip made in a conversation, a video in 创作, a video file in the
 * file pane — one player, in the glass the buttons on a drawn picture use (`image-gen.css`), rather
 * than the system's controls, which draw a different bar on every platform and none in this app's hand.
 *
 * What it does is what a person reaches for: a large play mark while it is paused, a bar along the
 * bottom with play, the time, a track to drag, sound, full screen and a menu, and the bar out of the
 * way while the clip plays and the pointer is still. Keys work once anything in it has focus — click
 * the picture: space or K plays and pauses, ← → step five seconds, M mutes, F fills the window, Esc
 * steps back out.
 *
 * Two sizes past the inline one, because they are two different requests. The full-screen button
 * fills the app's window: the clip over every panel, the window where it was and still a window —
 * watching a clip is not a reason to leave the desktop. Taking over the whole screen is a choice of its
 * own, in the menu, and leaving it goes back to the size it was asked from. Filling the window lifts the
 * player into the top layer (`popover`) instead of moving it: a moved `<video>` is a new element, and
 * the clip would start again from the first frame. Covering the window, it is the window's one dialog
 * for as long as it does: keys go to it wherever focus was left, Tab goes round its own controls rather
 * than on to the ones it hides, and the title strip's drag region gives way to it (`video.css`).
 *
 * `#t=0.001` on the source is what paints the first frame before anything is played — without it a
 * paused `<video>` is a black box until play.
 */

import { Maximize, Maximize2, Minimize, Minimize2, MoreHorizontal, Pause, Play, RotateCcw, VideoOff, Volume2, VolumeX } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "../../i18n/index.ts";
import { formatClock } from "../../lib/clock.ts";
import { ActionSpinner } from "../motion/loaders.tsx";
import { dismissHoverLayers } from "../overlay/hover-layers.ts";

/** How long the pointer has to rest before the bar steps aside for the picture. */
const IDLE_MS = 2200;
/** One press of ← or →. */
const STEP_S = 5;

type Size = "inline" | "window" | "screen";

/*
 * In and out of the top layer through `popover="manual"`: above every panel and out of every clipping
 * ancestor, while the element stays where React put it. Where the popover API is missing — a test's
 * DOM — the attribute alone does it, by fixed positioning (`video.css`).
 */
function lift(el: HTMLElement | null, on: boolean) {
	if (!el) return;
	const layer = el as HTMLElement & { showPopover?: () => void; hidePopover?: () => void };
	if (on) {
		el.setAttribute("popover", "manual");
		layer.showPopover?.();
	} else if (el.hasAttribute("popover")) {
		try {
			layer.hidePopover?.();
		} catch {
			// Not showing: nothing to take down.
		}
		el.removeAttribute("popover");
	}
}

/** Tab and Shift-Tab, round the player's own controls. */
function cycle(el: HTMLElement, by: 1 | -1) {
	const stops = [...el.querySelectorAll<HTMLElement>("button:not([disabled]), [tabindex='0']")].filter((stop) => stop.checkVisibility?.() ?? true);
	if (stops.length === 0) return;
	const at = stops.indexOf(document.activeElement as HTMLElement);
	stops[at < 0 ? (by > 0 ? 0 : stops.length - 1) : (at + by + stops.length) % stops.length].focus();
}

const leaveScreen = () => void document.exitFullscreen?.().catch(() => {});

export function VideoPlayer({ src, label, className = "", style }: { src: string; label?: string; className?: string; style?: React.CSSProperties }) {
	const { t } = useI18n();
	const box = useRef<HTMLDivElement>(null);
	const video = useRef<HTMLVideoElement>(null);
	const track = useRef<HTMLDivElement>(null);
	const more = useRef<HTMLButtonElement>(null);
	const menuBox = useRef<HTMLDivElement>(null);
	const idle = useRef<number | undefined>(undefined);
	const [playing, setPlaying] = useState(false);
	const [time, setTime] = useState(0);
	const [duration, setDuration] = useState(0);
	const [buffered, setBuffered] = useState(0);
	const [muted, setMuted] = useState(false);
	const [waiting, setWaiting] = useState(false);
	const [ended, setEnded] = useState(false);
	const [failed, setFailed] = useState(false);
	const [size, setSize] = useState<Size>("inline");
	// Read by handlers that outlive the render they were made in.
	const sizeNow = useRef<Size>("inline");
	sizeNow.current = size;
	/** The size the screen's full screen was asked from, and goes back to. */
	const asked = useRef<"inline" | "window">("inline");
	const [awake, setAwake] = useState(true);
	const [dragging, setDragging] = useState(false);
	const [menu, setMenu] = useState(false);

	const toggle = useCallback(() => {
		const el = video.current;
		if (!el || failed) return;
		if (el.paused || el.ended) void el.play().catch(() => {});
		else el.pause();
	}, [failed]);

	const step = (seconds: number) => {
		const el = video.current;
		if (!el || !Number.isFinite(el.duration)) return;
		el.currentTime = Math.min(el.duration, Math.max(0, el.currentTime + seconds));
	};

	const toggleMute = () => {
		const el = video.current;
		if (el) el.muted = !el.muted;
	};

	const closeMenu = (refocus: boolean) => {
		setMenu(false);
		if (refocus) more.current?.focus();
	};

	const fillWindow = (on: boolean) => {
		lift(box.current, on);
		setSize(on ? "window" : "inline");
	};

	/** The full-screen button, F and a double click: the window and back — from the screen, back to where it was asked from. */
	const toggleWindow = () => {
		if (sizeNow.current === "screen") leaveScreen();
		else fillWindow(sizeNow.current === "inline");
	};

	const toggleScreen = () => {
		closeMenu(true);
		const el = box.current;
		if (sizeNow.current === "screen") leaveScreen();
		else if (el && typeof el.requestFullscreen === "function") {
			const from = sizeNow.current === "window" ? "window" : "inline";
			asked.current = from;
			// A showing popover cannot also be the full-screen element: out of the top layer first.
			if (from === "window") lift(el, false);
			el.requestFullscreen().catch(() => {
				if (from === "window") lift(el, true);
			});
		}
	};

	/** The bar comes back on any movement, and goes again once the pointer has been still a while. */
	const wake = () => {
		setAwake(true);
		window.clearTimeout(idle.current);
		idle.current = window.setTimeout(() => setAwake(false), IDLE_MS);
	};
	useEffect(() => () => window.clearTimeout(idle.current), []);

	useEffect(() => {
		const onChange = () => {
			const el = box.current;
			if (!el) return;
			if (document.fullscreenElement === el) setSize("screen");
			else if (sizeNow.current === "screen") {
				if (asked.current === "window") lift(el, true);
				setSize(asked.current);
			}
		};
		document.addEventListener("fullscreenchange", onChange);
		return () => document.removeEventListener("fullscreenchange", onChange);
	}, []);

	// A tip or a hover card on screen belongs to the size just left: its control has moved, or gone behind.
	const shownAt = useRef<Size>("inline");
	useEffect(() => {
		if (shownAt.current === size) return;
		shownAt.current = size;
		dismissHoverLayers();
	}, [size]);

	/*
	 * Esc steps back once — out of the menu, then out of the size — before anything else hears it: in 创作
	 * the same key closes the whole view. Covering the window, the player is all there is to type to: a
	 * key lands on it wherever focus was left, Tab goes round its own controls, and focus sent behind it
	 * comes back.
	 */
	useEffect(() => {
		const el = box.current;
		if (!el || (size === "inline" && !menu)) return;
		const onKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				event.preventDefault();
				event.stopImmediatePropagation();
				// Stopped here, it never reaches the tooltip's own Esc: a bubble left showing goes now.
				dismissHoverLayers();
				if (menu) closeMenu(true);
				else if (size === "window") fillWindow(false);
				else leaveScreen();
			} else if (size !== "inline" && event.key === "Tab") {
				event.preventDefault();
				event.stopImmediatePropagation();
				cycle(el, event.shiftKey ? -1 : 1);
				wake();
			} else if (size !== "inline" && !(event.target instanceof Node && el.contains(event.target))) {
				keyRef.current(event);
			}
		};
		const onFocus = (event: FocusEvent) => {
			if (size !== "inline" && event.target instanceof Node && !el.contains(event.target)) video.current?.focus();
		};
		window.addEventListener("keydown", onKey, true);
		document.addEventListener("focusin", onFocus, true);
		return () => {
			window.removeEventListener("keydown", onKey, true);
			document.removeEventListener("focusin", onFocus, true);
		};
	});

	// Opened, the menu has the focus, so the keyboard is where the choice is.
	useEffect(() => {
		if (menu) menuBox.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
	}, [menu]);

	// The menu goes on any press outside it, as menus do.
	useEffect(() => {
		if (!menu) return;
		const onDown = (event: PointerEvent) => {
			if (!(event.target instanceof Element) || !event.target.closest("[data-ly-video-menu], [data-ly-video-more]")) setMenu(false);
		};
		document.addEventListener("pointerdown", onDown, true);
		return () => document.removeEventListener("pointerdown", onDown, true);
	}, [menu]);

	// A new source is a new clip: nothing about the last one carries over.
	useEffect(() => {
		setPlaying(false);
		setTime(0);
		setDuration(0);
		setBuffered(0);
		setEnded(false);
		setFailed(false);
		setWaiting(false);
	}, [src]);

	const readBuffered = (el: HTMLVideoElement) => {
		const ranges = el.buffered;
		setBuffered(ranges.length > 0 ? ranges.end(ranges.length - 1) : 0);
	};

	/** The track position under the pointer, as a time. */
	const timeAt = (clientX: number): number => {
		const rect = track.current?.getBoundingClientRect();
		if (!rect || rect.width <= 0 || !duration) return 0;
		return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)) * duration;
	};

	const seek = (seconds: number) => {
		const el = video.current;
		if (!el) return;
		el.currentTime = seconds;
		setTime(seconds);
	};

	/*
	 * Keys and the pointer, listened for on the whole player rather than on one control: a key pressed
	 * on any of its buttons, on the track, or on the picture (focused by clicking it) is a key for the
	 * player, and the bar wakes wherever the pointer moves over it. Through the latest render's
	 * handlers, so the listeners are attached once.
	 */
	const keyRef = useRef<(event: KeyboardEvent) => void>(() => {});
	keyRef.current = (event) => {
		if (event.metaKey || event.ctrlKey || event.altKey) return;
		const key = event.key.toLowerCase();
		const actions: Record<string, () => void> = { " ": toggle, k: toggle, arrowleft: () => step(-STEP_S), arrowright: () => step(STEP_S), m: toggleMute, f: toggleWindow };
		const action = actions[key];
		// Space on a button presses that button; the player only takes it from the picture and the track.
		if (!action || (key === " " && event.target instanceof HTMLButtonElement)) return;
		event.preventDefault();
		event.stopPropagation();
		action();
		wake();
	};
	const pointerRef = useRef<(event: PointerEvent) => void>(() => {});
	pointerRef.current = (event) => {
		if (event.type === "pointerleave") {
			if (playing && !menu) setAwake(false);
		} else wake();
	};
	useEffect(() => {
		const el = box.current;
		if (!el) return;
		const onKey = (event: KeyboardEvent) => keyRef.current(event);
		const onPointer = (event: PointerEvent) => pointerRef.current(event);
		el.addEventListener("keydown", onKey);
		el.addEventListener("pointermove", onPointer);
		el.addEventListener("pointerleave", onPointer);
		return () => {
			el.removeEventListener("keydown", onKey);
			el.removeEventListener("pointermove", onPointer);
			el.removeEventListener("pointerleave", onPointer);
		};
	}, []);

	const shown = !playing || awake || dragging || menu;
	const played = duration > 0 ? (time / duration) * 100 : 0;
	const loaded = duration > 0 ? Math.min(100, (buffered / duration) * 100) : 0;
	const state = failed ? "failed" : ended ? "ended" : playing ? "playing" : "paused";
	const large = size !== "inline";
	const screenable = document.fullscreenEnabled === true;
	const fullLabel = size === "screen" ? t("video.screenExit") : large ? t("video.exitFullscreen") : t("video.fullscreen");

	return (
		<div
			ref={box}
			role={large ? "dialog" : "group"}
			aria-modal={large || undefined}
			aria-label={label || t("video.player")}
			data-ly-video-player={state}
			data-size={size}
			data-idle={playing && !shown ? "" : undefined}
			className={`ly-video ${className}`}
			style={style}
		>
			{/* oxlint-disable-next-line jsx-a11y/media-has-caption -- a generated clip has no caption track to offer. */}
			<video
				ref={video}
				src={`${src}#t=0.001`}
				preload="metadata"
				playsInline
				// Focused by a click, not by Tab: Tab goes to the buttons, a click on the picture is a click on the player.
				tabIndex={-1}
				className="ly-video-media"
				onClick={toggle}
				onDoubleClick={toggleWindow}
				onPlay={() => {
					setPlaying(true);
					setEnded(false);
					wake();
				}}
				onPause={() => setPlaying(false)}
				onEnded={() => {
					setPlaying(false);
					setEnded(true);
				}}
				onTimeUpdate={(event) => !dragging && setTime(event.currentTarget.currentTime)}
				onLoadedMetadata={(event) => setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0)}
				onDurationChange={(event) => setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0)}
				onProgress={(event) => readBuffered(event.currentTarget)}
				onWaiting={() => setWaiting(true)}
				onPlaying={() => setWaiting(false)}
				onCanPlay={() => setWaiting(false)}
				onVolumeChange={(event) => setMuted(event.currentTarget.muted)}
				onError={() => setFailed(true)}
			/>

			{waiting && !failed && (
				<span className="ly-video-wait" aria-hidden>
					<ActionSpinner size={22} />
				</span>
			)}

			{failed && (
				<div className="ly-video-failed" role="status">
					<VideoOff size={22} strokeWidth={1.7} aria-hidden />
					<span>{t("video.unplayable")}</span>
				</div>
			)}

			{!playing && !failed && (
				<button type="button" className="ly-video-big" onClick={toggle} aria-label={ended ? t("video.replay") : t("video.play")} data-ly-video-play="">
					{ended ? <RotateCcw size={22} strokeWidth={2} /> : <Play size={22} strokeWidth={2} className="ml-[3px] fill-current" />}
				</button>
			)}

			{menu && screenable && (
				<div ref={menuBox} className="ly-video-menu" role="menu" aria-label={t("video.more")} data-ly-video-menu="">
					<button type="button" role="menuitem" className="ly-video-menu-item" onClick={toggleScreen} data-ly-video-screen="">
						{size === "screen" ? <Minimize size={15} strokeWidth={2} aria-hidden /> : <Maximize size={15} strokeWidth={2} aria-hidden />}
						<span className="min-w-0">
							<span className="block">{size === "screen" ? t("video.screenExit") : t("video.screenFull")}</span>
							{size !== "screen" && <span className="ly-video-menu-detail">{t("video.screenFullDetail")}</span>}
						</span>
					</button>
				</div>
			)}

			{!failed && (
				<div className="ly-video-bar" data-shown={shown ? "" : undefined} onDoubleClick={(event) => event.stopPropagation()}>
					<button type="button" className="ly-video-btn" onClick={toggle} aria-label={playing ? t("video.pause") : t("video.play")} data-ly-tip={playing ? t("video.pause") : t("video.play")}>
						{playing ? <Pause size={15} strokeWidth={2} className="fill-current" /> : <Play size={15} strokeWidth={2} className="fill-current" />}
					</button>
					<span className="ly-video-time" data-ly-video-time="">
						{formatClock(time)} / {formatClock(duration)}
					</span>
					<div
						ref={track}
						className="ly-video-track"
						role="slider"
						tabIndex={0}
						aria-label={t("video.seek")}
						aria-valuemin={0}
						aria-valuemax={Math.round(duration)}
						aria-valuenow={Math.round(time)}
						aria-valuetext={`${formatClock(time)} / ${formatClock(duration)}`}
						data-active={dragging ? "" : undefined}
						onPointerDown={(event) => {
							if (!duration) return;
							event.currentTarget.setPointerCapture(event.pointerId);
							setDragging(true);
							seek(timeAt(event.clientX));
						}}
						onPointerMove={(event) => dragging && seek(timeAt(event.clientX))}
						onPointerUp={(event) => {
							event.currentTarget.releasePointerCapture(event.pointerId);
							setDragging(false);
						}}
						onPointerCancel={() => setDragging(false)}
					>
						<span className="ly-video-rail" aria-hidden />
						<span className="ly-video-buffered" style={{ width: `${loaded}%` }} aria-hidden />
						<span className="ly-video-played" style={{ width: `${played}%` }} aria-hidden />
						<span className="ly-video-thumb" style={{ left: `${played}%` }} aria-hidden />
					</div>
					<button type="button" className="ly-video-btn ly-video-mute" onClick={toggleMute} aria-label={muted ? t("video.unmute") : t("video.mute")} data-ly-tip={muted ? t("video.unmute") : t("video.mute")}>
						{muted ? <VolumeX size={15} strokeWidth={2} /> : <Volume2 size={15} strokeWidth={2} />}
					</button>
					<button type="button" className="ly-video-btn" onClick={toggleWindow} aria-label={fullLabel} data-ly-tip={fullLabel} data-ly-video-full="">
						{large ? <Minimize2 size={15} strokeWidth={2} /> : <Maximize2 size={15} strokeWidth={2} />}
					</button>
					{screenable && (
						<button
							ref={more}
							type="button"
							className="ly-video-btn ly-video-more"
							onClick={() => setMenu((open) => !open)}
							aria-label={t("video.more")}
							aria-haspopup="menu"
							aria-expanded={menu}
							data-ly-tip={t("video.more")}
							data-ly-video-more=""
						>
							<MoreHorizontal size={15} strokeWidth={2} />
						</button>
					)}
				</div>
			)}
		</div>
	);
}
