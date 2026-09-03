/**
 * Which kinds of thing to show.
 *
 * Chips rather than a dropdown: the whole point of the view is that a turn is made of several
 * different things, and a control that hides them behind a menu hides the point. Each chip carries
 * its count, so "was there any reasoning in this run" is answered without clicking.
 *
 * A source with nothing in it is drawn but muted rather than removed — a filter row that changes
 * shape as a conversation grows is one you have to re-learn every time.
 */

import { SOURCE_LABEL, SOURCE_ORDER, type Source as TrajectorySourceKind } from "@lyra/core/trajectory-view";

export function SourceFilter({
	selected,
	counts,
	onToggle,
	onClear,
}: {
	selected: TrajectorySourceKind[];
	counts: Record<string, number>;
	onToggle: (source: TrajectorySourceKind) => void;
	onClear: () => void;
}) {
	const active = new Set(selected);

	return (
		<div className="flex flex-wrap items-center gap-1 px-2 pt-2 pb-1">
			<button
				type="button"
				onClick={onClear}
				className={`ly-item rounded-full px-2 py-[3px] text-caption ${
					active.size === 0 ? "bg-accent/12 text-accent" : "text-ink-faint"
				}`}
			>
				全部
			</button>
			{SOURCE_ORDER.map((source) => {
				const count = counts[source] ?? 0;
				return (
					<button
						key={source}
						type="button"
						disabled={count === 0}
						onClick={() => onToggle(source)}
						className={`ly-item rounded-full px-2 py-[3px] text-caption disabled:opacity-40 ${
							active.has(source) ? "bg-accent/12 text-accent" : "text-ink-muted"
						}`}
					>
						{SOURCE_LABEL[source]}
						{count > 0 && <span className="ml-1 text-ink-faint">{count}</span>}
					</button>
				);
			})}
		</div>
	);
}
