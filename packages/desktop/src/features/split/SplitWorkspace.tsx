import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useApp } from "../../store/index.ts";
import { useLayout } from "../../app/layout.tsx";
import { bridge } from "../../services/index.ts";
import { startInset, useBoxSize, provideReveal, provideScope, usePaneDock } from "../dock/index.ts";
import { canSplit, contains, firstSession, leafCount, nodeAt, sessionIds } from "./tree.ts";
import { warmSession } from "./warm.ts";
import { isOriginPane, isTopEndPane, layoutPanes, layoutSplitters } from "./layout.ts";
import { canSplitSide, fitSplitTree, resizeFloors, subtreeMinPx } from "./geometry.ts";
import { paneAtShare, panePixels, rememberSplitRoot } from "./hit.ts";
import { useSplit } from "./store.ts";
import { useSplitOverlay } from "./overlay.ts";
import { assignPaneKeys, paneKey, type PaneIdentity } from "./pane-key.ts";
import { SplitPane } from "./SplitPane.tsx";
import { SplitOverlay } from "./SplitOverlay.tsx";
import { Splitter } from "./Splitter.tsx";
import { sidesByDistance } from "./drop.ts";
import { dropOnPane, moveOnto, resetSplit, revealInWorkspace } from "./actions.ts";
import {
	cancelSessionDrag,
	dropSessionDrag,
	moveSessionDrag,
	sessionDragLive,
	setSplitDropper,
} from "./session-drag.ts";

/**
 * The conversations this window is showing, tiled — one to four screens.
 *
 * Each screen is one conversation and the panels it owns, drawn by that conversation's own dock
 * (`DockView`). One screen is simply a split of one: the same title bar, the same dock, the same
 * rules, so nothing changes shape when a second conversation arrives or the last but one leaves.
 * Panels never enter this tree and never sit at the window level — they belong to a conversation
 * and move with it. See `docs/adr/0023-containers-belong-to-sessions.md`.
 */
/*
 * 告诉 dock：「人此刻在哪一屏」和「把这个会话请上屏」这两个问题该问谁。
 *
 * 写在模块顶层而不是组件里——它是一次性的接线，不该跟着渲染跑。没有工作区的窗口（会话窗口、
 * 面板窗口）根本不加载这个文件，于是 dock 那边的默认答案 null 正好是它们的正确答案。
 *
 * 焦点那一屏按「它现在在不在树上」校一遍：`focused` 可能还指着刚关掉的一屏，那时答案是还在屏上
 * 的第一屏，而不是一把没有屏的钥匙——面板开进一个画不出来的地方，就是开了个寂寞。
 */
