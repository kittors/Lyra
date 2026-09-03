/**
 * Every conversation, newest first, under the day it was last touched.
 *
 * The other half of the sidebar. Where a project answers "what is in here", this answers "what was
 * I just doing" — the question the pane could not answer before, because the only way to a
 * conversation was through the project holding it.
 *
 * The band headings pin the same way project names do, and for the same reason: scrolled a screen
 * into 「过去 30 天」 the rows say nothing about when, and the heading is the only thing that does.
 */

import { useRef } from "react";
import { useLayout } from "../../app/layout.tsx";
import { useReflow } from "./useReflow.ts";
import { isScratch } from "./grouping.ts";
import type { RecencyBand } from "./recency.ts";
import { rowActions, SessionRow, type RowActions } from "./SessionRow.tsx";
import { ShowMore } from "./ShowMore.tsx";

/** How many rows the flat list starts with, and how many more each press adds. */
export const CHAT_PAGE = 40;

/**
 * A band's heading.
 *
 * Exported because it is drawn twice — once here, once pinned over the list by `StickyLayer` — and
 * the two have to be the same element or the handover between them is a visible step.
 *
 * A fixed height with no margin of its own: the space between bands belongs to the band, not to
 * its heading, or a heading pinned at the top of the pane would arrive with a gap above it.
 */
export function BandHead({ label }: { label: string }) {
	const { compact } = useLayout();
	return (
		<div
			className={`flex items-center px-2 text-detail font-medium text-ink-faint ${
				compact ? "h-[30px]" : "h-[24px]"
			}`}
		>
			{label}
		</div>
	);
}

export function ChatList({
	bands,
	activeSessionId,
	scratchRoots,
	hidden,
	canCollapse,
	onShowMore,
	onCollapse,
	actions,
	empty,
}: {
	bands: RecencyBand[];
	activeSessionId: string | null;
	/** Directories whose sessions belong to no project, so their rows get no caption. */
	scratchRoots: string[];
	hidden: number;
	canCollapse: boolean;
	onShowMore: () => void;
	onCollapse: () => void;
	actions: RowActions;
	/** What an empty list says, which differs between the sidebar and the archive. */
	empty: React.ReactNode;
}) {
	const { compact } = useLayout();
	const host = useRef<HTMLDivElement>(null);
	/*
	 * Which conversations are in which band, as one string.
	 *
	 * Re-measuring on every render would be a `getBoundingClientRect` per row per keystroke in the
	 * filter box; the composition changing is the same information for a fraction of the work — and
	 * it is exactly when a row can have moved.
	 */
	const shape = bands.map((band) => `${band.key}:${band.sessions.map((one) => one.id).join(",")}`).join("|");
	useReflow(host, shape);

	if (bands.length === 0) return <>{empty}</>;

	return (
		<div ref={host}>
			{bands.map((band, index) => (
				// The gap sits on the band rather than on its heading — see `BandHead`. The first
				// band gets none: it opens the list, and a list that starts with a gap reads as
				// something above it having failed to render.
				<div key={band.key} className={index === 0 ? "" : "mt-3"}>
					{/* Held at the rail for as long as this band is what you are scrolling through —
					    see `ProjectGroup` for why being sticky inside the band is the hand-off. */}
					<div data-ly-head className="ly-pin sticky top-[var(--ly-rail)] z-20">
						<BandHead label={band.label} />
					</div>
					<div className={`flex flex-col ${compact ? "gap-[5px] pt-[5px]" : "gap-[4px] pt-[4px]"}`}>
						{band.sessions.map((session) => (
							<SessionRow
								key={session.id}
								session={session}
								active={activeSessionId === session.id}
								/*
								 * Which project, as a tip rather than as a column.
								 *
								 * It used to be printed on every row, and in a list of forty that is a
								 * second column of names competing with the titles for the same width —
								 * the titles are what you are reading, and they were the ones being
								 * truncated to make room. Kept for the moments you actually need it: it
								 * is one hover away, alongside the full title.
								 */
								project={isScratch(session.cwd, scratchRoots) ? undefined : session.projectName}
								{...rowActions(actions, session)}
							/>
						))}
					</div>
				</div>
			))}
			<ShowMore hidden={hidden} canCollapse={canCollapse} onShowMore={onShowMore} onCollapse={onCollapse} />
		</div>
	);
}
