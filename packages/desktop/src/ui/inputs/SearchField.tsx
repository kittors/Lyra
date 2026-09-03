import { Search, X } from "lucide-react";
import { useEffect, useRef } from "react";

/**
 * The app's search box.
 *
 * One component because there were three: the sidebar's session search, the review panel's file
 * filter, and the file tree's. Each had its own height, its own border decision and its own idea
 * of whether the magnifier sat inside the field or beside it — three answers to a question that
 * only has one.
 *
 * Two sizes, because the two contexts genuinely differ: a field that owns its row (`comfortable`)
 * and one tucked into a panel header where the rows around it are 8px tall (`compact`).
 */
export function SearchField({
	value,
	onChange,
	placeholder,
	size = "compact",
	autoFocus,
	onEscape,
	className = "",
}: {
	value: string;
	onChange: (next: string) => void;
	placeholder?: string;
	size?: "compact" | "comfortable";
	autoFocus?: boolean;
	/** Escape clears first and dismisses only when already empty, which is what a filter wants. */
	onEscape?: () => void;
	className?: string;
}) {
	const input = useRef<HTMLInputElement>(null);

	useEffect(() => {
		if (autoFocus) input.current?.focus();
	}, [autoFocus]);

	const comfortable = size === "comfortable";

	return (
		<div
			className={`flex min-w-0 items-center gap-1.5 rounded-lg border border-transparent bg-card/60 transition-colors focus-within:border-line focus-within:bg-input ${
				comfortable ? "h-8 px-2.5" : "h-[26px] px-2"
			} ${className}`}
		>
			<Search size={comfortable ? 13 : 12} strokeWidth={1.9} className="shrink-0 text-ink-faint" />
			<input
				ref={input}
				value={value}
				onChange={(event) => onChange(event.target.value)}
				onKeyDown={(event) => {
					if (event.key !== "Escape") return;
					event.stopPropagation();
					if (value) onChange("");
					else onEscape?.();
				}}
				placeholder={placeholder}
				className={`min-w-0 flex-1 bg-transparent text-ink placeholder:text-ink-faint ${
					comfortable ? "text-label" : "text-detail"
				}`}
			/>
			{value && (
				<button
					type="button"
					data-ly-tip="清除"
					aria-label="清除搜索"
					onClick={() => {
						onChange("");
						input.current?.focus();
					}}
					className="flex h-[16px] w-[16px] shrink-0 items-center justify-center rounded-full text-ink-faint transition-colors hover:bg-card-hover hover:text-ink"
				>
					<X size={10.5} strokeWidth={2.2} />
				</button>
			)}
		</div>
	);
}
