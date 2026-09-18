import { memo } from "react";
import { SessionScope } from "../../app/session-scope.tsx";
import { Conversation, ConversationSkeleton, EmptyState } from "../conversation/index.ts";
import { chatSurface } from "../../lib/chat-surface.ts";
import { RetainedViews } from "../../ui/layout/RetainedViews.tsx";
import { useApp } from "../../store/index.ts";
import { pct } from "./layout.ts";
import type { PaneBox } from "./layout.ts";
import { paneKey } from "./pane-key.ts";
import { focusPane } from "./actions.ts";
import { PaneDock } from "./PaneDock.tsx";
import { SplitChrome } from "./SplitChrome.tsx";

/**
 * The conversation of one screen, isolated from the tile's geometry.
 *
 * A handle drag rewrites shares every frame. That has to move this section's box; it must
 * not rebuild the transcript or the composer. Those subscribe here, and this component's
 * props do not change while a boundary moves. Tool panes opened from this screen live in
 * this screen's dock. The title bar is passed into that dock so it covers the transcript
 * only — never the panel sitting beside it.
 */
const SplitScreen = memo(function SplitScreen({
	sessionId,
	screen,
	inset,
	insetEnd,
}: {
	sessionId: string | null;
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
			{screen ? (
				<PaneDock
					scope={paneKey(sessionId)}
					chrome={<SplitChrome sessionId={sessionId} inset={inset} insetEnd={insetEnd} />}
				>
					{body}
				</PaneDock>
			) : (
				body
			)}
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
	inset: number;
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
