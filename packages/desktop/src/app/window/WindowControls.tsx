/**
 * The buttons in the window's top row, and how much room they need.
 *
 * Where that row *starts* — past the traffic lights on macOS, past nothing on Windows and Linux,
 * where the system's own buttons are at the other end — is `src/titlebar.ts`. That is a property
 * of the platform and the window rather than of any button, and the dock needs it without needing
 * anything else in this file.
 */

/** A toolbar button, and the gap after it. Shared so what sits beside one can clear it. */
export const TOOLBAR_BUTTON = 28;
export const TOOLBAR_GAP = 10;

/**
 * How much of the window's top-left corner belongs to the window rather than to the content.
 *
 * Whatever the system draws there *and* the sidebar toggle: with the sidebar closed, that toggle
 * is the only way back to it, and it floats over whatever the dock has put in that corner. A pane
 * that only cleared the lights drew its own title straight underneath the button — the terminal's
 * first tab ended up on top of it, so the tab was hard to read and the button, still there and
 * still working, looked like it had gone.
 *
 * A function of where the toggle starts, which is a question about the platform and the window —
 * see `useTitlebar`. It was a constant back when only macOS was drawn correctly.
 */
export function toolbarReserved(start: number): number {
	return start + TOOLBAR_BUTTON + TOOLBAR_GAP;
}

/**
 * The button beside the traffic lights: show or hide the sidebar.
 *
 * Back and forward used to live here too. There is nothing to go back to: this is one window
 * with panes, not a stack of pages, so both were permanently inert.
 *
 * Whoever renders it owns the positioning and the `no-drag` region; this is only the button.
 */
export function WindowControls({
	navOpen,
	onToggleNav,
	active,
}: {
	navOpen: boolean;
	onToggleNav: () => void;
	/** Filled in, for the compact layout where the sidebar is a drawer that is currently over you. */
	active?: boolean;
}) {
	return (
		<>
			<ToolbarButton label={navOpen ? "隐藏侧边栏 ⌘B" : "显示侧边栏 ⌘B"} onClick={onToggleNav} active={active}>
				<SidebarIcon open={navOpen} />
			</ToolbarButton>
		</>
	);
}

export function ToolbarButton({
	children,
	label,
	onClick,
	active,
}: {
	children: React.ReactNode;
	label: string;
	/**
	 * The event is passed on for the callers that anchor a popover to this button.
	 *
	 * Optional to receive: a handler written `() => …` ignores it, which is what every other
	 * caller does.
	 */
	onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
	active?: boolean;
}) {
	return (
		<button
			type="button"
			data-ly-tip={label}
			// A hook the mobile stylesheet can reach: a 28px square is a comfortable mouse target
			// and a poor thumb one, and that is a difference in hit area rather than in markup.
			data-ly-toolbar-button
			aria-label={label}
			aria-pressed={active}
			onClick={onClick}
			className={`no-drag flex h-7 w-7 items-center justify-center rounded-md transition-all duration-[var(--ly-t-quick)] ${
				active ? "bg-card-hover text-ink" : "text-ink-faint hover:bg-card-hover hover:text-ink"
			}`}
		>
			{children}
		</button>
	);
}

/** The sidebar pane fills in while it is open, so the icon reflects state without moving. */
function SidebarIcon({ open }: { open: boolean }) {
	return (
		<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
			<rect x="3" y="4" width="18" height="16" rx="2.5" />
			<line x1="9.5" y1="4" x2="9.5" y2="20" />
			<rect
				x="3"
				y="4"
				width="6.5"
				height="16"
				rx="2.5"
				fill="currentColor"
				stroke="none"
				className="transition-opacity duration-[var(--ly-t-base)]"
				opacity={open ? 0.5 : 0}
			/>
		</svg>
	);
}
