/**
 * What a conversation row cannot say in one line, on hover.
 *
 * The row is a title and nothing else — deliberately, because in a pane 240px wide a second column
 * of names competes with the titles for the space the titles need. Everything that used to be
 * fighting for that space, and several things that were never shown at all, live here instead.
 *
 * A card rather than a tooltip. The app's tips are one string on an inverted surface, which is
 * right for 「关闭」 and wrong for four labelled figures — those want alignment, marks, and a rule
 * between the identity of the thing and the numbers about it.
 *
 * Portalled to `<body>`: the sidebar is a scroller that clips its overflow, and a card pinned
 * beside a row would be cut off at the pane's edge — which is exactly where it needs to be.
 */

import { Coins, FolderOpen, MessagesSquare, Zap } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import type { SessionMeta } from "@lyra/core";
import { formatTokens } from "../conversation/RunningIndicator.tsx";

/**
 * How long the pointer has to rest before this appears.
 *
 * Long enough that running the pointer down the list to reach something does not strobe a card at
 * every row on the way, short enough that stopping on a row and waiting does not feel like waiting.
 */
const OPEN_DELAY_MS = 420;
/** Matches `.ly-card-out`; the card is unmounted once it has played. */
const LEAVE_MS = 110;
/** Distance from the row, matching the gap the app's tooltips keep. */
const GAP = 8;
/** Above the tooltips (200), because this is the one thing the pointer is deliberately holding. */
const CARD_Z = 210;

/** `2026-08-26 17:50`, or a relative day count for anything recent — whichever reads faster. */
function when(at: number): string {
	const days = Math.floor((Date.now() - at) / 86_400_000);
	if (days === 0) {
		return new Date(at).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
	}
	if (days === 1) return "昨天";
	if (days < 30) return `${days} 天前`;
	return new Date(at).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
}

/**
 * How much of the input never had to be re-read.
 *
 * Against everything that was sent, not against the total: output tokens are generated rather than
 * read, so counting them in the denominator makes a well-cached session look worse the more it
 * says back. Null when nothing has been sent at all, which is not a 0% hit rate — it is no data.
 */
function cacheHitRate(usage: SessionMeta["usage"]): number | null {
	const sent = usage.input + usage.cacheRead;
	if (sent <= 0) return null;
	return usage.cacheRead / sent;
}

/**
 * The directory's own name, not the road to it.
 *
 * `~/Downloads/源码-plfx` says the same thing as `源码-plfx` plus three segments nobody is reading
 * — and the row above already carried the project, which for a checkout is that same word again.
 * One name, once.
 */
function folderName(path: string): string {
	const parts = path.split("/").filter(Boolean);
	return parts[parts.length - 1] ?? path;
}

/**
 * One figure with a word for what it is.
 *
 * The number alone was ambiguous — 97 and 57% and 1.0k in a row read as three unrelated readings,
 * and the marks are too small to carry the meaning on their own. The label goes above rather than
 * beside so three of them tile evenly however wide the values run.
 */
function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
	return (
		/*
		 * Each column is as wide as its own contents, with the figure centred under its word.
		 *
		 * Two things have to hold at once, and the obvious shapes each break one. Equal thirds with
		 * everything centred keeps the pairs together but leaves a visible margin at both edges that
		 * the title and folder lines above do not have, so the row reads as inset from the rest of
		 * the card. Equal thirds with the ends pushed outwards fixes the edges and breaks the pairs:
		 * the label is centred in its third while the number is flush to the card, and 「消息」 ends
		 * up sitting to the right of its own count.
		 *
		 * Sizing each column to its contents and spacing them apart satisfies both. Nothing is
		 * centred *within* a wider box, so a label and its value share a centre line; the first
		 * column's left edge and the last column's right edge are the row's own, which is the
		 * padding — the same left and right edges as everything above.
		 */
		<div className="flex min-w-0 flex-col items-center gap-0.5">
			<span className="flex items-center gap-1 text-caption text-ink-faint">
				<span className="shrink-0">{icon}</span>
				{label}
			</span>
			<span className="max-w-full truncate text-detail text-ink tabular-nums">{value}</span>
		</div>
	);
}

function Row({ icon, children, mono }: { icon: React.ReactNode; children: React.ReactNode; mono?: boolean }) {
	return (
		<div className="flex items-center gap-1.5 text-detail text-ink-muted">
			<span className="shrink-0 text-ink-faint">{icon}</span>
			<span className={`min-w-0 truncate ${mono ? "font-mono" : ""}`}>{children}</span>
		</div>
	);
}

