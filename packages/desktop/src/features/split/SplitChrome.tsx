/**
 * The title bar of one conversation screen, in two halves.
 *
 * `ScreenTitle` names the conversation — a folder icon, the title and a "…", which is the same
 * session menu as a right-click in the sidebar, after ZCode. `ScreenTools` holds the tools of *this*
 * conversation: terminal, browser, Git and the overflow open and close panels in this screen, and
 * their pressed state is this screen's; with several screens it also closes one.
 *
 * Where the halves are drawn depends on how many screens there are. Several: each in its own screen's
 * card, as `SplitChrome`, covering the transcript only — the panels beside it carry their own headers.
 * One: in the window's toolbar (`ToolbarScreenTitle` / `ToolbarScreenTools`), with the title over the
 * conversation's card and nothing inside the card, as the reference layout draws it.
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
import { leafCount, firstSession } from "./tree.ts";
import { useSplit } from "./store.ts";

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
			<ScreenTitle sessionId={sessionId} screen={screen} />
			<ScreenTools sessionId={sessionId} screen={screen} />
		</header>
	);
}

/** The conversation's metadata, wherever it is: the live one, a warmed screen, or the sidebar list. */
function useScreenMeta(sessionId: string | null) {
	return useApp((s) =>
		!sessionId
			? s.activeSessionId
				? null
				: s.meta
			: s.activeSessionId === sessionId
				? s.meta
				: (s.sessionCache[sessionId]?.meta ?? s.sessions.find((session) => session.id === sessionId) ?? null),
	);
}

function ScreenTitle({ sessionId, screen }: { sessionId: string | null; screen: boolean }) {
	const { t } = useI18n();
	const meta = useScreenMeta(sessionId);
	const deleteSession = useApp((s) => s.deleteSession);
	const menu = usePopover();
	// The delete confirmation hangs here rather than in the menu: the menu unmounts once clicked. See `onRequestDelete` on `SessionMenu`.
	const confirm = useConfirmer();
	// A blank new conversation on a single screen has no session to name yet, so no "Untitled"; with several screens each one must say whose it is.
	const title = meta || screen ? sessionTitle(meta?.title) : "";
	return (
		<>
			{meta && <Folder size={15} strokeWidth={1.7} aria-hidden className="shrink-0 text-ink-faint" />}
			<span data-ly-screen-title className="min-w-0 truncate text-label font-semibold text-ink select-none">{title}</span>
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
		</>
	);
}

function ScreenTools({ sessionId, screen }: { sessionId: string | null; screen: boolean }) {
	const { t } = useI18n();
	return (
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
	);
}

/**
 * The one screen the window shows, when it shows exactly one conversation view — what the toolbar
 * draws the title bar for. `undefined` when there is no such screen: several screens, or another
 * view (the plugin catalogue, settings) in front of the conversations.
 */
function useSingleScreen(): { sessionId: string | null } | undefined {
	const single = useSplit((s) => leafCount(s.tree) === 1);
	const sessionId = useSplit((s) => firstSession(s.tree));
	const chat = useApp((s) => s.view === "chat");
	return single && chat ? { sessionId } : undefined;
}

/** The single screen's title, drawn in the window's toolbar over the conversation's card. */
export function ToolbarScreenTitle() {
	const screen = useSingleScreen();
	if (!screen) return null;
	return (
		<div data-dock-header="conversation" data-ly-toolbar-title className="flex min-w-0 items-center gap-1.5">
			<ScreenTitle sessionId={screen.sessionId} screen={false} />
		</div>
	);
}

/** The single screen's panel buttons, at the toolbar's far end. */
export function ToolbarScreenTools() {
	const screen = useSingleScreen();
	if (!screen) return null;
	return <ScreenTools sessionId={screen.sessionId} screen={false} />;
}
