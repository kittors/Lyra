/**
 * What the bell at the top of the sidebar opens: the conversations that want you back.
 *
 * The bell had no handler at all — a button since 09-07 that did nothing when pressed. What it now
 * lists is what the app already tracks and already hints at with the dot on the sidebar toggle:
 * conversations waiting for an approval, and ones that finished or failed while you were elsewhere
 * (opening one clears its mark, as it always did). Scheduled tasks that failed unseen come last,
 * as one row that opens the schedule.
 *
 * The conversation on screen is left out: you are already looking at it.
 */

import { AlertTriangle, Check, Clock, Hand } from "lucide-react";

import type { SessionActivity } from "@lyra/core/activity";
import { useI18n } from "../../i18n/index.ts";
import { sessionTitle } from "../../lib/session-title.ts";
import { useApp } from "../../store/index.ts";
import { MenuBody, MenuItem, MenuLabel, Popover, type Anchor } from "../../ui/overlay/Popover.tsx";
import { useScheduledNotices } from "../scheduled/index.ts";

type Attention = Extract<SessionActivity, "waiting" | "failed" | "done">;
const ORDER: Attention[] = ["waiting", "failed", "done"];

export interface Notices {
	sessions: { id: string; title: string; state: Attention }[];
	scheduledFailures: number;
	/** The loudest thing in the list, for the bell's own dot. */
	top: Attention | null;
}

export function useNotices(): Notices {
	const activity = useApp((s) => s.activity);
	const activeSessionId = useApp((s) => s.activeSessionId);
	const sessions = useApp((s) => s.sessions);
	const scheduledFailures = useScheduledNotices((s) => s.unseen.length);
	const listed = Object.entries(activity)
		.filter((entry): entry is [string, Attention] => entry[0] !== activeSessionId && ORDER.includes(entry[1] as Attention))
		.map(([id, state]) => {
			const meta = sessions.find((session) => session.id === id);
			return { id, state, title: sessionTitle(meta?.title), updatedAt: meta?.updatedAt ?? 0 };
		})
		.sort((a, b) => ORDER.indexOf(a.state) - ORDER.indexOf(b.state) || b.updatedAt - a.updatedAt)
		.map(({ id, title, state }) => ({ id, title, state }));
	const top = listed[0]?.state ?? (scheduledFailures > 0 ? "failed" : null);
	return { sessions: listed, scheduledFailures, top };
}

export function NotificationsMenu({ anchor, notices, onClose }: { anchor: Anchor; notices: Notices; onClose: () => void }) {
	const { t } = useI18n();
	const label: Record<Attention, string> = { waiting: t("notifications.waiting"), failed: t("notify.failed"), done: t("notify.done") };
	const icon: Record<Attention, React.ReactNode> = {
		waiting: <Hand size={14} strokeWidth={1.8} className="text-accent" />,
		failed: <AlertTriangle size={14} strokeWidth={1.8} className="text-danger" />,
		done: <Check size={14} strokeWidth={2} className="text-ok" />,
	};
	const empty = notices.sessions.length === 0 && notices.scheduledFailures === 0;
	return (
		<Popover anchor={anchor} onClose={onClose} placement="bottom" align="end" width="default" role="menu" label={t("sidebar.notifications")}>
			<MenuBody>
				<MenuLabel>{t("sidebar.notifications")}</MenuLabel>
				{empty && <p data-ly-notifications-empty className="px-2.5 py-3 text-detail text-ink-faint">{t("notifications.empty")}</p>}
				{notices.sessions.map((notice) => (
					<MenuItem
						key={notice.id}
						icon={icon[notice.state]}
						detail={label[notice.state]}
						onClick={() => {
							onClose();
							void useApp.getState().openSessionById(notice.id);
						}}
					>
						<span data-ly-notice={notice.state}>{notice.title}</span>
					</MenuItem>
				))}
				{notices.scheduledFailures > 0 && (
					<MenuItem
						icon={<Clock size={14} strokeWidth={1.8} className="text-danger" />}
						onClick={() => {
							onClose();
							useApp.getState().setView("scheduled");
						}}
					>
						<span data-ly-notice="scheduled">{t("scheduled.unseenFailures", { n: notices.scheduledFailures })}</span>
					</MenuItem>
				)}
			</MenuBody>
		</Popover>
	);
}

/** The bell's dot: the colour of the loudest notice, as the sidebar toggle's dot does it. */
export function NoticeDot({ top }: { top: Notices["top"] }) {
	if (!top) return null;
	return (
		<span
			aria-hidden
			data-ly-notice-dot={top}
			className={`absolute top-1 right-1 h-1.5 w-1.5 rounded-full ${top === "waiting" ? "bg-accent" : top === "failed" ? "bg-danger" : "bg-ok"}`}
		/>
	);
}
