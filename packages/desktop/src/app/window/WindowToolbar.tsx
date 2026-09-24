/**
 * The window's top edge: what drags it, and the buttons that float over everything.
 *
 * All three parts are here because their order in the DOM is the whole point. Electron builds the
 * draggable region by walking the document in order, so a `drag` element after a `no-drag` one
 * fills the hole back in — which is why these are rendered last in the shell, and why the band and
 * the buttons are separate elements rather than one.
 */

import { translate } from "../../i18n/translate.ts";
import { useI18n } from "../../i18n/index.ts";
import { Check, MoreVertical } from "lucide-react";
import { emptyDockTree, has, toggleScopedPanel, usePaneDock, usePanelDefinitions } from "../../features/dock/index.ts";
import type { PanelKind } from "../../features/dock/index.ts";
import { useLayout } from "../layout.tsx";
import { MenuBody, MenuItem, MenuLabel, Popover, usePopover } from "../../ui/overlay/Popover.tsx";
import { TOOLBAR_BUTTON, ToolbarButton, WindowControls } from "./WindowControls.tsx";
import { NATIVE_HEADER_HEIGHT, WINDOW_HEADER_HEIGHT } from "../../../shared/window-chrome.ts";
import { onPhone } from "../../services/host.ts";

/*
 * The update chip used to have a slot of its own here, just past the sidebar toggle.
 *
 * It has moved to the end of the sidebar's bottom row, where it is a dot that opens on hover.
 * Nothing about the toolbar was wrong for it except the size of the claim: the corner of the
 * window is where the window's own controls are, and a version number is not one of them.
 */

/**
 * The strip of window that can be dragged to move it.
 *
 * As wide as the navigation and no wider, which is a change: it used to span the window. The dock
 * now reaches the top edge, and every pane's title bar is up there — a full-width band would claim
 * all of them, so pressing a pane's title would move the window instead of the pane.
 *
 * With the navigation closed it shrinks to the corner the traffic lights need, which is the only
 * part of that row that is still the window's rather than a pane's.
 */
export function DragBand({ navOpen, sidebarWidth }: { navOpen: boolean; sidebarWidth: number }) {
	const { titlebar } = useLayout();
	return (
		<div
			className="drag-region absolute top-0 left-0 z-40"
			/*
			 * Closed, this is only the corner the system's own controls need — which is the traffic
			 * lights on macOS and nothing at all elsewhere, where they are at the other end. The
			 * toggle beside them is `no-drag`, so a band the width of the button alone would leave
			 * no draggable pixels; a little more than the toggle's own start is what makes the
			 * corner grabbable without claiming the pane title next to it.
			 */
			style={{ height: WINDOW_HEADER_HEIGHT, width: navOpen ? sidebarWidth : titlebar.start + TOOLBAR_BUTTON }}
		/>
	);
}

/**
 * Windows 和 Linux 的那条 header：横贯窗口顶端，两头各归其主。
 *
 * macOS 没有这个组件，那里走的是上面的 `DragBand` + 浮在角上的 `WindowButtons`——红绿灯在左上
 * 角，面板的第一行就是窗口的顶行，一行当两行用。理由和这条带子存在的理由都写在 `hasHeaderBar`。
 *
 * 这里的排布只有一件事：左端 `titlebar.start` 处放侧边栏开关，右端空出 `titlebar.end` 给系统的
 * 最小化/最大化/关闭。中间整片都是拖拽区，开关那一小块是 `no-drag` 挖出来的洞——DOM 顺序在这里
 * 仍然是规矩，洞必须写在带子后面，否则会被重新盖上。
 *
 * 左上角跟着窗口圆角走。Windows 11 自己会把窗口裁成圆角，一条方角的带子压在那个圆里，转角处会
 * 透出窗口的底色——一个不属于任何界面元素的深色小三角。
 */
export function WindowHeader({
	navOpen,
	compact,
	onToggleNav,
	children,
}: {
	navOpen: boolean;
	compact: boolean;
	onToggleNav: () => void;
	/**
	 * 左端放什么，默认是工作区那个侧边栏开关。
	 *
	 * 设置页要传自己的：那里的开关开合的是章节列表而不是会话列表，两者的说明文字不是同一句话，
	 * 而屏幕朗读器读到的就是这句话。图标是同一个，因为做的是同一件事。
	 */
	children?: React.ReactNode;
}) {
	const { titlebar } = useLayout();
	return (
		<div
			data-ly-window-header
			className="drag-region ly-window-header relative z-40 flex shrink-0 items-center"
			/*
			 * 这个组件只在 `headerBar` 那条分支里渲染（见 `App.tsx`），也就是只在 Windows 和
			 * Linux 上——所以高度直接取原生那一档，不必再判一次平台。它和
			 * `titleBarOverlay.height` 是同一个常量，带子和系统按钮因此不会错开。
			 */
			style={{ height: NATIVE_HEADER_HEIGHT, paddingLeft: titlebar.start, paddingRight: titlebar.end }}
		>
			<div className="no-drag flex items-center gap-0.5">
				{children ?? <WindowControls navOpen={navOpen} onToggleNav={onToggleNav} active={compact && navOpen} />}
			</div>
		</div>
	);
}

