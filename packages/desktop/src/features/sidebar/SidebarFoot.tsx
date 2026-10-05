/**
 * The strip at the bottom, whose business is the app rather than the conversation.
 *
 * Padded container, rounded row — the same shape as every other item in this pane. As a full-bleed
 * button its hover fill ran edge to edge and read as a different kind of control from the list it
 * sits under.
 *
 * The update dot rides at the end of this row, and is usually not there at all. Which is why it is
 * here rather than in the toolbar: this is the one strip of the window that is about the app
 * itself, and a row that already ends in a small round mark has somewhere to put another one.
 */

import { Settings as SettingsIcon } from "lucide-react";
import { useLayout } from "../../app/layout.tsx";
import { useApp } from "../../store/index.ts";
import { ScrollText } from "../../ui/scroll/ScrollText.tsx";
import { UpdateBadge } from "../update/index.ts";
import { activeProviderLabel } from "../../lib/sidebar-grouping.ts";

export function SidebarFoot({ onNavigate }: { onNavigate: () => void }) {
	const settings = useApp((s) => s.settings);
	const setView = useApp((s) => s.setView);
	const { compact } = useLayout();

	return (
		<div className={`ly-sidebar-foot flex shrink-0 items-center gap-2 ${compact ? "p-3" : "p-2.5"}`}>
			<button
				type="button"
				data-ly-open-settings=""
				onClick={() => {
					setView("settings");
					onNavigate();
				}}
				className={`ly-scroll flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2 text-left transition-colors duration-[var(--ly-t-quick)] hover:bg-card-hover active:bg-elevated ${
					compact ? "h-[40px]" : "h-[34px]"
				}`}
			>
				<SettingsIcon size={16} strokeWidth={1.8} className="shrink-0 text-ink-muted" />
				{/* Fades when the badge beside it opens, rather than being squeezed into its own
				    overflow animation — see `.ly-sidebar-foot` in styles.css. */}
				<ScrollText
					text={settings?.personalization?.sidebarMotto?.trim() || activeProviderLabel(settings?.providers ?? [])}
					className="ly-sidebar-foot-label min-w-0 flex-1 text-label text-ink"
				/>
			</button>
			<UpdateBadge compact={compact} />
		</div>
	);
}

/**
 * The motto, at the foot of the sidebar card, when settings and the update mark live in the rail.
 *
 * Kept because it is a setting of its own (个性化 › 侧边栏座右铭) that says where it is shown; with
 * nothing typed there it is which providers are set up, as before. Not a button any more — the gear
 * in the rail is the way to settings, and a second door to the same place reads as a different one.
 */
export function SidebarMottoLine() {
	const settings = useApp((s) => s.settings);
	const text = settings?.personalization?.sidebarMotto?.trim() || activeProviderLabel(settings?.providers ?? []);
	if (!text) return null;
	return (
		<div data-ly-sidebar-motto className="flex h-9 shrink-0 items-center px-4">
			<ScrollText text={text} className="min-w-0 flex-1 text-detail text-ink-faint" />
		</div>
	);
}
