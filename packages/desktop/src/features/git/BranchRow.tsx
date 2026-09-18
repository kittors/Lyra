/**
 * One branch, with what it is ahead and behind by.
 *
 * Same as SessionRow: the name uses the full row, icons overlay, and hover fade
 * yields via `--ly-row-controls`. Reserved `pr-14` / a 76px overlay is the empty gutter.
 */

import { translate } from "../../i18n/translate.ts";
import { GitBranch, GitCompare, GitPullRequestArrow, ArrowRightLeft, Trash2 } from "lucide-react";
import { IconButton } from "../../ui/primitives/IconButton.tsx";
import { ScrollText } from "../../ui/scroll/ScrollText.tsx";
import { Text } from "../../ui/primitives/Text.tsx";
import { HoverRow, HoverRowMark, HoverRowReveal, hoverSlot } from "../../ui/row/HoverRow.tsx";

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
	const controls = actions === 0 ? "36px" : hoverSlot(actions as 1 | 2 | 3);
	return (
		<HoverRow controls={controls} className="rounded-md transition-colors hover:bg-card-hover">
			<div
				data-ly-branch-name
				className="flex w-full min-w-0 items-center gap-1.5 py-1 pr-1.5 pl-1.5"
			>
				<HoverRowMark>
					<GitBranch
						size={12}
						strokeWidth={1.8}
						className={current ? "text-accent" : "text-ink-faint"}
					/>
				</HoverRowMark>
				<ScrollText text={name} className={`ly-fade-tail min-w-0 flex-1 text-label ${current ? "text-ink" : "text-ink-muted"}`} />
				{current && (
					<Text size="caption" tone="faint" className="w-9 shrink-0 text-right">
						{translate("branchRow.current")}
					</Text>
				)}
			</div>
			{!current && (
				<HoverRowReveal className="gap-0.5">
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
				</HoverRowReveal>
			)}
		</HoverRow>
	);
}
