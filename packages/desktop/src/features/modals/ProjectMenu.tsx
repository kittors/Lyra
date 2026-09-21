import { Archive, FolderOpen, Pencil, PinOff, Pin, SquarePen, X } from "lucide-react";
import { useState } from "react";
import { Confirm } from "../../ui/overlay/Confirm.tsx";
import { MenuBody, MenuItem, MenuSeparator, Popover, type Anchor } from "../../ui/overlay/Popover.tsx";
import { useRevealLabel } from "../../store/open-targets.ts";
import { startProjectSession } from "../../store/project-session.ts";
import { useI18n } from "../../i18n/index.ts";
import { useApp } from "../../store/index.ts";
import { ProjectDialog } from "./ProjectDialog.tsx";
import { bridge } from "../../services/index.ts";

/**
 * Per-project actions, hung off the row they act on.
 *
 * Everything here is either reversible (pinning, archiving) or leaves the working tree alone
 * (removing only forgets the entry). Nothing on this menu deletes a directory.
 *
 * It got shorter, and the two that went are worth naming. 「切换到这个项目」 duplicated what opening
 * any conversation inside already does — and 「在这里新建会话」, one row above it, does it too, with
 * something to show for it afterwards. 「创建永久工作树」 was a text field in a menu that produced a
 * directory somewhere else on disk; the same thing is configured in 设置 › 工作树 for every project
 * at once rather than one branch name at a time.
 *
 * Renaming did not go — it moved. A name and the folders a project is made of are one form, and
 * that form is `ProjectDialog`.
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
	const { t } = useI18n();
	const settings = useApp((s) => s.settings);
	const sessions = useApp((s) => s.sessions);
	const setPinned = useApp((s) => s.setProjectPinned);
	const removeProject = useApp((s) => s.removeProject);
	const archiveProjectSessions = useApp((s) => s.archiveProjectSessions);
	const notify = useApp((s) => s.notify);
	const reveal = useRevealLabel();

	const [mode, setMode] = useState<"menu" | "edit" | "remove">("menu");

	const entry = settings?.projects.find((project) => project.path === path);
	const pinned = entry?.pinned ?? false;
	const liveSessions = sessions.filter((s) => s.cwd === path && !s.archived).length;

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
				title={t("projectMenu.removeConfirm", { name })}
				detail={t("projectMenu.removeDetail")}
				confirmLabel={t("common.remove")}
				onCancel={onClose}
				onConfirm={() => {
					void removeProject(path);
					onClose();
				}}
			/>
		);
	}

	// Centred, like every other dialog — a form with two controls and a destructive action in it is
	// not something to hang off the corner of a row.
	if (mode === "edit") {
		return <ProjectDialog project={{ path, name, folders: entry?.folders }} onClose={onClose} />;
	}

	return (
		<Popover anchor={anchor} onClose={onClose} placement="right" width="compact" label={t("projectMenu.actionsFor", { name })}>
			<MenuBody>
				{/*
				 * What the row is usually pressed for, first.
				 *
				 * The button on the row does the same thing; this is the keyboard and right-click
				 * path to it. Starting a conversation here is also how you switch to the project,
				 * which is why there is no separate item saying so.
				 */}
				<MenuItem
					icon={<SquarePen size={13} strokeWidth={1.8} />}
					onClick={() => {
						void startProjectSession(path);
						onClose();
					}}
				>
					{t("projectMenu.newSessionHere")}
				</MenuItem>

				<MenuSeparator />

				<MenuItem
					icon={pinned ? <PinOff size={13} strokeWidth={1.8} /> : <Pin size={13} strokeWidth={1.8} />}
					onClick={() => {
						void setPinned(path, !pinned);
						notify(pinned ? t("projectMenu.unpinned") : t("projectMenu.pinned"));
						onClose();
					}}
				>
					{pinned ? t("projectMenu.unpin") : t("projectMenu.pin")}
				</MenuItem>
				<MenuItem icon={<Pencil size={13} strokeWidth={1.8} />} onClick={() => setMode("edit")}>
					{t("projectMenu.editProject")}
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
					{t("projectMenu.archiveChats")}
				</MenuItem>
				<MenuItem icon={<X size={13} strokeWidth={1.9} />} danger onClick={() => setMode("remove")}>
					{t("common.remove")}
				</MenuItem>
			</MenuBody>
		</Popover>
	);
}
