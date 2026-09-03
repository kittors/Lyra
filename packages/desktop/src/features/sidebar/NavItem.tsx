/**
 * A row in the nav, and — for the ones that lead somewhere — whether you are there.
 *
 * Clicking these used to leave no trace: the view you had opened looked exactly like the one you
 * had not, so the only way to know where you were was to read the pane beside it. `active` is the
 * same treatment the settings nav already gives its own sections.
 *
 * Destinations sit in the muted tone and step up to full ink when current, which is what makes
 * the highlight read as "you are here" rather than as a hover that got stuck. 新对话 is not one
 * of them — it starts a conversation rather than leading anywhere, so it stays at full weight and
 * has no state to be in. `undefined` rather than `false` says that: not inactive, inapplicable.
 */

import { useLayout } from "../../app/layout.tsx";

export function NavItem({
	icon,
	label,
	onClick,
	active,
}: {
	icon: React.ReactNode;
	label: string;
	onClick?: () => void;
	active?: boolean;
}) {
	// A drawer is reached by pointing at it rather than by muscle memory, so its rows get the
	// taller touch-style hit area the reference mobile layout uses.
	const { compact } = useLayout();
	const tone =
		active === undefined
			? "text-ink hover:bg-card-hover"
			: active
				? "bg-card-hover text-ink"
				: "text-ink-muted hover:bg-card-hover/60 hover:text-ink";
	return (
		<button
			type="button"
			onClick={onClick}
			aria-current={active ? "page" : undefined}
			className={`flex w-full items-center gap-2.5 rounded-lg px-2 text-left transition-colors ${tone} ${
				compact ? "h-[40px] text-body" : "h-[31px] text-label"
			}`}
		>
			<span className={`shrink-0 ${active ? "text-ink" : "text-ink-muted"}`}>{icon}</span>
			{label}
		</button>
	);
}
