/**
 * The button, in the four shapes this application actually uses.
 *
 * There were 276 hand-written `<button>` in the renderer and at least eight heights among them —
 * 26, 28, 30, 32, 44 — none of them different on purpose. A row of controls that do not share a
 * baseline reads as two toolbars pushed together, and that is what several of them looked like.
 *
 * `GhostButton` and `PrimaryButton` were already here, in `settings/controls.tsx`, and were already
 * imported from outside settings. This is those two plus the states they kept growing by hand:
 * a size for dense rows, and a loading state that every async action was reimplementing with a
 * disabled flag and a spinner beside it.
 *
 * Not a general-purpose button library. Four variants, two sizes, and no `style` prop — the point
 * is that a caller cannot invent a ninth height.
 */

import type { ReactNode, MouseEvent } from "react";

/**
 * `data-*` passed straight through to the `<button>`.
 *
 * The tests find controls by these rather than by their words, so a label can be reworded without
 * breaking a suite. Nothing else passes through: no style, no class of events — see the top of this file.
 */
export type DataAttributes = { [key: `data-${string}`]: string | boolean | undefined };

export type ButtonVariant = "primary" | "ghost" | "subtle" | "danger";
export type ButtonSize = "md" | "sm" | "xs";

/**
 * `md` is 32px and is the default: it is what a dialog's buttons are, and what the two older
 * components settled on after they spent a while being 26 and 32.
 *
 * `sm` is 26px, for the rows inside a panel where a full-height button would dominate.
 *
 * `xs` is 20px, for an action at the end of a sentence or a caption-sized line: a 26px button
 * there makes the line taller than the text it belongs to.
 */
const HEIGHT: Record<ButtonSize, string> = {
	md: "h-[32px] rounded-lg text-label",
	sm: "h-[26px] rounded-lg text-label",
	xs: "h-[20px] rounded-md text-caption",
};

const SQUARE: Record<ButtonSize, string> = {
	md: "w-[32px]",
	sm: "w-[26px]",
	xs: "w-[20px]",
};

const PAD: Record<ButtonSize, string> = {
	md: "gap-1.5 px-3",
	sm: "gap-1.5 px-3",
	xs: "gap-1 px-1.5",
};

const TONE: Record<ButtonVariant, string> = {
	// The one thing to press. Ink on shell, so it reads as filled without introducing a colour.
	primary: "bg-ink text-shell font-medium hover:opacity-90 disabled:opacity-40",
	// An outline. The ordinary case, and what sits next to `primary` at the foot of a dialog.
	ghost: "border border-line text-ink hover:border-ink-faint hover:bg-card-hover disabled:opacity-45",
	// No outline at all, for a row of actions that should not draw a grid on the panel.
	subtle: "text-ink-muted hover:bg-card-hover hover:text-ink disabled:opacity-45",
	// Destructive. Coloured only on hover: a row of red buttons is a row nobody reads.
	danger: "border border-line text-danger hover:border-danger/50 hover:bg-danger/10 disabled:opacity-45",
};

/** The chosen one of a row of choices: the hover state, held. */
const PRESSED: Partial<Record<ButtonVariant, string>> = {
	ghost: "border border-ink-faint bg-card-hover text-ink disabled:opacity-45",
	subtle: "bg-card-hover text-ink disabled:opacity-45",
};

export function Button({
	children,
	icon,
	onClick,
	variant = "ghost",
	size = "md",
	disabled,
	loading,
	label,
	ariaLabel,
	menu,
	expanded,
	pressed,
	className = "",
	type = "button",
	...data
}: DataAttributes & {
	/**
	 * Omit it for an icon-only button.
	 *
	 * A label beside an icon says the same thing twice, and a row of them turns a toolbar into a
	 * sentence. Where the icon carries the meaning, `label` becomes both the tooltip and the
	 * accessible name — so nothing is lost to a screen reader, only to the eye.
	 */
	children?: ReactNode;
	icon?: ReactNode;
	onClick?: (event: MouseEvent<HTMLButtonElement>) => void;
	variant?: ButtonVariant;
	size?: ButtonSize;
	disabled?: boolean;
	/**
	 * Busy. Disables the button and dims it, without changing its width.
	 *
	 * Every async action used to do this itself, and each did it slightly differently — some
	 * swapped the label for a spinner and the row jumped, some left the button live and it could be
	 * pressed twice. The width is held because a button that shrinks while you are looking at it is
	 * a button you might miss on the way back.
	 */
	loading?: boolean;
	/** Tooltip, and the accessible name when there is no visible text. */
	label?: string;
	/** The accessible name, when the visible text alone does not say what the button does — `中文` is a value, not an action. */
	ariaLabel?: string;
	/** Opens a menu; the value is whether it is open now. Omit it for an ordinary button. */
	menu?: boolean;
	/** Shows or hides a section in place — `aria-expanded` without `menu`'s popup claim. */
	expanded?: boolean;
	/** Chosen among a row of choices — a filter, a view. Omit it for a button that is not one of a set. */
	pressed?: boolean;
	className?: string;
	type?: "button" | "submit";
}) {
	const bare = children === undefined || children === null || children === false;
	const inert = disabled || loading;

	return (
		<button
			{...data}
			type={type}
			disabled={inert}
			onClick={onClick}
			aria-busy={loading || undefined}
			aria-haspopup={menu === undefined ? undefined : "menu"}
			aria-expanded={menu ?? expanded}
			aria-pressed={pressed}
			data-ly-tip={label}
			aria-label={ariaLabel ?? (bare ? label : undefined)}
			data-variant={variant}
			className={[
				// Button radii come in two tiers app-wide: 8px from about 22px tall up, 6px for small icon buttons of 20px and under.
				"flex shrink-0 cursor-pointer items-center whitespace-nowrap",
				"transition-[background-color,border-color,opacity] duration-[var(--ly-t-quick)]",
				HEIGHT[size],
				bare ? `${SQUARE[size]} justify-center` : PAD[size],
				(pressed && PRESSED[variant]) || TONE[variant],
				// Held apart from `disabled:` so a busy button reads as busy rather than as unavailable.
				loading ? "opacity-60" : "",
				className,
			]
				.filter(Boolean)
				.join(" ")}
		>
			{icon}
			{children}
		</button>
	);
}
