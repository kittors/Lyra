/**
 * The workspace window's frame: a toolbar across the top, the icon rail down the left, and the
 * sidebar and the content as cards in what is left.
 *
 * After the reference layout. The window's top row used to be shared out: the traffic lights sat on
 * the sidebar, the sidebar toggle floated over the corner, and the conversation's title bar *was* the
 * top row of its card. Now the row belongs to the window — lights, back, forward and the toggle on
 * the left, the open conversation's title over its card — and everything below starts under it, so
 * nothing below has to make room for the window's corners any more (see `framed` in `layout.tsx`).
 *
 * Used by the workspace and by settings alike, so moving between them moves nothing but the content.
 */

import { ArrowLeft, ArrowRight } from "lucide-react";
import { useEffect } from "react";

import { useI18n } from "../../i18n/index.ts";
import { onPhone } from "../../services/index.ts";
import { useLayout, useSidebarFit } from "../layout.tsx";
import { goBack, goForward, useCanStep } from "../nav-history.ts";
import { AppRail, RAIL_WIDTH } from "./AppRail.tsx";
import { TOOLBAR_BUTTON, ToolbarButton, WindowControls } from "./WindowControls.tsx";

export function WindowFrame({
	nav,
	navLabels,
	toolbarTitle,
	toolbarEnd,
	children,
	...rest
}: {
	/** The sidebar, or settings' section list — a `NavPane`. */
	nav: React.ReactNode;
	/** The toggle's names when `nav` is not the sidebar — see `WindowControls`. */
	navLabels?: { hide: string; show: string };
	/** Drawn over the content's card: the open conversation's title, when there is one. */
	toolbarTitle?: React.ReactNode;
	/** At the toolbar's far end: the open conversation's panel buttons. */
	toolbarEnd?: React.ReactNode;
	children: React.ReactNode;
} & Record<`data-${string}`, string | boolean | undefined>) {
	const { rail } = useLayout();
	return (
		<div {...rest} className="ly-shell ly-framed relative flex h-full flex-col overflow-hidden">
			<MainToolbar title={toolbarTitle} end={toolbarEnd} navLabels={navLabels} />
			<div className="ly-window-body relative flex min-h-0 flex-1">
				{rail && <AppRail />}
				{/*
				 * One panel for the sidebar and the content, after the reference: a single rounded edge
				 * round both, and a hairline between them that the toolbar's separator continues upwards.
				 * They used to be two cards with the window showing between them, which made the content
				 * read as a separate thing set down beside the list rather than the other half of it.
				 *
				 * It also clips the sidebar as it slides shut — it slides by a negative margin, and
				 * unclipped it would pass under the rail on its way out.
				 */}
				<div data-ly-frame-panel className={`ly-frame-panel relative flex min-w-0 flex-1 overflow-hidden ${rail ? "" : "ml-1"}`}>
					{nav}
					{children}
				</div>
			</div>
		</div>
	);
}

/**
 * The window's top row.
 *
 * The whole row is the window's drag region; the buttons cut holes in it, which stay open because
 * they come after it in the document (Electron builds the region in document order).
 *
 * The left cluster is as wide as the rail and the sidebar together whenever that is wider than the
 * cluster itself, so the title in the middle starts over the content's card and follows the sidebar
 * as it is dragged, opened and closed.
 */
