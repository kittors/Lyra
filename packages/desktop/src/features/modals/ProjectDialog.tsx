/**
 * Describing a project: a name, and the folders it is made of.
 *
 * 「新建项目」 used to be a directory picker and nothing else — the folder you chose was the project,
 * and its `basename` was the name, so neither was ever something you said. Two things were missing
 * from that, and they are the same thing twice: a project is not always one directory, and it is
 * not always called what the directory is called.
 *
 * One component for both 创建 and 编辑, because they are the same form. The difference is what
 * already exists: editing cannot move the main folder (see `SourceFolders`) and offers to remove
 * the project, creating cannot.
 */

import { Folder, FolderPlus, Monitor, X } from "lucide-react";
import { useState } from "react";

import { projectFolders } from "@lyra/core/project-folders";
import { useI18n } from "../../i18n/index.ts";
import { baseName } from "../../lib/paths.ts";
import { Input } from "../../ui/inputs/NativeField.tsx";
import { Dialog, DialogAction } from "../../ui/overlay/Dialog.tsx";
import { useApp } from "../../store/index.ts";
import { bridge } from "../../services/index.ts";

/** Wide enough for two columns of path, narrow enough to stay a form rather than a page. */
const PROJECT_DIALOG_WIDTH = 520;

export interface ProjectDraft {
	path: string;
	name: string;
	folders?: string[];
}

/**
 * The folders, as rows you can add to and take from.
 *
 * Empty, it is an invitation rather than an empty box: the one thing to do here is name a folder,
 * so the only control is the one that does it. With folders in it, the 「此电脑」 mark moves up to
 * the heading — it says where these paths are, which is worth one label and not one per row.
 */
function SourceFolders({
	folders,
	lockFirst,
	onAdd,
	onRemove,
}: {
	folders: string[];
	/** Editing: the first folder is the working directory of every session filed under this project. */
	lockFirst: boolean;
	onAdd: () => void;
	onRemove: (folder: string) => void;
}) {
	const { t } = useI18n();
	return (
		<>
			<div className="flex items-center justify-between pb-2">
				<span className="text-label text-ink">{t("project.sourceFolders")}</span>
				{folders.length > 0 && (
					<span className="flex items-center gap-1.5 text-detail text-ink-faint">
						<Monitor size={13} strokeWidth={1.8} aria-hidden />
						{t("project.thisComputer")}
					</span>
				)}
			</div>

			<div className="overflow-hidden rounded-2xl bg-card">
				{folders.length === 0 ? (
					<div className="flex flex-col items-center gap-3 px-4 py-7">
						<p className="text-label text-ink-muted">{t("project.addFolderOnThisComputer")}</p>
						<button
							type="button"
							data-ly-add-folder
							onClick={onAdd}
							className="ly-dialog-action ly-dialog-action-secondary"
						>
							<FolderPlus size={14} strokeWidth={1.8} aria-hidden />
							{t("project.add")}
						</button>
					</div>
				) : (
					<>
						{folders.map((folder, index) => (
							/* The path is the tooltip, not the row: a row of absolute paths is a column of
							   prefixes you have to read past to find the one that differs. */
							<div key={folder} data-ly-source-folder={folder} className="flex h-11 items-center gap-2.5 px-4" data-ly-tip={folder}>
								<Folder size={15} strokeWidth={1.8} className="shrink-0 text-ink-muted" aria-hidden />
								<span className="ly-fade-tail min-w-0 flex-1 truncate text-label text-ink">{baseName(folder)}</span>
								{lockFirst && index === 0 ? (
									<span className="shrink-0 text-caption text-ink-faint" data-ly-tip={t("project.mainFolderHint")}>
										{t("project.mainFolder")}
									</span>
								) : (
									<button
										type="button"
										onClick={() => onRemove(folder)}
										data-ly-tip={t("project.removeFolder")}
										aria-label={t("project.removeFolderNamed", { name: baseName(folder) })}
										className="shrink-0 rounded-md p-1 text-ink-faint transition-colors duration-[var(--ly-t-quick)] hover:bg-card-hover hover:text-ink"
									>
										<X size={14} strokeWidth={2} aria-hidden />
									</button>
								)}
							</div>
						))}
						<button
							type="button"
							data-ly-add-folder
							onClick={onAdd}
							className="flex h-11 w-full items-center gap-2.5 px-4 text-left text-label text-ink-muted transition-colors duration-[var(--ly-t-quick)] hover:bg-card-hover hover:text-ink"
						>
							<FolderPlus size={15} strokeWidth={1.8} className="shrink-0" aria-hidden />
							{t("project.addFolder")}
						</button>
					</>
				)}
			</div>
		</>
	);
}

