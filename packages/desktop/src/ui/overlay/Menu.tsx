/**
 * The pieces a menu is made of: a row, a separator, a heading, a search field, a padded body.
 *
 * Separate from `Popover`, which is only a positioned surface. A popover can hold anything — a
 * colour picker, a form — and a menu can live somewhere that is not a popover. Keeping the two
 * apart is what stops "how a row looks" and "where the surface lands" from being edited together
 * by accident.
 */

import { Search, X } from "lucide-react";
import { createContext, useContext } from "react";

import { ScrollText } from "../scroll/ScrollText.tsx";
import { shortcutLabel } from "../keyboard.ts";

/**
 * Whether rows in this menu keep a column for their mark, even the ones that have none.
 *
 * Set by the body rather than by each row, because it is a fact about the menu: the file-opener
 * dropdown lists seven applications and finds an icon for three of them, so with the column
 * collapsing per row its labels started at two different x positions and the list read as two
 * lists. A row cannot see its neighbours; the body can.
 */
const InsetIcons = createContext(false);

/**
 * The padded box every menu's contents sit in.
 *
 * Rows are rounded, so the panel needs a margin for them to sit inside — and every menu
 * needing the same margin is exactly the sort of thing that drifts if each one writes it out.
 */
export function MenuBody({
	children,
	insetIcons = false,
	className = "",
}: {
	children: React.ReactNode;
	/** Reserve the icon column on every row, for a menu where only some rows have one. */
	insetIcons?: boolean;
	className?: string;
}) {
	return (
		<InsetIcons.Provider value={insetIcons}>
			<div className={`p-1 ${className}`}>{children}</div>
		</InsetIcons.Provider>
	);
}

/**
 * One row in a menu.
 *
 * Every menu in the app had grown its own version of this — different heights, different
 * corner radii, one with no radius at all — so the same gesture looked different depending on
 * which menu you were in. The visual states live in `.ly-item` so a row that needs a
 * different shape (the permission picker's two-line entries) can still opt into them.
 */
export function MenuItem({
	icon,
	children,
	detail,
	hint,
	trailing,
	selected,
	danger,
	disabled,
	title,
	onClick,
}: {
	icon?: React.ReactNode;
	children: React.ReactNode;
	/**
	 * A second line explaining the choice.
	 *
	 * Handled here rather than by each menu laying out its own two-line row: the permission
	 * picker used to do exactly that and ended up with its own height, padding and hover
	 * treatment, so the same gesture looked different depending which menu you were in.
	 */
	detail?: React.ReactNode;
	/** Right-aligned annotation: a count, a shortcut digit, a context size. */
	hint?: React.ReactNode;
	/** Right-aligned element, for a checkmark or a chevron. */
	trailing?: React.ReactNode;
	selected?: boolean;
	danger?: boolean;
	disabled?: boolean;
	title?: string;
	onClick?: () => void;
}) {
	const inset = useContext(InsetIcons);

	return (
		<button
			type="button"
			role="menuitem"
			disabled={disabled}
			data-ly-tip={title}
			data-selected={selected ? "true" : undefined}
			data-danger={danger ? "true" : undefined}
			onClick={onClick}
			className={`ly-scroll ly-item flex w-full gap-2.5 px-2 text-left text-label ${
				detail ? "items-start py-1.5" : "h-[28px] items-center"
			}`}
		>
			{/*
			 * A fixed column, whatever is in it.
			 *
			 * Menus mix 13px lucide marks with 18px application icons, and a slot that took each
			 * one's own width left the labels beside them a few pixels out of line — the sort of
			 * thing nobody names but everybody sees. Centred in a column wide enough for the
			 * largest, so the text starts in the same place regardless.
			 */}
			{(icon || inset) && (
				<span
					className={`flex w-[18px] shrink-0 items-center justify-center text-ink-muted ${detail ? "mt-[3px]" : ""}`}
				>
					{icon}
				</span>
			)}
			<span className="min-w-0 flex-1">
				{typeof children === "string" ? <ScrollText text={children} /> : children}
				{/* One line. A detail that wraps makes its row taller than its neighbours, and a menu
				 * of ragged rows is harder to scan than one where the odd path is cut short. */}
				{detail && <span className="mt-0.5 block truncate text-caption leading-snug opacity-65">{detail}</span>}
			</span>
			{hint !== undefined && (
				<span className={`shrink-0 font-mono text-caption text-ink-faint ${detail ? "mt-[3px]" : ""}`}>
					{typeof hint === "string" ? shortcutLabel(hint) : hint}
				</span>
			)}
			{trailing}
		</button>
	);
}

/** Separates groups of items inside a menu. */
export function MenuSeparator() {
	return <div className="my-1 h-px bg-line-soft" />;
}

/** Small label above a group of items. */
export function MenuLabel({ children }: { children: React.ReactNode }) {
	return <div className="px-2 pt-1.5 pb-1 text-caption text-ink-faint">{children}</div>;
}

/**
 * The filter at the top of a menu that lists more than a screenful.
 *
 * Written out twice before this — once in the branch menu, once in the project picker — with the
 * same height, the same magnifier and the same placeholder wording, which is two chances for one
 * of them to drift. Meant for `Popover`'s `header` slot, so it stays put while the list scrolls;
 * the rule beneath it belongs to that slot and is not drawn here.
 *
 * Escape clears before it closes, matching `SearchField`: the first press undoes the typing, and
 * only a press with nothing to undo dismisses the menu.
 */
export function MenuSearch({
	value,
	onChange,
	placeholder,
	autoFocus = true,
}: {
	value: string;
	onChange: (value: string) => void;
	placeholder?: string;
	autoFocus?: boolean;
}) {
	return (
		<div className="flex h-9 items-center gap-2 px-3">
			<Search size={13} strokeWidth={1.9} className="shrink-0 text-ink-faint" />
			<input
				autoFocus={autoFocus}
				value={value}
				onChange={(event) => onChange(event.target.value)}
				onKeyDown={(event) => {
					if (event.key !== "Escape" || !value) return;
					event.stopPropagation();
					onChange("");
				}}
				placeholder={placeholder}
				className="h-full min-w-0 flex-1 bg-transparent text-label text-ink placeholder:text-ink-faint"
			/>
			{value && (
				<button
					type="button"
					aria-label="清除搜索"
					onClick={() => onChange("")}
					className="flex h-[16px] w-[16px] shrink-0 items-center justify-center rounded-full text-ink-faint transition-colors hover:bg-card-hover hover:text-ink"
				>
					<X size={10.5} strokeWidth={2.2} />
				</button>
			)}
		</div>
	);
}
