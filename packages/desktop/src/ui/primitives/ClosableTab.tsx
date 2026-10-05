import { X } from "lucide-react";
import type { MouseEvent, ReactNode } from "react";
import type { DataAttributes } from "./Button.tsx";

/**
 * One tab in a pane's strip: the name to pick it by, and a ✕ to close it.
 *
 * The terminal and the file pane each had their own copy, and the copies had started to drift —
 * one tab was announced as a tab and the other as a plain button. `data-*` lands on the wrapper,
 * which is what the probes find a tab by.
 *
 * The ✕ is only on the tab you are pointing at, or the one you are on. Every tab carrying one
 * turned a strip of three into a row of six targets, and the close buttons read as loudly as the
 * names — on a strip whose whole job is to let you pick by name.
 */
export function ClosableTab({
	children,
	current,
	onSelect,
	onClose,
	closeLabel,
	tip,
	onContextMenu,
	className = "",
	labelClassName = "",
	...data
}: DataAttributes & {
	children: ReactNode;
	current: boolean;
	onSelect: () => void;
	onClose: () => void;
	/** Names the tab being closed: a row of identical "close" buttons says nothing to a screen reader. */
	closeLabel: string;
	tip?: string;
	onContextMenu?: (event: MouseEvent<HTMLDivElement>) => void;
	className?: string;
	labelClassName?: string;
}) {
	return (
		<div
			{...data}
			onContextMenu={onContextMenu}
			className={`group/tab flex shrink-0 items-center gap-1 rounded-md pr-0.5 pl-2 transition-colors duration-[var(--ly-t-quick)] ${
				// Lit on hover as well, or a row of names does not say which one the pointer is on.
				current ? "bg-card-hover text-ink" : "text-ink-faint hover:bg-card-hover/60 hover:text-ink"
			} ${className}`}
		>
			<button
				type="button"
				role="tab"
				aria-selected={current}
				data-ly-tip={tip}
				onClick={onSelect}
				className={`py-1 text-detail whitespace-nowrap ${labelClassName}`}
			>
				{children}
			</button>
			<button
				type="button"
				data-ly-hover-reveal
				aria-label={closeLabel}
				onClick={onClose}
				className={`rounded-md p-0.5 transition-opacity duration-[var(--ly-t-quick)] hover:bg-elevated ${
					current ? "opacity-60 hover:opacity-100" : "opacity-0 group-hover/tab:opacity-60"
				}`}
			>
				<X size={11} strokeWidth={2.2} />
			</button>
		</div>
	);
}