export function ProjectDialog({ project, onClose }: { project?: ProjectDraft; onClose: () => void }) {
	const { t } = useI18n();
	const editing = project !== undefined;
	const createProject = useApp((s) => s.createProject);
	const updateProject = useApp((s) => s.updateProject);
	const removeProject = useApp((s) => s.removeProject);
	const notify = useApp((s) => s.notify);

	const [name, setName] = useState(project?.name ?? "");
	const [folders, setFolders] = useState<string[]>(project ? projectFolders(project) : []);
	const [confirmingRemove, setConfirmingRemove] = useState(false);

	async function addFolder() {
		const picked = await bridge.workspace.pick();
		if (!picked) return;
		if (folders.includes(picked.path)) {
			notify(t("project.folderAlready", { name: baseName(picked.path) }));
			return;
		}
		setFolders((current) => [...current, picked.path]);
	}

	function submit() {
		if (folders.length === 0) return;
		if (editing) void updateProject(project.path, { name, folders });
		else void createProject(name, folders);
		onClose();
	}

	/*
	 * 移除 asks its own question, on this same surface.
	 *
	 * Raising `Confirm` over the dialog would stack two scrims and two cards — and the question is
	 * about the thing this dialog is already showing, so there is nothing for a second surface to
	 * add. What it costs is spelled out because the answer people expect is the wrong one: the
	 * directory stays, the entry does not.
	 */
	if (confirmingRemove && project) {
		return (
			<Dialog
				onClose={onClose}
				width={PROJECT_DIALOG_WIDTH}
				label={t("projectMenu.removeConfirm", { name: project.name })}
				title={t("projectMenu.removeConfirm", { name: project.name })}
				detail={t("projectMenu.removeDetail")}
				actions={
					<>
						<div className="flex-1" />
						<DialogAction onClick={() => setConfirmingRemove(false)}>{t("common.cancel")}</DialogAction>
						<DialogAction
							tone="danger"
							onClick={() => {
								void removeProject(project.path);
								onClose();
							}}
						>
							{t("common.remove")}
						</DialogAction>
					</>
				}
			/>
		);
	}

	return (
		<Dialog
			onClose={onClose}
			width={PROJECT_DIALOG_WIDTH}
			label={editing ? t("project.edit") : t("project.create")}
			title={editing ? t("project.edit") : t("project.create")}
			actions={
				<>
					{editing && (
						<DialogAction tone="danger" onClick={() => setConfirmingRemove(true)}>
							{t("project.removeLocal")}
						</DialogAction>
					)}
					<div className="flex-1" />
					<DialogAction onClick={onClose}>{t("common.cancel")}</DialogAction>
					<DialogAction tone="primary" disabled={folders.length === 0} onClick={submit}>
						{editing ? t("common.save") : t("project.create")}
					</DialogAction>
				</>
			}
		>
			{/*
			 * A form, so Enter submits from the name field — which is the only field, and the last
			 * thing most people will touch before pressing 创建.
			 */}
			<form
				data-ly-project-dialog={editing ? "edit" : "create"}
				onSubmit={(event) => {
					event.preventDefault();
					submit();
				}}
			>
				<div className="ly-field mb-5 gap-2.5">
					<Folder size={15} strokeWidth={1.8} className="shrink-0 text-ink-muted" aria-hidden />
					<Input
						autoFocus
						value={name}
						onChange={(event) => setName(event.target.value)}
						placeholder={t("project.namePlaceholder")}
						aria-label={t("project.namePlaceholder")}
						className="min-w-0 flex-1 bg-transparent text-label text-ink outline-none placeholder:text-ink-faint"
					/>
				</div>

				<SourceFolders
					folders={folders}
					lockFirst={editing}
					onAdd={() => void addFolder()}
					onRemove={(folder) => setFolders((current) => current.filter((entry) => entry !== folder))}
				/>
				{/* Submits the form without being reachable: the visible submit is in the actions row,
				    which `DialogFrame` renders outside this form. */}
				<button type="submit" className="hidden" tabIndex={-1} aria-hidden />
			</form>
		</Dialog>
	);
}
