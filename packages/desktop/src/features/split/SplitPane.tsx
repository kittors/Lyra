import { memo } from "react";
import { SessionScope } from "../../app/session-scope.tsx";
import { Conversation, ConversationSkeleton, EmptyState } from "../conversation/index.ts";
import { chatSurface } from "../../lib/chat-surface.ts";
import { RetainedViews } from "../../ui/layout/RetainedViews.tsx";
import { useApp } from "../../store/index.ts";
import { DockView, type ScreenInsets } from "../dock/index.ts";
import { pct } from "./layout.ts";
import type { PaneBox } from "./layout.ts";
import { paneKey } from "./pane-key.ts";
import { focusPane } from "./actions.ts";
import { SplitChrome } from "./SplitChrome.tsx";

/**
 * The conversation of one screen, isolated from the tile's geometry.
 *
 * A handle drag rewrites shares every frame. That has to move this section's box; it must not
 * rebuild the transcript, the composer or the panels. Those subscribe here, and this component's
 * props do not change while a boundary moves.
 *
 * Every screen is the same thing whatever the count: this conversation and the panels it owns,
 * drawn by the conversation's own dock. A single screen is a split of one — there is no window
 * layer above it that panels could fall into. The title bar is handed to that dock so it covers the
 * transcript only, never a panel beside it.
 */
const SplitScreen = memo(function SplitScreen({
	sessionId,
	screen,
	inset,
	insetEnd,
}: {
	sessionId: string | null;
	/** More than one conversation on the window: each names itself and can be closed. */
	screen: boolean;
	inset: number;
	insetEnd: number;
}) {
	const messages = useApp((s) => {
		if (!sessionId || s.activeSessionId === sessionId) return s.messages.length;
		return s.sessionCache[sessionId]?.messages.length ?? 0;
	});
	const loading = useApp((s) => {
		if (!sessionId) return false;
		if (s.activeSessionId === sessionId) return s.loadingSession;
		return !s.sessionCache[sessionId];
	});
	const surface = chatSurface({ messages, loading });
	const body = (
		<div className="flex min-h-0 flex-1 flex-col">
			{!sessionId ? (
				surface === "skeleton" ? <ConversationSkeleton /> : <EmptyState />
			) : surface === "empty" ? (
				/*
				 * 会话还在，消息没了——这一格也得是空状态。
				 *
				 * 撤回第一条消息之后，会话还在侧边栏里选着，`messages` 已经空了；`Conversation` 照样
				 * 挂上去画出来是一整片空白，外加一行没人清掉的「已暂停」。那不是任何一个设计过的界面。
				 * 这里不用 `surface === "skeleton"`：那一支在有 sessionId 时仍然交给 `RetainedViews`。
				 */
				<EmptyState />
			) : (
				<RetainedViews
					active={sessionId}
					limit={3}
					pageClassName=""
					render={(id) => (
						<SessionScope.Provider value={id}>
							<Conversation sessionId={id} />
						</SessionScope.Provider>
					)}
				/>
			)}
		</div>
	);
	return (
		<SessionScope.Provider value={sessionId}>
			<DockView
				scope={paneKey(sessionId)}
				insets={{ start: inset, end: insetEnd }}
				header={(room: ScreenInsets) => <SplitChrome sessionId={sessionId} screen={screen} inset={room.start} insetEnd={room.end} />}
			>
				{body}
			</DockView>
		</SessionScope.Provider>
	);
});

export const SplitPane = memo(function SplitPane({
	pane,
	count,
	focused,
	inset,
	insetEnd,
}: {
	pane: PaneBox;
	count: number;
	focused: boolean;
	/** Room for the traffic lights and the sidebar toggle, when this screen holds the window's top-left. */
	inset: number;
	/** Room for the caption buttons Windows and Linux draw at the top-right. */
	insetEnd: number;
}) {
	const key = paneKey(pane.sessionId);
	const screen = count > 1;

	return (
		<section
			data-ly-split-pane={key}
			data-ly-split-focused={focused ? "" : undefined}
			onPointerDown={() => focusPane(pane.sessionId)}
			style={{
				left: pct(pane.left),
				top: pct(pane.top),
				width: pct(pane.width),
				height: pct(pane.height),
			}}
			className={`ly-freeze absolute flex min-h-0 min-w-0 flex-col overflow-hidden contain-layout contain-paint ${
				screen ? "bg-shell" : ""
			} ${pane.left > 0.001 ? "border-l border-line" : ""} ${pane.top > 0.001 ? "border-t border-line" : ""}`}
		>
			<SplitScreen sessionId={pane.sessionId} screen={screen} inset={inset} insetEnd={insetEnd} />
		</section>
	);
});
