/**
 * The dock of one tiled conversation screen.
 *
 * A panel opened from this screen's header lands here, beside this transcript,
 * and can be dragged around this screen with the same move the window dock uses.
 * It does not leave the tile.
 *
 * The tile's title bar is a slot on the conversation, not a strip over the whole
 * tile. Painting it above the dock is what left an empty bar over the browser.
 */

import { useEffect, useLayoutEffect, useMemo, useRef, type ReactNode } from "react";
import { translate } from "../../i18n/translate.ts";
import {
	DockPane,
	PaneGrip,
	DockSplitter,
	detachOf,
	dockPct,
	emptyDockTree,
	fitTree,
	layoutPanes,
	layoutSplitters,
	minimumSpan,
	tilePaneFloor,
	popOutPanel,
	renderPanel,
	renderPanelActions,
	renderPanelHeader,
	useBoxSize,
	useDockDrag,
	usePaneDock,
	usePanelDefinitions,
	type DockDragHost,
	type PaneKind,
} from "../dock/index.ts";

export function PaneDock({
	scope,
	chrome,
	children,
}: {
	scope: string;
	chrome?: ReactNode;
	children: ReactNode;
}) {
	const tree = usePaneDock((state) => state.trees[scope] ?? emptyDockTree);
	const maximized = usePaneDock((state) => state.maximized[scope] ?? null);
	const definitions = usePanelDefinitions();
	const container = useRef<HTMLDivElement>(null);
	const order = useRef<PaneKind[]>([]);
	const size = useBoxSize(container);
	const host = useMemo<DockDragHost>(
		() => ({
			floor: tilePaneFloor,
			preserveAxis: true,
			tree: () => usePaneDock.getState().tree(scope),
			restore: () => {},
			beginDrag: (drag) => usePaneDock.getState().beginDrag(scope, drag),
			preview: (rest, kind, at) => usePaneDock.getState().preview(scope, rest, kind, at),
			dragTo: (pointer, at) => usePaneDock.getState().dragTo(pointer, at),
			endDrag: (cancelled) => usePaneDock.getState().endDrag(cancelled),
			currentDrag: () => {
				const drag = usePaneDock.getState().drag;
				return drag?.scope === scope ? drag : null;
			},
		}),
		[scope],
	);
	const { carried, start, landed } = useDockDrag(container, host);
	// A tile too small for its panels keeps them and draws them squeezed. It used to hand the
	// trailing one to a real window, which a second screen alone was enough to trigger.


	/*
	 * 把这一屏存着的布局读回来。
	 *
	 * 在 layout effect 里做，和窗口 dock 同一个理由：读 localStorage 是同步的，等到普通 effect
	 * 就要先拿默认布局画一帧，面板会明显地「弹」出来一下。
	 *
	 * `allowed` 只有渲染层知道（面板注册表在这里），所以由它递给 store。
	 */
	const allowed = useMemo<PaneKind[]>(
		() => ["conversation", ...definitions.filter((def) => !def.ephemeral).map((def) => def.kind)],
		[definitions],
	);
	useLayoutEffect(() => {
		usePaneDock.getState().hydrate(scope, allowed);
	}, [scope, allowed]);

	useLayoutEffect(() => {
		if (size) usePaneDock.getState().rememberSize(scope, size);
	}, [scope, size]);

	useEffect(() => () => usePaneDock.getState().forget(scope), [scope]);
	useEffect(() => {
		const escape = (event: KeyboardEvent) => {
			if (event.key !== "Escape" || event.defaultPrevented || !maximized) return;
			if (!(event.target instanceof Element) || !container.current?.contains(event.target)) return;
			event.preventDefault();
			usePaneDock.getState().restore(scope);
		};
		window.addEventListener("keydown", escape);
		return () => window.removeEventListener("keydown", escape);
	}, [scope, maximized]);


	// Keep one flat keyed list even when lifting leaves only a single pane behind.
	const minimum = minimumSpan(tree, tilePaneFloor);
	const span = size && tree.type === "split" ? { width: Math.max(size.width, minimum.width), height: Math.max(size.height, minimum.height) } : size;
	const fitted = span ? fitTree(tree, span, tilePaneFloor, true) : tree;
	const storedBoxes = layoutPanes(fitted);
	const boxes = maximized ? [{ kind: maximized, left: 0, top: 0, width: 1, height: 1 }] : storedBoxes;
	const handles = maximized ? [] : layoutSplitters(fitted);
	const present = storedBoxes.map((box) => box.kind);
	const live = [...new Set<PaneKind>(["conversation", ...present, ...(carried ? [carried.kind] : [])])];
	// Reordering an existing webview's ancestors destroys its guest even with a stable React key.
	order.current = [...order.current.filter((kind) => live.includes(kind)), ...live.filter((kind) => !order.current.includes(kind))];

	return (
		<div ref={container} data-ly-pane-dock={scope} className="relative min-h-0 flex-1 overflow-auto">
		<div className="relative h-full w-full" style={tree.type === "split" && !maximized ? { minWidth: minimum.width, minHeight: minimum.height } : undefined}>
			{handles.map((handle) => (
				<DockSplitter
					key={`${handle.path.join(".")}:${handle.index}`}
					handle={handle}
					containerRef={container}
					onResize={(share) => usePaneDock.getState().setShare(scope, handle.path, handle.index, share)}
					onEven={() => usePaneDock.getState().even(scope, handle.path, handle.index)}
				/>
			))}
			{carried && !carried.landing && (() => {
				const target = boxes.find((box) => box.kind === carried.kind);
				if (!target) return null;
				return (
					<div
						aria-hidden
						data-dock-drop
						className="ly-dock-drop pointer-events-none absolute"
						style={{
							left: dockPct(target.left),
							top: dockPct(target.top),
							width: dockPct(target.width),
							height: dockPct(target.height),
						}}
					/>
				);
			})()}
			{order.current.map((kind) => {
				const placed = boxes.find((entry) => entry.kind === kind);
				const def = definitions.find((entry) => entry.kind === kind);
				const box = placed ?? storedBoxes.find((entry) => entry.kind === kind) ?? { left: 0, top: 0, width: 1, height: 1 };
				const conversation = kind === "conversation";
				const label = def ? translate(def.label) : translate("sidebar.chats");
				const moving = carried?.kind === kind;
				const onMove = (side: "left" | "right" | "top" | "bottom") => usePaneDock.getState().moveTo(scope, kind, { side, kind: null });
				const onArrowMove = (side: "left" | "right" | "top" | "bottom") => usePaneDock.getState().moveAlong(scope, kind, side);
				return (
					<DockPane
						key={kind}
						kind={kind}
						chrome={!conversation || Boolean(chrome)}
						box={box}
						label={label}
						icon={def ? <def.icon size={12.5} strokeWidth={1.8} /> : undefined}
						maximized={maximized === kind}
						carried={moving ? carried.rect : null}
						landing={moving && carried.landing}
						hidden={!placed && !moving}
						draggable={live.length > 1}
						onDragStart={(event) => start(kind, event)}
						onMove={onMove}
						onArrowMove={onArrowMove}
						actions={conversation ? undefined : renderPanelActions(kind)}
						title={conversation ? undefined : renderPanelHeader(kind)}
						onClose={conversation ? undefined : () => usePaneDock.getState().close(scope, kind)}
						onToggleMaximized={conversation ? undefined : () => usePaneDock.getState().toggleMaximized(scope, kind)}
						onPopOut={conversation || detachOf(kind) === "none" ? undefined : () => void popOutPanel({ dock: "pane", scope, kind, sessionId: scope === "@draft" ? null : scope })}
						onFocus={() => {}}
						onLanded={landed}
						customHeader={conversation ? <>
							{chrome}
							{live.length > 1 && <PaneGrip kind={kind} label={label} carried={moving} onDragStart={(event) => start(kind, event)} onMove={onMove} onArrowMove={onArrowMove} />}
						</> : undefined}
					>
						{conversation ? children : renderPanel(kind)}
					</DockPane>
				);
			})}
		</div>
		</div>
	);
}
