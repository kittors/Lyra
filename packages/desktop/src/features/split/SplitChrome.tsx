/**
 * The title bar of one conversation screen.
 *
 * Every screen has one, and it covers the transcript only — the panels beside it carry their own
 * headers at full height. It holds the tools of *this* conversation: terminal, browser, Git and the
 * overflow open and close panels in this screen, and their pressed state is this screen's.
 *
 * A lone screen is the conversation the window is showing, so it does not repeat the title the
 * sidebar already highlights and offers no close. With more than one screen each names itself and
 * can be put away, and the overflow carries the moves that rearrange them.
 */

import { X } from "lucide-react";
import { PanelMenu } from "../../app/window/WindowToolbar.tsx";
import { ToolbarButton } from "../../app/window/WindowControls.tsx";
import { WINDOW_HEADER_HEIGHT } from "../../../shared/window-chrome.ts";
import { useI18n } from "../../i18n/index.ts";
import { sessionTitle } from "../../lib/session-title.ts";
import { useApp } from "../../store/index.ts";
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
	const title = useApp((s) => {
		if (!screen) return "";
		const meta = !sessionId
			? s.activeSessionId
				? null
				: s.meta
			: s.activeSessionId === sessionId
				? s.meta
				: (s.sessionCache[sessionId]?.meta ?? s.sessions.find((session) => session.id === sessionId) ?? null);
		return sessionTitle(meta?.title);
	});
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
			<span className="min-w-0 flex-1 truncate text-detail font-medium text-ink select-none">{title}</span>
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
