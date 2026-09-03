/**
 * Window-size driven layout modes.
 *
 * The window can be dragged from full screen down to 380pt, and the shell has to change shape
 * along the way rather than just squeezing. Three modes:
 *
 *   wide     ≥1180  sidebar pushes the content; the dock has room for panes side by side
 *   regular  ≥760   sidebar still pushes; the dock is tighter but still divides
 *   compact  <760   sidebar becomes a full-window drawer; the dock shows one pane at a time
 *
 * The mode lives in one place so behaviour (drawer vs push) and styling (paddings, card
 * columns) can never disagree — a phone-shaped window wearing desktop paddings was the
 * failure this replaces. `data-layout` is mirrored onto <html> for the few rules that are
 * easier to express in CSS than in props.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { SIDEBAR_DEFAULT, SIDEBAR_MAX, SIDEBAR_MIN, storedWidth } from "./layout-widths.ts";
import { freezeMotion } from "./motion-freeze.ts";
import { useDrawerGesture, useKeyboardInset } from "./mobile/useMobileShell.ts";
import { overlayReserved, titlebarInsets, type TitlebarInsets } from "./titlebar.ts";
import { bridge, onPhone } from "./services/index.ts";

/** Below this the sidebar and a readable content column no longer fit side by side. */
const COMPACT_MAX = 760;
/** Above this the dock can hold panes beside the conversation without starving either. */
const WIDE_MIN = 1180;

export type LayoutMode = "compact" | "regular" | "wide";

function modeFor(width: number): LayoutMode {
	if (width < COMPACT_MAX) return "compact";
	if (width < WIDE_MIN) return "regular";
	return "wide";
}

export interface LayoutValue {
	mode: LayoutMode;
	compact: boolean;
	/** True when there is room for a full-width side panel rather than a squeezed one. */
	wide: boolean;
	/** Current window width, for callers that budget space rather than just pick a mode. */
	width: number;
	/** Whether the navigation pane is showing, in whichever form this mode uses. */
	navOpen: boolean;
	/**
	 * The sidebar's width, as the user last dragged it.
	 *
	 * A *preference*, clamped only to its own sensible bounds. What actually fits also depends on
	 * the window, so the layout narrows it further at render time without overwriting this — drag
	 * the window in and back out, and the sidebar returns to the width that was asked for.
	 *
	 * There used to be a second one here for the right-hand panel. The dock divides itself in
	 * shares and remembers them per project, so there is no single width left to keep.
	 */
	sidebarWidth: number;
	setSidebarWidth: (next: number) => void;
	resetSidebarWidth: () => void;
	/** The bounds the handle enforces, so callers do not restate them. */
	bounds: { sidebar: { min: number; max: number } };
	/**
	 * The window is in macOS native full screen, so the traffic lights are not drawn.
	 *
	 * Everything that insets itself to clear them has to stop doing so, or the space they would
	 * have occupied stays open around nothing.
	 */
	nativeFullScreen: boolean;
	/**
	 * How much of the window's top row the system has taken, at each end.
	 *
	 * macOS puts its traffic lights on the left and nothing on the right; Windows and Linux paint
	 * minimise/maximise/close on the right and nothing on the left. Both are drawn *over* the page
	 * — they are not in the document and cannot be measured from it — so anything in that row has
	 * to be told to stay out of the way. See `useTitlebar`.
	 */
	titlebar: { start: number; end: number };
	toggleNav: () => void;
	/**
	 * Close the drawer after an action that navigates somewhere. A no-op outside compact,
	 * because a pushed sidebar should stay put when you pick a session from it.
	 */
	dismissNav: () => void;
	/**
	 * Put the sidebar away in whichever form it is currently in.
	 *
	 * Unlike `dismissNav` this also collapses a pushed sidebar — used when opening the side
	 * panel would otherwise leave the conversation too narrow to read. Navigation is the thing
	 * you need least while working in two panes at once.
	 */
	collapseNav: () => void;
}

/**
 * The sidebar's width, persisted in `localStorage` rather than in Settings: a per-window
 * preference with no meaning on the phone. Reading it synchronously on the first render is what
 * stops the pane jumping from its default to the saved width a frame later.
 */

const LayoutContext = createContext<LayoutValue | null>(null);

