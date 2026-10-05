import { Tooltip } from "../overlay/Tooltip.tsx";
import { shortcutLabel } from "../keyboard.ts";
import type { DataAttributes } from "./Button.tsx";

/**
 * A button whose label is an icon.
 *
 * Every toolbar in the app had grown its own: five heights, three corner radii, and press
 * feedback that ranged from nothing to a 10% shrink. The shrink is gone on purpose — a control
 * that jumps away from the pointer at the moment of contact reads as unstable, and at these
 * sizes it is a wobble rather than a press. Pressing is shown by the fill going one step
 * darker, which is what a real button does: it stays exactly where it is and changes state.
 *
 * The label is both the tooltip and the accessible name, so a caller cannot ship one without
 * the other — which is how icon-only toolbars end up unreadable to screen readers.
 */
export function IconButton({
	label,
	ariaLabel,
	icon,
	onClick,
	active,
	disabled,
	emphasis,
	badge,
	explainDisabled,
	tone = "default",
	size = "md",
	tipSide = "bottom",
	menu,
	expanded,
	className = "",
	...data
}: DataAttributes & {
	label: string;
	/**
	 * The accessible name, when it has to say more than the tooltip.
	 *
	 * A row of identical buttons reads to a screen reader as the same word over and over; the name
	 * carries which row (`归档会话「a」`) while the tooltip stays short beside the pointer that is
	 * already on that row. Omit it and `label` is both, which is the ordinary case.
	 */
	ariaLabel?: string;
	icon: React.ReactNode;
	onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
	/** Held down / currently on, for toggles like "match case". */
	active?: boolean;
	disabled?: boolean;
	/**
	 * The one control in a row that is worth pressing now.
	 *
	 * Full-strength ink against the row's usual faint grey, which is the contrast the app already
	 * uses to mean "this one". Not a filled or coloured button: a toolbar that grows a primary
	 * button has stopped being a toolbar.
	 */
	emphasis?: boolean;
	/** A count on the corner. Zero and null are both drawn as nothing — see the git panel. */
	badge?: number | null;
	/**
	 * Show the tooltip even while disabled, because the label explains the disabling.
	 *
	 * Off by default, and the default is right for most toolbars: a control greyed out for an
	 * obvious reason gains nothing from a bubble repeating its name. It is wrong wherever the
	 * reason is the interesting part — 「当前分支没有上游」 is precisely what someone hovering a
	 * dead pull button wants to know, and without this they get silence and have to guess.
	 */
	explainDisabled?: boolean;
	tone?: "default" | "danger";
	/**
	 * `xs` is 20px, the height of a pane header's row and of a caption line; the corner drops to 6px
	 * with it, as every button at that size does. `composer` follows the input box's own control
	 * height, so its row stays one line when that changes.
	 */
	size?: "xs" | "sm" | "md" | "composer";
	tipSide?: "top" | "bottom";
	/** Opens a menu; the value is whether it is open now. Same as `Button`'s. */
	menu?: boolean;
	/** Shows or hides a section in place. Same as `Button`'s. */
	expanded?: boolean;
	className?: string;
}) {
	const showBadge = typeof badge === "number" && badge > 0;
	const button = (
		<button
			{...data}
			type="button"
			aria-label={ariaLabel ?? shortcutLabel(label)}
			aria-pressed={active}
			aria-haspopup={menu === undefined ? undefined : "menu"}
			aria-expanded={menu ?? expanded}
			disabled={disabled}
			onClick={onClick}
			// The count, readable without knowing how it is drawn — a badge in the corner here, part
			// of a word in the wide form of the git panel's sync row.
			data-ly-count={showBadge ? String(badge) : undefined}
			className={`relative flex shrink-0 items-center justify-center transition-[color,background-color,opacity] duration-[var(--ly-t-quick)] disabled:opacity-40 ${
				size === "xs"
					? "h-[20px] w-[20px] rounded-md"
					: size === "sm"
						? "h-[22px] w-[22px] rounded-lg"
						: size === "composer"
							? "ly-composer-control ly-composer-icon rounded-lg"
							: "h-[26px] w-[26px] rounded-lg"
			} ${
				tone === "danger"
					? "text-ink-faint hover:bg-danger/10 hover:text-danger active:bg-danger/15"
					: active
						? "bg-card-hover text-ink active:bg-elevated"
						: emphasis
							? "text-ink hover:bg-card-hover active:bg-elevated"
							: "text-ink-faint hover:bg-card-hover hover:text-ink active:bg-elevated"
			} ${className}`}
		>
			{icon}
			{showBadge && (
				/*
				 * Outside the icon rather than beside it, so a number appearing does not move the
				 * row. `tabular-nums` for the same reason: 1 becoming 2 must not change the width.
				 */
				<span className="pointer-events-none absolute -top-0.5 -right-1 font-mono text-[9px] leading-none tabular-nums text-ink">
					{badge}
				</span>
			)}
		</button>
	);

	// A disabled control explains nothing by hovering, and its tip would never dismiss on click —
	// unless the reason it is disabled is the thing worth saying. See `explainDisabled`.
	return disabled && !explainDisabled ? (
		button
	) : (
		<Tooltip label={label} side={tipSide}>
			{button}
		</Tooltip>
	);
}
