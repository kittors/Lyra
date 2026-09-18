/**
 * A repository or worktree in the branch list.
 *
 * Same leading icon box as BranchRow (no extra indent). The branch qualifies the
 * folder in-flow, like 「当前」 on the current row — not a 76px empty overlay.
 */

import { FolderGit2, GitBranchPlus } from "lucide-react";

import type { RepoRef } from "../../../electron/git.ts";
import { useI18n } from "../../i18n/index.ts";
import { HoverRowMark } from "../../ui/row/HoverRow.tsx";
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
		<button
			type="button"
			data-ly-tip={entry.path}
			aria-current={here ? "location" : undefined}
			onClick={() => onSelect(entry.path)}
			className={`ly-scroll flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left transition-colors ${
				here ? "text-accent" : "text-ink-muted hover:text-ink"
			}`}
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
			<span className={`ml-auto min-w-0 max-w-[42%] shrink-[4] truncate text-caption ${here ? "text-accent" : "text-ink-faint"}`}>
				{entry.branch ?? t("sync.detached")}
			</span>
		</button>
	);
}
