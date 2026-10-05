/**
 * A row in the nav, and — for the ones that lead somewhere — whether you are there.
 *
 * Clicking these used to leave no trace: the view you had opened looked exactly like the one you
 * had not, so the only way to know where you were was to read the pane beside it. `active` is the
 * same treatment the settings nav already gives its own sections.
 *
 * Every row is drawn in full ink; the current destination is marked by its
 * fill alone. 新对话 starts a conversation rather than leading anywhere, so it has no state to be
 * in. `undefined` rather than `false` says that: not inactive, inapplicable.
 */

import { useLayout } from "../../app/layout.tsx";

export function NavItem({
	icon,
	label,
	onClick,
	active,
	badge,
	badgeLabel,
}: {
	icon: React.ReactNode;
	label: string;
	onClick?: () => void;
	active?: boolean;
	/** A count at the right-hand end — something there is waiting on you. Zero draws nothing. */
	badge?: number;
	/** What the count means, for a screen reader and the tooltip. */
	badgeLabel?: string;
}) {
	// A drawer is reached by pointing at it rather than by muscle memory, so its rows get the
	// taller touch-style hit area the reference mobile layout uses.
	const { compact } = useLayout();
	const tone = active ? "bg-card-hover" : "hover:bg-card-hover";
	return (
		<button
			type="button"
			onClick={onClick}
			aria-current={active ? "page" : undefined}
			className={`flex w-full items-center gap-2 rounded-lg px-2.5 text-left text-ink transition-colors ${tone} ${
				compact ? "h-[40px] text-body" : "h-[32px] text-label"
			}`}
		>
			<span className="shrink-0">{icon}</span>
			{label}
			{badge ? (
				<span
					data-ly-tip={badgeLabel}
					aria-label={badgeLabel}
					className="ml-auto min-w-[18px] rounded-full bg-accent/15 px-1.5 text-center text-caption leading-[18px] font-medium text-accent tabular-nums"
				>
					{badge}
				</span>
			) : null}
		</button>
	);
}
