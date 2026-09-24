/**
 * One conversation's screen: its transcript and the panels it has open, arranged by its own tree.
 *
 * Every screen is drawn by this — a single screen is a split of one. There is no window-level dock
 * any more: a panel belongs to the conversation it was opened for, sits inside that conversation's
 * screen at the screen's full height, and goes wherever the conversation goes. The screen's title
 * bar (`header`) covers the transcript only, never a panel beside it. See
 * `docs/adr/0023-containers-belong-to-sessions.md` for the two-layer arrangement this replaced.
 *
 * Two rules hold this together, and both exist to keep a pane's contents alive across a
 * rearrangement — a terminal's shell, a page in the browser, an editor's undo history.
 *
 * **One flat list of panes, positioned absolutely.** Never a recursive render of the tree; see the
 * note at the top of `layout.ts`.
 *
 * **One DOM shape for every window size.** The narrow form is the same panes, each laid over the
 * whole screen with all but one hidden — not a different component. A layout that swaps its
 * structure at a breakpoint unmounts everything inside it.
 */

import { translate } from "../../i18n/translate.ts";
import { useEffect, useLayoutEffect, useMemo, useRef, type ReactNode } from "react";

import { useLayout } from "../../app/layout.tsx";
import { toolbarReserved } from "../../app/window/WindowControls.tsx";
import { freezeMotion } from "../../ui/motion/freeze.ts";
import { useApp } from "../../store/index.ts";
import { companionOf, renderPanel, renderPanelActions, renderPanelHeader, usePanelDefinitions } from "./panels/definitions.tsx";
import { pct } from "./css.ts";
import { HEADER_PAD, PANEL_MIN_WIDTH_PX, paneFloor } from "./geometry.ts";
import { DockPane } from "./DockPane.tsx";
import { PaneGrip } from "./PaneGrip.tsx";
import { Splitter } from "./Splitter.tsx";
import { fitTree, layoutPanes, layoutSplitters, type Box, type SplitterBox } from "./layout.ts";
import { popOutPanel } from "./popout.ts";
import { emptyDockTree, usePaneDock } from "./pane-store.ts";
import { DockScope } from "../../app/session-scope.tsx";
import { canToggleMaximized } from "./visibility.ts";
import type { DockDragHost } from "./drag-host.ts";
import type { PanelKind } from "./sideStore.ts";
import type { PaneKind } from "./tree.ts";
import { detachOf } from "./panels/registry.ts";
import { useBoxSize } from "./useBoxSize.ts";
import { useDockDrag } from "./useDockDrag.ts";

const WHOLE: Box = { left: 0, top: 0, width: 1, height: 1 };

/** Room this screen has to leave at its corners of the window, for what the system draws there. */
export interface ScreenInsets {
	/** The traffic lights and the sidebar toggle, when this screen holds the window's top-left. */
	start: number;
	/** Windows and Linux caption buttons, when this screen holds the window's top-right. */
	end: number;
}

/**
 * How far a pane's title must start in when it holds the window's top-left corner.
 *
 * What it has to leave clear is whatever the system drew there *and* the sidebar toggle beside it.
 * `toolbarReserved` is measured from the window's edge; a pane at the left edge is flush with it, so
 * what stands between the two is the header's own padding — subtract that and what is left is the
 * extra the header has to add. The toggle used not to be counted, and with the sidebar closed it is
 * the only way back.
 */
export function cornerReserved(start: number): number {
	return toolbarReserved(start) - HEADER_PAD - 1;
}

/**
 * How much the screen at the window's top-left must reserve.
 *
 * Nothing while the sidebar is open — it covers that corner and draws the toggle itself — and
 * nothing on Windows and Linux, whose header band takes both ends of the window once for everyone.
 * **Native full screen does not excuse it**: full screen takes the traffic lights away, not the
 * toggle, which stays and is the only way back with the sidebar closed. What full screen changes is
 * how much — `titlebarInsets` drops `start` from 78 to 12.
 */
export function startInset({ headerBar, navOpen, start }: { headerBar: boolean; navOpen: boolean; start: number }): number {
	return headerBar || navOpen ? 0 : cornerReserved(start);
}

/**
 * Which pane of a screen is drawn at a corner — the one that has to make room there.
 *
 * Asked of where panes are *drawn*, not of where the tree keeps them: full screen moves a pane to
 * the origin without touching the tree. The narrow layout shows one pane over the whole screen, so
 * that pane is every corner.
 */
