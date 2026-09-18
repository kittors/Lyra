import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useApp } from "../../store/index.ts";
import { useLayout } from "../../app/layout.tsx";
import { toolbarReserved } from "../../app/window/WindowControls.tsx";
import { bridge } from "../../services/index.ts";
import { useBoxSize } from "../dock/index.ts";
import { canSplit, contains, firstSession, leafCount, nodeAt, sessionIds } from "./tree.ts";
import { warmSession } from "./warm.ts";
import { isOriginPane, isTopEndPane, layoutPanes, layoutSplitters } from "./layout.ts";
import { canSplitSide, resizeFloors } from "./geometry.ts";
import { paneAtShare, panePixels, rememberSplitRoot } from "./hit.ts";
import { useSplit } from "./store.ts";
import { useSplitOverlay } from "./overlay.ts";
import { paneKey } from "./pane-key.ts";
import { SplitPane } from "./SplitPane.tsx";
import { SplitOverlay } from "./SplitOverlay.tsx";
import { Splitter } from "./Splitter.tsx";
import { sideOf } from "./drop.ts";
import { dropAlreadyOpen, dropOnPane, resetSplit } from "./actions.ts";
import {
	cancelSessionDrag,
	dropSessionDrag,
	moveSessionDrag,
	setSplitDropper,
} from "./session-drag.ts";

/**
 * The conversations this window is showing, tiled.
 *
 * Lives in the dock's conversation slot. One screen is today's layout; two to four are
 * independent chats, each with its own title bar. The dock still has exactly one conversation
 * leaf — its shared chrome turns off once there is more than one screen, so that bar does not
 * sit above four titles as a fifth strip.
 *
 * Tool panes never enter this tree. A panel opened from a tile belongs to that
 * tile's dock. A panel already on the window dock stays there. The tile title bar
 * is painted on the conversation slot, so it cannot sit empty over a panel.
 */
