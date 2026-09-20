/**
 * A window that is only one docked panel — browser, terminal, files, git.
 *
 * "Open in a new window" is not a second workspace. The pane leaves the tile (or the
 * window dock) and this document holds it. One control puts it back in the slot it left.
 */

import { AppWindow } from "lucide-react";
import { useEffect } from "react";
import { SessionScope } from "../session-scope.tsx";
import { renderPanel, renderPanelHeader, renderPanelActions, usePanelDefinitions, useSide } from "../../features/dock/index.ts";
import { useApp } from "../../store/index.ts";
import { useI18n } from "../../i18n/index.ts";
import { useLayout } from "../layout.tsx";
import { ToolbarButton } from "./WindowControls.tsx";
import { NATIVE_HEADER_HEIGHT, WINDOW_HEADER_HEIGHT } from "../../../shared/window-chrome.ts";
import { bridge } from "../../services/index.ts";
import { KeepOnTopButton } from "./KeepOnTopButton.tsx";
import { flushFilePanelState } from "../../store/file-panel-handoff.ts";
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

	/*
	 * The side chat has to be pointed at a conversation before it holds anything.
	 *
	 * `ChatShell` does this for the primary window, and a panel window does not have one — so this
	 * panel opened empty, and stayed empty: `ask`, `abort` and `reset` all begin by reading
	 * `useSide.sessionId`, which only `attach` sets, so the composer accepted text and sent
	 * nothing. The transcript itself was never missing; nobody had asked for it.
	 */
	useEffect(() => {
		if (kind !== "chat") return;
		void useSide.getState().attach(sessionId).catch((error: unknown) => {
			useApp.getState().notify(String(error), "error");
		});
	}, [kind, sessionId]);

	useEffect(() => {
		document.title = title;
	}, [title]);

	useEffect(() => {
		if (kind !== "file" || !bridge.windows?.onClosePanel) return;
		let closing = false;
		return bridge.windows.onClosePanel(() => {
			if (closing) return;
			closing = true;
			void flushFilePanelState().then(async () => {
				const result = await bridge.windows.closePanel({ kind, scope });
				if (!result.ok) throw new Error("File panel close was rejected");
			}).catch((error: unknown) => {
				closing = false;
				useApp.getState().notify(String(error), "error");
			});
		});
	}, [kind, scope]);

	const restore = async () => {
		if (!kind || !bridge.windows?.restorePanel) return;
		try {
			if (kind === "file") await flushFilePanelState();
			await bridge.windows.restorePanel({ kind, scope });
		} catch (error) {
			useApp.getState().notify(String(error), "error");
		}
	};

	return (
		<div data-ly-panel-window={kind ?? ""} className="ly-shell relative flex h-full flex-col overflow-hidden">
			{/*
			 * 这条带子在两个平台上是两样东西，所以三项都跟着 `headerBar` 走。
			 *
			 * **底色**：Windows/Linux 上它要和底下的内容分开——`ly-window-header` 取的是侧边栏那
			 * 一档，比外壳亮/暗一级，于是两者之间有一道横平的边界。漏掉这个类的后果不是"少点样式"，
			 * 是整条带子和内容同色糊成一片，第一行内容顶上去看着像被压住（那个类自己的注释写着
			 * 「第一版写的是外壳色，拍出来整条带子根本看不见」，说的就是这个）。
			 * macOS 不加：那里的红绿灯在窗口外，这条带子本来就该是透明的，加了反而多一道没来由的
			 * 横线。
			 *
			 * **高度**：Windows/Linux 取原生那一档（32），因为这条带子要和系统画的三颗按钮同高；
			 * macOS 取 44，那是红绿灯居中的数。
			 */}
			<header
				data-ly-panel-window-chrome
				className={`drag-region relative z-40 flex shrink-0 items-center${headerBar ? " ly-window-header" : ""}`}
				style={{
					height: headerBar ? NATIVE_HEADER_HEIGHT : WINDOW_HEADER_HEIGHT,
					paddingLeft: titlebar.start + 10,
					paddingRight: (headerBar ? titlebar.end : 0) + 8,
				}}
			>
				<div
					data-ly-panel-window-title
					className="min-w-0 flex-1 truncate text-detail font-medium text-ink select-none"
				>
					<SessionScope.Provider value={sessionId}>{kind ? renderPanelHeader(kind) ?? title : title}</SessionScope.Provider>
				</div>
				<div data-ly-panel-window-tools className="no-drag ml-auto flex shrink-0 items-center gap-0.5">
					<SessionScope.Provider value={sessionId}>{kind ? renderPanelActions(kind) : null}</SessionScope.Provider>
					<KeepOnTopButton />
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
