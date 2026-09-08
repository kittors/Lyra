import { Input } from "../../ui/inputs/NativeField.tsx";
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
	const renameSession = useApp((s) => s.renameSession);
	const moveSessionProject = useApp((s) => s.moveSessionProject);
	const notify = useApp((s) => s.notify);

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
		<Popover anchor={anchor} onClose={onClose} placement="right" width="compact" label={t("sessionMenu.options")}>
			<MenuBody>
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

				<MenuItem
					icon={<Pencil size={13} strokeWidth={1.8} />}
					onClick={() => {
						setDraft(session.title);
						setMode("rename");
					}}
				>
					{t("common.rename")}
				</MenuItem>

				<MenuItem
					icon={<Eye size={13} strokeWidth={1.8} />}
					onClick={() => {
						notify(t("sessionMenu.markedUnread"));
						onClose();
					}}
				>
					{t("sessionMenu.markUnread")}
				</MenuItem>

				<MenuItem
					icon={<Archive size={13} strokeWidth={1.8} />}
					onClick={() => {
						void setSessionArchived(session, true);
						onClose();
					}}
				>
					{t("common.archive")}
				</MenuItem>

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
	);
}