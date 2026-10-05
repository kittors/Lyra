/**
 * The tab strip along the top of the right-hand column in the tabs layout: one tab per open panel.
 *
 * Every panel's pane draws a copy of its own, and only the current one is visible — background tabs'
 * panes are hidden, and their strips with them. So the strip needs no home of its own, and switching
 * tabs is just showing another pane.
 *
 * Built from the same `ClosableTab` and `Sideways` as the terminal's sub-tabs: one kind of thing has
 * one look within a window.
 */

import { Plus } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { translate } from "../../i18n/translate.ts";
import { MenuBody, MenuItem, MenuLabel, Popover, usePopover } from "../../ui/overlay/Popover.tsx";
import { ClosableTab } from "../../ui/primitives/ClosableTab.tsx";
import { IconButton } from "../../ui/primitives/IconButton.tsx";
import { Sideways } from "../../ui/scroll/Sideways.tsx";
import { usePaneDock } from "./pane-store.ts";
import type { PaneKind } from "./tree.ts";

export interface PanelTab {
	kind: PaneKind;
	label: string;
	icon?: ReactNode;
}

/** An entry in the "+" menu: a panel that can be opened and is not open yet. */
export interface AddablePanel extends PanelTab {
	shortcut: string;
}

export function PanelTabs({
	scope,
	tabs,
	addable,
	current,
}: {
	scope: string;
	tabs: PanelTab[];
	addable: AddablePanel[];
	/** The pane this copy of the strip lives in — the current tab whenever this copy is showing. */
	current: PaneKind;
}) {
	const strip = useRef<HTMLDivElement>(null);
	const menu = usePopover();

	// A new tab goes last and may be past the right edge; keep the current one in view.
	useEffect(() => {
		strip.current?.querySelector(`[data-panel-tab="${current}"]`)?.scrollIntoView({ block: "nearest", inline: "nearest" });
	}, [current, tabs.length]);

	return (
		<div className="no-drag flex min-w-0 flex-1 items-center gap-0.5">
			{/* Not full width: "+" follows the last tab; when the tabs no longer fit the strip narrows and "+" stays at the right end. */}
			<Sideways
				trackRef={strip}
				role="tablist"
				aria-label={translate("pane.tabs")}
				className="flex min-w-0 items-center gap-0.5 overflow-x-auto"
			>
				{tabs.map(({ kind, label, icon }) => (
					<ClosableTab
						key={kind}
						data-panel-tab={kind}
						current={kind === current}
						onSelect={() => usePaneDock.getState().focus(scope, kind)}
						onClose={() => usePaneDock.getState().close(scope, kind)}
						closeLabel={translate("pane.closeOne", { label })}
					>
						<span className="flex items-center gap-1.5">
							{icon && <span className="flex shrink-0 items-center">{icon}</span>}
							{label}
						</span>
					</ClosableTab>
				))}
			</Sideways>

			{/* Outside the scroller: "open another" must not be the thing scrolled out of view. With everything open there is nothing to add, so it is not drawn. */}
			{addable.length > 0 && (
				<IconButton size="sm" label={translate("pane.addTab")} onClick={menu.toggle} icon={<Plus size={13} strokeWidth={2} />} />
			)}
			{menu.open && (
				<Popover anchor={menu.anchor} onClose={menu.close} placement="bottom" align="start" width="default">
					<MenuBody>
						<MenuLabel>{translate("toolbar.panels")}</MenuLabel>
						{addable.map((panel) => (
							<MenuItem
								key={panel.kind}
								icon={panel.icon}
								hint={panel.shortcut}
								onClick={() => {
									usePaneDock.getState().open(scope, panel.kind);
									menu.close();
								}}
							>
								{panel.label}
							</MenuItem>
						))}
					</MenuBody>
				</Popover>
			)}
		</div>
	);
}
