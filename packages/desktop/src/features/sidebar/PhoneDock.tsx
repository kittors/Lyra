/**
 * The drawer's bottom bar, on a phone: settings, search, a new conversation.
 *
 * The three things you reach for in the list sit where the thumb already is. On the desktop they are
 * spread over the pane — search at the top right, 新对话 under the title, settings in the footer —
 * which is right for a pointer that travels anywhere and wrong for a thumb that has to stretch to
 * the top of a tall screen for the most common of them. The list scrolls on underneath and fades
 * out behind the bar rather than stopping above it.
 *
 * Search is a field from the start, not a button that becomes one. A field focused by the tap
 * itself is the only kind iOS will raise the keyboard for — one that appears after a re-render and
 * is focused from an effect gets the caret and no keyboard. Focusing it starts a search; 取消 ends it.
 */

import { Search, Settings as SettingsIcon, SquarePen, X } from "lucide-react";
import { useRef } from "react";

import { useI18n } from "../../i18n/index.ts";
import { Input } from "../../ui/inputs/NativeField.tsx";
import { useApp } from "../../store/index.ts";

export function PhoneDock({
	searching,
	query,
	onQuery,
	onToggleSearch,
	onNavigate,
}: {
	searching: boolean;
	query: string;
	onQuery: (query: string) => void;
	/** Starts a search, or ends one and clears it — the same toggle the desktop's button uses. */
	onToggleSearch: () => void;
	/** Put the drawer away after going somewhere. */
	onNavigate: () => void;
}) {
	const { t } = useI18n();
	const newSession = useApp((s) => s.newSession);
	const setView = useApp((s) => s.setView);
	const field = useRef<HTMLInputElement>(null);

	const endSearch = () => {
		field.current?.blur();
		if (searching) onToggleSearch();
	};

	return (
		<div className="ly-phone-dock" data-searching={searching || undefined}>
			<button
				type="button"
				aria-label={t("phone.settings")}
				onClick={() => {
					setView("settings");
					onNavigate();
				}}
				className="ly-phone-dock-round ly-press"
			>
				<SettingsIcon size={19} strokeWidth={1.8} aria-hidden />
			</button>

			<label className="ly-phone-dock-search">
				<Search size={16} strokeWidth={2} aria-hidden className="shrink-0 text-ink-faint" />
				<Input
					ref={field}
					type="search"
					enterKeyHint="search"
					aria-label={t("sidebar.search")}
					placeholder={t("phone.search")}
					value={query}
					onFocus={() => {
						if (!searching) onToggleSearch();
					}}
					onChange={(event) => onQuery(event.target.value)}
					onKeyDown={(event) => {
						if (event.key === "Escape") {
							event.stopPropagation();
							endSearch();
						}
						// Return closes the keyboard and leaves the results: they are already on screen.
						if (event.key === "Enter") field.current?.blur();
					}}
					className="min-w-0 flex-1 bg-transparent text-ink placeholder:text-ink-faint"
				/>
				{query && (
					<button
						type="button"
						aria-label={t("common.clearSearch")}
						onPointerDown={(event) => event.preventDefault()}
						onClick={() => onQuery("")}
						className="ly-phone-dock-clear"
					>
						<X size={12} strokeWidth={2.4} aria-hidden />
					</button>
				)}
			</label>

			{searching ? (
				<button type="button" onClick={endSearch} className="ly-phone-dock-cancel ly-press">
					{t("common.cancel")}
				</button>
			) : (
				<button
					type="button"
					aria-label={t("sidebar.newChat")}
					onClick={() => {
						void newSession();
						onNavigate();
					}}
					className="ly-phone-dock-round ly-phone-dock-primary ly-press"
				>
					<SquarePen size={18} strokeWidth={1.9} aria-hidden />
				</button>
			)}
		</div>
	);
}