export function paneAtCorner({
	compact,
	focusedPane,
	boxes,
	corner,
}: {
	compact: boolean;
	focusedPane: PaneKind;
	boxes: (Box & { kind: PaneKind })[];
	corner: "start" | "end";
}): PaneKind | null {
	if (compact) return focusedPane;
	const hit = boxes.find((box) =>
		corner === "start" ? box.left <= 1e-6 && box.top <= 1e-6 : box.top <= 1e-6 && Math.abs(box.left + box.width - 1) < 0.001,
	);
	return hit?.kind ?? null;
}

/*
 * Adopting a layout is not a movement, so it does not animate — and several screens may adopt in
 * the same frame. Counted, so one screen finishing does not lift the flag under another.
 */
let settling = 0;
function settle(): () => void {
	const thaw = freezeMotion();
	settling++;
	document.documentElement.dataset.dockSettling = "";
	let done = false;
	return () => {
		if (done) return;
		done = true;
		thaw();
		settling--;
		if (settling === 0) delete document.documentElement.dataset.dockSettling;
	};
}

const sessionOf = (scope: string): string | null => (scope === "@draft" ? null : scope);

/** A screen that holds neither corner of the window reserves nothing. */
const NO_INSETS: ScreenInsets = { start: 0, end: 0 };

