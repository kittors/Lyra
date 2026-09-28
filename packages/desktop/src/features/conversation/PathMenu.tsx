/**
 * What right-clicking a file in a conversation offers: a file a turn edited, the header of its diff,
 * a file linked in a reply.
 *
 * These are paths the conversation mentions, not rows of the file tree — nothing here renames,
 * deletes or pastes — so the menu is the tree's first half and nothing more: open it here, open it
 * in the chosen editor or any other installed application, show it in the file manager, copy where
 * it is. The order is the tree's (`features/files/FileMenu.tsx`), so a file offers the same things in
 * the same places wherever it is right-clicked.
 *
 * 「打开所在文件夹」 is 「在访达中显示」: that opens the folder with the file selected, and a second row
 * that only opens the folder reads as one sentence said twice (the same call `AttachmentMenu` made).
 */

import { AppWindow, ChevronRight, CornerUpRight, ExternalLink, FolderOpen, Link2 } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import type { OpenTarget } from "../../../electron/ipc-types.ts";
import { useI18n } from "../../i18n/index.ts";
import { relativeTo } from "../../lib/paths.ts";
import { available, bridge } from "../../services/index.ts";
import { useApp } from "../../store/index.ts";
import { openLabel, revealLabel, useOpenTarget, useOpenTargets } from "../../store/open-targets.ts";
import { ContextMenu, useContextMenu } from "../../ui/overlay/ContextMenu.tsx";
import { MenuBody, MenuItem, MenuSeparator } from "../../ui/overlay/Menu.tsx";
import { Popover } from "../../ui/overlay/Popover.tsx";

const ICON = { size: 13, strokeWidth: 1.8 } as const;

/** What a right-click is about. */
export interface PathMenuTarget {
	/** Absolute. */
	path: string;
	/** Open it inside Lyra, where the surface can — the file pane. Omitted, the row is not offered. */
	onOpen?: () => void;
}

/**
 * Right-click handling for paths, and the menu that goes with it.
 *
 * `root` is the conversation's project, for 复制相对路径; a file outside it gets only the full path.
 * On a host that can open nothing — the phone — the event is left alone and no menu appears, rather
 * than a menu of rows that do nothing when pressed.
 */
export function usePathMenu(root: string | null) {
	const menu = useContextMenu<PathMenuTarget>();
	return {
		open: menu.open,
		onContextMenu: (event: React.MouseEvent, target: PathMenuTarget) => {
			if (!available("system", "openIn")) return;
			menu.show(event, target);
		},
		element:
			menu.open && menu.target ? <PathMenu anchor={menu.anchor} target={menu.target} root={root} onClose={menu.close} /> : null,
	};
}

/** An installed application's own icon, at the size the menu's icon column is made for. */
function appIcon(target: OpenTarget, fallback: ReactNode): ReactNode {
	return target.icon ? <img src={target.icon} alt="" className="h-[18px] w-[18px] shrink-0 rounded-[4px]" /> : fallback;
}

