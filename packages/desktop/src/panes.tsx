/**
 * The navigation pane, which is the one thing in the window that is not in the dock.
 *
 * It changes shape with the window — a column at desktop widths, a drawer over the content when
 * there is no room beside it — and is resizable at the widths where resizing means anything. Kept
 * apart from the layout state it reads: this file draws, `layout.tsx` decides.
 *
 * Its sibling used to live here too: `SidePane`, the right-hand panel, with two widths and three
 * modes of covering the conversation. The dock replaced all of it — every pane including the
 * conversation is now a leaf in one tree, and a tree needs no arbitration between its branches.
 */

import { useEffect, useRef, useState } from "react";
import { ResizeHandle } from "./components/ResizeHandle.tsx";
import { useFocusTrap, useLayout } from "./layout.tsx";
import { drawerWidth } from "./mobile/drawer-gesture.ts";
import { onPhone } from "./mobile/useMobileShell.ts";

/**
 * The shell's navigation pane, in whichever form the window can afford.
 *
 * Wide enough, it is a column that pushes the content aside. Too narrow for that, it becomes a
 * drawer covering the window — the same pane, reached the same way, so nothing has to be
 * learned twice. Both the workspace sidebar and the settings nav render through here so the
 * two can never drift apart.
 */
export function NavPane({
	width,
	label,
	maxWidth,
	children,
}: {
	width: number;
	label: string;
	/**
	 * A ceiling lower than the pane's own, when the rest of the window needs the room.
	 *
	 * The workspace shell passes one computed from what is left after the conversation's floor and
	 * the panel's minimum. Absent — the settings window, which has neither beside it — the pane's
	 * own bound is the only limit there is.
	 */
	maxWidth?: number;
	children: React.ReactNode;
}) {
	const { compact, navOpen, dismissNav, setSidebarWidth, resetSidebarWidth, bounds } = useLayout();
	const ref = useRef<HTMLElement>(null);
	/**
	 * Suppresses the transition for one beat after the breakpoint moves.
	 *
	 * The two forms animate different properties — margin when pushing, transform when
	 * covering. Crossing the breakpoint swaps both the property and the value, and letting
	 * that interpolate produces a slide from nowhere to nowhere.
	 */
	const [snap, setSnap] = useState(false);

	useFocusTrap(ref, compact && navOpen);

	useEffect(() => {
		setSnap(true);
		const id = window.setTimeout(() => setSnap(false), 60);
		return () => window.clearTimeout(id);
	}, [compact]);

	/*
	 * On a phone the drawer stops short of the full width and lays a scrim over what is left.
	 *
	 * Covering everything would make it a page, and a page needs a button to leave. The strip of
	 * conversation still showing says the drawer is *over* the session rather than instead of it —
	 * so tapping outside is the obvious way back, and the drag that opened it visibly has somewhere
	 * to return to. In a narrow desktop window it stays full-width: there is no thumb to drag it
	 * with and no edge gesture to discover it by, so the strip would be decoration.
	 */
	const phone = onPhone();

	const pane = (
		<aside
			ref={ref}
			aria-label={label}
			{...(compact ? { role: "dialog" as const, "aria-modal": true } : {})}
			// `inert`, not just aria-hidden: a closed pane is otherwise still in the tab order,
			// so Tab walks into something nobody can see.
			inert={!navOpen}
			/*
			 * Which form it is in, so the fill can differ — see `[data-pane="drawer"]` in the
			 * stylesheet. Beside the content the pane is a column of its own; as a drawer it lies
			 * over the transcript and has to cover what is under it.
			 */
			data-pane={compact ? "drawer" : "beside"}
			className={`${compact ? `fixed inset-y-0 left-0 z-30 shadow-2xl shadow-black/60 ${phone ? "ly-drawer" : "right-0"}` : "h-full w-full overflow-hidden"} ${
				snap ? "transition-none" : "transition-[opacity,transform] duration-[var(--ly-t-base)] ease-out"
			}`}
			style={
				compact
					? phone
						? {
								width: drawerWidth(window.innerWidth),
								/*
								 * The fallback is the whole mechanism: with no finger down `--ly-drawer`
								 * is unset, so this reads the open/closed value and animates like any
								 * other state change. During a drag the variable exists and overrides
								 * it, frame by frame, without React hearing about it.
								 */
								transform: `translateX(calc((var(--ly-drawer, ${navOpen ? 1 : 0}) - 1) * 100%))`,
							}
						: { transform: navOpen ? "none" : "translateX(-100%)", opacity: navOpen ? 1 : 0 }
					: undefined
			}
		>
			{children}
		</aside>
	);

	if (compact)
		return phone ? (
			<>
				{/*
				 * The scrim, which is both the way out and the thing that says there is one.
				 *
				 * Its opacity tracks the same variable as the drawer, so during a drag the page
				 * darkens under the finger at exactly the rate the drawer emerges — that coupling is
				 * most of what makes the drawer feel attached to the hand rather than triggered by
				 * it. `inert` while closed so it cannot swallow a tap on the conversation.
				 */}
				<div
					aria-hidden
					inert={!navOpen}
					onClick={dismissNav}
					className={`ly-drawer-scrim fixed inset-0 z-20 bg-black/45 ${
						snap ? "transition-none" : "transition-opacity duration-[var(--ly-t-base)] ease-out"
					}`}
					style={{ opacity: `var(--ly-drawer, ${navOpen ? 1 : 0})` }}
				/>
				{pane}
			</>
		) : (
			pane
		);

	return (
		/*
		 * A frame around the pane, so the drag handle can hang outside it.
		 *
		 * The pane clips its own overflow — it has to, or a long title spills onto the content
		 * while the pane is sliding shut. That clipping is also what forced the resize handle to
		 * live *inside* the pane, on the same nine pixels of edge as the scrollbar's thumb, and no
		 * arrangement of layers fixes that: the thumb can only be reached when its scroller is
		 * hovered, and a pointer sitting on the handle is not hovering the scroller. Which meant
		 * the scrollbar was draggable or not depending on which direction you approached it from.
		 *
		 * The edge belongs to the boundary between two panes, not to either one of them. So the
		 * frame carries the width and the clipping stays on the pane, leaving the handle free to
		 * sit where the boundary actually is — one pixel inside, the rest over the content beside
		 * it. Nothing moved on screen: the scrollbar is where it was, the hairline is where it was.
		 * Only the invisible hit area stepped aside.
		 */
		<div
			/*
			 * `ly-freeze`: this frame's margin is what makes the sidebar push the content aside, so
			 * dragging its edge changes the margin every frame — and an eased margin trails the
			 * pointer. Named here rather than keyed on `[data-resizing]`, which is a flag on the
			 * root and therefore a question asked about the whole document; see `motion-freeze.ts`.
			 */
			className={`ly-freeze relative shrink-0 ${
				snap ? "transition-none" : "transition-[margin-left,opacity] duration-[var(--ly-t-base)] ease-out"
			}`}
			style={{ width, marginLeft: navOpen ? 0 : -width, opacity: navOpen ? 1 : 0 }}
		>
			{pane}

			{/*
			 * Only while it is a pane you can see beside the content. Closed, there is no edge —
			 * and a handle over the content with no pane attached to it resizes nothing.
			 */}
			{navOpen && (
				<ResizeHandle
					edge="end"
					// The width on screen, not the one in storage — a drag that started from the
					// remembered number would jump by the difference on its first move.
					width={width}
					min={bounds.sidebar.min}
					max={Math.min(bounds.sidebar.max, maxWidth ?? bounds.sidebar.max)}
					onResize={setSidebarWidth}
					onReset={resetSidebarWidth}
					label="调整侧边栏宽度"
				/>
			)}
		</div>
	);
}
