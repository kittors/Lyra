/**
 * The conversation's title bar on a phone: the drawer, the conversation, a new one.
 *
 * The desktop's bar carries six controls — the sidebar toggle, a folder mark, the title, its "…",
 * two panel shortcuts and the panel menu — each a 28px mark meant for a cursor. Shrunk onto a phone
 * they were a row of things to aim at under the status bar. A phone app's bar holds three: the way
 * to everything else on the left, what you are in in the middle, the next thing on the right.
 *
 * The middle is a button. Pressed, it brings up the conversation's sheet: its panels first — the
 * tasks, the side chat, the files, which had a button each — and then what the "…" offered. One
 * target the width of the bar instead of five small ones, and the things it opens are listed with
 * their names rather than guessed at from their icons.
 */

import { ChevronDown, Folder, SquarePen } from "lucide-react";
import { useLayout } from "../../app/layout.tsx";
import { useI18n } from "../../i18n/index.ts";
import { sessionTitle } from "../../lib/session-title.ts";
import { useApp } from "../../store/index.ts";
import { useConfirmer } from "../../ui/overlay/Confirm.tsx";
import { usePopover } from "../../ui/overlay/Popover.tsx";
import { SessionMenu, deleteSessionQuestion } from "../modals/index.ts";
import { paneKey } from "./pane-key.ts";
import { PhonePanelGrid } from "./PhonePanelGrid.tsx";
import { useScreenMeta } from "./screen-meta.ts";

export function PhoneTopBar({ sessionId }: { sessionId: string | null }) {
	const { t } = useI18n();
	const { toggleNav, navOpen } = useLayout();
	const meta = useScreenMeta(sessionId);
	const newSession = useApp((s) => s.newSession);
	const deleteSession = useApp((s) => s.deleteSession);
	const sheet = usePopover();
	// Asked from here rather than from the sheet, which is gone by the time the answer comes back.
	const confirm = useConfirmer();
	return (
		<header data-dock-header="conversation" data-ly-phone-bar="conversation" className="ly-phone-bar">
			<div className="ly-phone-bar-side">
				<button
					type="button"
					aria-label={t("phone.openDrawer")}
					aria-expanded={navOpen}
					onClick={toggleNav}
					className="ly-phone-bar-icon ly-press"
				>
					<DrawerMark />
				</button>
			</div>

			{meta ? (
				<button
					type="button"
					aria-haspopup="dialog"
					aria-expanded={sheet.open}
					aria-label={t("phone.conversationSheet", { title: sessionTitle(meta.title) })}
					onClick={sheet.toggle}
					className="ly-phone-bar-title ly-press"
				>
					<span data-ly-screen-title className="ly-phone-bar-label">{sessionTitle(meta.title)}</span>
					<ChevronDown size={15} strokeWidth={2.2} aria-hidden className="ly-phone-bar-chevron" />
				</button>
			) : (
				// A new conversation has no name yet; the page under the bar says what it is.
				<span />
			)}

			<div className="ly-phone-bar-side ly-phone-bar-end">
				{meta ? (
					<button type="button" aria-label={t("sidebar.newChat")} onClick={() => void newSession()} className="ly-phone-bar-icon ly-press">
						<SquarePen size={20} strokeWidth={1.8} aria-hidden />
					</button>
				) : (
					// Already a new conversation, which the button would only start again. Its width stays, so the bar does not shift.
					<span data-placeholder aria-hidden className="ly-phone-bar-icon" />
				)}
			</div>

			{meta && sheet.open && (
				<SessionMenu
					anchor={sheet.anchor}
					session={meta}
					onClose={sheet.close}
					lead={
						<>
							<div className="ly-phone-sheet-heading">
								<div className="ly-phone-sheet-heading-title">{sessionTitle(meta.title)}</div>
								{meta.projectName && (
									<div className="ly-phone-sheet-heading-caption">
										<Folder size={14} strokeWidth={1.8} aria-hidden className="shrink-0" />
										<span>{meta.projectName}</span>
									</div>
								)}
							</div>
							<PhonePanelGrid scope={paneKey(sessionId)} onPick={sheet.close} />
						</>
					}
					onRequestDelete={() => void deleteSessionQuestion(meta, () => void deleteSession(meta)).then(confirm.ask)}
				/>
			)}
			{confirm.element}
		</header>
	);
}

/**
 * Two lines, the lower one shorter: the mark phone apps use for "the list of everything".
 *
 * The desktop's sidebar glyph is a window with a pane in it, which says "toggle a column" — true of
 * a window, and not what this does: on a phone the list comes in over the conversation as a drawer.
 */
function DrawerMark() {
	return (
		<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
			<path d="M4 8.5h16" />
			<path d="M4 15.5h10" />
		</svg>
	);
}
