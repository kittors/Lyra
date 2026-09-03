import { Check, GitBranch } from "lucide-react";
import { useEffect, useState } from "react";
import type { BranchList } from "../../../electron/ipc-types.ts";
import { MENU_MAX_HEIGHT, MenuBody, MenuItem, MenuLabel, MenuSearch, Popover, type Anchor } from "../Popover.tsx";
import { ScrollText } from "../ScrollText.tsx";
import { useApp } from "../../store.ts";
import { bridge } from "../../services/index.ts";

/**
 * The last list seen for a workspace, so reopening the menu does not start from nothing.
 *
 * Deliberately module-level and not persisted. It exists to make the second open instant and
 * the right size — branches change, so it is shown while the real list is being fetched and
 * replaced the moment it arrives.
 */
const lastSeen = new Map<string, BranchList>();

/**
 * Branch switcher for the composer's branch chip.
 *
 * Checking out is refused rather than forced when the working tree would be clobbered — git's
 * own message says exactly which files are in the way, so it is surfaced verbatim instead of
 * being replaced with a generic failure.
 */
export function BranchMenu({ anchor, onClose }: { anchor: Anchor; onClose: () => void }) {
	const workspace = useApp((s) => s.workspace);
	const refreshWorkspace = useApp((s) => s.refreshWorkspace);
	const setSwitching = useApp((s) => s.setSwitchingBranch);
	const notify = useApp((s) => s.notify);

	const [branches, setBranches] = useState<BranchList | null>(
		() => (workspace ? (lastSeen.get(workspace.path) ?? null) : null),
	);
	const [query, setQuery] = useState("");

	useEffect(() => {
		if (!workspace) return;
		let live = true;
		void bridge.git.branches(workspace.path).then((list) => {
			lastSeen.set(workspace.path, list);
			if (live) setBranches(list);
		});
		return () => {
			live = false;
		};
	}, [workspace]);

	const needle = query.trim().toLowerCase();
	const match = (name: string) => !needle || name.toLowerCase().includes(needle);
	const local = (branches?.local ?? []).filter(match);
	const remote = (branches?.remote ?? []).filter(match);

	async function switchTo(branch: string) {
		if (!workspace) return;
		/*
		 * Handed over whole, remote prefix and all.
		 *
		 * `switchBranch` is the one that knows what to do with it: it asks git whether
		 * `refs/heads/<name>` exists and picks `switch` or `switch --track` accordingly, and
		 * `--track` wants exactly the remote ref — `origin/foo` — from which it derives the local
		 * name itself.
		 *
		 * Stripping the first segment here broke that. `origin/dependabot/npm_and_yarn/react-…`
		 * arrived as `dependabot/npm_and_yarn/react-…`, which names neither a local branch nor a
		 * remote ref, so git answered `fatal: invalid reference` — from an entry the menu had just
		 * offered. The unit tests never saw it because they call `switchBranch("origin/…")`
		 * directly, which was always right; the stripping only existed on this side.
		 */
		const target = branch;

		/*
		 * Close first, switch after — and never show a name git has not confirmed.
		 *
		 * The menu used to stay open for the whole of `git switch` plus the workspace re-read that
		 * follows it. On a large repository that is most of a second with the pointer already moved
		 * on, and it reads as the click not having registered. Nothing in the menu is worth watching
		 * during that time: the answer is a branch name in the bar below and a different set of
		 * changes in the Git panel, both of which are somewhere else.
		 *
		 * The acknowledgement is a *loading state*, not the new name. Writing the target in
		 * optimistically was faster to read but dishonest when the switch was refused — and it is
		 * refused often, for ordinary reasons: uncommitted work in the way, a remote ref that
		 * cannot be checked out by that name. The chip then said `plugins` for a moment and
		 * snapped back to `main`, which claims something happened and then takes it back. Holding
		 * the old name while the spinner runs says the same thing without ever being wrong.
		 */
		onClose();
		setSwitching(target);
		try {
			const result = await bridge.git.switchBranch(workspace.path, target);
			if (!result.ok) {
				notify(result.error ?? "切换分支失败", "error");
				return;
			}
			await refreshWorkspace();
		} finally {
			setSwitching(null);
		}
	}

	return (
		<Popover
			anchor={anchor}
			onClose={onClose}
			placement="top"
			align="start"
			width="wide"
			maxHeight={MENU_MAX_HEIGHT}
			label="切换分支"
			header={<MenuSearch value={query} onChange={setQuery} placeholder="搜索分支" />}
		>
			<MenuBody>
				{/*
				 * Rows, not a line of text.
				 *
				 * A single "读取分支…" is one row tall, and the list that replaces it is six or ten —
				 * so the menu opened, sat still for a moment, then shoved itself open. Standing in
				 * the shape of what is coming means the box is the right size from the first frame
				 * and only its contents change. Same reason the context breakdown does it.
				 */}
				{!branches &&
					[0, 1, 2, 3, 4].map((i) => (
						<div key={i} className="flex h-[30px] items-center gap-2 px-2">
							<span className="ly-pulse h-[13px] w-[13px] shrink-0 rounded bg-card" />
							<span
								className="ly-pulse h-[11px] rounded bg-card"
								style={{ width: `${58 - i * 7}%` }}
							/>
						</div>
					))}

				{branches && local.length === 0 && remote.length === 0 && (
					<p className="px-2.5 py-5 text-center text-detail text-ink-faint">
						{branches.local.length === 0 ? "当前项目不是 Git 仓库" : "没有匹配的分支"}
					</p>
				)}

				{local.map((branch) => (
					<Row
						key={branch}
						name={branch}
						/*
						 * From the workspace, not from the list this menu fetched.
						 *
						 * `branches.current` is a snapshot taken when the menu opened, and switching
						 * does not refetch it — so the tick stayed on the branch you left until the
						 * whole list was read again, which is what read as the check lagging behind.
						 * The workspace's branch is re-read the moment a switch lands, so it is both
						 * current and the same thing the bar below the composer is showing.
						 */
						current={branch === (workspace?.branch ?? branches?.current)}
						onSelect={() => void switchTo(branch)}
					/>
				))}

				{remote.length > 0 && (
					<>
						<MenuLabel>远程</MenuLabel>
						{remote.map((branch) => (
							<Row key={branch} name={branch} onSelect={() => void switchTo(branch)} />
						))}
					</>
				)}
			</MenuBody>
		</Popover>
	);
}

function Row({
	name,
	current,
	onSelect,
}: {
	name: string;
	current?: boolean;
	onSelect: () => void;
}) {
	return (
		<MenuItem
			icon={<GitBranch size={13} strokeWidth={1.8} />}
			title={name}
			selected={current}
			trailing={current ? <Check size={13} strokeWidth={2.2} className="shrink-0 text-ink" /> : undefined}
			onClick={onSelect}
		>
			<ScrollText text={name} className="font-mono text-detail" />
		</MenuItem>
	);
}
