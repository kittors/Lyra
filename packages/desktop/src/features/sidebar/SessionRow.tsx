/**
 * One conversation in the sidebar.
 *
 * The row, not the button inside it, owns the hover state. The archive affordance is a sibling
 * laid over the button's right-hand end, so a pointer sitting there is outside the button —
 * hanging `hover:` on the button meant the fill and the text colour dropped out the moment you
 * reached for the icon, while the icon itself (keyed off the row) stayed.
 *
 * The title stops short of the archive button, always. It used to run the full width with the
 * icon on top of it, so a long name and the icon overlapped into something neither could be read
 * through. A gradient behind the icon was the previous answer, but the sidebar is translucent —
 * there is no colour to fade to that reliably covers text. Reserving the space costs a few
 * characters and cannot go wrong; the full title is a hover away in the scroller either way.
 */

import type { SessionMeta } from "@lyra/core";
import { visibleActivity } from "@lyra/core/activity";
import { Archive, ArchiveRestore, Pin, PinOff, Trash2 } from "lucide-react";
import { useState } from "react";
import { useLayout } from "../../app/layout.tsx";
import { sessionTitle } from "../../lib/session-title.ts";
import { useApp } from "../../store/index.ts";
import { SessionCard, useSessionCard } from "./SessionCard.tsx";
import { SessionMenu } from "../modals/SessionMenu.tsx";
import { usePopover } from "../../ui/overlay/Popover.tsx";
import { ScrollText } from "../../ui/scroll/ScrollText.tsx";
import { SessionStatus } from "../conversation/SessionStatus.tsx";
import { useTypedText } from "../../ui/motion/TypedText.tsx";

/**
 * How recently a conversation must have been created for its row to drop in.
 *
 * The row appears the instant the first message is sent, so in the case this is for the gap is
 * a few milliseconds. The allowance is for the other way a row can be new — a turn started on
 * the phone, arriving with the next session list — and it has to stay short, or scrolling a
 * long sidebar would replay the entrance for whatever happens to have been made a minute ago.
 */
const JUST_CREATED_MS = 1500;

/**
 * What a row can do, as one thing rather than four callbacks threaded through every list.
 *
 * Which of them exist is what tells a row where it is: a conversation in the sidebar can be
 * archived, one in the archive can be restored or deleted, and neither list needs to be told which
 * one it is beyond being handed the right set.
 */
export interface RowActions {
	onOpen: (session: SessionMeta) => void;
	onArchive?: (session: SessionMeta) => void;
	onRestore?: (session: SessionMeta) => void;
	onDelete?: (session: SessionMeta) => void;
}

/** Bind a set of actions to one conversation, for spreading onto its row. */
export function rowActions(actions: RowActions, session: SessionMeta) {
	const bind = (act: ((session: SessionMeta) => void) | undefined) => (act ? () => act(session) : undefined);
	return {
		onOpen: () => actions.onOpen(session),
		onArchive: bind(actions.onArchive),
		onRestore: bind(actions.onRestore),
		onDelete: bind(actions.onDelete),
	};
}

