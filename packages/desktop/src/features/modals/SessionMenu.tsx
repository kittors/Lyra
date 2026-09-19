import { Input } from "../../ui/inputs/NativeField.tsx";
import {
	Archive,
	ArchiveRestore,
	Check,
	ChevronRight,
	Columns2,
	Copy,
	ExternalLink,
	Folder,
	FolderInput,
	Pencil,
	Pin,
	PinOff,
	Trash2,
	X,
} from "lucide-react";
import { useRef, useState } from "react";
import type { SessionMeta } from "@lyra/core";
import { MenuBody, MenuItem, MenuSeparator, Popover, type Anchor } from "../../ui/overlay/Popover.tsx";
import { useI18n } from "../../i18n/index.ts";
import { useApp } from "../../store/index.ts";
import { onPhone } from "../../services/index.ts";
import { canOfferSplit, canSplit, contains, openInNewWindow, SplitMoveItems, splitWith, useSplit } from "../split/index.ts";

export function SessionMenu({
	anchor,
	session,
	onClose,
	onRequestDelete,
}: {
	anchor: Anchor;
	session: SessionMeta;
	onClose: () => void;
	/**
	 * Ask to delete this session — the confirmation belongs to whoever opened this menu.
	 *
	 * It cannot live here. A confirmation is rendered by the component that asks for it, and this
	 * component is unmounted the instant it is asked: the delete item closes the menu, `SessionRow`
	 * drops it from the tree, and the dialog goes with it. So the click reported nothing, showed
	 * nothing, and deleted nothing — see `SessionRow`, which outlives the menu and holds it instead.
	 */
	onRequestDelete: () => void;
}) {
	const { t } = useI18n();
	const splitTree = useSplit((s) => s.tree);
	const settings = useApp((s) => s.settings);
	const setSessionPinned = useApp((s) => s.setSessionPinned);
	const setSessionArchived = useApp((s) => s.setSessionArchived);
	const renameSession = useApp((s) => s.renameSession);
	const moveSessionProject = useApp((s) => s.moveSessionProject);
	const notify = useApp((s) => s.notify);

	const [mode, setMode] = useState<"menu" | "rename" | "projects" | "copy">("menu");
	const [openIn, setOpenIn] = useState(false);
	const openInRow = useRef<HTMLDivElement>(null);
	const openInLeave = useRef<number>(0);
	const showOpenIn = () => {
		window.clearTimeout(openInLeave.current);
		setOpenIn(true);
	};
	const hideOpenIn = () => {
		openInLeave.current = window.setTimeout(() => setOpenIn(false), 160);
	};
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
							data-ly-tip={t("common.cancel")}
							aria-label={t("common.cancel")}
							onClick={() => setMode("menu")}
							className="grid h-7 w-7 place-items-center rounded-lg text-ink-muted transition-colors hover:bg-card-hover hover:text-ink"
						>
							<X size={13} strokeWidth={2} aria-hidden />
						</button>
						<button
							type="submit"
							data-ly-tip={t("common.save")}
							aria-label={t("common.save")}
							disabled={!draft.trim()}
							className="grid h-7 w-7 place-items-center rounded-lg bg-ink text-shell transition-opacity hover:opacity-90 disabled:opacity-45"
						>
							<Check size={13} strokeWidth={2.2} aria-hidden />
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
								onRequestDelete();
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

					<div
						ref={openInRow}
						data-ly-open-in=""
						onMouseEnter={showOpenIn}
						onMouseLeave={hideOpenIn}
					>
						<MenuItem
							icon={<ExternalLink size={13} strokeWidth={1.8} />}
							trailing={<ChevronRight size={13} strokeWidth={1.8} className="text-ink-faint" />}
							onClick={showOpenIn}
						>
							{t("sessionMenu.openIn")}
						</MenuItem>
						{openIn && openInRow.current && (
							<Popover
								anchor={openInRow.current}
								onClose={() => setOpenIn(false)}
								placement="right"
								align="start"
								width="compact"
								label={t("sessionMenu.openIn")}
								onMouseEnter={showOpenIn}
								onMouseLeave={hideOpenIn}
							>
								<MenuBody>
									<MenuItem
										icon={<Columns2 size={13} strokeWidth={1.8} />}
										disabled={!contains(splitTree, session.id) && !(canSplit(splitTree) && canOfferSplit())}
										onClick={() => {
											const pane = document.querySelector<HTMLElement>("[data-ly-split-focused]");
											const box = (pane ?? document.querySelector("[data-ly-split-root]"))?.getBoundingClientRect();
											splitWith(session, pane?.dataset.lySplitPane === "@draft" ? null : pane?.dataset.lySplitPane ?? null, box?.width ?? 800, box?.height ?? 600);
											onClose();
										}}
									>
										{t("sessionMenu.splitView")}
									</MenuItem>
									{!onPhone() && (
										<MenuItem
											icon={<ExternalLink size={13} strokeWidth={1.8} />}
											onClick={() => {
												void openInNewWindow(session.id);
												onClose();
											}}
										>
											{t("sessionMenu.newWindow")}
										</MenuItem>
									)}
								</MenuBody>
							</Popover>
						)}
					</div>
					<SplitMoveItems sessionId={session.id} onClose={onClose} />
				</MenuBody>
			</Popover>
		</>
	);
}