export function SplitWorkspace() {
	const tree = useSplit((s) => s.tree);
	const focused = useSplit((s) => s.focused);
	const hydrate = useSplit((s) => s.hydrate);
	const forgetMissing = useSplit((s) => s.forgetMissing);
	const resize = useSplit((s) => s.resize);
	const even = useSplit((s) => s.even);
	const activeSessionId = useApp((s) => s.activeSessionId);
	const workspace = useApp((s) => s.workspace);
	const sessions = useApp((s) => s.sessions);
	const root = useRef<HTMLElement | null>(null);
	const size = useBoxSize(root);

	const windowId = bridge.bootWindow?.id ?? "primary";
	const project = workspace?.path ?? "";

	useEffect(() => {
		const existing = new Set(useApp.getState().sessions.map((session) => session.id));
		hydrate(windowId, existing, project);
	}, [hydrate, windowId, project]);

	useEffect(() => {
		/*
		 * Sessions from every project, plus anything already warmed into this window.
		 * The sidebar list is all conversations; a tile from another repository is still
		 * in that list. Cache keys cover the moment a just-opened foreign chat is on
		 * screen before the next `list()` lands.
		 */
		const existing = new Set(sessions.map((session) => session.id));
		for (const id of Object.keys(useApp.getState().sessionCache)) existing.add(id);
		forgetMissing(existing);
	}, [sessions, forgetMissing]);

	useEffect(() => {
		const boot = bridge.bootWindow?.sessionId;
		if (!boot) return;
		void useApp.getState().openSessionById(boot);
	}, []);

	const tiledKey = sessionIds(tree).join("\n");
	useEffect(() => {
		for (const id of tiledKey.split("\n")) {
			if (!id || id === activeSessionId) continue;
			const meta = sessions.find((session) => session.id === id);
			if (meta) void warmSession(meta);
		}
	}, [tiledKey, sessions, activeSessionId]);

	const previousSession = useRef(activeSessionId);
	useLayoutEffect(() => {
		/*
		 * Leaving a conversation for a blank one is 新对话. That is a statement that the next
		 * thing typed belongs alone on the screen. Booting with `activeSessionId === null`
		 * is not the same fact — a saved tiling would be thrown away before the list arrived.
		 */
		if (previousSession.current && activeSessionId === null) resetSplit(null);
		previousSession.current = activeSessionId;
		if (!activeSessionId) return;
		const split = useSplit.getState();
		if (contains(split.tree, activeSessionId)) {
			if (split.focused !== activeSessionId) split.focus(activeSessionId);
			return;
		}
		if (leafCount(split.tree) === 1 && firstSession(split.tree) === null) {
			split.reset(activeSessionId);
			return;
		}
		split.show(activeSessionId);
	}, [activeSessionId]);

	useEffect(() => {
		const onMove = (event: PointerEvent) => moveSessionDrag(event);
		const onUp = (event: PointerEvent) => {
			dropSessionDrag(event);
		};
		const onCancel = () => cancelSessionDrag();
		window.addEventListener("pointermove", onMove, true);
		window.addEventListener("pointerup", onUp);
		window.addEventListener("pointercancel", onCancel);
		window.addEventListener("blur", onCancel);
		return () => {
			window.removeEventListener("pointermove", onMove, true);
			window.removeEventListener("pointerup", onUp);
			window.removeEventListener("pointercancel", onCancel);
			window.removeEventListener("blur", onCancel);
		};
	}, []);

	useEffect(() => {
		setSplitDropper((sessionId, x, y, phase) => {
			const rootBox = rememberSplitRoot(root.current);
			if (!rootBox) {
				useSplitOverlay.getState().clear();
				return false;
			}
			const live = useSplit.getState().tree;
			const pane = paneAtShare(layoutPanes(live), rootBox, x, y);
			if (!pane) {
				useSplitOverlay.getState().clear();
				return false;
			}
			const targetKey = paneKey(pane.sessionId);
			const target = pane.sessionId;
			if (contains(live, sessionId)) {
				useSplitOverlay.getState().clear();
				if (phase === "move" || !bridge.windows) return false;
				return dropAlreadyOpen(sessionId);
			}
			const box = panePixels(pane, rootBox);
			const side = sideOf(box, x, y);
			if (!side) {
				useSplitOverlay.getState().clear();
				return false;
			}
			if (!canSplit(live)) {
				if (phase === "move") {
					useSplitOverlay.getState().show(targetKey, "replace", side);
					return false;
				}
				return dropOnPane(sessionId, target, side);
			}
			if (!canSplitSide(box.width, box.height, side)) {
				useSplitOverlay.getState().clear();
				return false;
			}
			if (phase === "move") {
				useSplitOverlay.getState().show(targetKey, "split", side);
				return false;
			}
			return dropOnPane(sessionId, target, side);
		});
		return () => setSplitDropper(null);
	}, []);

	const panes = useMemo(() => layoutPanes(tree), [tree]);
	const handles = useMemo(() => layoutSplitters(tree), [tree]);
	const count = panes.length;
	const focusedId = focused ?? activeSessionId;
	const { navOpen, headerBar, titlebar } = useLayout();
	const cornerInset = !headerBar && !navOpen ? toolbarReserved(titlebar.start) - 11 : 0;
	const endInset = headerBar || titlebar.end === 0 ? 0 : titlebar.end;

	return (
		<div
			ref={(node) => {
				root.current = node;
			}}
			data-ly-split-root
			data-ly-split-count={count}
			className="relative min-h-0 flex-1"
		>
			{panes.map((pane) => (
				<SplitPane
					key={paneKey(pane.sessionId)}
					pane={pane}
					count={count}
					focused={pane.sessionId === focusedId || (pane.sessionId === null && !focusedId)}
					inset={isOriginPane(pane) ? cornerInset : 0}
					insetEnd={isTopEndPane(pane) ? endInset : 0}
				/>
			))}
			{handles.map((handle) => (
				<Splitter
					key={`${handle.path.join(".")}:${handle.index}`}
					handle={handle}
					containerRef={root}
					onResize={(share) => {
						const node = nodeAt(tree, handle.path);
						const span = size && node?.type === "split"
							? handle.dir === "row"
								? handle.split.width * size.width
								: handle.split.height * size.height
							: 0;
						resize(handle.path, handle.index, share, node?.type === "split" && span > 0 ? resizeFloors(node, handle.index, span) : undefined);
					}}
					onEven={() => {
						const node = nodeAt(tree, handle.path);
						const span = size && node?.type === "split"
							? handle.dir === "row"
								? handle.split.width * size.width
								: handle.split.height * size.height
							: 0;
						even(handle.path, handle.index, node?.type === "split" && span > 0 ? resizeFloors(node, handle.index, span) : undefined);
					}}
				/>
			))}
			<SplitOverlay />
		</div>
	);
}
