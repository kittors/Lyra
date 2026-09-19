/**
 * The title bar of one conversation screen.
 *
 * Each tiled chat is its own screen. The bar therefore carries the same window tools every
 * conversation header does — terminal, browser, review, the overflow — plus the close that
 * puts this screen away. Putting those icons on only the top-right screen left the others
 * looking unfinished.
 */

import { X } from "lucide-react";
import { PanelMenu } from "../../app/window/WindowToolbar.tsx";
import { ToolbarButton } from "../../app/window/WindowControls.tsx";
import { WINDOW_HEADER_HEIGHT } from "../../../shared/window-chrome.ts";
import { useI18n } from "../../i18n/index.ts";
import { sessionTitle } from "../../lib/session-title.ts";
import { useApp } from "../../store/index.ts";
import { closePane } from "./actions.ts";
import { SplitMoveItems } from "./SplitMoveItems.tsx";

export function SplitChrome({
	sessionId,
	inset,
	insetEnd,
}: {
	sessionId: string | null;
	inset: number;
	insetEnd: number;
}) {
	const { t } = useI18n();
	const title = useApp((s) => {
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
			data-ly-split-chrome={sessionId ?? "@draft"}
			style={{
				height: WINDOW_HEADER_HEIGHT,
				paddingLeft: inset + 10,
				paddingRight: insetEnd + 6,
			}}
			className="drag-region flex shrink-0 items-center gap-1.5"
		>
			<span className="min-w-0 flex-1 truncate text-detail font-medium text-ink select-none">
				{title}
			</span>
			<div data-ly-split-tools className="no-drag relative z-[1] ml-auto flex shrink-0 items-center gap-0.5">
				<PanelMenu scope={sessionId ?? "@draft"} extras={sessionId ? (onClose) => <SplitMoveItems sessionId={sessionId} onClose={onClose} includeWindow /> : undefined} />
				{sessionId && (
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
