/**
 * A repository or worktree in the branch list.
 *
 * Same reserved trailing slot as `BranchRow`, so the folder, the worktree plus and the
 * branch glyph share one x, and the qualifying branch sits where hover icons sit.
 */

import { FolderGit2, GitBranchPlus } from "lucide-react";

import type { RepoRef } from "../../../electron/git.ts";
import { useI18n } from "../../i18n/index.ts";
import { CHECKOUT_TRAIL, HoverRow, HoverRowButton, HoverRowMark, HoverRowTrail } from "../../ui/row/HoverRow.tsx";
import { ScrollText } from "../../ui/scroll/ScrollText.tsx";

export function CheckoutRow({
	entry,
	cwd,
	onSelect,
}: {
	entry: RepoRef;
	cwd: string;
	onSelect: (path: string) => void;
}) {
	const { t } = useI18n();
	const here = entry.path === cwd;
	return (
		<HoverRow controls={CHECKOUT_TRAIL} className="rounded-md transition-colors hover:bg-card-hover">
			<HoverRowButton
				data-ly-tip={entry.path}
				aria-current={here ? "location" : undefined}
				onClick={() => onSelect(entry.path)}
				className={`gap-1.5 py-1 pl-1.5 text-left ${here ? "text-accent" : "text-ink-muted hover:text-ink"}`}
			>
				<HoverRowMark className={here ? "text-accent" : "text-ink-faint"}>
					{entry.worktree ? (
						<GitBranchPlus size={12} strokeWidth={1.8} />
					) : (
						<FolderGit2 size={12} strokeWidth={1.8} />
					)}
				</HoverRowMark>
				<ScrollText
					text={entry.label}
					className={`ly-fade-tail min-w-0 flex-1 text-label ${here ? "text-accent" : "text-ink-muted"}`}
				/>
			</HoverRowButton>
			<HoverRowTrail>
				<span className={`min-w-0 truncate text-caption ${here ? "text-accent" : "text-ink-faint"}`}>
					{entry.branch ?? t("sync.detached")}
				</span>
			</HoverRowTrail>
		</HoverRow>
	);
}