export function LayoutProvider({ children }: { children: React.ReactNode }) {
	const [width, setWidth] = useState(() => window.innerWidth);
	const mode = modeFor(width);
	// The two forms keep separate state: entering compact must not throw a full-window drawer
	// in the user's face, and leaving it must not hide a sidebar they had open.
	const [pushOpen, setPushOpen] = useState(true);
	const [drawerOpen, setDrawerOpen] = useState(false);

	const [sidebarWidth, setSidebarWidthState] = useState(() =>
		storedWidth("dw:sidebar-width", SIDEBAR_DEFAULT, SIDEBAR_MIN, SIDEBAR_MAX),
	);
	/*
	 * Written on every frame of the drag, deliberately.
	 *
	 * `localStorage` is synchronous, and one small string per frame is nothing next to the
	 * relayout the same frame is already doing. Debouncing it would mean a width lost whenever
	 * the app is closed within the debounce window — the one moment it matters most.
	 */
	const setSidebarWidth = useCallback((next: number) => {
		const clamped = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, next));
		setSidebarWidthState(clamped);
		window.localStorage.setItem("dw:sidebar-width", String(Math.round(clamped)));
	}, []);

	const resetSidebarWidth = useCallback(() => setSidebarWidth(SIDEBAR_DEFAULT), [setSidebarWidth]);

	/*
	 * Freeze transitions for the duration of a drag.
	 *
	 * Every pane here animates its width or margin over ~200ms. That is right for a click, and
	 * wrong while an edge is being dragged: each frame restarts an animation the next frame
	 * overrides, so the panes trail the window instead of tracking it, and the composited
	 * layers (the blur behind menus, the mask on the tab strip) smear over what has already
	 * been repainted. Marking the drag lets CSS drop the animation and land on the final
	 * geometry immediately; the flag clears shortly after the last resize event.
	 */
	useEffect(() => {
		let idle: number | undefined;
		let thaw: (() => void) | null = null;
		const onResize = () => {
			setWidth(window.innerWidth);
			// One freeze for the whole stream of resize events, released when they stop arriving.
			// See `motion-freeze.ts` — this is a class on a handful of elements, not a flag on the
			// root, because the root is above the transcript.
			thaw ??= freezeMotion();
			document.documentElement.dataset.resizing = "";
			window.clearTimeout(idle);
			idle = window.setTimeout(() => {
				thaw?.();
				thaw = null;
				delete document.documentElement.dataset.resizing;
			}, 140);
		};
		window.addEventListener("resize", onResize);
		return () => {
			window.removeEventListener("resize", onResize);
			window.clearTimeout(idle);
			thaw?.();
			delete document.documentElement.dataset.resizing;
		};
	}, []);

	useEffect(() => {
		document.documentElement.dataset.layout = mode;
	}, [mode]);

	const compact = mode === "compact";

	/*
	 * Reported by the window, because the page has no way to see it.
	 *
	 * The lights are drawn by macOS outside the document, and `titlebar-area-*` is the Windows
	 * overlay API rather than a general one. Defaults to false, which is right for every other
	 * platform and for the ordinary windowed case.
	 */
	const [nativeFullScreen, setNativeFullScreen] = useState(false);
	useEffect(() => bridge.onFullScreenChange?.(setNativeFullScreen), []);

	const titlebar = useTitlebar(nativeFullScreen);

	// Crossing the breakpoint in either direction dismisses the drawer; it is a transient
	// overlay, and carrying it across a reflow leaves it stranded over the wrong layout.
	useEffect(() => {
		setDrawerOpen(false);
	}, [compact]);

	const toggleNav = useCallback(() => {
		if (compact) setDrawerOpen((open) => !open);
		else setPushOpen((open) => !open);
	}, [compact]);

	const dismissNav = useCallback(() => {
		if (compact) setDrawerOpen(false);
	}, [compact]);

	const collapseNav = useCallback(() => {
		if (compact) setDrawerOpen(false);
		else setPushOpen(false);
	}, [compact]);

	/*
	 * The phone's two additions to the shell, mounted here because this is where the drawer's state
	 * lives. Both are inert in a window — see `onPhone` — so a narrow desktop window is unaffected.
	 */
	useKeyboardInset();
	useDrawerGesture(compact && drawerOpen, setDrawerOpen);

	const value = useMemo<LayoutValue>(
		() => ({
			mode,
			compact,
			wide: mode === "wide",
			width,
			navOpen: compact ? drawerOpen : pushOpen,
			nativeFullScreen,
			titlebar,
			sidebarWidth,
			setSidebarWidth,
			resetSidebarWidth,
			bounds: { sidebar: { min: SIDEBAR_MIN, max: SIDEBAR_MAX } },
			toggleNav,
			dismissNav,
			collapseNav,
		}),
		[
			mode,
			compact,
			width,
			drawerOpen,
			pushOpen,
			nativeFullScreen,
			titlebar,
			sidebarWidth,
			setSidebarWidth,
			resetSidebarWidth,
			toggleNav,
			dismissNav,
			collapseNav,
		],
	);

	return <LayoutContext.Provider value={value}>{children}</LayoutContext.Provider>;
}

