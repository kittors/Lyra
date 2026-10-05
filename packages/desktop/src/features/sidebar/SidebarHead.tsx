/**
 * The pane's title bar, and the search that drops out of it.
 *
 * The app name, and nothing more. It used to open the project picker, which put the same control
 * in two places and read as a dropdown over the whole window. Switching projects belongs on the
 * composer's project chip, next to what it actually scopes.
 */

import { Bell, Search } from "lucide-react";
import { SearchField } from "../../ui/inputs/SearchField.tsx";
import { useI18n } from "../../i18n/index.ts";
import { onPhone } from "../../services/index.ts";
import { useApp } from "../../store/index.ts";
import { activeProviderLabel } from "../../lib/sidebar-grouping.ts";

export function SidebarHead({
	searching,
	query,
	onQuery,
	onToggleSearch,
}: {
	searching: boolean;
	query: string;
	onQuery: (query: string) => void;
	/** Opens the field, and — pressed again or on Escape — closes it and clears what was typed. */
	onToggleSearch: () => void;
}) {
	const { t } = useI18n();
	// The search moved to the dock along the bottom on a phone — see `PhoneDock`.
	if (onPhone()) return <PhoneHead />;
	return (
		<>
			<div className="ly-sidebar-head flex h-[34px] shrink-0 items-center justify-between px-4">
				<span className="text-title font-semibold tracking-tight text-ink">Lyra</span>
				<div className="flex items-center gap-0.5">
					<button
						type="button"
						data-ly-tip={t("sidebar.search")}
						aria-label={t("sidebar.search")}
						aria-pressed={searching}
						onClick={onToggleSearch}
						className={`flex h-7 w-7 items-center justify-center rounded-lg transition-colors hover:bg-card-hover hover:text-ink ${
							searching ? "bg-card-hover text-ink" : "text-ink-muted"
						}`}
					>
						<Search size={15} strokeWidth={1.9} />
					</button>
					<button
						type="button"
						data-ly-tip={t("sidebar.notifications")}
						aria-label={t("sidebar.notifications")}
						className="flex h-7 w-7 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-card-hover hover:text-ink"
					>
						<Bell size={15} strokeWidth={1.9} />
					</button>
				</div>
			</div>

			{searching && (
				<div className="px-3 pb-2">
					<SearchField
						autoFocus
						size="comfortable"
						value={query}
						onChange={onQuery}
						onEscape={onToggleSearch}
						placeholder={t("sidebar.searchPlaceholder")}
					/>
				</div>
			)}
		</>
	);
}

/**
 * The drawer's title on a phone: the name, what it is set up with, and the bell.
 *
 * The line under the name is the one the desktop keeps in its footer — the motto if there is one,
 * otherwise which providers are configured. The footer is gone on a phone (its settings button is
 * in the dock), and a large title with a quiet line under it is how a phone names a list anyway.
 */
function PhoneHead() {
	const { t } = useI18n();
	const settings = useApp((s) => s.settings);
	const subtitle = settings?.personalization?.sidebarMotto?.trim() || activeProviderLabel(settings?.providers ?? []);
	return (
		<div className="ly-phone-head">
			<div className="min-w-0 flex-1">
				<div className="ly-phone-head-title">Lyra</div>
				{subtitle && <div className="ly-phone-head-subtitle">{subtitle}</div>}
			</div>
			<button type="button" aria-label={t("sidebar.notifications")} className="ly-phone-head-button ly-press">
				<Bell size={19} strokeWidth={1.8} aria-hidden />
			</button>
		</div>
	);
}
