import {
	Archive,
	Copy,
	ExternalLink,
	Eye,
	Folder,
	FolderInput,
	Pencil,
	Pin,
	PinOff,
} from "lucide-react";
import { useState } from "react";
import type { SessionMeta } from "@lyra/core";
import { MenuBody, MenuItem, MenuSeparator, Popover, type Anchor } from "../../ui/overlay/Popover.tsx";
import { useApp } from "../../store.ts";
import { bridge } from "../../services/index.ts";

export function SessionMenu({
	anchor,
	session,
	onClose,
}: {
	anchor: Anchor;
	session: SessionMeta;
	onClose: () => void;
}) {
	const settings = useApp((s) => s.settings);
	const setSessionPinned = useApp((s) => s.setSessionPinned);
	const setSessionArchived = useApp((s) => s.setSessionArchived);
	const renameSession = useApp((s) => s.renameSession);
	const moveSessionProject = useApp((s) => s.moveSessionProject);
	const notify = useApp((s) => s.notify);

	const [mode, setMode] = useState<"menu" | "rename" | "projects" | "copy">("menu");
	const [draft, setDraft] = useState(session.title);

	const isPinned = settings?.pinnedSessionIds?.includes(session.id) ?? false;
	const projects = settings?.projects ?? [];

	if (mode === "rename") {
		return (
			<Popover anchor={anchor} onClose={onClose} placement="right" width="compact" role="dialog" label="重命名会话">
				<form
					className="p-2.5"
					onSubmit={(e) => {
						e.preventDefault();
						void renameSession(session, draft);
						onClose();
					}}
				>
					<label className="block pb-1.5 text-detail text-ink-faint">会话标题</label>
					<input
						autoFocus
						value={draft}
						onChange={(e) => setDraft(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Escape") {
								e.stopPropagation();
								setMode("menu");
								setDraft(session.title);
							}
						}}
						className="h-8 w-full rounded-lg border border-line bg-input px-2.5 text-label text-ink placeholder:text-ink-faint focus:border-ink-faint"
					/>
					<div className="flex justify-end gap-1.5 pt-2.5">
						<button
							type="button"
							onClick={() => setMode("menu")}
							className="h-7 rounded-lg px-2.5 text-detail text-ink-muted transition-colors hover:bg-card-hover hover:text-ink"
						>
							取消
						</button>
						<button
							type="submit"
							disabled={!draft.trim()}
							className="h-7 rounded-lg bg-ink px-2.5 text-detail font-medium text-shell transition-opacity hover:opacity-90 disabled:opacity-45"
						>
							保存
						</button>
					</div>
				</form>
			</Popover>
		);
	}

	if (mode === "projects") {
		return (
			<Popover anchor={anchor} onClose={onClose} placement="right" width="compact" label="移动到项目">
				<MenuBody>
					<MenuItem
						icon={<FolderInput size={13} strokeWidth={1.8} />}
						onClick={() => {
							setMode("menu");
						}}
					>
						返回上一级
					</MenuItem>
					<MenuSeparator />
					{projects.map((p) => {
						const isCurrent = session.cwd === p.path;
						return (
							<MenuItem
								key={p.path}
								icon={<Folder size={13} strokeWidth={1.8} />}
								hint={isCurrent ? "当前项目" : undefined}
								disabled={isCurrent}
								onClick={() => {
									void moveSessionProject(session, p.path);
									onClose();
								}}
							>
								{p.name}
							</MenuItem>
						);
					})}
					{session.cwd && (
						<>
							<MenuSeparator />
							<MenuItem
								icon={<FolderInput size={13} strokeWidth={1.8} />}
								onClick={() => {
									void moveSessionProject(session, "");
									onClose();
								}}
							>
								从 {session.projectName || "项目"} 中移除
							</MenuItem>
						</>
					)}
				</MenuBody>
			</Popover>
		);
	}

	if (mode === "copy") {
		return (
			<Popover anchor={anchor} onClose={onClose} placement="right" width="compact" label="复制选项">
				<MenuBody>
					<MenuItem
						icon={<FolderInput size={13} strokeWidth={1.8} />}
						onClick={() => {
							setMode("menu");
						}}
					>
						返回上一级
					</MenuItem>
					<MenuSeparator />
					<MenuItem
						icon={<Copy size={13} strokeWidth={1.8} />}
						onClick={() => {
							void navigator.clipboard.writeText(session.cwd);
							notify("已复制工作目录路径");
							onClose();
						}}
					>
						复制工作目录
					</MenuItem>
					<MenuItem
						icon={<Copy size={13} strokeWidth={1.8} />}
						onClick={() => {
							void navigator.clipboard.writeText(`lyra://session/${session.id}`);
							notify("已复制深度链接");
							onClose();
						}}
					>
						复制深度链接
					</MenuItem>
				</MenuBody>
			</Popover>
		);
	}

	return (
		<Popover anchor={anchor} onClose={onClose} placement="right" width="compact" label="会话选项">
			<MenuBody>
				<MenuItem
					icon={isPinned ? <PinOff size={13} strokeWidth={1.8} /> : <Pin size={13} strokeWidth={1.8} />}
					onClick={() => {
						void setSessionPinned(session.id, !isPinned);
						notify(isPinned ? "已取消置顶会话" : "已置顶会话");
						onClose();
					}}
				>
					{isPinned ? "取消置顶" : "置顶"}
				</MenuItem>

				<MenuItem
					icon={<Pencil size={13} strokeWidth={1.8} />}
					onClick={() => {
						setDraft(session.title);
						setMode("rename");
					}}
				>
					重命名
				</MenuItem>

				<MenuItem
					icon={<Eye size={13} strokeWidth={1.8} />}
					onClick={() => {
						notify("已标记为未读");
						onClose();
					}}
				>
					标记为未读
				</MenuItem>

				<MenuItem
					icon={<Archive size={13} strokeWidth={1.8} />}
					onClick={() => {
						void setSessionArchived(session, true);
						notify("已归档会话");
						onClose();
					}}
				>
					归档
				</MenuItem>

				<MenuSeparator />

				<MenuItem icon={<Folder size={13} strokeWidth={1.8} />} onClick={() => setMode("projects")}>
					项目
				</MenuItem>

				<MenuItem icon={<Copy size={13} strokeWidth={1.8} />} onClick={() => setMode("copy")}>
					复制
				</MenuItem>

				<MenuItem
					icon={<ExternalLink size={13} strokeWidth={1.8} />}
					onClick={() => {
						void bridge.system.openExternal(`lyra://session/${session.id}`).catch(() => {});
						notify("正在新窗口中打开…");
						onClose();
					}}
				>
					在新窗口中打开
				</MenuItem>
			</MenuBody>
		</Popover>
	);
}