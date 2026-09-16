import { ChevronDown, ChevronUp } from "lucide-react";
import { translate } from "../../i18n/translate.ts";
import { useLayout } from "../../app/layout.tsx";
import { RollingText } from "../../ui/motion/RollingText.tsx";

/**
 * The pager under a run of conversation rows.
 *
 * Two separate actions rather than one toggle. "More" and "back to the top" are different
 * intentions, and a single control that means whichever one the current state implies makes the
 * second press unpredictable. The count is what is left, not what a press will reveal — how much
 * more there is is the question being asked.
 *
 * Shared by a project's block and by the 「最近」 section, which both cap what they show for the
 * same reason: forty rows under one heading is a wall, and the way back from it used to be a
 * single 收起 that threw away however far you had read.
 *
 * Indented so its icon aligns with the session status icons above it (pl-2 and 14px slot),
 * with the title starting at 30px to align with session titles.
 */
export function ShowMore({
	hidden,
	canCollapse,
	onShowMore,
	onCollapse,
}: {
	/** How many rows are still not shown. */
	hidden: number;
	canCollapse: boolean;
	onShowMore: () => void;
	onCollapse: () => void;
}) {
	const { compact } = useLayout();
	if (hidden <= 0 && !canCollapse) return null;

	const heightClass = compact ? "h-[34px]" : "h-[27px]";

	if (hidden > 0 && !canCollapse) {
		return (
			<button
				type="button"
				onClick={onShowMore}
				className={`group/more flex w-full min-w-0 items-center gap-2 rounded-lg pl-2 pr-2 text-left text-label text-ink-faint transition-colors duration-[var(--ly-t-quick)] hover:bg-card-hover hover:text-ink-muted active:bg-elevated ${heightClass}`}
			>
				{/*
				 * The 14px (h-3.5 w-3.5) icon slot preceded by pl-2 perfectly mirrors SessionRow,
				 * ensuring the chevron is horizontally centered with the session status dots above.
				 */}
				<span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center text-ink-faint transition-colors duration-[var(--ly-t-quick)] group-hover/more:text-ink-muted">
					<ChevronDown size={12} strokeWidth={2} aria-hidden />
				</span>
				<span className="truncate text-detail text-ink-faint tabular-nums transition-colors duration-[var(--ly-t-quick)] group-hover/more:text-ink-muted">
					<RollingText rollKey={hidden}>{translate("showMore.expand", { n: hidden })}</RollingText>
				</span>
			</button>
		);
	}

	if (hidden <= 0 && canCollapse) {
		return (
			<button
				type="button"
				onClick={onCollapse}
				className={`group/more flex w-full min-w-0 items-center gap-2 rounded-lg pl-2 pr-2 text-left text-label text-ink-faint transition-colors duration-[var(--ly-t-quick)] hover:bg-card-hover hover:text-ink-muted active:bg-elevated ${heightClass}`}
			>
				<span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center text-ink-faint transition-colors duration-[var(--ly-t-quick)] group-hover/more:text-ink-muted">
					<ChevronUp size={12} strokeWidth={2} aria-hidden />
				</span>
				<span className="truncate text-detail text-ink-faint transition-colors duration-[var(--ly-t-quick)] group-hover/more:text-ink-muted">
					{translate("common.collapse")}
				</span>
			</button>
		);
	}

	return (
		<div className={`flex w-full min-w-0 items-center justify-between gap-1 rounded-lg ${heightClass}`}>
			<button
				type="button"
				onClick={onShowMore}
				className="group/more flex min-w-0 flex-1 items-center gap-2 rounded-lg pl-2 pr-1.5 text-left text-label text-ink-faint transition-colors duration-[var(--ly-t-quick)] hover:bg-card-hover hover:text-ink-muted"
			>
				<span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center text-ink-faint transition-colors duration-[var(--ly-t-quick)] group-hover/more:text-ink-muted">
					<ChevronDown size={12} strokeWidth={2} aria-hidden />
				</span>
				<span className="truncate text-detail text-ink-faint tabular-nums transition-colors duration-[var(--ly-t-quick)] group-hover/more:text-ink-muted">
					<RollingText rollKey={hidden}>{translate("showMore.expand", { n: hidden })}</RollingText>
				</span>
			</button>
			<button
				type="button"
				data-ly-tip={translate("common.collapse")}
				aria-label={translate("common.collapse")}
				onClick={onCollapse}
				className="flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-caption text-ink-faint transition-colors duration-[var(--ly-t-quick)] hover:bg-card-hover hover:text-ink-muted"
			>
				<ChevronUp size={12} strokeWidth={2} aria-hidden />
				<span>{translate("common.collapse")}</span>
			</button>
		</div>
	);
}
