/**
 * A pane's title bar: what it is, and the things you can do to it.
 *
 * **Only the grip moves the pane.** The grip is a short bar near the top edge, and it is both the
 * only way to move the pane and the only thing that says the pane can be moved. One small target
 * meaning exactly one thing beats a large one meaning several.
 *
 * It fades in as the pointer comes into the pane rather than sitting there permanently — a mark
 * that is always visible on every pane is five marks competing for attention in a window where
 * nothing is being moved. Keyed to the *pane* because the bar it sits on cannot answer: a
 * `drag-region` gets its mouse events taken by the window manager, so `:hover` there never fires.
 *
 * **Everything else moves the window.** That falls out of the first rule rather than competing
 * with it: with the pane's drag confined to the grip, the rest of the bar is free to be what a
 * title bar normally is. Losing this is what made the window undraggable for a while — the dock
 * reaches the top edge now, so if these bars do not move the window, nothing up there does.
 *
 * `drag-region` on the bar, `no-drag` on everything you can press. Electron composites the two by
 * walking the document in order, so the holes have to come after the region they are cut out of —
 * which is the order they appear in below.
 *
 * No border under it. The panes are cards with their own edges, and a rule here would draw a
 * second line a few pixels inside the first.
 */

import { Maximize2, Minimize2, X } from "lucide-react";
import { GRIP_REACH, GRIP_WIDTH, HEADER_HEIGHT, HEADER_PAD } from "./geometry.ts";
import type { DropSide, PaneKind } from "./tree.ts";

/** ⌥ plus an arrow moves the pane. Mapped here so the key and the meaning sit together. */
const ARROWS: Record<string, DropSide> = {
	ArrowLeft: "left",
	ArrowRight: "right",
	ArrowUp: "top",
	ArrowDown: "bottom",
};

