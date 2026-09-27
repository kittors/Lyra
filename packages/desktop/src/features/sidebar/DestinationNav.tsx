/**
 * The three places in the app that are not a conversation.
 *
 * Inside the scroller rather than above it, and that is the point of them being here at all: they
 * are visited a few times a day, and as fixed rows they cost three of a narrow column's rows
 * permanently — which meant the conversations, the reason the pane exists, started a third of the
 * way down and never got that space back however far you scrolled. Starting a conversation earns a
 * permanent row. A destination can be scrolled to.
 */

import { AtSign, Clock, GitPullRequest } from "lucide-react";
import { useApp } from "../../store/index.ts";
import { onPhone } from "../../services/host.ts";
import { NavItem } from "./NavItem.tsx";
import { useI18n } from "../../i18n/index.ts";
import { useScheduledNotices } from "../scheduled/index.ts";

export function DestinationNav({ onNavigate }: { onNavigate: () => void }) {
	const { t } = useI18n();
	// Scheduled tasks that failed with nobody looking. Opening the schedule is what clears it.
	const failures = useScheduledNotices((s) => s.unseen.length);
	const view = useApp((s) => s.view);
	const setView = useApp((s) => s.setView);
	if (onPhone()) return null;
	const go = (next: Parameters<typeof setView>[0]) => () => {
		setView(next);
		onNavigate();
	};

	return (
		<div className="flex flex-col gap-[2px] pb-1">
			<NavItem
				active={view === "pull-requests"}
				icon={<GitPullRequest size={15} strokeWidth={1.8} />}
				label={t("sidebar.pullRequests")}
				onClick={go("pull-requests")}
			/>
			<NavItem
				active={view === "scheduled"}
				icon={<Clock size={15} strokeWidth={1.8} />}
				label={t("sidebar.scheduled")}
				onClick={go("scheduled")}
				badge={view === "scheduled" ? 0 : failures}
				badgeLabel={t("scheduled.unseenFailures", { n: failures })}
			/>
			{/*
			 * The catalogue, not the settings pane it used to open.
			 *
			 * Clicking 插件 landed in 设置 › 插件, which is where you manage what you already have — so
			 * the one thing the sidebar entry could not do was show you what you could add. The two
			 * now split along that line: here to browse and install, settings to configure. The gear
			 * in this view's header is the way across.
			 */}
			<NavItem active={view === "plugins"} icon={<AtSign size={15} strokeWidth={1.8} />} label={t("sidebar.plugins")} onClick={go("plugins")} />
		</div>
	);
}
