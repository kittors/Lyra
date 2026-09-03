/**
 * Editing a message that has already been sent.
 *
 * One component for both conversations. The main transcript and the side chat are the same kind of
 * surface — you write, it answers, and sometimes what you wrote came out wrong — and there is no
 * reason for the second one to look like a different application. They had drifted apart already:
 * different corner radii, different paddings, one pair of buttons styled as the composer's and the
 * other invented on the spot.
 *
 * The surface deliberately matches the composer's. Editing a message is the same act as writing
 * one, and a box that looks like the box you type into says so without a label.
 *
 * What differs between the two callers is the word on the confirm button, because what happens next
 * differs: the main conversation re-runs from that point, the side chat asks again. Everything else
 * is fixed here on purpose — a size prop would be an invitation for them to drift again.
 */

import { useEffect, useRef } from "react";
import { OverlayScrollbar } from "../../../ui/scroll/OverlayScrollbar.tsx";

export function MessageEditor({
	value,
	onChange,
	onSubmit,
	onCancel,
	confirmLabel = "发送",
	/**
	 * How tall it may grow before it scrolls.
	 *
	 * The one measurement that genuinely differs: the side panel is a couple of hundred pixels wide
	 * and cannot spare 320px of height for a box, while the main transcript can.
	 */
	maxHeight = 320,
}: {
	value: string;
	onChange: (next: string) => void;
	onSubmit: () => void;
	onCancel: () => void;
	confirmLabel?: string;
	maxHeight?: number;
}) {
	const box = useRef<HTMLTextAreaElement>(null);

	// Grow to fit, so a long message is not edited through a three-line window.
	useEffect(() => {
		const el = box.current;
		if (!el) return;
		el.style.height = "auto";
		el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`;
	}, [value, maxHeight]);

	return (
		<div className="ly-composer w-full rounded-[18px] border border-line-soft bg-transparent px-4 pt-3.5 pb-2.5">
			<div className="ly-scroll-host relative">
				<textarea
					ref={box}
					autoFocus
					value={value}
					onChange={(e) => onChange(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === "Escape") {
							// Stopped, or the panel or modal around this would take it as "close me".
							e.stopPropagation();
							onCancel();
						}
						if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
							e.preventDefault();
							onSubmit();
						}
					}}
					rows={1}
					style={{ maxHeight }}
					className="block w-full resize-none overflow-y-auto bg-transparent text-body leading-relaxed text-ink"
				/>
				{/* Same treatment as the composer: a long edit scrolls, so it needs a thumb. */}
				<OverlayScrollbar viewport={box} orientation="vertical" />
			</div>
			<div className="flex items-center justify-end gap-2 pt-2">
				<button
					type="button"
					onClick={onCancel}
					className="h-7 rounded-lg border border-line px-3 text-label text-ink-muted transition-colors duration-[var(--ly-t-quick)] hover:bg-card-hover hover:text-ink"
				>
					取消
				</button>
				<button
					type="button"
					disabled={!value.trim()}
					onClick={onSubmit}
					className="h-7 rounded-lg bg-ink px-3 text-label font-medium text-shell transition-opacity duration-[var(--ly-t-quick)] hover:opacity-90 disabled:opacity-45"
				>
					{confirmLabel}
				</button>
			</div>
		</div>
	);
}
