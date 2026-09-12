/**
 * One pane: a header and whatever it holds, positioned absolutely inside the dock.
 *
 * Absolute rather than laid out in a flex tree, because the flat list is what keeps a pane from
 * being unmounted when the layout changes — see the note at the top of `layout.ts`. The practical
 * consequence is that a rearrangement retains the same content. PaneSurface lays it out once
 * at its destination and composites the movement, without reflowing every intermediate width.
 */

import { PaneHeader } from "./PaneHeader.tsx";
import { PaneSurface } from "./PaneSurface.tsx";
import { pct } from "./css.ts";
import { HEADER_HEIGHT, PANE_INSET, paneFloor } from "./geometry.ts";
import type { Box } from "./layout.ts";
import type { DropSide, PaneKind } from "./tree.ts";

export function DockPane({
	kind,
	box,
	label,
	icon,
	maximized,
	carried,
	landing,
	hidden,
	draggable,
	onDragStart,
	onMove,
	actions,
	title,
	inset,
	insetEnd,
	onToggleMaximized,
	onClose,
	onFocus,
	onLanded,
	children,
}: {
	kind: PaneKind;
	box: Box;
	label: string;
	icon?: React.ReactNode;
	maximized: boolean;
	/**
	 * Where to draw this pane while it is being carried, in client coordinates — or null when it
	 * is docked like everything else.
	 *
	 * The pane *itself* is what lifts. An earlier version drew a stand-in card that followed the
	 * pointer, and it looked exactly as cheap as it was: an empty rectangle with a title, while
	 * the thing you were actually moving sat greyed out underneath. What a pane is is its
	 * contents, and the only way to carry those without mounting a second copy of them — a second
	 * shell, a second page — is to move the one that exists.
	 */
	carried: { left: number; top: number; width: number; height: number } | null;
	/** Flying home after being let go, which is the one time the carried pane animates. */
	landing: boolean;
	/**
	 * Behind another pane in the collapsed layout.
	 *
	 * Opacity and inertness retain layout as well as content. display:none invalidates the
	 * terminal grid and every row's measurements; inherited visibility restyles every descendant.
	 */
	hidden: boolean;
	draggable: boolean;
	onDragStart: (event: React.PointerEvent<HTMLElement>) => void;
	onMove: (side: DropSide) => void;
	/** Controls belonging to what the pane holds — the conversation's panel buttons. */
	actions?: React.ReactNode;
	/** Drawn in the header in place of the name — see `PanelDefinition.header`. */
	title?: React.ReactNode;
	/** Room for the traffic lights, when this pane covers the window's top-left corner. */
	inset?: number;
	/** And for the system's own buttons at the other end, on Windows and Linux. */
	insetEnd?: number;
	/** Absent where full screen is not on offer — the dock decides; see `DockView`. */
	onToggleMaximized?: () => void;
	onClose?: () => void;
	onFocus: () => void;
	/** Reported when the flight home ends, so the pane can be handed back to the dock's layout. */
	onLanded: () => void;
	children: React.ReactNode;
}) {
	/** Panels are cards over the conversation's surface; so is anything currently in the air. */
	const floats = kind !== "conversation" || Boolean(carried);

	return (
		<PaneSurface
			carried={Boolean(carried)}
			isHidden={hidden}
			data-dock-pane={kind}
			// Focus follows the click for the benefit of the collapsed layout and the keyboard;
			// it costs nothing here and means the two forms agree about which pane is current.
			onPointerDownCapture={onFocus}
			/*
			 * `left` only, and only while landing.
			 *
			 * Four properties animate together, so listening to all of them would report four times
			 * for one flight; and the event also fires for the dock's own rearrangements, which are
			 * not flights at all. `target === currentTarget` keeps a transition inside the pane's
			 * contents from being mistaken for the pane arriving.
			 */
			onTransitionEnd={
				landing
					? (event) => {
							if (event.propertyName === "transform" && event.target === event.currentTarget) onLanded();
						}
					: undefined
			}
			/*
			 * Two positioning models, one element.
			 *
			 * Docked, it is `absolute` against the dock in percentages, so a window resize is the
			 * browser's problem. Carried, it is
			 * `fixed` against the window in pixels, so it can go anywhere the pointer does. The
			 * switch does not recreate anything — same element, same subtree, same shell running
			 * inside it.
			 */
			style={
				carried
					? {
							position: "fixed",
							/*
							 * Anchored where it was picked up; the pointer moves it with a transform.
							 *
							 * `left`/`top` would be the obvious way and it is the wrong one: changing
							 * them is a layout change, so every frame of a drag laid the window out
							 * again — with a terminal, a file tree and a diff in it. A transform is
							 * composited, and the whole drag becomes something the compositor does
							 * without the main thread.
							 *
							 * The transform itself is written straight to this element by the drag —
							 * see `useDockDrag`. It is not a prop, because a prop means a render per
							 * frame, and rendering was the other half of the same problem.
							 */
							left: carried.left,
							top: carried.top,
							width: carried.width,
							height: carried.height,
							willChange: "transform",
						}
					: {
							left: pct(box.left),
							top: pct(box.top),
							width: pct(box.width),
							height: pct(box.height),
							/*
							 * The pixel floor, which a share cannot express.
							 *
							 * `fitSizes` keeps every pane in a row at its floor except the first, which
							 * absorbs whatever the row cannot hold — so on a dock too narrow for the
							 * arrangement, the first pane's *box* is smaller than the pane may be drawn.
							 * This is what draws it at its floor anyway: it extends past its box, and
							 * the pane beside it — a panel, and so a layer above — is drawn over the
							 * overhang.
							 *
							 * Which is the whole point. The conversation stays laid out at the width it
							 * says it is, with its right-hand side covered, rather than reflowing its
							 * text into a column two words wide. Nothing else in the row moves.
							 *
							 * Width only. A vertical overhang would cover either the composer at the
							 * bottom of the conversation or the title bar of the pane below — and those
							 * are the controls you would need in order to undo it. `fitSizes` declines
							 * to overlap a column for the same reason.
							 *
							 * Not while a pane fills the dock: full screen divides the room by a ratio
							 * of its own, which can legitimately put a pane below its floor, and a
							 * minimum here would make the pair overlap instead of divide.
							 */
							...(maximized ? null : { minWidth: paneFloor(kind).width }),
						}
			}
			/*
			 * Panels sit above the conversation, and the splitters sit above both.
			 *
			 * Full screen used to raise its pane higher than everything — a hangover from when it
			 * meant "cover the others". It prunes the layout now, so the panes it is not showing
			 * are inert and transparent and there is nothing to cover; the only thing the extra layer
			 * achieved was burying the splitter, which made a maximised pair impossible to resize.
			 */
			/*
			 * Which panel this is, so the stylesheet can tell a code surface from a chrome one.
			 *
			 * The panes that show code — the editor, its tree, the terminal, a diff — take the code
			 * theme's background for the *whole card*, header and tab strip included. Colouring only
			 * the text area is what made the pane read as two things stacked: a white title bar with
			 * a warm rectangle below it, rather than one editor.
			 */
			data-pane={kind}
			className={`ly-dock-pane group/pane absolute flex min-w-0 flex-col ${
				carried ? "ly-dock-pane-carried" : floats ? "z-10" : "z-0"
			} ${landing ? "ly-dock-pane-landing" : ""}`}
			header={<div className="ly-dock-chrome absolute inset-x-0 top-0 z-[1]" style={{ margin: floats ? PANE_INSET + 1 : 0, background: "transparent" }}>
				<PaneHeader
					kind={kind}
					label={label}
					icon={icon}
					maximized={maximized}
					draggable={draggable}
					carried={Boolean(carried)}
					hideTitle={kind === "conversation"}
					title={title}
					onDragStart={onDragStart}
					onMove={onMove}
					actions={actions}
					inset={inset}
					insetEnd={insetEnd}
					lift={floats ? PANE_INSET + 1 : 0}
					onToggleMaximized={onToggleMaximized}
					onClose={onClose}
				/>
			</div>}
		>
			{/*
			 * Panels float; the conversation does not.
			 *
			 * That asymmetry is the whole visual idea, and it is not decoration. The conversation is
			 * what the window is *for* — it runs flush to the window's edges and carries no border,
			 * so it reads as the page itself. A panel is something brought alongside it: inset,
			 * cornered and lifted slightly off, so it reads as sitting on top.
			 *
			 * Making every pane a card lost that: five equal boxes with nothing to say which one is
			 * the thing and which are the accessories.
			 *
			 * Anything in the air is a card, whichever it is — it is off the surface by definition,
			 * and the conversation has to look picked up while it is being carried.
			 *
			 * `overflow-hidden` is what makes the radius real: without it a scroller inside paints
			 * its own square corners straight over the rounded ones.
			 */}
			<div
				className={`flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden ${floats ? "ly-dock-card" : ""}`}
				style={floats ? { margin: PANE_INSET } : undefined}
			>
			{/* Controls keep their endpoint geometry while this retained surface composites its resize. */}
			<div aria-hidden className="shrink-0" style={{ height: HEADER_HEIGHT }} />
			<div className="relative flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>
			</div>
		</PaneSurface>
	);
}
