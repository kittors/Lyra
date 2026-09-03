/**
 * The dock: every pane in the window except the navigation, arranged by the tree.
 *
 * Two rules hold this together, and both exist to keep a pane's contents alive across a
 * rearrangement — a terminal's shell, a page in the browser, an editor's undo history.
 *
 * **One flat list of panes, positioned absolutely.** Never a recursive render of the tree; see
 * the note at the top of `layout.ts`.
 *
 * **One DOM shape for both window sizes.** The narrow form is the same panes, each laid over the
 * whole dock with all but one hidden — not a different component. A layout that swaps its
 * structure at a breakpoint unmounts everything inside it, which is how this app has previously
 * shipped a transition that was a hard cut, and how it would now ship a terminal that dies when
 * you make the window small.
 */

import { useEffect, useLayoutEffect, useRef } from "react";

import { useLayout, useSidebarFit } from "../../app/layout.tsx";
import { freezeMotion } from "../../ui/motion/freeze.ts";
import { toolbarReserved } from "../../app/window/WindowControls.tsx";
import { useApp } from "../../store/index.ts";
import { renderPanel, renderPanelActions, renderPanelHeader, usePanelDefinitions } from "./panels/definitions.tsx";
import { pct } from "./css.ts";
import { HEADER_PAD, PANEL_MIN_WIDTH_PX, paneFloor } from "./geometry.ts";
import { DockPane } from "./DockPane.tsx";
import { Splitter } from "./Splitter.tsx";
import { fitTree, layoutPanes, layoutSplitters, type Box, type SplitterBox } from "./layout.ts";
import { useDock } from "./store.ts";
import { canToggleMaximized } from "./visibility.ts";
import type { PaneKind } from "./tree.ts";
import { useBoxSize } from "./useBoxSize.ts";
import { useDockDrag } from "./useDockDrag.ts";

const WHOLE: Box = { left: 0, top: 0, width: 1, height: 1 };

/**
 * How far a pane's title must start in when it is the one holding the window's top-left corner.
 *
 * What it has to leave clear is whatever the system drew there *and* the sidebar toggle beside it.
 * `toolbarReserved` is measured from the window's edge; a pane at the left edge is flush with it,
 * so what stands between the two is the card's border and the header's own padding — subtract
 * those and what is left is the extra the header has to add.
 *
 * The toggle used not to be counted, and with the sidebar closed it is the only way back — so the
 * pane in that corner drew its title over the one control that would have undone the thing that
 * put it there.
 */
function cornerReserved(start: number): number {
	return toolbarReserved(start) - HEADER_PAD - 1;
}

