/**
 * One branch, with what it is ahead and behind by.
 *
 * Same shell as a session row: the name stops short of a reserved slot, the icons sit in
 * that slot, and every row in the list uses the same width so the glyphs share one column.
 */

import { translate } from "../../i18n/translate.ts";
import { GitBranch, GitCompare, GitPullRequestArrow, ArrowRightLeft, Trash2 } from "lucide-react";
import { IconButton } from "../../ui/primitives/IconButton.tsx";
import { ScrollText } from "../../ui/scroll/ScrollText.tsx";
import { Text } from "../../ui/primitives/Text.tsx";
import { GIT_CONTROLS, HoverRow, HoverRowBody, HoverRowMark, HoverRowReveal, HoverRowTrail } from "../../ui/row/HoverRow.tsx";

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
	return (
		<HoverRow controls={GIT_CONTROLS} className="rounded-md transition-colors hover:bg-card-hover">
			<HoverRowBody data-ly-branch-name className="gap-1.5 px-1.5 py-1">
				<HoverRowMark>
					<GitBranch
						size={12}
						strokeWidth={1.8}
						className={current ? "text-accent" : "text-ink-faint"}
					/>
				</HoverRowMark>
				<ScrollText text={name} className={`ly-fade-tail min-w-0 flex-1 text-label ${current ? "text-ink" : "text-ink-muted"}`} />
			</HoverRowBody>
			{current ? (
				<HoverRowTrail>
					<Text size="caption" tone="faint">
						{translate("branchRow.current")}
					</Text>
				</HoverRowTrail>
			) : (
				<HoverRowReveal className="gap-0.5 rounded-r-md">
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