export function DockView({
	scope,
	header,
	insets = NO_INSETS,
	children,
}: {
	/** The conversation this screen shows — its session id, or `@draft` for the blank one. */
	scope: string;
	/** The conversation's own title bar, given the insets it owes the window's corners. */
	header: (insets: ScreenInsets) => ReactNode;
	insets?: ScreenInsets;
	/** The transcript and composer. */
	children: ReactNode;
}) {
	const tree = usePaneDock((s) => s.trees[scope] ?? emptyDockTree);
	const maximized = usePaneDock((s) => s.maximized[scope] ?? null);
	const focusedPane = usePaneDock((s) => s.focused[scope] ?? "conversation");
	const { compact } = useLayout();
	const definitions = usePanelDefinitions();
	const containerRef = useRef<HTMLDivElement>(null);
	const host = useMemo<DockDragHost>(
		() => ({
			floor: paneFloor,
			tree: () => usePaneDock.getState().tree(scope),
			restore: () => usePaneDock.getState().restore(scope),
			beginDrag: (drag) => usePaneDock.getState().beginDrag(scope, drag),
			preview: (rest, kind, at) => usePaneDock.getState().preview(scope, rest, kind, at),
			dragTo: (pointer, at) => usePaneDock.getState().dragTo(pointer, at),
			endDrag: (cancelled) => usePaneDock.getState().endDrag(cancelled),
			currentDrag: () => {
				const drag = usePaneDock.getState().drag;
				return drag?.scope === scope ? drag : null;
			},
		}),
		[scope],
	);
	const { carried, start, landed } = useDockDrag(containerRef, host);
	const size = useBoxSize(containerRef);

	/*
	 * Read this conversation's layout back — in a layout effect, because reading storage is
	 * synchronous and an ordinary effect would paint the default layout for a frame first, the panes
	 * then snapping into place.
	 *
	 * `definitions` is rebuilt on every render, so it is read through a ref: only its contents
	 * (which kinds are loadable) matter here, never its identity.
	 */
	const allowed = useRef<PaneKind[]>([]);
	allowed.current = ["conversation", ...definitions.filter((def) => !def.ephemeral).map((def) => def.kind)];
	const previousScope = useRef<string | null>(null);
	useLayoutEffect(() => {
		const from = previousScope.current;
		previousScope.current = scope;
		const settled = settle();
		// Only a blank conversation that has just been *sent* keeps its panes under the new id — see
		// `draftBecame`. Clicking an existing conversation from a blank one looks the same here.
		const sent = from === "@draft" && scope !== "@draft" && useApp.getState().draftBecame === scope;
		usePaneDock.getState().hydrate(scope, allowed.current, sent ? { draftFrom: "@draft" } : undefined);
		const frame = requestAnimationFrame(() => {
			requestAnimationFrame(settled);
		});
		return () => {
			cancelAnimationFrame(frame);
			settled();
		};
	}, [scope]);

	useLayoutEffect(() => {
		if (size) usePaneDock.getState().rememberSize(scope, size);
	}, [scope, size]);
	useEffect(() => () => usePaneDock.getState().forget(scope), [scope]);

	/*
	 * The tree as stored, and the tree as it should be drawn at this screen's size.
	 *
	 * `fitted` is what everything here uses — panes, splitters and the drag's hit test — because it
	 * is what is on screen. `tree` keeps the shares that were actually dragged to, so a wider screen
	 * returns the layout to them. A screen that cannot hold its floors draws them anyway, the first
	 * pane in a row covered rather than reflowed; it never evicts a pane.
	 */
	const fitted = compact || !size ? tree : fitTree(tree, size, paneFloor);
	const laid = layoutPanes(fitted);

	const focus = compact ? null : maximized;
	const stacked = Boolean(focus && focus.panes.length === 2 && (!size || size.width < PANEL_MIN_WIDTH_PX * 2));
	// The renderer decides which way a maximised pair goes; the store needs it on the way out.
	useEffect(() => {
		if (maximized) usePaneDock.getState().setMaximizedAxis(scope, stacked ? "col" : "row");
	}, [scope, maximized, stacked]);

	const focusBox = (kind: PaneKind): Box | null => {
		if (!focus) return null;
		const at = focus.panes.indexOf(kind);
		if (at < 0) return null;
		if (focus.panes.length === 1) return WHOLE;
		const share = at === 0 ? focus.ratio : 1 - focus.ratio;
		const offset = at === 0 ? 0 : focus.ratio;
		return stacked ? { left: 0, top: offset, width: 1, height: share } : { left: offset, top: 0, width: share, height: 1 };
	};

	const boxes = focus ? laid.filter((box) => focus.panes.includes(box.kind)) : laid;

	// One boundary while a pair is full screen, none when a single pane fills the screen.
	const focusSeam: SplitterBox | null =
		focus && focus.panes.length === 2
			? {
					path: [],
					index: 0,
					dir: stacked ? "col" : "row",
					share: focus.ratio,
					pair: 1,
					split: WHOLE,
					left: stacked ? 0 : focus.ratio,
					top: stacked ? focus.ratio : 0,
					width: stacked ? 1 : 0,
					height: stacked ? 0 : 1,
				}
			: null;

	/*
	 * Apply a boundary drag. Read from the store rather than from a variable captured above: a drag
	 * holds this callback for its whole length, and full screen is exactly the case distinguished.
	 */
	const applyShare = (share: number, handle: SplitterBox) => {
		const dock = usePaneDock.getState();
		if (dock.maximized[scope]) dock.setMaximizedRatio(scope, share);
		else dock.setShare(scope, handle.path, handle.index, share);
	};

	const splitters = compact ? [] : focus ? (focusSeam ? [focusSeam] : []) : layoutSplitters(fitted);

	/*
	 * The order panes are *mounted* in, which is not the order they are laid out in.
	 *
	 * Moving an <iframe> or a <webview> in the DOM reloads it, so new panes are appended and an
	 * existing pane's node is only ever removed, never relocated. The browser is always mounted,
	 * hidden when closed: its pages keep running while the panel is put away, and opening it again
	 * shows them without a reload. Assigned during render and idempotent.
	 */
	const order = useRef<PaneKind[]>(["conversation", "browser"]);
	const present = laid.map((box) => box.kind);
	// A carried pane has been lifted out of the tree and is still the thing in your hand.
	const live = carried && !present.includes(carried.kind) ? [...present, carried.kind] : present;
	order.current = [
		...order.current.filter((kind) => live.includes(kind) || kind === "browser"),
		...live.filter((kind) => !order.current.includes(kind)),
	];

	const at = (box: Box & { kind: PaneKind }) => ({ ...box, ...focusBox(box.kind) });
	const drawn = boxes.map(at);
	const startCorner = insets.start > 0 ? paneAtCorner({ compact, focusedPane, boxes: drawn, corner: "start" }) : null;
	const endCorner = insets.end > 0 ? paneAtCorner({ compact, focusedPane, boxes: drawn, corner: "end" }) : null;
	const conversationLabel = translate("sidebar.chats");

	return (
		<DockScope.Provider value={scope}>
			<div className="ly-dock relative flex min-h-0 min-w-0 flex-1 flex-col">
				{/* Marked so the drop geometry can be measured from outside — see `e2e/dock.test.ts`. */}
				<div ref={containerRef} data-dock-panes={scope} data-ly-pane-dock={scope} className="relative min-h-0 min-w-0 flex-1">
					{splitters.map((handle) => (
						<Splitter
							// The full-screen boundary is its own component, never a reused one: its path
							// collides with the first real boundary, and a reused instance keeps that one's
							// listeners — the drag simply never started.
							key={focus ? "maximised-seam" : `${handle.path.join(".")}:${handle.index}`}
							handle={handle}
							containerRef={containerRef}
							onResize={(share) => applyShare(share, handle)}
							onEven={() => applyShare(0.5, handle)}
						/>
					))}

					{/*
					 * Where the carried pane would land. The panes staying put have already made room;
					 * this says the room is for you. Not while landing — the pane is on its way there.
					 */}
					{carried &&
						!carried.landing &&
						(() => {
							const target = boxes.find((box) => box.kind === carried.kind);
							if (!target) return null;
							return (
								<div
									aria-hidden
									data-dock-drop
									className="ly-dock-drop pointer-events-none absolute"
									style={{ left: pct(target.left), top: pct(target.top), width: pct(target.width), height: pct(target.height) }}
								/>
							);
						})()}

					{order.current.map((kind) => {
						const placed = boxes.find((box) => box.kind === kind);
						if (!placed && carried?.kind !== kind && !present.includes(kind) && kind !== "browser") return null;
						const conversation = kind === "conversation";
						const def = definitions.find((entry) => entry.kind === kind);
						const label = conversation ? conversationLabel : def ? translate(def.label) : kind;
						const icon = !conversation && def ? <def.icon size={12.5} strokeWidth={1.8} /> : undefined;
						const box = compact ? WHOLE : (focusBox(kind) ?? laid.find((entry) => entry.kind === kind) ?? WHOLE);
						const moving = carried?.kind === kind;
						const draggable = !compact && live.length > 1;
						const onDragStart = (event: React.PointerEvent<HTMLElement>) => start(kind, event);
						const onMove = (side: "left" | "right" | "top" | "bottom") => usePaneDock.getState().moveTo(scope, kind, { side, kind: null });
						const onArrowMove = (side: "left" | "right" | "top" | "bottom") => usePaneDock.getState().moveAlong(scope, kind, side);
						const inset = startCorner === kind ? insets.start : 0;
						const insetEnd = endCorner === kind ? insets.end : 0;
						return (
							<DockPane
								key={kind}
								kind={kind}
								box={box}
								label={label}
								icon={icon}
								maximized={Boolean(focus) && Boolean(placed)}
								carried={moving ? carried.rect : null}
								landing={moving && carried.landing}
								/*
								 * A pane in the air is never hidden, whatever the tree says: it has been
								 * lifted out of the tree and is positioned against the window.
								 */
								hidden={compact ? kind !== focusedPane : !placed && !moving}
								draggable={draggable}
								onDragStart={onDragStart}
								onMove={onMove}
								onArrowMove={onArrowMove}
								actions={conversation ? undefined : renderPanelActions(kind as PanelKind)}
								title={conversation ? undefined : renderPanelHeader(kind as PanelKind)}
								inset={inset}
								insetEnd={insetEnd}
								onToggleMaximized={
									canToggleMaximized(kind, { compact, maximized })
										? () => usePaneDock.getState().toggleMaximized(scope, kind, companionOf(kind as PanelKind)?.kind)
										: undefined
								}
								onClose={conversation ? undefined : () => usePaneDock.getState().close(scope, kind)}
								onPopOut={
									conversation || detachOf(kind) === "none"
										? undefined
										: () => void popOutPanel({ scope, kind: kind as PanelKind, sessionId: sessionOf(scope) })
								}
								onFocus={() => usePaneDock.getState().focus(scope, kind)}
								onLanded={landed}
								customHeader={
									conversation ? (
										<>
											{header({ start: inset, end: insetEnd })}
											{draggable && !maximized && (
												<PaneGrip kind={kind} label={label} carried={moving} onDragStart={onDragStart} onMove={onMove} onArrowMove={onArrowMove} />
											)}
										</>
									) : undefined
								}
							>
								{conversation ? children : renderPanel(kind as PanelKind)}
							</DockPane>
						);
					})}
				</div>
			</div>
		</DockScope.Provider>
	);
}
