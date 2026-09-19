/**
 * A window that is only one conversation.
 *
 * "Open in a new window" is not a second workspace. The sidebar, the dock, and every panel that
 * belongs to the container stay on the primary window. What remains is the transcript, the
 * composer, and one way back.
 */

import { AppWindow } from "lucide-react";
import { useEffect } from "react";
import { SessionScope } from "../session-scope.tsx";
import { Conversation, ConversationSkeleton } from "../../features/conversation/index.ts";
import { chatSurface } from "../../lib/chat-surface.ts";
import { sessionTitle } from "../../lib/session-title.ts";
import { useApp } from "../../store/index.ts";
import { useI18n } from "../../i18n/index.ts";
import { useLayout } from "../layout.tsx";
import { ToolbarButton } from "./WindowControls.tsx";
import { WINDOW_HEADER_HEIGHT } from "../../../shared/window-chrome.ts";
import { bridge } from "../../services/index.ts";
import { KeepOnTopButton } from "./KeepOnTopButton.tsx";

export function SessionWindow() {
	const { t } = useI18n();
	const sessionId = bridge.bootWindow?.sessionId ?? null;
	const { titlebar, headerBar } = useLayout();
	const meta = useApp((state) => state.meta);
	const messages = useApp((state) => state.messages.length);
	const loading = useApp((state) => state.loadingSession);
	const title = sessionTitle(meta?.title);
	const surface = chatSurface({ messages, loading });

	useEffect(() => {
		if (!sessionId) return;
		void useApp.getState().openSessionById(sessionId);
	}, [sessionId]);

	useEffect(() => {
		document.title = title;
	}, [title]);

	const openInMain = () => {
		if (!sessionId || !bridge.windows?.openInMain) return;
		void bridge.windows.openInMain({ sessionId });
	};

	return (
		<div data-ly-session-window className="ly-shell relative flex h-full flex-col overflow-hidden">
			<header
				data-ly-session-window-chrome
				className="drag-region relative z-40 flex shrink-0 items-center"
				style={{
					height: WINDOW_HEADER_HEIGHT,
					paddingLeft: titlebar.start + 10,
					paddingRight: (headerBar ? titlebar.end : 0) + 8,
				}}
			>
				<span
					data-ly-session-window-title
					className="min-w-0 flex-1 truncate text-detail font-medium text-ink select-none"
				>
					{title}
				</span>
				<div data-ly-session-window-tools className="no-drag ml-auto flex shrink-0 items-center gap-0.5">
					<KeepOnTopButton />
					<ToolbarButton label={t("sessionMenu.openInMainWindow")} onClick={openInMain}>
						<span data-ly-open-in-main className="flex items-center justify-center">
							<AppWindow size={13} strokeWidth={1.9} />
						</span>
					</ToolbarButton>
				</div>
			</header>
			<SessionScope.Provider value={sessionId}>
				<div className="flex min-h-0 flex-1 flex-col">
					{surface === "skeleton" || !sessionId ? <ConversationSkeleton /> : <Conversation sessionId={sessionId} />}
				</div>
			</SessionScope.Provider>
		</div>
	);
}
