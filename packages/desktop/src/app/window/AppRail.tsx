/**
 * The icon rail along the window's left edge: the app's places, and its own two buttons.
 *
 * The places used to be rows at the top of the sidebar — 拉取请求, 已安排, 插件 — scrolled away with
 * the list beneath them. As icons beside the sidebar they are reachable however far the list is
 * scrolled, and they cost the list nothing. 对话 is first because it is where the window opens, and
 * the only way back from the other three that does not depend on remembering which one you came from.
 *
 * At the bottom, the app rather than the work: the update mark when there is one, and settings. The
 * sidebar keeps 新对话 and the motto; a narrow window, whose sidebar is a drawer, has no rail and
 * puts all of these back in the drawer.
 */

import { Blocks, Clock, GitPullRequest, House, Settings as SettingsIcon } from "lucide-react";

import { useI18n } from "../../i18n/index.ts";
import { useApp } from "../../store/index.ts";
import { useScheduledNotices } from "../../features/scheduled/index.ts";
import { UpdateBadge } from "../../features/update/index.ts";

/** The rail's width; the sidebar card starts right after it. */
export const RAIL_WIDTH = 48;

type Place = "chat" | "pull-requests" | "scheduled" | "plugins" | "settings";

export function AppRail() {
	const { t } = useI18n();
	const view = useApp((s) => s.view);
	const setView = useApp((s) => s.setView);
	// Scheduled tasks that failed with nobody looking; opening the schedule is what clears it.
	const failures = useScheduledNotices((s) => s.unseen.length);
	// Plugin updates waiting while automatic updates are off. With them on, a number would appear
	// for the second it takes them to install themselves.
	const waiting = useApp((s) => (s.pluginUpdates && !s.pluginUpdates.auto ? s.pluginUpdates.outdated.length : 0));

	const item = (place: Place, label: string, icon: React.ReactNode, badge?: { count: number; label: string; tone: "danger" | "accent" }) => (
		<RailButton key={place} place={place} active={view === place} label={label} onClick={() => setView(place)} badge={badge && badge.count > 0 && view !== place ? badge : undefined}>
			{icon}
		</RailButton>
	);

	return (
		<nav data-ly-app-rail aria-label={t("rail.label")} className="ly-app-rail flex shrink-0 flex-col items-center gap-1.5 pt-1 pb-2" style={{ width: RAIL_WIDTH }}>
			{item("chat", t("rail.conversations"), <House size={17} strokeWidth={1.8} />)}
			{item("pull-requests", t("sidebar.pullRequests"), <GitPullRequest size={17} strokeWidth={1.8} />)}
			{item("scheduled", t("sidebar.scheduled"), <Clock size={17} strokeWidth={1.8} />, { count: failures, label: t("scheduled.unseenFailures", { n: failures }), tone: "danger" })}
			{item("plugins", t("sidebar.plugins"), <Blocks size={17} strokeWidth={1.8} />, { count: waiting, label: t("sidebar.pluginUpdates", { n: waiting }), tone: "accent" })}
			<span className="flex-1" />
			<UpdateBadge rail />
			{item("settings", t("phone.settings"), <SettingsIcon size={17} strokeWidth={1.8} />)}
		</nav>
	);
}

function RailButton({
	place,
	active,
	label,
	onClick,
	badge,
	children,
}: {
	place: Place;
	active: boolean;
	label: string;
	onClick: () => void;
	badge?: { count: number; label: string; tone: "danger" | "accent" };
	children: React.ReactNode;
}) {
	const tip = badge ? `${label} · ${badge.label}` : label;
	return (
		<button
			type="button"
			data-ly-rail-item={place}
			// The settings door the probes knock on, here and in the drawer's footer, wherever settings is reached from.
			data-ly-open-settings={place === "settings" ? "" : undefined}
			data-ly-tip={tip}
			data-ly-tip-side="right"
			aria-label={tip}
			aria-current={active ? "page" : undefined}
			onClick={onClick}
			// `transition`, not `transition-all` — see `Workspace` in `app/App.tsx`.
			className={`no-drag relative flex h-8 w-8 items-center justify-center rounded-lg transition duration-[var(--ly-t-quick)] ${
				active ? "bg-card-hover text-ink" : "text-ink-muted hover:bg-card-hover hover:text-ink"
			}`}
		>
			{children}
			{badge && (
				<span
					aria-hidden
					className={`absolute -top-0.5 -right-0.5 min-w-[15px] rounded-full px-1 text-center text-[10px] leading-[15px] font-semibold tabular-nums text-white ${
						badge.tone === "danger" ? "bg-danger" : "bg-accent"
					}`}
				>
					{badge.count > 9 ? "9+" : badge.count}
				</span>
			)}
		</button>
	);
}