export function DockView({
	title,
	icon,
	actions,
	solo,
	renderConversation,
}: {
	/** The conversation's title, which is the session's rather than a fixed word. */
	title: string;
	icon?: React.ReactNode;
	/** The window's panel controls, which ride on the conversation's own title bar. */
	actions?: React.ReactNode;
	/**
	 * Show the main pane by itself, whatever else is open.
	 *
	 * For the screens that are not a conversation in a project — the pull request list, the
	 * schedule, the plugin catalogue. A file tree and a terminal beside a list of someone else's
	 * branches are not merely unhelpful, they are about a different place entirely: the repository
	 * in the tree is not the repository being reviewed.
	 *
	 * Hidden rather than closed, and the tree is left alone. The panes come back exactly as they
	 * were the moment the conversation does.
	 */
	solo?: boolean;
	renderConversation: () => React.ReactNode;
}) {
	const tree = useDock((s) => s.tree);
	const focusedPane = useDock((s) => s.focused);
	const maximized = useDock((s) => s.maximized);
	const { compact, navOpen, nativeFullScreen, titlebar, width: windowWidth } = useLayout();
	const { drawn: sidebarDrawn } = useSidebarFit();
	const definitions = usePanelDefinitions();

	const containerRef = useRef<HTMLDivElement>(null);
	const { carried, start, landed } = useDockDrag(containerRef);
	const expectedDockWidth = compact ? windowWidth : navOpen ? Math.max(0, windowWidth - sidebarDrawn) : windowWidth;
	const size = useBoxSize(containerRef, expectedDockWidth);

	/*
	 * Point the dock at the project, which loads that project's saved layout.
	 *
	 * A *layout* effect, not an ordinary one, and that is a visible difference rather than a
	 * stylistic preference. An ordinary effect runs after the browser has painted, so the first
	 * frame of every launch showed the default layout and the second showed the saved one — the
	 * panes you arranged appearing to snap into place a frame after the window opened. Reading
	 * storage is synchronous, so there is nothing to wait for and no reason to paint first.
	 *
	 * Keyed on the path alone. `definitions` is rebuilt on every render, so depending on it would
	 * run this constantly — it is read through a ref instead, and only its contents matter here
	 * (which kinds are loadable), never its identity.
	 */
	const allowed = useRef<PaneKind[]>([]);
	allowed.current = ["conversation", ...definitions.map((def) => def.kind)];
	const session = useApp((s) => s.activeSessionId);
	useLayoutEffect(() => {
		/*
		 * Adopting a layout is not a movement, so it does not animate.
		 *
		 * The panes animate between arrangements because one arrangement became another and the
		 * eye should be able to follow it. Loading a stored layout is not that: nothing moved, this
		 * is simply where things are. Left to transition it read as the window assembling itself —
		 * every launch began with the default layout and slid into the saved one, and every switch
		 * between conversations slid from the last one's arrangement into this one's, as though the
		 * panes had travelled between two unrelated places.
		 */
		const settled = freezeMotion();
		document.documentElement.dataset.dockSettling = "";
		useDock.getState().adopt(session, allowed.current);
		const frame = requestAnimationFrame(() => {
			requestAnimationFrame(() => {
				settled();
				delete document.documentElement.dataset.dockSettling;
			});
		});
		return () => {
			cancelAnimationFrame(frame);
			settled();
		};
	}, [session]);

	/*
	 * The tree as stored, and the tree as it should be drawn at this window size.
	 *
	 * `fitted` is the one everything here uses — the panes, the splitters, and the drag's hit test —
	 * because it is what is on screen, and a handle that did not sit on the boundary it moves would
	 * be unusable. `tree` keeps the shares that were actually dragged to, so widening the window
	 * returns the layout to them rather than to whatever a narrow window forced.
	 */
	const fitted = compact || !size ? tree : fitTree(tree, size, paneFloor);
	const laid = layoutPanes(fitted);

	/*
	 * Full screen: the chosen panes split the dock between them, and nothing else is drawn.
	 *
	 * Laid out here rather than by pruning the tree and re-running the layout. Pruning produced a
	 * second tree whose boundaries had to be matched back to the real one before a drag could act
	 * on them, and every part of that translation was a place to be wrong — the value, the floor,
	 * the identity. Two panes and a ratio need none of it: the boundary moves the ratio, and the
	 * ratio is written back into the tree when full screen ends.
	 *
	 * Side by side when the dock is wide enough for both, stacked when it is not — rather than
	 * keeping whatever arrangement they had. A pair of panels sharing a column is stacked because
	 * the column is narrow; full screen is exactly the moment that stops being true, and a tree
	 * beside a file is the arrangement every editor uses. On a window too narrow for two usable
	 * columns it stays stacked, because the reason for stacking is back.
	 */
	/*
	 * Showing one pane by itself covers two cases with the same machinery: a maximised pane, and a
	 * screen that is not a conversation at all. The second one outranks the first — leaving a
	 * maximised terminal on screen over the plugin catalogue would be the same mistake twice.
	 */
	const solitary: typeof maximized = solo ? { panes: ["conversation"], ratio: 1, axis: "row" } : null;
	const focus = compact ? null : (solitary ?? maximized);
	const stacked = Boolean(focus && focus.panes.length === 2 && (!size || size.width < PANEL_MIN_WIDTH_PX * 2));
	/*
	 * Tell the store which way it went.
	 *
	 * The decision is the renderer's — it is the only thing that knows how much room there is —
	 * and the store needs it on the way out, to know whether the ratio it is holding describes the
	 * same axis the panes are going back to.
	 */
	useEffect(() => {
		// Not for the solitary case, which is a screen standing alone rather than a pair with an axis.
		if (maximized && !solo) useDock.getState().setMaximizedAxis(stacked ? "col" : "row");
	}, [maximized, solo, stacked]);

	const focusBox = (kind: PaneKind): Box | null => {
		if (!focus) return null;
		const at = focus.panes.indexOf(kind);
		if (at < 0) return null;
		if (focus.panes.length === 1) return WHOLE;
		const share = at === 0 ? focus.ratio : 1 - focus.ratio;
		const offset = at === 0 ? 0 : focus.ratio;
		return stacked
			? { left: 0, top: offset, width: 1, height: share }
			: { left: offset, top: 0, width: share, height: 1 };
	};

	const boxes = focus ? laid.filter((box) => focus.panes.includes(box.kind)) : laid;

	/*
	 * One boundary while full screen, none when a single pane fills it.
	 *
	 * Given the geometry of what is drawn and a `share` that already is the ratio, so the splitter
	 * needs no special case: what it reports back is the new ratio.
	 */
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

	/**
	 * Apply a boundary drag.
	 *
	 * While full screen the reported share *is* the ratio between the two panes on screen;
	 * otherwise it names a boundary in the tree.
	 *
	 * Read from the store rather than from a variable captured above. A drag holds this callback
	 * for its whole length, so a captured value is one from before the drag — and full screen is
	 * exactly the case being distinguished. Getting that wrong sent every full-screen drag into
	 * the other branch, where it moved a boundary that was not on screen: nothing appeared to
	 * happen at all.
	 */
	const applyShare = (share: number, handle: SplitterBox) => {
		const dock = useDock.getState();
		if (dock.maximized) dock.setMaximizedRatio(share);
		else dock.setShare(handle.path, handle.index, share);
	};

	const splitters = compact ? [] : focus ? (focusSeam ? [focusSeam] : []) : layoutSplitters(fitted);

	/*
	 * The order panes are *mounted* in, which is not the order they are laid out in.
	 *
	 * React keys stop a moved pane from being recreated, but they do not stop it being moved in
	 * the DOM — and moving an <iframe> or a <webview> reloads it, which is the same loss by
	 * another route. Appending new panes and never reordering means an existing pane's DOM node
	 * is only ever removed, never relocated.
	 *
	 * Assigned during render and idempotent, so a double render under StrictMode produces the
	 * same list rather than a duplicated one.
	 */
	const order = useRef<PaneKind[]>([]);
	const present = boxes.map((box) => box.kind);
	/*
	 * A carried pane is *not in the tree* — it has been lifted out, and the panes staying put have
	 * closed over the space it left. It is still mounted, obviously: it is the thing in your hand.
	 * Counting it as live keeps it in the mounting order too, so putting a terminal down does not
	 * append it to the end of the list and relocate every DOM node after it.
	 */
	const live = carried && !present.includes(carried.kind) ? [...present, carried.kind] : present;
	order.current = [
		...order.current.filter((kind) => live.includes(kind)),
		...live.filter((kind) => !order.current.includes(kind)),
	];

	const describe = (kind: PaneKind) => {
		if (kind === "conversation") return { label: title, icon };
		const def = definitions.find((entry) => entry.kind === kind);
		return { label: def?.label ?? kind, icon: def ? <def.icon size={12.5} strokeWidth={1.8} /> : undefined };
	};

	/*
	 * Which pane, if any, has to make room for the traffic lights.
	 *
	 * With the sidebar open — which is almost always — the answer is none: the sidebar covers that
	 * corner and draws the lights' inset itself. Closed, the corner belongs to whichever pane is at
	 * the very top-left, and only that one. Native full screen takes the lights away entirely.
	 *
	 * This is the whole of what used to be a delayed handover of the window's own buttons between
	 * the toolbar and the panel — 220ms of it, timed to a slide. A pane either starts at the
	 * origin or it does not.
	 */
	const corner =
		navOpen || nativeFullScreen
			? null
			: compact
				? /*
					 * The narrow layout shows one pane over the whole dock, so that pane is the corner
					 * — always, rather than only when it happens to be laid out at the origin. It used
					 * to be excluded here on the assumption that the sidebar covers the corner, which
					 * is true at every width except this one: at this width the sidebar is a drawer
					 * over the window, and with it closed the pane's own title started underneath the
					 * three buttons the system paints there.
					 */
					focusedPane
				: (boxes.find((box) => box.left === 0 && box.top === 0)?.kind ?? null);

	/*
	 * And which pane has to make room for the buttons at the *other* end.
	 *
	 * Windows and Linux draw minimise/maximise/close over the top-right of the page, which is
	 * where this app puts a pane's own controls — the panel menu on the conversation, full screen
	 * and close on a panel. They were underneath the system's buttons: drawn, and impossible to
	 * press, because the press went to the window rather than to the page.
	 *
	 * Unlike the left corner the sidebar can never cover this one, so it belongs to whichever pane
	 * reaches the right edge on the top row — always. Zero on macOS, where the system puts nothing
	 * there, which leaves every one of these lines a no-op.
	 */
	const endCorner =
		titlebar.end === 0
			? null
			: compact
				? focusedPane
				: (boxes.find((box) => box.top === 0 && Math.abs(box.left + box.width - 1) < 0.001)?.kind ?? null);



	return (
		<div className="ly-dock relative flex min-h-0 min-w-0 flex-1 flex-col">
			{/* Marked so the drop geometry can be measured from outside — see `e2e/dock.test.ts`. */}
			<div ref={containerRef} data-dock-panes className="relative min-h-0 min-w-0 flex-1">
				{splitters.map((handle) => (
					<Splitter
						/*
						 * The full-screen boundary is its own component, never a reused one.
						 *
						 * It is a synthesised handle, not one from the tree, and its path happens to
						 * collide with the dock's first real boundary — so React kept the old
						 * instance alive across the switch, complete with the listeners and refs
						 * belonging to a boundary that no longer exists. The drag simply never
						 * started.
						 */
						key={focus ? "maximised-seam" : `${handle.path.join(".")}:${handle.index}`}
						handle={handle}
						containerRef={containerRef}
						onResize={(share) => applyShare(share, handle)}
						onEven={() => applyShare(0.5, handle)}
					/>
				))}

				{/*
				 * Where the carried pane would land.
				 *
				 * The panes staying put have already rearranged to make room, which leaves that room
				 * empty — the pane that belongs in it is in the air. Without this the gap reads as
				 * nothing at all rather than as a destination, and the drag has no target: you can
				 * see that the layout changed but not that it changed *for you*.
				 *
				 * Not while landing. By then the pane is on its way into the space and outlining it
				 * as well would be saying the same thing twice, in two places, for a fifth of a second.
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
								style={{
									left: pct(target.left),
									top: pct(target.top),
									width: pct(target.width),
									height: pct(target.height),
								}}
							/>
						);
					})()}

				{order.current.map((kind) => {
					const placed = boxes.find((box) => box.kind === kind);
					// Outside a full screen, or closed altogether. Kept mounted either way — hidden
					// below — unless it is genuinely gone from the tree.
					if (!placed && carried?.kind !== kind && !present.includes(kind)) return null;
					const { label, icon } = describe(kind);
					// Collapsed and maximised are the same geometry — the whole dock — which is why
					// neither needs a second component or a second code path. A carried pane's box is
					// ignored entirely; it is positioned against the window, not against the dock.
					const box = compact ? WHOLE : (focusBox(kind) ?? placed ?? WHOLE);
					return (
						<DockPane
							key={kind}
							kind={kind}
							box={box}
							label={label}
							icon={icon}
							maximized={Boolean(focus) && Boolean(placed)}
							carried={carried?.kind === kind ? carried.rect : null}
							landing={carried?.kind === kind && carried.landing}
							/*
							 * A pane in the air is never hidden, whatever the tree says.
							 *
							 * While it is carried it has been lifted *out* of the tree, so it has no box
							 * — and hiding panes with no box is right for every pane except this one.
							 * The moment the pointer was somewhere that is not a drop target — past the
							 * edge of the window, most obviously — the card being dragged vanished, and
							 * came back only if the pointer wandered over a target again. It is
							 * positioned against the window and follows the pointer; where the tree
							 * would put it is not a question that has an answer yet.
							 */
							hidden={compact ? kind !== focusedPane : !placed && carried?.kind !== kind}
							/*
							 * No grip when there is nowhere to go.
							 *
							 * With one pane in the dock a drag cannot do anything — `useDockDrag` already
							 * refuses to pick it up, because lifting the only pane leaves no layout to drop
							 * it into. But the handle was drawn anyway, so a conversation on its own had a
							 * control above it that does nothing when pressed, and appears whenever the
							 * pointer is anywhere in the pane. `live` rather than `present` so it does not
							 * vanish mid-drag, when the carried pane has been lifted out of the tree.
							 */
							draggable={!compact && live.length > 1}
							onDragStart={(event) => start(kind, event)}
							onMove={(side) => useDock.getState().moveTo(kind, { side, kind: null })}
							/*
							 * The conversation carries the window's panel menu; a panel carries its own
							 * controls. Both land left of full screen and close — see `PaneHeader`.
							 */
							actions={kind === "conversation" ? actions : renderPanelActions(kind)}
							title={kind === "conversation" ? undefined : renderPanelHeader(kind)}
							inset={corner === kind ? cornerReserved(titlebar.start) : 0}
							insetEnd={endCorner === kind ? titlebar.end : 0}
							// Absent where full screen is not on offer, which is what hides the button —
							// see `canToggleMaximized` for the rule and the bug it was written for.
							onToggleMaximized={
								canToggleMaximized(kind, { compact, maximized })
									? () =>
											useDock
												.getState()
												.toggleMaximized(kind, definitions.find((def) => def.kind === kind)?.companion?.kind)
									: undefined
							}
							onClose={kind === "conversation" ? undefined : () => useDock.getState().close(kind)}
							onFocus={() => useDock.getState().focus(kind)}
							onLanded={landed}
						>
							{kind === "conversation" ? renderConversation() : renderPanel(kind)}
						</DockPane>
					);
				})}
			</div>
		</div>
	);
}
