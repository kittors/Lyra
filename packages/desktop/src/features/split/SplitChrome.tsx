/**
 * The title bar of one conversation screen.
 *
 * Every screen has one, and it covers the transcript only — the panels beside it carry their own
 * headers at full height. It holds the tools of *this* conversation: terminal, browser, Git and the
 * overflow open and close panels in this screen, and their pressed state is this screen's.
 *
 * 每一屏都报出自己的会话名，单屏也一样，照 ZCode：文件夹图标、标题、「…」，「…」就是侧边栏右键
 * 的那份会话菜单。只有多屏时才能关掉某一屏，面板菜单里也才有挪动它们的项。
 */

import { Folder, MoreHorizontal, X } from "lucide-react";
import { PanelMenu } from "../../app/window/WindowToolbar.tsx";
import { ToolbarButton } from "../../app/window/WindowControls.tsx";
import { WINDOW_HEADER_HEIGHT } from "../../../shared/window-chrome.ts";
import { useI18n } from "../../i18n/index.ts";
import { sessionTitle } from "../../lib/session-title.ts";
import { useApp } from "../../store/index.ts";
import { SessionMenu } from "../modals/index.ts";
import { useConfirmer } from "../../ui/overlay/Confirm.tsx";
import { usePopover } from "../../ui/overlay/Popover.tsx";
import { closePane } from "./actions.ts";
import { paneKey } from "./pane-key.ts";
import { SplitMoveItems } from "./SplitMoveItems.tsx";

export function SplitChrome({
	sessionId,
	screen,
	inset,
	insetEnd,
}: {
	sessionId: string | null;
	/** More than one conversation on the window. */
	screen: boolean;
	inset: number;
	insetEnd: number;
}) {
	const { t } = useI18n();
	const meta = useApp((s) =>
		!sessionId
			? s.activeSessionId
				? null
				: s.meta
			: s.activeSessionId === sessionId
				? s.meta
				: (s.sessionCache[sessionId]?.meta ?? s.sessions.find((session) => session.id === sessionId) ?? null),
	);
	const deleteSession = useApp((s) => s.deleteSession);
	const menu = usePopover();
	// 删除确认挂在这里而不是菜单里：菜单点完就卸载了，见 `SessionMenu` 的 `onRequestDelete`。
	const confirm = useConfirmer();
	// 单屏的空白新对话还没有会话可名，不写「未命名」；多屏时每一格都得报上名字。
	const title = meta || screen ? sessionTitle(meta?.title) : "";
	return (
		<header
			// One screen answers to the old single-screen selector; several each answer to their own.
			data-ly-split-chrome={screen ? paneKey(sessionId) : undefined}
			data-dock-header={screen ? undefined : "conversation"}
			style={{
				height: WINDOW_HEADER_HEIGHT,
				paddingLeft: inset + 10,
				paddingRight: insetEnd + 6,
			}}
			className="drag-region flex shrink-0 items-center gap-1.5"
		>
			{meta && <Folder size={15} strokeWidth={1.7} aria-hidden className="shrink-0 text-ink-faint" />}
			<span className="min-w-0 truncate text-label font-semibold text-ink select-none">{title}</span>
			{meta && (
				<div className="no-drag flex shrink-0">
					<ToolbarButton label={t("split.sessionActions")} onClick={menu.toggle} active={menu.open}>
						<MoreHorizontal size={15} strokeWidth={2} />
					</ToolbarButton>
				</div>
			)}
			{meta && menu.open && (
				<SessionMenu
					anchor={menu.anchor}
					session={meta}
					onClose={menu.close}
					onRequestDelete={() =>
						confirm.ask({
							title: t("sidebarList.deleteConfirm"),
							detail: t("sidebarList.deleteDetail", { title: meta.title, n: meta.messageCount }),
							confirmLabel: t("common.delete"),
							onConfirm: () => void deleteSession(meta),
						})
					}
				/>
			)}
			{confirm.element}
			<div data-ly-split-tools data-dock-actions className="no-drag relative z-[1] ml-auto flex shrink-0 items-center gap-0.5">
				<PanelMenu
					scope={paneKey(sessionId)}
					extras={screen && sessionId ? (onClose) => <SplitMoveItems sessionId={sessionId} onClose={onClose} includeWindow /> : undefined}
				/>
				{screen && sessionId && (
					<ToolbarButton
						label={t("split.closePane")}
						onClick={(event) => {
							event.stopPropagation();
							closePane(sessionId);
						}}
					>
						<span data-ly-split-close={sessionId} className="flex items-center justify-center">
							<X size={13} strokeWidth={1.9} aria-hidden />
						</span>
					</ToolbarButton>
				)}
			</div>
		</header>
	);
}