export function useLayout(): LayoutValue {
	const value = useContext(LayoutContext);
	if (!value) throw new Error("useLayout must be used inside <LayoutProvider>");
	return value;
}

/**
 * What the system has drawn into the window's top row, and where — see `titlebar.ts` for the rule.
 *
 * This half is the subscription. `geometrychange` fires when the overlay is resized or hidden,
 * which happens on maximise and on any change to the system's own title bar metrics; reading it
 * once at mount was enough to be wrong after the first double-click on the title bar.
 */
function useTitlebar(nativeFullScreen: boolean): TitlebarInsets {
	const overlay = typeof navigator === "undefined" ? undefined : navigator.windowControlsOverlay;
	const [reserved, setReserved] = useState(() => overlayReserved(overlay, window.innerWidth));

	useEffect(() => {
		if (!overlay) return;
		const update = () => setReserved(overlayReserved(overlay, window.innerWidth));
		update();
		overlay.addEventListener("geometrychange", update);
		return () => overlay.removeEventListener("geometrychange", update);
	}, [overlay]);

	return useMemo(
		() => titlebarInsets(bridge.platform ?? "darwin", nativeFullScreen, reserved, !onPhone()),
		[nativeFullScreen, reserved],
	);
}

/** What the dock keeps for itself before the sidebar is allowed any more of the window. */
const CONTENT_MIN = 420;

/**
 * How wide the sidebar is actually drawn, which is not always how wide it was set to be.
 *
 * `sidebarWidth` is a *preference* — what it was last dragged to, remembered across launches. What
 * fits is a different question, and it changes with the window. Clamping here rather than writing
 * the smaller number back is what keeps the preference intact: widen the window again and the
 * sidebar returns to what it was, because nothing overwrote it.
 *
 * This is all that survives of `usePanelLayout`. The rest of that file existed to arbitrate
 * between a conversation column and a side panel that could squeeze it, cover it, or take the
 * whole window — three modes, two widths and a delayed handover of the window's own buttons. The
 * dock replaced that with a tree, and a tree divides itself.
 */
export function useSidebarFit(): { drawn: number; max: number } {
	const { width, sidebarWidth, bounds } = useLayout();
	const drawn = Math.max(bounds.sidebar.min, Math.min(sidebarWidth, width - CONTENT_MIN));
	return {
		/**
		 * Kept even while the sidebar is closed.
		 *
		 * A closed sidebar slides out; it does not shrink. Handed a width of zero it would have
		 * nothing to slide, so `marginLeft: -0` would move it nowhere and it would simply stop
		 * existing between one frame and the next. Reserving nothing in the row is the frame's job.
		 */
		drawn,
		/**
		 * Never below the floor — a ceiling under the floor would leave the drag handle unable to
		 * move in either direction on a window too small for both panes.
		 */
		max: Math.max(bounds.sidebar.min, Math.min(bounds.sidebar.max, width - CONTENT_MIN)),
	};
}

/**
 * Hold keyboard focus inside a full-window drawer and hand it back when the drawer goes.
 *
 * Without this, Tab walks straight out of a drawer that visually covers everything and lands
 * on the transcript behind it — the caret disappears and the next Enter hits the wrong thing.
 */
/** What counts as focusable, for the trap below. */
const FOCUSABLE =
	'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function useFocusTrap(ref: React.RefObject<HTMLElement | null>, active: boolean): void {
	useEffect(() => {
		const container = ref.current;
		if (!active || !container) return;

		const restoreTo = document.activeElement as HTMLElement | null;
		const focusable = () =>
			[...container.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null);

		focusable()[0]?.focus();

		const onKey = (event: KeyboardEvent) => {
			if (event.key !== "Tab") return;
			const list = focusable();
			if (list.length === 0) return;
			const first = list[0];
			const last = list[list.length - 1];
			if (event.shiftKey && document.activeElement === first) {
				event.preventDefault();
				last.focus();
			} else if (!event.shiftKey && document.activeElement === last) {
				event.preventDefault();
				first.focus();
			}
		};

		container.addEventListener("keydown", onKey);
		return () => {
			container.removeEventListener("keydown", onKey);
			// Only reclaim focus if it is still ours to give back; the user may have clicked
			// elsewhere, and stealing it back from them would be worse than losing it.
			const current = document.activeElement;
			if (current === document.body || container.contains(current)) restoreTo?.focus();
		};
	}, [ref, active]);
}

export { NavPane } from "./panes.tsx";
