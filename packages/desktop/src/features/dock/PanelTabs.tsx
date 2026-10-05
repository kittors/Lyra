/**
 * 标签页排法下，右侧那一栏顶上的标签条：每个开着的面板一个标签。
 *
 * 每个面板的 pane 各画一份，只有当前那个看得见——后台标签的 pane 是隐藏着的，它们的标签条也跟着
 * 隐藏。于是标签条不用自己挂在哪儿，切标签也就是换一个 pane 显示。
 *
 * 和终端的子标签用同一个 `ClosableTab` 与 `Sideways`：同一种东西在同一个窗口里只长一个样子。
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

/** 「+」菜单里的一项：能开、还没开的面板。 */
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
	/** 这一份标签条所在的 pane，也就是它显示出来时的当前标签。 */
	current: PaneKind;
}) {
	const strip = useRef<HTMLDivElement>(null);
	const menu = usePopover();

	// 新开的标签排在最后，可能在右边界外面；让当前那个待在视野里。
	useEffect(() => {
		strip.current?.querySelector(`[data-panel-tab="${current}"]`)?.scrollIntoView({ block: "nearest", inline: "nearest" });
	}, [current, tabs.length]);

	return (
		<div className="no-drag flex min-w-0 flex-1 items-center gap-0.5">
			{/* 不占满：「+」紧跟在最后一个标签后面，标签多到放不下时条被压窄，「+」停在右端。 */}
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

			{/* 在滚动条外面：「再开一个」不能是那个被滚出视野的东西。全都开着时没有可加的，就不画。 */}
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
