import { useLayout } from "../../layout.tsx";
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
 * Indented to where the titles start, so it reads as part of the list it pages rather than as a
 * control belonging to the pane.
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

	return (
		<div /*
			 * 30px, not a Tailwind step: it lines this row's text up with the session titles above it,
			 * which sit at the dot's left edge plus the dot's own 14px plus the 8px gap. Every one of
			 * those is fixed, so the sum is too.
			 */
			className={`flex items-center gap-3 pl-[30px] ${compact ? "h-[32px]" : "h-[26px]"}`}>
			{hidden > 0 && (
				<button
					type="button"
					onClick={onShowMore}
					className="text-left text-label text-ink-faint transition-colors hover:text-ink-muted"
				>
					{/* The count is the part that changes on each press, and it is what the roll is for:
					    five more rows appeared, and this is the line that says how many are left. */}
					<RollingText>{`展开显示 (${hidden})`}</RollingText>
				</button>
			)}
			{canCollapse && (
				<button
					type="button"
					onClick={onCollapse}
					className="text-left text-label text-ink-faint transition-colors hover:text-ink-muted"
				>
					收起
				</button>
			)}
		</div>
	);
}
