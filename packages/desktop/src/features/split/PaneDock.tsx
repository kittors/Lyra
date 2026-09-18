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
	DockSplitter,
	dockPct,
	emptyDockTree,
	fitTree,
	layoutPanes,
	layoutSplitters,
	paneFloor,
	popOutPanel,
	renderPanel,
	renderPanelActions,
	renderPanelHeader,
	useBoxSize,
	useDockDrag,
	usePaneDock,
	usePanelDefinitions,
	type DockDragHost,
	type PanelKind,
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
	const definitions = usePanelDefinitions();
	const container = useRef<HTMLDivElement>(null);
	const size = useBoxSize(container);
	const host = useMemo<DockDragHost>(
		() => ({
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

	useLayoutEffect(() => {
		if (size) usePaneDock.getState().rememberSize(scope, size);
	}, [scope, size]);

	useEffect(() => () => usePaneDock.getState().forget(scope), [scope]);

	if (tree.type === "leaf") {
		return (
			<div ref={container} data-ly-pane-dock={scope} className="relative flex min-h-0 flex-1 flex-col">
				{chrome}
				{children}
			</div>
		);
	}

	const fitted = size ? fitTree(tree, size, paneFloor) : tree;
	const boxes = layoutPanes(fitted);
	const handles = layoutSplitters(fitted);
	const present = boxes.map((box) => box.kind);
	const live = carried && !present.includes(carried.kind) ? [...present, carried.kind] : present;

	return (
		<div ref={container} data-ly-pane-dock={scope} className="relative min-h-0 flex-1">
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
			{live.map((kind) => {
				if (kind === "conversation") {
					const box = boxes.find((entry) => entry.kind === "conversation");
					if (!box) return null;
					return (
						<div
							key="conversation"
							data-ly-pane-slot="conversation"
							className="absolute flex min-h-0 min-w-0 flex-col overflow-hidden"
							style={{
								left: dockPct(box.left),
								top: dockPct(box.top),
								width: dockPct(box.width),
								height: dockPct(box.height),
							}}
						>
							{chrome}
							{children}
						</div>
					);
				}
				const placed = boxes.find((entry) => entry.kind === kind);
				if (!placed && carried?.kind !== kind) return null;
				const def = definitions.find((entry) => entry.kind === kind);
				const box = placed ?? { left: 0, top: 0, width: 1, height: 1 };
				return (
					<DockPane
						key={kind}
						kind={kind}
						box={box}
						label={def ? translate(def.label) : kind}
						icon={def ? <def.icon size={12.5} strokeWidth={1.8} /> : undefined}
						maximized={false}
						carried={carried?.kind === kind ? carried.rect : null}
						landing={carried?.kind === kind && carried.landing}
						hidden={!placed && carried?.kind !== kind}
						draggable={live.length > 1}
						onDragStart={(event) => start(kind, event)}
						onMove={(side) => usePaneDock.getState().moveTo(scope, kind, { side, kind: null })}
						actions={renderPanelActions(kind)}
						title={renderPanelHeader(kind)}
						onClose={() => usePaneDock.getState().close(scope, kind)}
						onPopOut={() =>
							void popOutPanel({
								dock: "pane",
								scope,
								kind: kind as PanelKind,
								sessionId: scope === "@draft" ? null : scope,
							})
						}
						onFocus={() => {}}
						onLanded={landed}
					>
						{renderPanel(kind)}
					</DockPane>
				);
			})}
		</div>
	);
}
