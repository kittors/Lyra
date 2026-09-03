import { Archive, ArrowRight, FolderOpen, GitBranch, Pencil, PinOff, Pin, SquarePen, X } from "lucide-react";
import { useState } from "react";
import { Confirm } from "../../ui/overlay/Confirm.tsx";
import { MenuBody, MenuItem, MenuSeparator, Popover, type Anchor } from "../../ui/overlay/Popover.tsx";
import { useRevealLabel } from "../files/index.ts";
import { startProjectSession } from "../sidebar/index.ts";
import { useApp } from "../../store/index.ts";
import { bridge } from "../../services/index.ts";

/**
 * Per-project actions, hung off the row they act on.
 *
 * Everything here is either reversible (pinning, archiving) or leaves the working tree alone
 * (removing only forgets the entry). Nothing on this menu deletes a directory.
 */
export function ProjectMenu({
	anchor,
	path,
	name,
	onClose,
}: {
	anchor: Anchor;
	path: string;
	name: string;
	onClose: () => void;
}) {
	const openWorkspace = useApp((s) => s.openWorkspace);
	const settings = useApp((s) => s.settings);
	const sessions = useApp((s) => s.sessions);
	const setPinned = useApp((s) => s.setProjectPinned);
	const removeProject = useApp((s) => s.removeProject);
	const archiveProjectSessions = useApp((s) => s.archiveProjectSessions);
	const renameProject = useApp((s) => s.renameProject);
	const refreshWorkspace = useApp((s) => s.refreshWorkspace);
	const notify = useApp((s) => s.notify);
	const reveal = useRevealLabel();

	const [mode, setMode] = useState<"menu" | "rename" | "worktree" | "remove">("menu");
	const [draft, setDraft] = useState(name);
	const [busy, setBusy] = useState(false);

	const pinned = settings?.projects.find((p) => p.path === path)?.pinned ?? false;
	const liveSessions = sessions.filter((s) => s.cwd === path && !s.archived).length;

	async function makeWorktree() {
		const branch = draft.trim();
		if (!branch || busy) return;
		setBusy(true);
		const result = await bridge.git.createWorktree(path, branch);
		setBusy(false);
		if (!result.ok) {
			notify(result.error ?? "创建工作树失败", "error");
			return;
		}
		notify(`已创建工作树 ${result.path}`);
		await refreshWorkspace();
		onClose();
	}

	/*
	 * The question is the app's modal, not a second panel hung off this menu.
	 *
	 * It used to replace the menu in place, on the same anchor — which read well here and nowhere
	 * else, since every other confirmation in the app is raised by a button rather than by a menu
	 * row. One shape for all of them is worth more than each one being locally clever; see
	 * `Confirm`. The menu goes away first, so nothing is left highlighted behind the scrim.
	 *
	 * Removing a project only forgets the entry; the working tree is not touched, and saying so is
	 * most of why this asks at all.
	 */
	if (mode === "remove") {
		return (
			<Confirm
				title={`移除 ${name}？`}
				detail="只是从列表里去掉，磁盘上的目录和里面的文件都不动。置顶、改过的名字这些会丢。"
				confirmLabel="移除"
				onCancel={onClose}
				onConfirm={() => {
					void removeProject(path);
					onClose();
				}}
			/>
		);
	}

	if (mode === "rename" || mode === "worktree") {
		const worktree = mode === "worktree";
		return (
			// A form, not a menu — a text field announced as a menu item is worse than one
			// announced as nothing.
			<Popover
				anchor={anchor}
				onClose={onClose}
				placement="right"
				width="panel"
				role="dialog"
				label={worktree ? "新建工作树" : "编辑项目"}
			>
				<form
					className="p-2.5"
					onSubmit={(event) => {
						event.preventDefault();
						if (worktree) void makeWorktree();
						else {
							void renameProject(path, draft);
							onClose();
						}
					}}
				>
					<label className="block pb-1.5 text-detail text-ink-faint">
						{worktree ? "新工作树的分支名" : "项目名称"}
					</label>
					<input
						autoFocus
						value={draft}
						onChange={(e) => setDraft(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Escape") {
								e.stopPropagation();
								setMode("menu");
								setDraft(name);
							}
						}}
						placeholder={worktree ? "feature/…" : name}
						className="h-8 w-full rounded-lg border border-line bg-input px-2.5 text-label text-ink placeholder:text-ink-faint focus:border-ink-faint"
					/>
					{worktree && (
						<p className="pt-1.5 text-caption leading-relaxed text-ink-faint">
							会在项目同级目录新建一个工作树，独立分支，不影响当前签出的内容。
						</p>
					)}
					<div className="flex justify-end gap-1.5 pt-2.5">
						<button
							type="button"
							onClick={() => {
								setMode("menu");
								setDraft(name);
							}}
							className="h-7 rounded-lg px-2.5 text-detail text-ink-muted transition-colors hover:bg-card-hover hover:text-ink"
						>
							取消
						</button>
						<button
							type="submit"
							disabled={busy || !draft.trim()}
							className="h-7 rounded-lg bg-ink px-2.5 text-detail font-medium text-shell transition-opacity hover:opacity-90 disabled:opacity-45"
						>
							{busy ? "创建中…" : worktree ? "创建" : "保存"}
						</button>
					</div>
				</form>
			</Popover>
		);
	}

	return (
		<Popover anchor={anchor} onClose={onClose} placement="right" width="compact" label={`${name} 的操作`}>
			<MenuBody>
				{/*
				 * The two ways of going somewhere, before the ways of changing something.
				 *
				 * Starting a conversation is first because it is what the row is usually pressed
				 * for; the button on the row does the same thing, and this is the keyboard and
				 * right-click path to it. Switching without starting one is the rarer intent — the
				 * project name folds the group now, so it needs a home here.
				 */}
				<MenuItem
					icon={<SquarePen size={13} strokeWidth={1.8} />}
					onClick={() => {
						void startProjectSession(path);
						onClose();
					}}
				>
					在这里新建会话
				</MenuItem>
				<MenuItem
					icon={<ArrowRight size={13} strokeWidth={1.8} />}
					onClick={() => {
						void openWorkspace(path);
						onClose();
					}}
				>
					切换到这个项目
				</MenuItem>

				<MenuSeparator />

				<MenuItem
					icon={pinned ? <PinOff size={13} strokeWidth={1.8} /> : <Pin size={13} strokeWidth={1.8} />}
					onClick={() => {
						void setPinned(path, !pinned);
						notify(pinned ? "已取消置顶项目" : "已置顶项目");
						onClose();
					}}
				>
					{pinned ? "取消置顶项目" : "置顶项目"}
				</MenuItem>
				<MenuItem
					icon={<Pencil size={13} strokeWidth={1.8} />}
					onClick={() => {
						setDraft(name);
						setMode("rename");
					}}
				>
					重命名
				</MenuItem>
				<MenuItem
					icon={<FolderOpen size={13} strokeWidth={1.8} />}
					onClick={() => {
						void bridge.workspace.reveal(path);
						onClose();
					}}
				>
					{reveal}
				</MenuItem>
				<MenuItem
					icon={<GitBranch size={13} strokeWidth={1.8} />}
					onClick={() => {
						setDraft("");
						setMode("worktree");
					}}
				>
					创建永久工作树
				</MenuItem>

				<MenuSeparator />

				<MenuItem
					icon={<Archive size={13} strokeWidth={1.8} />}
					hint={liveSessions > 0 ? String(liveSessions) : undefined}
					disabled={liveSessions === 0}
					onClick={() => {
						void archiveProjectSessions(path);
						onClose();
					}}
				>
					归档聊天
				</MenuItem>
				<MenuItem icon={<X size={13} strokeWidth={1.9} />} danger onClick={() => setMode("remove")}>
					移除
				</MenuItem>
			</MenuBody>
		</Popover>
	);
}
