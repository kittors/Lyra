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
import { NavItem } from "./NavItem.tsx";

export function DestinationNav({ onNavigate }: { onNavigate: () => void }) {
	const view = useApp((s) => s.view);
	const setView = useApp((s) => s.setView);
	const go = (next: Parameters<typeof setView>[0]) => () => {
		setView(next);
		onNavigate();
	};

	return (
		<div className="flex flex-col gap-[2px] pb-1">
			<NavItem
				active={view === "pull-requests"}
				icon={<GitPullRequest size={15} strokeWidth={1.8} />}
				label="拉取请求"
				onClick={go("pull-requests")}
			/>
			<NavItem active={view === "scheduled"} icon={<Clock size={15} strokeWidth={1.8} />} label="已安排" onClick={go("scheduled")} />
			{/*
			 * The catalogue, not the settings pane it used to open.
			 *
			 * Clicking 插件 landed in 设置 › 插件, which is where you manage what you already have — so
			 * the one thing the sidebar entry could not do was show you what you could add. The two
			 * now split along that line: here to browse and install, settings to configure. The gear
			 * in this view's header is the way across.
			 */}
			<NavItem active={view === "plugins"} icon={<AtSign size={15} strokeWidth={1.8} />} label="插件" onClick={go("plugins")} />
		</div>
	);
}
