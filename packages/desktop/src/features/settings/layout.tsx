/**
 * How a settings page is laid out: a heading, a card, a labelled row.
 *
 * Two shapes for the same thing, and the difference is the point. `Row` puts the label and the
 * control on one line, which works while the control is small; `Field` stacks them, which is what
 * a full-width input needs. Both are here, side by side, where the choice between them is visible.
 */

import { Text } from "../../ui/primitives/Text.tsx";

/** Section heading above a card group, as used by the reference settings pages. */
export function SectionTitle({ children }: { children: React.ReactNode }) {
	return (
		<Text as="h2" size="title" weight="medium" className="mb-3">
			{children}
		</Text>
	);
}

export function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
	return <div className={`overflow-hidden rounded-[12px] border border-line bg-card/40 ${className}`}>{children}</div>;
}

/** One labelled row inside a card, with the control right-aligned. */
export function Row({
	title,
	detail,
	control,
	children,
}: {
	title: string;
	detail?: React.ReactNode;
	control?: React.ReactNode;
	children?: React.ReactNode;
}) {
	return (
		/*
		 * The control drops below the text when the row runs out of width.
		 *
		 * A control is `shrink-0` — a segmented picker squeezed to nothing is worse than one
		 * that moved — so beside it the description took whatever was left. In a narrow window
		 * that was a column two or three characters wide and a dozen lines tall, which reads as
		 * broken rather than as compact. Measured against the row, so a wide window is unchanged.
		 */
		<div className="@container border-b border-line-soft px-4 py-3.5 last:border-b-0">
			<div className="flex flex-col gap-2 @md:flex-row @md:items-start @md:gap-4">
				<div className="min-w-0 flex-1">
					<Text as="div" size="body">
						{title}
					</Text>
					{detail && (
						<Text as="div" size="label" tone="muted" className="mt-0.5 leading-relaxed">
							{detail}
						</Text>
					)}
				</div>
				{control && <div className="shrink-0 @md:pt-0.5">{control}</div>}
			</div>
			{children}
		</div>
	);
}

/**
 * A row that leads with a mark, for a thing rather than a setting.
 *
 * `Row` describes a preference: a name, what it does, and the control that changes it. This is
 * for a list of things that were installed — a plugin, a skill, a server — where the mark is how
 * you find the one you mean, and the one line under it is all anybody reads.
 *
 * That line is the whole point. The plugin list used to carry, per row: a version badge, a source
 * badge, a category badge, a skill count, a server count, a 详情 link that unfolded three more
 * sections, and a 打开目录 link. All true, none of it what the page is for — which is seeing what
 * you have and switching it on or off. The rest of it lives on the bundle's own page, which is
 * where you go when the answer is not on the row.
 *
 * `actions` is for what appears on hover; `control` for what is always there. Keeping them apart
 * is what stops a ⋯ from shifting the switch beside it a few pixels as the pointer arrives.
 */
export function ListRow({
	icon,
	title,
	detail,
	actions,
	control,
	onOpen,
	openLabel,
}: {
	icon?: React.ReactNode;
	title: React.ReactNode;
	detail?: React.ReactNode;
	actions?: React.ReactNode;
	control?: React.ReactNode;
	/** Makes the row itself a target — for a thing that has somewhere further to go. */
	onOpen?: () => void;
	openLabel?: string;
}) {
	return (
		/*
		 * No rule between rows, and no box around the list.
		 *
		 * A hairline every 52px turns a list of eight things into sixteen horizontal edges, and the
		 * card's own border adds a seventeenth around the outside — all of it drawing structure that
		 * the rows already have from their marks and their spacing. Taken away, the eye groups them
		 * by rhythm, and the only line left on the page is the one under the tabs, which is the one
		 * that means something.
		 */
		<div className="group/row relative flex items-center gap-3 rounded-[10px] px-2 py-3">
			{/*
			 * The row's own hit area, underneath everything on it.
			 *
			 * A row cannot be a `<button>` while it also holds a switch and a menu — a button inside
			 * a button is not a thing the platform has. Laid over the row instead and left at the
			 * bottom of the stack, so every control on top of it takes its own clicks first.
			 */}
			{onOpen && (
				<button
					type="button"
					aria-label={openLabel}
					onClick={onOpen}
					className="absolute inset-0 rounded-[10px] transition-colors duration-[var(--ly-t-quick)] hover:bg-card-hover/60"
				/>
			)}

			{icon && <span className="pointer-events-none relative shrink-0">{icon}</span>}

			<div className="pointer-events-none relative min-w-0 flex-1">
				<Text as="div" size="body" className="truncate">
					{title}
				</Text>
				{detail && (
					<Text as="div" size="label" tone="muted" className="mt-0.5 truncate">
						{detail}
					</Text>
				)}
			</div>

			{/*
			 * 动作与开关在同一条中线上。
			 *
			 * `control` 之前没有 `items-center`，于是一个 22px 的开关和一排 32px 的按钮各自按自己的
			 * 高度落位，差出来的几像素在一行里看得很清楚。两边都居中，行有多高就都对着那条中线。
			 */}
			{actions && <div className="relative flex shrink-0 items-center gap-1">{actions}</div>}
			{control && <div className="relative flex shrink-0 items-center">{control}</div>}
		</div>
	);
}

export function Field({
	label,
	hint,
	children,
}: {
	label: string;
	hint?: string;
	children: React.ReactNode;
}) {
	return (
		<label className="block">
			<Text size="label" tone="muted" className="mb-1.5 block">
				{label}
			</Text>
			{children}
			{hint && (
				<Text size="detail" tone="faint" className="mt-1.5 block">
					{hint}
				</Text>
			)}
		</label>
	);
}