provideScope(() => {
	const { tree, focused } = useSplit.getState();
	const keys = layoutPanes(tree).map((pane) => paneKey(pane.sessionId));
	const wanted = paneKey(focused ?? useApp.getState().activeSessionId);
	return keys.includes(wanted) ? wanted : (keys[0] ?? null);
});
provideReveal((scope) => revealInWorkspace(scope));

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
	const viewport = useRef<HTMLDivElement>(null);
	const size = useBoxSize(root);
	/*
	 * A window too narrow for its screens keeps every one of them.
	 *
	 * It used to move the unfocused conversation into a window of its own — and before that it
	 * popped each of that screen's panels into windows of their own, one native window each — the
	 * moment two screens needed more width than the workspace had. Two screens ask for 840px, so
	 * an ordinary resize was enough. `fitSplitTree` already squeezes to the floors.
	 */

	const windowId = bridge.bootWindow?.id ?? "primary";
	const project = workspace?.path ?? "";

	useEffect(() => {
		const existing = new Set(useApp.getState().sessions.map((session) => session.id));
		hydrate(windowId, existing, project);
		/*
		 * 恢复出来的那一屏，也要让应用知道它就是「当前会话」。
		 *
		 * `hydrate` 只接了一个方向：树是空的而 `activeSessionId` 有值时，把那个会话填进树。
		 * 反过来——树里有会话、而 `activeSessionId` 还空着——正是刷新之后的常态，却没人接。
		 *
		 * 转录照样显示，所以这件事很不容易被发现：每一屏走的是 `SessionScope`，读的是树里的
		 * id，不问 `activeSessionId`。可输入框、快捷键和只属于当前会话的那些实时状态（运行中的
		 * 这一轮、子代理名单）认的都是它，刷新之后它们对着的是一个空会话。
		 *
		 * 面板布局从前也按它存取，刷新后读的是一把空钥匙，开好的浏览器、终端一次也恢复不了。
		 * 那一层已经没有了——每一屏按自己的会话读布局，见 ADR-0023。
		 */
		const restored = useSplit.getState().focused ?? firstSession(useSplit.getState().tree);
		if (restored && !useApp.getState().activeSessionId) void useApp.getState().openSessionById(restored);
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
		/*
		 * Escape abandons a carry, all of it.
		 *
		 * The sidebar's reorder hook answers Escape too and marks it handled, which used to leave this
		 * half running: the chip vanished, the frost stayed, and letting go still split the screen.
		 * Whoever answered first, a carry in flight ends here.
		 */
		const onKey = (event: KeyboardEvent) => {
			if (event.key !== "Escape" || !sessionDragLive()) return;
			event.preventDefault();
			cancelSessionDrag();
		};
		window.addEventListener("pointermove", onMove, true);
		window.addEventListener("pointerup", onUp);
		window.addEventListener("pointercancel", onCancel);
		window.addEventListener("blur", onCancel);
		window.addEventListener("keydown", onKey, true);
		return () => {
			window.removeEventListener("pointermove", onMove, true);
			window.removeEventListener("pointerup", onUp);
			window.removeEventListener("pointercancel", onCancel);
			window.removeEventListener("blur", onCancel);
			window.removeEventListener("keydown", onKey, true);
		};
	}, []);

	useEffect(() => {
		/*
		 * What letting go at (x, y) would do — shown while moving, done on release. One function for
		 * both, so the preview is never a promise the release does not keep.
		 *
		 * The target is a whole screen: its transcript, its title bar and the panels beside them.
		 */
		setSplitDropper((sessionId, x, y, phase) => {
			const overlay = useSplitOverlay.getState();
			const rootBox = rememberSplitRoot(root.current);
			// Put away behind the plugin catalogue or the like (see `Workspace` in `App.tsx`), it is
			// still mounted — and a drop nobody can see land would rearrange it behind their back.
			if (!rootBox || root.current?.closest("[inert]")) {
				overlay.clear();
				return false;
			}
			const live = useSplit.getState().tree;
			const pane = paneAtShare(layoutPanes(fitSplitTree(live, rootBox)), rootBox, x, y);
			if (!pane) {
				overlay.clear();
				return false;
			}
			const target = pane.sessionId;
			const targetKey = paneKey(target);
			const onScreen = contains(live, sessionId);
			// A conversation dropped onto its own screen is already where it was put.
			if (onScreen && target === sessionId) {
				overlay.clear();
				return false;
			}
			const box = panePixels(pane, rootBox);
			const sides = sidesByDistance(box, x, y);
			if (sides.length === 0) {
				overlay.clear();
				return false;
			}
			// Four screens is the most a window shows: a fifth replaces the one under the pointer.
			if (!onScreen && !canSplit(live)) {
				if (phase === "move") {
					overlay.show(targetKey, "replace", sides[0]);
					return false;
				}
				return dropOnPane(sessionId, target, sides[0]);
			}
			// The nearest edge that can take a readable half, not merely the nearest edge.
			const side = sides.find((candidate) => canSplitSide(box.width, box.height, candidate)) ?? null;
			if (!side) {
				if (phase === "move") overlay.show(targetKey, "full", null);
				else overlay.clear();
				return false;
			}
			if (phase === "move") {
				overlay.show(targetKey, onScreen ? "move" : "split", side);
				return false;
			}
			return onScreen ? moveOnto(sessionId, target, side) : dropOnPane(sessionId, target, side);
		});
		return () => setSplitDropper(null);
	}, []);

	const minimum = { width: subtreeMinPx(tree, "row"), height: subtreeMinPx(tree, "col") };
	const fitted = useMemo(() => size ? fitSplitTree(tree, size) : tree, [tree, size]);
	const panes = useMemo(() => layoutPanes(fitted), [fitted]);
	const identities = useRef<PaneIdentity[]>([]);
	identities.current = assignPaneKeys(identities.current, panes.map((pane) => pane.sessionId));
	const mountedPanes = [...panes].sort((a, b) => {
		const keyOf = (id: string | null) => identities.current.find((slot) => slot.sessionId === id)?.key ?? 0;
		return keyOf(a.sessionId) - keyOf(b.sessionId);
	});
	const handles = useMemo(() => layoutSplitters(fitted), [fitted]);
	const count = panes.length;
	/*
	 * Which screen's browser keeps the pages nobody else is showing: the one that has been on screen
	 * longest. Stable across a conversation switching in and out of a screen, so a page does not
	 * reload because the conversation beside it changed — see `useBrowserPages`.
	 */
	const hostKey = identities.current.reduce<PaneIdentity | null>((oldest, slot) => (!oldest || slot.key < oldest.key ? slot : oldest), null);
	const host = hostKey ? paneKey(hostKey.sessionId) : null;
	useEffect(() => {
		usePaneDock.getState().setHost(host);
	}, [host]);
	const focusedId = focused ?? activeSessionId;
	const { navOpen, headerBar, titlebar } = useLayout();
	const cornerInset = startInset({ headerBar, navOpen, start: titlebar.start });
	const endInset = headerBar || titlebar.end === 0 ? 0 : titlebar.end;

	return (
		<div ref={viewport} data-ly-split-viewport className="relative flex min-h-0 min-w-0 flex-1 overflow-auto">
		<div
			ref={(node) => {
				root.current = node;
			}}
			data-ly-split-root
			data-ly-split-count={count}
			style={count > 1 ? { minWidth: minimum.width, minHeight: minimum.height } : undefined}
			className="relative min-h-0 flex-1"
		>
			{mountedPanes.map((pane) => (
				<SplitPane
					key={identities.current.find((slot) => slot.sessionId === pane.sessionId)?.key}
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
			<SplitOverlay panes={panes} />
		</div>
		</div>
	);
}