export function SessionRow({
	session,
	active,
	project,
	onRestore,
	onDelete,
	onOpen,
	onArchive,
}: {
	session: SessionMeta;
	active: boolean;
	/**
	 * What this conversation belongs to, shown on hover rather than on the row.
	 *
	 * Under a project the folder row above already answers this, so it is only passed by 「聊天」,
	 * where there is no folder row. It used to be printed inline; a second column of names in a
	 * list of forty competes with the titles for a pane that is 240px wide, and the titles are the
	 * thing being read. In the tip it costs nothing and is there when it is wanted.
	 */
	project?: string;
	onOpen: () => void;
	/** Absent in the archive, where a row is already filed away. */
	onArchive?: () => void;
	/** Both present only in the archive: put it back, or end it. */
	onRestore?: () => void;
	onDelete?: () => void;
}) {
	/*
	 * Subscribed here rather than threaded through: it changes for reasons this row's other props
	 * know nothing about — a turn ending in a conversation nobody has open.
	 *
	 * This row's own mark, not the whole map. Selecting the map means every row in the list is
	 * subscribed to every other row's state, so one conversation starting a turn re-rendered a
	 * sidebar of forty. Selecting the entry narrows that to the row it is about; the rest see a
	 * value that did not change and stay put.
	 */
	const activity = useApp((s) => s.activity[session.id] ?? null);
	const settings = useApp((s) => s.settings);
	const setSessionPinned = useApp((s) => s.setSessionPinned);
	const isPinned = settings?.pinnedSessionIds?.includes(session.id) ?? false;
	const { compact } = useLayout();
	const menu = usePopover();

	/*
	 * Two motions, for the two things that happen to a new conversation's name.
	 *
	 * It arrives as 「新对话」 — the row drops in from above, because a row appearing out of
	 * nowhere in a list you are looking at is the sort of change the eye reports as "something
	 * moved" without being able to say what. Then, a moment later, the runtime derives the real
	 * title from the first message, and that one is a rewrite rather than an arrival: the row is
	 * already yours and only its name is being corrected.
	 *
	 * Decided once, at mount. Re-reading the clock on every render would let a row stop being new
	 * mid-animation, and `useState`'s initialiser is the one place that runs exactly once.
	 */
	const [justCreated] = useState(() => Date.now() - session.createdAt < JUST_CREATED_MS);
	const title = useTypedText(sessionTitle(session.title));
	/*
	 * Everything the row cannot fit, on a pause rather than on every render.
	 *
	 * The row shows a title; the card shows the full one plus where it lives and what it has cost.
	 * Both lists use it — under a project the folder above already names the project, so only 「聊天」
	 * passes one, but the path and the figures are worth having in either.
	 */
	const refreshSessionStats = useApp((s) => s.refreshSessionStats);
	const card = useSessionCard(() => void refreshSessionStats(session.id));

	const actionsCount = onRestore && onDelete ? 2 : (onArchive ? 1 : 0) + 1;

	return (
		<div
			{...card.bind}
			data-ly-row={session.id}
			onContextMenu={(event) => {
				event.preventDefault();
				card.dismiss();
				menu.openAtPoint(event);
			}}
			style={{ "--ly-row-controls": actionsCount === 2 ? "58px" : "34px" } as React.CSSProperties}
			className={`ly-scroll group/session relative rounded-lg transition-colors duration-[var(--ly-t-quick)] active:bg-elevated ${
				justCreated ? "ly-drop" : ""
			} ${active ? "bg-card-hover" : "hover:bg-card-hover"}`}
		>
			{card.anchor && <SessionCard session={session} anchor={card.anchor} project={project} leaving={card.leaving} />}
			{menu.open && <SessionMenu anchor={menu.anchor} session={session} onClose={menu.close} />}
			<button
				type="button"
				onClick={onOpen}
				/*
				 * Which conversation you are in, stated rather than only drawn.
				 *
				 * The row says so with a fill, which a screen reader cannot see — so the open
				 * conversation was indistinguishable from the forty above it to anyone not looking
				 * at the colour.
				 */
				aria-current={active ? "page" : undefined}
				/*
				 * The room made for the buttons is made on exactly the conditions that show them.
				 *
				 * It used to be `group-focus-within`, which is any focus anywhere in the row — and
				 * this button is in the row. Clicking a conversation focuses it, in Chromium, and the
				 * focus stays: move the pointer away and `:hover` drops but `:focus-within` does not,
				 * so the row went on reserving 56px for buttons whose own visibility is governed by
				 * the strip's `focus-within` — which the button is not inside of. Measured: 8px at
				 * rest, 56px on hover, 56px after the pointer left with the icons at opacity 0. A gap
				 * on the right of the open conversation with nothing in it, for as long as it kept
				 * focus. See `e2e/session-row-probe.ts`.
				 *
				 * `group-has-[:focus-visible]` is the same rule the strip uses below, and it is the
				 * one that was meant: keyboard focus reveals the buttons and is given room, a mouse
				 * click does neither.
				 */
				className={`flex w-full min-w-0 items-center gap-2 rounded-lg pl-2 text-left text-label transition-[padding,color,background-color] duration-[var(--ly-t-quick)] ${
					actionsCount === 2
						? "pr-2 group-hover/session:pr-14 group-has-[:focus-visible]/session:pr-14"
						: "pr-2 group-hover/session:pr-8 group-has-[:focus-visible]/session:pr-8"
				} ${compact ? "h-[34px]" : "h-[27px]"} ${
					active ? "text-ink" : "text-ink-muted group-hover/session:text-ink"
				}`}
			>
				{/* In the indent the titles already had, so nothing moved to make room for it. */}
				<SessionStatus activity={visibleActivity(activity, active)} />
				<ScrollText text={title} className="ly-fade-tail min-w-0 flex-1" />
			</button>

			{/* The strip never takes pointer events; only the button does. Anything wider would
			    shadow the row button and cost it its hover. */}
			{/* Shown on hover, and on keyboard focus anywhere in the row — which is the same condition
			    the button above reserves its space on. Two conditions that differ by a millimetre is
			    what left a gap with nothing in it; see the note there. */}
			<span className="pointer-events-none absolute inset-y-0 right-0 flex items-center rounded-r-lg pr-1.5 opacity-0 transition-opacity duration-[var(--ly-t-quick)] group-hover/session:opacity-100 group-has-[:focus-visible]/session:opacity-100">
				{onRestore && (
					<button
						type="button"
						data-ly-tip="取消归档"
						aria-label={`取消归档「${sessionTitle(session.title)}」`}
						onClick={onRestore}
						className="pointer-events-auto rounded p-1 text-ink-faint transition-colors duration-[var(--ly-t-quick)] hover:text-ink"
					>
						<ArchiveRestore size={12.5} strokeWidth={1.8} />
					</button>
				)}
				{onDelete && (
					<button
						type="button"
						data-ly-tip="删除"
						aria-label={`删除「${sessionTitle(session.title)}」`}
						onClick={onDelete}
						className="pointer-events-auto rounded p-1 text-ink-faint transition-colors duration-[var(--ly-t-quick)] hover:text-danger"
					>
						<Trash2 size={12.5} strokeWidth={1.8} />
					</button>
				)}
				{!onRestore && !onDelete && (
					<button
						type="button"
						data-ly-tip={isPinned ? "取消置顶" : "置顶会话"}
						aria-label={isPinned ? "取消置顶" : "置顶会话"}
						onClick={() => void setSessionPinned(session.id, !isPinned)}
						className="pointer-events-auto rounded p-1 text-ink-faint transition-colors duration-[var(--ly-t-quick)] hover:text-ink"
					>
						{isPinned ? <PinOff size={12.5} strokeWidth={1.8} /> : <Pin size={12.5} strokeWidth={1.8} />}
					</button>
				)}
				{onArchive && (
					<button
						type="button"
						data-ly-tip="归档会话"
						aria-label={`归档会话「${sessionTitle(session.title)}」`}
						onClick={onArchive}
						className="pointer-events-auto rounded p-1 text-ink-faint transition-colors duration-[var(--ly-t-quick)] hover:text-ink"
					>
						<Archive size={12.5} strokeWidth={1.8} />
					</button>
				)}
			</span>
		</div>
	);
}
