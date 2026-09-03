/**
 * The changes, drawn by the same viewer as your own uncommitted work.
 *
 * That is the whole point of parsing the patch in the main process: a review and a look at what
 * you have not committed yet are the same act, and reading them in two different layouts costs
 * more than it sounds like.
 *
 * Fetched only when this tab is opened. A diff is the expensive part of a pull request — some are
 * megabytes — and most visits to the summary never ask for it.
 */

import { useEffect, useState } from "react";
import type { WorkspaceDiffFile } from "../../../electron/ipc-types.ts";
import { FileDiffList } from "../git/FileDiffList.tsx";
import { Scroller } from "../Scroller.tsx";
import { CodeSkeleton } from "./PullRequestSkeleton.tsx";
import { bridge } from "../../services/index.ts";

export function PullRequestCode({ accountId, repo, number }: { accountId: string; repo: string; number: number }) {
	const [files, setFiles] = useState<WorkspaceDiffFile[] | null>(null);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;
		setFiles(null);
		setError(null);
		void bridge.git.pullRequestDiff(accountId, repo, number).then((result) => {
			if (cancelled) return;
			setFiles(result.files);
			setError(result.error ?? null);
		});
		return () => {
			cancelled = true;
		};
	}, [accountId, repo, number]);

	if (error) return <Centered>{error}</Centered>;
	if (!files) return <CodeSkeleton />;
	if (files.length === 0) return <Centered>这个 Pull Request 没有文件改动</Centered>;

	const added = files.reduce((sum, file) => sum + file.added, 0);
	const removed = files.reduce((sum, file) => sum + file.removed, 0);

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<p className="shrink-0 px-4 pb-1.5 text-detail text-ink-faint">
				{files.length} 个文件 · <span className="text-ok">+{added}</span> <span className="text-danger">−{removed}</span>
			</p>
			<Scroller className="flex-1" contentClassName="ly-fade-in px-2 pb-4">
				<FileDiffList files={files} emptyLabel="没有文件改动" />
			</Scroller>
		</div>
	);
}

function Centered({ children }: { children: React.ReactNode }) {
	return (
		<div className="flex min-h-0 flex-1 items-center justify-center px-6">
			<p className="text-center text-label leading-relaxed text-ink-faint">{children}</p>
		</div>
	);
}
