/**
 * One branch, with what it is ahead and behind by.
 */

import type { CSSProperties } from "react";
import { translate } from "../../i18n/translate.ts";
import { GitBranch, GitCompare, GitPullRequestArrow, ArrowRightLeft, Trash2 } from "lucide-react";
import { IconButton } from "../../ui/primitives/IconButton.tsx";
import { ScrollText } from "../../ui/scroll/ScrollText.tsx";
import { Text } from "../../ui/primitives/Text.tsx";

/** `IconButton` sm is 22px; 2px between them; 6px of row padding on the right. */
function controlsWidth(count: number): string {
	if (count <= 0) return "0px";
	return `${22 * count + 2 * Math.max(0, count - 1) + 6}px`;
}

export function BranchRow({
	name,
	current,
	busy,
	remote,
	onSwitch,
	onCompare,
	onDelete,
}: {
	name: string;
	current: boolean;
	busy: boolean;
	remote?: boolean;
	onSwitch: () => void;
	onCompare?: () => void;
	/** Takes the event, because what confirms it hangs off the button that was clicked. */
	onDelete?: (event: React.MouseEvent<HTMLButtonElement>) => void;
}) {
	const actions = current ? 0 : 1 + (onCompare ? 1 : 0) + (onDelete ? 1 : 0);
	const controls = controlsWidth(actions);
	return (
		<div
			className="ly-scroll group/branch relative rounded-md transition-colors hover:bg-card-hover"
			style={actions ? ({ "--ly-row-controls": controls } as CSSProperties) : undefined}
		>
			{/*
			 * The name keeps the full row. Reserving `padding-right` for icons (or leaving them
			 * in-flow at opacity 0) is what drew those empty boxes: a 1-button row, a 3-button
			 * row and 「当前」 each stopped the fade at a different place. The icons sit on top;
			 * `--ly-row-controls` deepens the fade only while they are actually showing.
			 */}
			<div data-ly-branch-name className="flex min-w-0 items-center gap-1.5 px-1.5 py-1">
				<GitBranch
					size={12}
					strokeWidth={1.8}
					className={`shrink-0 ${current ? "text-accent" : "text-ink-faint"}`}
				/>
				<ScrollText text={name} className={`ly-fade-tail min-w-0 flex-1 text-label ${current ? "text-ink" : "text-ink-muted"}`} />
				{current && (
					<Text size="caption" tone="faint" className="w-9 shrink-0 text-right">
						{translate("branchRow.current")}
					</Text>
				)}
			</div>
			{!current && (
				<span
					data-ly-hover-reveal
					className="pointer-events-none absolute inset-y-0 right-0 flex items-center rounded-r-md pr-1.5 opacity-0 transition-opacity duration-[var(--ly-t-quick)] group-hover/branch:opacity-100 group-has-[:focus-visible]/branch:opacity-100"
				>
					{onCompare && (
						<IconButton
							icon={<GitCompare size={12} strokeWidth={1.9} />}
							label={translate("branchRow.compare")}
							size="sm"
							className="pointer-events-auto"
							onClick={onCompare}
						/>
					)}
					{onDelete && (
						<IconButton
							icon={<Trash2 size={12} strokeWidth={1.9} />}
							label={translate("branchRow.delete")}
							size="sm"
							tone="danger"
							className="pointer-events-auto"
							onClick={onDelete}
						/>
					)}
					<IconButton
						size="sm"
						icon={remote ? <GitPullRequestArrow size={13} strokeWidth={1.9} /> : <ArrowRightLeft size={13} strokeWidth={1.9} />}
						label={translate(remote ? "branchRow.checkoutRemote" : "branchRow.switchTo")}
						disabled={busy}
						className="pointer-events-auto"
						onClick={onSwitch}
					/>
				</span>
			)}
		</div>
	);
}
