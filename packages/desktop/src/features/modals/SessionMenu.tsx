import { Input } from "../../ui/inputs/NativeField.tsx";
import {
	Archive,
	ArchiveRestore,
	Copy,
	ExternalLink,
	Folder,
	FolderInput,
	Pencil,
	Pin,
	PinOff,
	Trash2,
} from "lucide-react";
import { useState } from "react";
import type { SessionMeta } from "@lyra/core";
import { MenuBody, MenuItem, MenuSeparator, Popover, type Anchor } from "../../ui/overlay/Popover.tsx";
import { useConfirmer } from "../../ui/overlay/Confirm.tsx";
import { useI18n } from "../../i18n/index.ts";
import { useApp } from "../../store/index.ts";
import { bridge, onPhone } from "../../services/index.ts";

export function SessionMenu({
	anchor,
	session,
	onClose,
}: {
	anchor: Anchor;
	session: SessionMeta;
	onClose: () => void;
}) {
	const { t } = useI18n();
	const settings = useApp((s) => s.settings);
	const setSessionPinned = useApp((s) => s.setSessionPinned);
	const setSessionArchived = useApp((s) => s.setSessionArchived);
	const deleteSession = useApp((s) => s.deleteSession);
	const renameSession = useApp((s) => s.renameSession);
	const moveSessionProject = useApp((s) => s.moveSessionProject);
	const notify = useApp((s) => s.notify);
	const confirm = useConfirmer();

	const [mode, setMode] = useState<"menu" | "rename" | "projects" | "copy">("menu");
	const [draft, setDraft] = useState(session.title);

	const isPinned = settings?.pinnedSessionIds?.includes(session.id) ?? false;
	const projects = settings?.projects ?? [];

	if (mode === "rename") {
		return (
			<Popover anchor={anchor} onClose={onClose} placement="right" width="compact" role="dialog" label={t("sessionMenu.rename")}>
				<form
					className="p-2.5"
					onSubmit={(e) => {
						e.preventDefault();
						void renameSession(session, draft);
						onClose();
					}}
				>
					<label className="block pb-1.5 text-detail text-ink-faint">{t("sessionMenu.titleLabel")}</label>
					<Input
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
							{t("common.cancel")}
						</button>
						<button
							type="submit"
							disabled={!draft.trim()}
							className="h-7 rounded-lg bg-ink px-2.5 text-detail font-medium text-shell transition-opacity hover:opacity-90 disabled:opacity-45"
						>
							{t("common.save")}
						</button>
					</div>
				</form>
			</Popover>
		);
	}

	if (mode === "projects") {
		return (
			<Popover anchor={anchor} onClose={onClose} placement="right" width="compact" label={t("sessionMenu.moveToProject")}>
				<MenuBody>
					<MenuItem
						icon={<FolderInput size={13} strokeWidth={1.8} />}
						onClick={() => {
							setMode("menu");
						}}
					>
						{t("common.back")}
					</MenuItem>
					<MenuSeparator />
					{projects.map((p) => {
						const isCurrent = session.cwd === p.path;
						return (
							<MenuItem
								key={p.path}
								icon={<Folder size={13} strokeWidth={1.8} />}
								hint={isCurrent ? t("sessionMenu.currentProject") : undefined}
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
								{t("sessionMenu.removeFrom", { name: session.projectName || t("sessionMenu.project") })}
							</MenuItem>
						</>
					)}
				</MenuBody>
			</Popover>
		);
	}

	if (mode === "copy") {
		return (
			<Popover anchor={anchor} onClose={onClose} placement="right" width="compact" label={t("sessionMenu.copyOptions")}>
				<MenuBody>
					<MenuItem
						icon={<FolderInput size={13} strokeWidth={1.8} />}
						onClick={() => {
							setMode("menu");
						}}
					>
						{t("common.back")}
					</MenuItem>
					<MenuSeparator />
					<MenuItem
						icon={<Copy size={13} strokeWidth={1.8} />}
						onClick={() => {
							void navigator.clipboard.writeText(session.cwd);
							notify(t("sessionMenu.cwdCopied"));
							onClose();
						}}
					>
						{t("sessionMenu.copyCwd")}
					</MenuItem>
					<MenuItem
						icon={<Copy size={13} strokeWidth={1.8} />}
						onClick={() => {
							void navigator.clipboard.writeText(`lyra://session/${session.id}`);
							notify(t("sessionMenu.deepLinkCopied"));
							onClose();
						}}
					>
						{t("sessionMenu.copyDeepLink")}
					</MenuItem>
				</MenuBody>
			</Popover>
		);
	}

	return (
		<>
			<Popover anchor={anchor} onClose={onClose} placement="right" width="compact" label={t("sessionMenu.options")}>
				<MenuBody>
					{!session.archived && (
						<MenuItem
							icon={isPinned ? <PinOff size={13} strokeWidth={1.8} /> : <Pin size={13} strokeWidth={1.8} />}
							onClick={() => {
								void setSessionPinned(session.id, !isPinned);
								notify(isPinned ? t("sessionMenu.unpinned") : t("sessionMenu.pinned"));
								onClose();
							}}
						>
							{isPinned ? t("sessionMenu.unpin") : t("sessionMenu.pin")}
						</MenuItem>
					)}

					<MenuItem
						icon={<Pencil size={13} strokeWidth={1.8} />}
						onClick={() => {
							setDraft(session.title);
							setMode("rename");
						}}
					>
						{t("common.rename")}
					</MenuItem>

					{/*
					 * 「标为未读」不在这里，因为它从来没有被实现过。
					 *
					 * 这一项过去点下去只弹一句「已标为未读」，然后什么都不做——全仓没有任何会话级
					 * 的手动未读位：`unreadActivity` 问的是「有没有跑完的活动」，`unreadSince` 问的
					 * 是「转录里未读了多少」，两个都是自动推出来的，谁都没有入口去写。
					 *
					 * 一个假装做完了的按钮比一个不存在的按钮更糟：它让人以为那条会话被标记了。要么
					 * 真做（`SessionMeta` 上加一位，侧边栏画点，打开会话时清掉），要么不给。
					 */}

					<MenuItem
						icon={session.archived ? <ArchiveRestore size={13} strokeWidth={1.8} /> : <Archive size={13} strokeWidth={1.8} />}
						onClick={() => {
							void setSessionArchived(session, !session.archived);
							onClose();
						}}
					>
						{session.archived ? t("common.unarchive") : t("common.archive")}
					</MenuItem>

					{session.archived && (
						<MenuItem
							icon={<Trash2 size={13} strokeWidth={1.8} className="text-danger" />}
							onClick={() => {
								onClose();
								confirm.ask({
									title: t("sidebarList.deleteConfirm"),
									detail: t("sidebarList.deleteDetail", { title: session.title, n: session.messageCount }),
									confirmLabel: t("common.delete"),
									onConfirm: () => void deleteSession(session),
								});
							}}
						>
							<span className="text-danger">{t("common.delete")}</span>
						</MenuItem>
					)}

					<MenuSeparator />

					<MenuItem icon={<Folder size={13} strokeWidth={1.8} />} onClick={() => setMode("projects")}>
						{t("sessionMenu.project")}
					</MenuItem>

					<MenuItem icon={<Copy size={13} strokeWidth={1.8} />} onClick={() => setMode("copy")}>
						{t("common.copy")}
					</MenuItem>

					{!onPhone() && <MenuItem
						icon={<ExternalLink size={13} strokeWidth={1.8} />}
						onClick={() => {
							void bridge.system.openExternal(`lyra://session/${session.id}`).catch(() => {});
							notify(t("sessionMenu.openingWindow"));
							onClose();
						}}
					>
						{t("sessionMenu.openInNewWindow")}
					</MenuItem>}
				</MenuBody>
			</Popover>
			{confirm.element}
		</>
	);
}