export function PaneHeader({
	kind,
	label,
	icon,
	maximized,
	draggable,
	carried,
	hideTitle,
	title,
	onDragStart,
	onMove,
	actions,
	inset,
	insetEnd,
	lift,
	onToggleMaximized,
	onClose,
}: {
	kind: PaneKind;
	label: string;
	icon?: React.ReactNode;
	maximized: boolean;
	/** False in the collapsed layout, where there is nowhere for a pane to be dropped. */
	draggable: boolean;
	/** The pane is in the air, so the grip shows that the hand is still on it. */
	carried: boolean;
	/**
	 * Draw the bar without a name.
	 *
	 * The conversation uses this: the sidebar already says which one is open, and repeating it
	 * above a transcript that also says so is a third copy of the same fact.
	 */
	hideTitle?: boolean;
	/** Drawn in place of the name, for a panel whose header is a control. */
	title?: React.ReactNode;
	onDragStart: (event: React.PointerEvent<HTMLElement>) => void;
	/** ⌥ and an arrow, for the same rearrangement without a pointer. */
	onMove: (side: DropSide) => void;
	/**
	 * Controls belonging to what the pane holds, left of the pane's own.
	 *
	 * The conversation puts the window's panel buttons here. They used to live in a toolbar of
	 * their own above the dock, which cost a whole row and left the buttons and the pane titles on
	 * two different lines — see the note on `HEADER_HEIGHT`.
	 */
	actions?: React.ReactNode;
	/**
	 * Room for the traffic lights, when this pane is what covers the window's top-left corner.
	 *
	 * Normally nobody needs it: the sidebar is there. Close the sidebar and the corner belongs to
	 * whichever pane is first, and its title would otherwise start underneath three buttons drawn
	 * by the system.
	 */
	inset?: number;
	/**
	 * The same at the trailing end, for the window controls Windows and Linux draw over the page.
	 *
	 * Nothing to do with the sidebar: this corner is never covered, so it is always the pane at the
	 * right edge of the top row that has to move its own buttons out from under the system's.
	 */
	insetEnd?: number;
	/**
	 * How far to raise the content inside the bar.
	 *
	 * A floating pane's card is inset from its box, so its title bar starts a few pixels lower than
	 * a flush one's. Left alone, two panes side by side would put their titles on lines that differ
	 * by exactly that inset — visible, and worse on the top row, where one of them is also meant to
	 * line up with the traffic lights.
	 */
	lift?: number;
	/**
	 * Absent where full screen means nothing — the conversation, which is already what the dock is
	 * showing, and the collapsed layout, where one pane is all there is room for.
	 *
	 * Decided by the dock and passed in, rather than inferred here from `draggable`. It used to be
	 * `canMaximize && draggable`, and `draggable` is false whenever the dock is showing a single
	 * pane — which is precisely what maximising a pane on its own produces. So the control removed
	 * itself on arrival: every pane without a companion could be made full screen and then only
	 * closed, with an Esc nothing on screen mentioned as the way back. Whether a pane can be
	 * dragged and whether it can leave full screen are different questions.
	 */
	onToggleMaximized?: () => void;
	/** Absent for the conversation, which is not a pane you can put away. */
	onClose?: () => void;
}) {
	return (
		<div
			data-dock-header={kind}
			style={{
				height: HEADER_HEIGHT,
				paddingLeft: (inset ?? 0) + HEADER_PAD,
				// 6px is `pr-1.5`, which is what this row used before there was anything to clear.
				paddingRight: (insetEnd ?? 0) + 6,
				paddingBottom: (lift ?? 0) * 2,
			}}
			/*
			 * `touch-none` so a trackpad drag moves the pane instead of scrolling whatever is
			 * underneath. Without it the browser claims the gesture before the first pointermove
			 * arrives, and the pane simply never picks up.
			 */
			className="drag-region group/header relative flex shrink-0 items-center gap-1.5"
		>
			{!hideTitle && !title && icon && (
				<span className="flex shrink-0 items-center text-ink-faint">{icon}</span>
			)}
			{/*
			 * A panel may put a control here instead of its name — the terminal's tab strip does,
			 * because once a pane holds several of something, choosing between them *is* the title.
			 */}
			{title ?? (
				<span className="min-w-0 flex-1 truncate text-detail text-ink-muted select-none">
					{hideTitle ? "" : label}
				</span>
			)}
			{title && <span className="min-w-0 flex-1" />}

			{/*
			 * The grip: a short bar near the top edge, centred, and the only thing that moves the pane.
			 *
			 * Absolute so it is not in the row's flow — a long title would otherwise push it off
			 * centre, and the one thing a handle must do is be in the same place every time.
			 *
			 * A real button, not a decoration, because it carries the keyboard route too. Dragging
			 * is the whole interaction here and a drag is one of the few gestures with no keyboard
			 * equivalent at all; without this the dock would be unusable without a mouse. ⌥ rather
			 * than bare arrows, which belong to whatever is being scrolled. Each arrow sends the
			 * pane to that edge of the *dock*, so "left" means one thing wherever it is pressed —
			 * which is what makes it usable without a preview to watch.
			 *
			 * `touch-none` so a trackpad drag moves the pane instead of scrolling what is under it;
			 * without it the browser claims the gesture before the first move arrives.
			 */}
			{draggable && (
				<button
					type="button"
					data-dock-grip={kind}
					aria-label={`移动${label}：拖动，或 ⌥ 加方向键`}
					data-ly-tip="移动"
					onPointerDown={onDragStart}
					onKeyDown={(event) => {
						const side = event.altKey ? ARROWS[event.key] : undefined;
						if (!side) return;
						event.preventDefault();
						onMove(side);
					}}
					className={`ly-dock-grip no-drag absolute top-0 left-1/2 flex -translate-x-1/2 touch-none justify-center pt-[7px] ${
						carried ? "cursor-grabbing" : "cursor-grab"
					}`}
					style={{ height: GRIP_REACH, width: GRIP_WIDTH }}
				>
					<span aria-hidden className="h-[3px] w-9 rounded-full bg-ink-faint" />
				</button>
			)}

			{/*
			 * The controls stop the press from reaching the bar underneath them.
			 *
			 * They sit inside the drag target, so without this every click on ✕ also begins a drag
			 * — which does not visibly break anything, but leaves the pane lifted for the length
			 * of the click and the layout flickering under it.
			 */}
			<div className="no-drag flex shrink-0 items-center gap-0.5">
				{actions}
				{/*
				 * Only where there is something to maximise *from*.
				 *
				 * The conversation is what the window is already showing — offering to make it
				 * fill the window is offering to do nothing. In the collapsed layout the same is
				 * true of every pane, since one of them is all there is room for. Both of those are the
				 * dock's call, not this component's — see `onToggleMaximized`.
				 */}
				{onToggleMaximized && (
					<HeaderButton
						tip={maximized ? "退出全屏（Esc）" : "全屏"}
						label={maximized ? `退出全屏：${label}` : `全屏：${label}`}
						onClick={onToggleMaximized}
					>
						{maximized ? <Minimize2 size={12} strokeWidth={2} /> : <Maximize2 size={12} strokeWidth={2} />}
					</HeaderButton>
				)}
				{onClose && (
					<HeaderButton tip={`关闭${label}`} label={`关闭${label}`} onClick={onClose}>
						<X size={12} strokeWidth={2.2} />
					</HeaderButton>
				)}
			</div>
		</div>
	);
}

function HeaderButton({
	tip,
	label,
	onClick,
	children,
}: {
	tip: string;
	label: string;
	onClick: () => void;
	children: React.ReactNode;
}) {
	return (
		<button
			type="button"
			data-ly-tip={tip}
			aria-label={label}
			onClick={onClick}
			className="flex h-[20px] w-[20px] items-center justify-center rounded-md text-ink-faint transition-colors duration-[var(--ly-t-quick)] hover:bg-card-hover hover:text-ink"
		>
			{children}
		</button>
	);
}
