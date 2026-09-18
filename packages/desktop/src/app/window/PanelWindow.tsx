/**
 * A window that is only one docked panel — browser, terminal, files, git.
 *
 * "Open in a new window" is not a second workspace. The pane leaves the tile (or the
 * window dock) and this document holds it. One control puts it back in the slot it left.
 */

import { AppWindow } from "lucide-react";
import { useEffect } from "react";
import { SessionScope } from "../session-scope.tsx";
import { renderPanel, usePanelDefinitions } from "../../features/dock/index.ts";
import { useApp } from "../../store/index.ts";
import { useI18n } from "../../i18n/index.ts";
import { useLayout } from "../layout.tsx";
import { ToolbarButton } from "./WindowControls.tsx";
import { WINDOW_HEADER_HEIGHT } from "../../../shared/window-chrome.ts";
import { bridge } from "../../services/index.ts";
import type { PanelKind } from "../../features/dock/index.ts";

export function PanelWindow() {
	const { t } = useI18n();
	const kind = (bridge.bootWindow?.panelKind ?? null) as PanelKind | null;
	const scope = bridge.bootWindow?.panelScope ?? "window";
	const sessionId = bridge.bootWindow?.sessionId ?? null;
	const { titlebar, headerBar } = useLayout();
	const definitions = usePanelDefinitions();
	const def = kind ? definitions.find((entry) => entry.kind === kind) : undefined;
	const title = def ? t(def.label) : kind ?? "";

	useEffect(() => {
		if (!sessionId) return;
		void useApp.getState().openSessionById(sessionId);
	}, [sessionId]);

	useEffect(() => {
		document.title = title;
	}, [title]);

	const restore = () => {
		if (!kind || !bridge.windows?.restorePanel) return;
		void bridge.windows.restorePanel({ kind, scope });
	};

	return (
		<div data-ly-panel-window={kind ?? ""} className="ly-shell relative flex h-full flex-col overflow-hidden">
			<header
				data-ly-panel-window-chrome
				className="drag-region relative z-40 flex shrink-0 items-center"
				style={{
					height: WINDOW_HEADER_HEIGHT,
					paddingLeft: titlebar.start + 10,
					paddingRight: (headerBar ? titlebar.end : 0) + 8,
				}}
			>
				<span
					data-ly-panel-window-title
					className="min-w-0 flex-1 truncate text-detail font-medium text-ink select-none"
				>
					{title}
				</span>
				<div data-ly-panel-window-tools className="no-drag ml-auto flex shrink-0 items-center gap-0.5">
					<ToolbarButton label={t("pane.restoreToDock")} onClick={restore}>
						<span data-ly-restore-panel className="flex items-center justify-center">
							<AppWindow size={13} strokeWidth={1.9} />
						</span>
					</ToolbarButton>
				</div>
			</header>
			<SessionScope.Provider value={sessionId}>
				<div className="flex min-h-0 flex-1 flex-col">{kind ? renderPanel(kind) : null}</div>
			</SessionScope.Provider>
		</div>
	);
}