export function SessionCard({
	session,
	anchor,
	project,
	leaving,
}: {
	session: SessionMeta;
	/** The row's rectangle, in viewport coordinates. */
	anchor: DOMRect;
	/** Shown only where the list is not already grouped by project. */
	project?: string;
	/** Playing its exit; see `useSessionCard`. */
	leaving?: boolean;
}) {
	const card = useRef<HTMLDivElement>(null);
	const [at, setAt] = useState<{ left: number; top: number } | null>(null);

	/*
	 * Placed after measuring, in a layout effect, so it is never painted at the wrong spot first.
	 *
	 * To the right of the row where there is room, and flipped to the left where there is not —
	 * the sidebar can be dragged wide enough that its right edge is most of the way across the
	 * window. Vertically it is clamped rather than flipped: a card that jumped above the pointer
	 * near the foot of a list would be harder to follow than one that simply stops travelling.
	 */
	useLayoutEffect(() => {
		const box = card.current?.getBoundingClientRect();
		if (!box) return;
		const right = anchor.right + GAP;
		const left = right + box.width > window.innerWidth - GAP ? anchor.left - GAP - box.width : right;
		const top = Math.min(Math.max(GAP, anchor.top - 6), window.innerHeight - box.height - GAP);
		setAt({ left: Math.max(GAP, left), top });
	}, [anchor]);

	const usage = session.usage;
	const hit = cacheHitRate(usage);

	return createPortal(
		<div
			ref={card}
			role="tooltip"
			style={{ zIndex: CARD_Z, left: at?.left ?? -9999, top: at?.top ?? -9999, opacity: at ? undefined : 0 }}
			className={`ly-glass-solid pointer-events-none fixed w-[248px] overflow-hidden rounded-[12px] border border-line-soft ${
				leaving ? "ly-card-out" : "ly-card-in"
			}`}
		>
			<div className="flex items-start gap-2 px-3 pt-2.5 pb-2">
				{/* Three lines at most: a title derived from a long first message can be a paragraph. */}
				<p className="line-clamp-3 min-w-0 flex-1 text-label leading-[18px] text-ink">{session.title}</p>
				<span className="mt-[1px] shrink-0 text-caption text-ink-faint tabular-nums">{when(session.updatedAt)}</span>
			</div>

			{/*
			 * One line, and a folder mark on it.
			 *
			 * There were two: the project, and the full path. For a checkout those are the same word
			 * twice over — 「源码-plfx」 above 「~/Downloads/源码-plfx」 — and the mark on the first was
			 * a branch, which this has no way of knowing: `SessionMeta` records where a conversation
			 * ran, not what was checked out at the time. A stale branch name would be worse than none.
			 */}
			<div className="border-t border-line-soft px-3 py-2">
				<Row icon={<FolderOpen size={11.5} strokeWidth={1.9} />}>{project ?? folderName(session.cwd)}</Row>
			</div>

			{/*
			 * Numbers last, and only the ones that mean something on their own.
			 *
			 * Message count answers "how long is this", tokens answer "what did it cost", and the
			 * hit rate answers "was most of that re-read for free" — which is the one that changes
			 * what anyone does next, and the one nothing in the app was showing.
			 */}
			<div className="flex items-start justify-between gap-2 border-t border-line-soft px-3 py-2">
				<Stat icon={<MessagesSquare size={11} strokeWidth={2} />} label="消息" value={String(session.messageCount)} />
				<Stat icon={<Zap size={11} strokeWidth={2} />} label="用量" value={formatTokens(usage.total)} />
				{hit !== null && (
					<Stat icon={<Coins size={11} strokeWidth={2} />} label="缓存" value={`${Math.round(hit * 100)}%`} />
				)}
			</div>
		</div>,
		document.body,
	);
}

/**
 * Hover state for one row, with the delay and the teardown that go with it.
 *
 * Returned as props rather than rendered here, so the row keeps ownership of its own markup — and
 * so a row that unmounts mid-hover (the list re-sorts constantly) takes its timer with it.
 *
 * `onOpen` fires when the wait is up and the card is about to be shown — the one moment the figures
 * on it are being read, and so the one moment worth going to disk for them. Not on the mouse
 * entering: running the pointer down forty rows to reach one would be forty reads of the index for
 * forty cards nobody asked to see.
 */
export function useSessionCard(onOpen?: () => void): {
	anchor: DOMRect | null;
	leaving: boolean;
	bind: {
		onMouseEnter: (event: React.MouseEvent<HTMLElement>) => void;
		onMouseLeave: () => void;
		onClick: () => void;
	};
	dismiss: () => void;
} {
	const [anchor, setAnchor] = useState<DOMRect | null>(null);
	/*
	 * Held on screen for the length of the exit animation.
	 *
	 * Dropping the anchor the moment the pointer leaves unmounts the card, and a card React has
	 * already removed cannot animate — it simply blinks out, which beside a 130ms entrance reads as
	 * a glitch rather than as a dismissal. Marking it first and removing it after is what gives the
	 * animation something to play on; same arrangement as the toast stack.
	 */
	const [leaving, setLeaving] = useState(false);
	const open = useRef<number | undefined>(undefined);
	const close = useRef<number | undefined>(undefined);

	const dismiss = useCallback(() => {
		window.clearTimeout(open.current);
		window.clearTimeout(close.current);
		setAnchor(null);
		setLeaving(false);
	}, []);

	useEffect(() => {
		const hide = () => dismiss();
		window.addEventListener("scroll", hide, true);
		window.addEventListener("wheel", hide, true);
		window.addEventListener("blur", hide);
		return () => {
			window.clearTimeout(open.current);
			window.clearTimeout(close.current);
			window.removeEventListener("scroll", hide, true);
			window.removeEventListener("wheel", hide, true);
			window.removeEventListener("blur", hide);
		};
	}, [dismiss]);

	return {
		anchor,
		leaving,
		dismiss,
		bind: {
			onMouseEnter: (event) => {
				const box = event.currentTarget.getBoundingClientRect();
				window.clearTimeout(open.current);
				window.clearTimeout(close.current);
				// Coming back before the exit finished is a re-entry, not a second arrival.
				setLeaving(false);
				open.current = window.setTimeout(() => {
					onOpen?.();
					setAnchor(box);
				}, OPEN_DELAY_MS);
			},
			onMouseLeave: () => {
				window.clearTimeout(open.current);
				setLeaving(true);
				close.current = window.setTimeout(() => {
					setAnchor(null);
					setLeaving(false);
				}, LEAVE_MS);
			},
			onClick: () => {
				dismiss();
			},
		},
	};
}