/**
 * The panels that get a button of their own, in the order they sit in.
 *
 * A shortlist, not the whole registry. These are the three you reach for while working — a shell,
 * a page, the diff — and reaching for them through two clicks of a menu is two clicks too many.
 * Everything else, including anything a plugin contributes, is in the menu beside them, which is
 * also where these three appear when they cannot be opened.
 */
const QUICK: PanelKind[] = ["terminal", "browser", "review"];

/**
 * Which panels this conversation has open: three buttons and a menu.
 *
 * Rendered *inside the conversation's own title bar* rather than in a toolbar of its own. A toolbar
 * cost a whole row of the window and put these buttons on a different line from the pane titles
 * they act on — two strips where the reference has one.
 *
 * Always one screen's: `scope` is the conversation whose title bar this is, and every button opens,
 * closes and reports on that conversation's panels. There is no window-wide set of panels for a
 * button to be about.
 */
export function PanelMenu({ scope, extras }: { scope: string; extras?: (onClose: () => void) => React.ReactNode }) {
	const { t } = useI18n();
	const menu = usePopover();
	const definitions = usePanelDefinitions();
	const phone = onPhone();
	const { compact } = useLayout();
	const tree = usePaneDock((s) => s.trees[scope] ?? emptyDockTree);
	const toggle = (kind: PanelKind) => toggleScopedPanel(scope, kind, { compact });
	const open = (kind: PanelKind) => void usePaneDock.getState().open(scope, kind);
	const close = (kind: PanelKind) => usePaneDock.getState().close(scope, kind);

	return (
		<>
			<div className="flex items-center gap-0.5">
				<span data-ly-panel-quick className="contents">
				{(phone ? (["tasks", "chat"] as PanelKind[]) : QUICK).map((kind) => {
					const def = definitions.find((entry) => entry.kind === kind);
					// Absent rather than disabled when it cannot be opened: a row of greyed buttons
					// is a row of things you have to read before you can ignore them. The menu still
					// lists them, with the reason.
					if (!def || def.unavailable) return null;
					return (
						<ToolbarButton
							key={kind}
							label={phone ? t(def.label) : `${t(def.label)} ${def.shortcut}`}
							active={has(tree, kind)}
							onClick={() => toggle(kind)}
						>
							<def.icon size={13} strokeWidth={1.9} />
						</ToolbarButton>
					);
				})}
				</span>

				{/* The overflow mark every toolbar uses for "the rest of it". */}
				<ToolbarButton label={translate("toolbar.panels")} onClick={menu.toggle} active={menu.open}>
					<MoreVertical size={15} strokeWidth={2} />
				</ToolbarButton>
			</div>

			{menu.open && (
				<Popover anchor={menu.anchor} onClose={menu.close} placement="bottom" align="end" width="default">
					<MenuBody>
						<MenuLabel>{t("toolbar.panels")}</MenuLabel>
						{/*
						 * Absent, not greyed.
						 *
						 * The list used to show everything and disable what could not be opened, on the
						 * reasoning that a stated reason beats an unexplained gap. In practice it is four
						 * grey rows out of eight — a menu where half the items are things you have to
						 * read before you can ignore them, every time you open it. What a panel needs in
						 * order to exist is not something to be told each time; it is obvious the moment
						 * you have a project open, because the panel is simply there.
						 */}
						{definitions
							.filter((def) => !def.unavailable && def.listed !== false)
							.map((def) => {
							const shown = has(tree, def.kind);
							return (
								<MenuItem
									key={def.kind}
									icon={<def.icon size={16} strokeWidth={1.7} />}
									hint={phone ? undefined : def.shortcut}
									// A tick, not a highlight: this is a set of things that are either
									// in the window or not, and every row is independently either.
									trailing={shown ? <Check size={13} strokeWidth={2.2} className="shrink-0 text-ink" /> : undefined}
									onClick={() => {
										if (shown) close(def.kind);
										else open(def.kind);
										menu.close();
									}}
								>
									{t(def.label)}
								</MenuItem>
							);
						})}
						{extras?.(menu.close)}
					</MenuBody>
				</Popover>
			)}
		</>
	);
}

/**
 * The window's own controls: the traffic lights' neighbour, and nothing else.
 *
 * Unconditional now. This used to be rendered only when no panel was covering the window's corner,
 * because in that case the panel drew its own copy inside its tab strip — a handover that had to
 * be delayed by exactly the length of the panel's slide, or the buttons appeared riding its edge
 * and swept 450px across the window. The dock puts every pane below the toolbar, so the corner is
 * the sidebar's or the toolbar's and never changes hands.
 */
export function WindowButtons({
	navOpen,
	compact,
	onToggleNav,
}: {
	navOpen: boolean;
	compact: boolean;
	onToggleNav: () => void;
}) {
	const { titlebar } = useLayout();
	return (
		<div
			className="no-drag absolute top-0 z-[60] flex items-center gap-0.5"
			/*
			 * Past whatever the system drew in this corner: the traffic lights on macOS, nothing on
			 * Windows and Linux — where this used to sit 78px in anyway, out of line with the marks
			 * directly below it and adrift from the edge. `useTitlebar` is the whole rule.
			 */
			style={{ left: titlebar.start, height: WINDOW_HEADER_HEIGHT }}
		>
			<WindowControls navOpen={navOpen} onToggleNav={onToggleNav} active={compact && navOpen} />
		</div>
	);
}
