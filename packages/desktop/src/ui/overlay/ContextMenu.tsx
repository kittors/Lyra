/**
 * The menu that opens where you right-clicked.
 *
 * Electron ships no default context menu, so until now right-clicking anywhere in this app did
 * nothing at all — not on a file, not in the editor, not in a text field. `Popover` already knows
 * how to hang a surface off a point rather than an element; what was missing is the small amount
 * of agreement around it: which target the menu is about, and the fact that picking any row closes
 * it. Written once here so the file tree, the editor and the plain inputs cannot drift apart.
 */

import { useCallback, useState } from "react";

import { MenuBody, Popover, type PopoverWidth } from "./Popover.tsx";

/** Where the menu hangs from, and what it is about. */
interface ContextTarget<T> {
	point: { x: number; y: number };
	target: T;
}

/**
 * Track a right-click: the point it happened at and the thing it happened on.
 *
 * The target rides along because a context menu is nearly always about a row, and reading "which
 * row" back out of the event later is not possible — by the time the menu renders, the pointer has
 * moved on. Typed, so a menu cannot be built for the wrong kind of thing.
 */
export function useContextMenu<T = void>() {
	const [state, setState] = useState<ContextTarget<T> | null>(null);

	const show = useCallback((event: React.MouseEvent, target: T) => {
		// Otherwise the browser's own menu appears in dev, and the parent's handler fires too —
		// which in a tree means the row menu and the background menu both trying to open.
		event.preventDefault();
		event.stopPropagation();
		setState({ point: { x: event.clientX, y: event.clientY }, target });
	}, []);

	return {
		anchor: state?.point ?? null,
		/** Null until something has been right-clicked; narrow on this before rendering the menu. */
		target: state ? state.target : null,
		open: state !== null,
		show,
		close: useCallback(() => setState(null), []),
	};
}

/**
 * The surface itself.
 *
 * Every row closes it, handled here rather than by each item remembering to: a context menu has no
 * rows that are not actions, and one that stayed open after a click would be the only menu in the
 * app that did. The listener is on the bubble phase, so the row's own handler has already run.
 */
export function ContextMenu({
	anchor,
	onClose,
	width = "default",
	children,
}: {
	anchor: { x: number; y: number } | null;
	onClose: () => void;
	width?: PopoverWidth;
	children: React.ReactNode;
}) {
	if (!anchor) return null;
	return (
		<Popover
			anchor={anchor}
			onClose={onClose}
			// Down and to the right of the cursor, which is where every OS puts it.
			placement="bottom"
			align="start"
			width={width}
			/*
			 * No ceiling of our own — only the one the window imposes.
			 *
			 * `MENU_MAX_HEIGHT` is right for a menu that *lists* things, where forty rows is a
			 * scroll and always was. This kind lists actions, and the actions at the bottom are
			 * 删除 and 永久删除: capped at 340px the file menu ended mid-list, and the two items
			 * somebody would look hardest for were the two below the fold. `Popover` still clamps
			 * to the gap it was placed in and flips when the other side has more room.
			 */
			role="menu"
		>
			<MenuBody insetIcons>
				{/* biome-ignore lint/a11y/useKeyWithClickEvents: rows are buttons; this only closes after them. */}
				<div onClick={onClose}>{children}</div>
			</MenuBody>
		</Popover>
	);
}