function MainToolbar({ title, end, navLabels }: { title?: React.ReactNode; end?: React.ReactNode; navLabels?: { hide: string; show: string } }) {
	const { t } = useI18n();
	const { titlebar, toolbarHeight, navOpen, compact, rail, toggleNav } = useLayout();
	const { drawn } = useSidebarFit();
	const canBack = useCanStep(-1);
	const canForward = useCanStep(1);
	// The cluster's own width: the system's corner, three buttons and the gaps between them.
	const cluster = titlebar.start + TOOLBAR_BUTTON * 3 + 2 * 2 + 8;
	const beside = navOpen && !compact;
	const lead = Math.max(cluster, (rail ? RAIL_WIDTH : 0) + (beside ? drawn : 0));

	return (
		<div
			data-ly-main-toolbar
			className="drag-region relative z-40 flex shrink-0 items-center"
			style={{ height: toolbarHeight, paddingRight: titlebar.end }}
		>
			<div
				// Tracks the sidebar's slide, and freezes with it while its edge is dragged.
				className="ly-freeze flex shrink-0 items-center transition-[width] duration-[var(--ly-t-base)] ease-out"
				style={{ width: lead, paddingLeft: titlebar.start }}
			>
				<div className="no-drag flex items-center gap-0.5">
					<ToolbarButton label={`${t("toolbar.back")} ${backKey}`} onClick={() => void goBack()} disabled={!canBack}>
						<ArrowLeft size={15} strokeWidth={1.9} />
					</ToolbarButton>
					<ToolbarButton label={`${t("toolbar.forward")} ${forwardKey}`} onClick={() => void goForward()} disabled={!canForward}>
						<ArrowRight size={15} strokeWidth={1.9} />
					</ToolbarButton>
					<WindowControls navOpen={navOpen} onToggleNav={toggleNav} active={compact && navOpen} labels={navLabels} />
				</div>
			</div>
			<div data-ly-toolbar-middle className="relative flex h-full min-w-0 flex-1 items-center gap-1.5 pl-3.5">
				{/*
				 * A short rule on the line of the sidebar's divider, centred in the toolbar: the title starts
				 * on the content's side of it, as in the reference. Short, not run into the divider below —
				 * joined up, the two read as a wall through the window rather than a mark in the toolbar.
				 * Only while the sidebar is open beside the content; shut or a drawer, there is nothing for it
				 * to line up with.
				 */}
				{beside && rail && <span aria-hidden data-ly-toolbar-divider className="ly-toolbar-divider absolute top-1/2 left-0 h-5 w-px -translate-y-1/2" />}
				{title}
			</div>
			<div className="no-drag flex shrink-0 items-center pr-1.5">{end}</div>
		</div>
	);
}

const mac = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform);
const backKey = mac ? "⌘[" : "Alt+←";
const forwardKey = mac ? "⌘]" : "Alt+→";

/**
 * ⌘[ and ⌘] on macOS, Alt+← and Alt+→ elsewhere, and the mouse's own back and forward buttons.
 *
 * Not while typing: in a text field those keys belong to the field, and leaving the conversation
 * because a word was being selected would lose the place being typed into.
 *
 * Mounted once, by the window's `Shell`, not by each toolbar: the workspace stays mounted under
 * settings, so a listener per toolbar would take every press twice and go back two places.
 */
export function useNavShortcuts() {
	useEffect(() => {
		if (onPhone()) return;
		const typing = (target: EventTarget | null) =>
			target instanceof HTMLElement && (target.isContentEditable || target.tagName === "INPUT" || target.tagName === "TEXTAREA");
		const onKey = (event: KeyboardEvent) => {
			if (event.defaultPrevented || event.repeat || typing(event.target)) return;
			const back = mac ? event.metaKey && !event.altKey && !event.shiftKey && event.code === "BracketLeft" : event.altKey && !event.ctrlKey && event.key === "ArrowLeft";
			const forward = mac ? event.metaKey && !event.altKey && !event.shiftKey && event.code === "BracketRight" : event.altKey && !event.ctrlKey && event.key === "ArrowRight";
			if (!back && !forward) return;
			event.preventDefault();
			void (back ? goBack() : goForward());
		};
		// Buttons 3 and 4 are the side buttons on a mouse; `mouseup`, so the press itself is not taken.
		const onMouse = (event: MouseEvent) => {
			if (event.button !== 3 && event.button !== 4) return;
			event.preventDefault();
			void (event.button === 3 ? goBack() : goForward());
		};
		window.addEventListener("keydown", onKey);
		window.addEventListener("mouseup", onMouse);
		return () => {
			window.removeEventListener("keydown", onKey);
			window.removeEventListener("mouseup", onMouse);
		};
	}, []);
}