function PathMenu({
	anchor,
	target,
	root,
	onClose,
}: {
	anchor: { x: number; y: number } | null;
	target: PathMenuTarget;
	root: string | null;
	onClose: () => void;
}) {
	const { t } = useI18n();
	const editor = useOpenTarget();
	const targets = useOpenTargets();
	const name = target.path.split(/[\\/]/).pop() || target.path;
	const relative = root ? relativeTo(root, target.path) : null;
	const inside = relative !== null && relative !== target.path && !relative.startsWith("..");

	/*
	 * The file may have moved since the turn that wrote it. Asked first, because revealing a path that
	 * is gone opens its parent folder instead — which looks like showing the wrong file rather than
	 * saying the file is not there.
	 */
	const withFile = async (act: (path: string) => Promise<unknown>) => {
		const here = await bridge.system.pathExists(target.path).catch(() => false);
		if (!here) {
			useApp.getState().notify(t("attachment.gone", { name }), "warn");
			return;
		}
		await act(target.path).catch((error: unknown) => useApp.getState().notify(String(error), "error"));
	};
	const copy = (text: string, isRelative: boolean) => {
		void bridge.clipboard.write(text);
		useApp.getState().notify(t(isRelative ? "fileAction.relativePathCopied" : "fileAction.pathCopied"));
	};
	// The chosen editor has its own row; the file manager has its own row. The rest are 「打开方式」.
	const others = targets.filter((one) => one.id !== "reveal" && one.id !== editor.id);

	return (
		<ContextMenu anchor={anchor} onClose={onClose}>
			{target.onOpen && (
				<MenuItem icon={<FolderOpen {...ICON} />} onClick={target.onOpen}>
					{t("common.open")}
				</MenuItem>
			)}
			{editor.id !== "reveal" && (
				<MenuItem icon={appIcon(editor, <ExternalLink {...ICON} />)} onClick={() => void withFile((path) => bridge.system.openIn(editor.id, path))}>
					{openLabel(editor)}
				</MenuItem>
			)}
			<OpenWith
				targets={others}
				onPick={(id) => {
					onClose();
					void withFile((path) => bridge.system.openIn(id, path));
				}}
				onDefault={() => {
					onClose();
					void withFile((path) => bridge.system.openPath(path));
				}}
			/>
			<MenuItem icon={<CornerUpRight {...ICON} />} onClick={() => void withFile((path) => bridge.system.openIn("reveal", path))}>
				{revealLabel()}
			</MenuItem>
			<MenuSeparator />
			<MenuItem icon={<Link2 {...ICON} />} onClick={() => copy(target.path, false)}>
				{t("fileMenu.copyPath")}
			</MenuItem>
			{inside && relative && (
				<MenuItem icon={<Link2 {...ICON} />} onClick={() => copy(relative, true)}>
					{t("fileMenu.copyRelativePath")}
				</MenuItem>
			)}
		</ContextMenu>
	);
}

/**
 * 「打开方式 ▸」: every other application this machine can open a file with, each with its own icon,
 * and the system's default last.
 *
 * Hand-rolled the way `SessionMenu`'s submenu is, because the app has no submenu component. The row
 * stops its clicks from reaching `ContextMenu`'s close-on-click wrapper — that wrapper would close the
 * whole menu the moment the submenu was asked for — which is also why each application row closes the
 * menu itself.
 */
function OpenWith({ targets, onPick, onDefault }: { targets: OpenTarget[]; onPick: (id: string) => void; onDefault: () => void }) {
	const { t } = useI18n();
	const row = useRef<HTMLDivElement>(null);
	const [open, setOpen] = useState(false);
	const leave = useRef(0);
	const show = () => {
		window.clearTimeout(leave.current);
		setOpen(true);
	};
	// A moment's grace, so the pointer can cross from the row into the submenu without it closing.
	const hide = () => {
		leave.current = window.setTimeout(() => setOpen(false), 160);
	};
	return (
		<div
			ref={row}
			data-ly-open-with=""
			onMouseEnter={show}
			onMouseLeave={hide}
			onClick={(event) => event.stopPropagation()}
		>
			<MenuItem icon={<AppWindow {...ICON} />} trailing={<ChevronRight size={13} strokeWidth={1.8} className="text-ink-faint" />} onClick={show}>
				{t("pathMenu.openWith")}
			</MenuItem>
			{open && row.current && (
				<Popover
					anchor={row.current}
					onClose={() => setOpen(false)}
					placement="right"
					align="start"
					width="compact"
					label={t("pathMenu.openWith")}
					onMouseEnter={show}
					onMouseLeave={hide}
				>
					<MenuBody insetIcons>
						{targets.map((one) => (
							<MenuItem key={one.id} icon={appIcon(one, <ExternalLink {...ICON} />)} onClick={() => onPick(one.id)}>
								{one.label}
							</MenuItem>
						))}
						{targets.length > 0 && <MenuSeparator />}
						<MenuItem icon={<ExternalLink {...ICON} />} onClick={onDefault}>
							{t("openTarget.defaultApp")}
						</MenuItem>
					</MenuBody>
				</Popover>
			)}
		</div>
	);
}
