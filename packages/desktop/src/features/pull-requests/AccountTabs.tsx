/**
 * Which account's pull requests you are looking at.
 *
 * Only drawn when there is more than one. A single account is not a choice, and a tab strip with
 * one tab in it is a row of chrome that says nothing — the pane looks exactly as it did before
 * anyone had a second identity, which is the right outcome for most people most of the time.
 *
 * A face rather than a host logo. The question this row answers is "as whom", not "on what" — and
 * the picture is the thing recognised without reading, which matters in a 300px column where the
 * labels are truncated anyway. The host is still there, in the tooltip, for the case where two
 * accounts share a name.
 *
 * A tab whose last fetch failed says so with a dot. That is the whole reason the errors are
 * reported per account rather than as one message: an expired GitLab token must not read as "you
 * have no pull requests" when the two GitHub accounts beside it answered perfectly well.
 */

import type { ForgeAccount } from "../../../electron/ipc-types.ts";
import { Avatar } from "./Avatar.tsx";

export function AccountTabs({
	accounts,
	active,
	onSelect,
	errors,
}: {
	accounts: ForgeAccount[];
	/** Null is every account at once, which is the resting state. */
	active: string | null;
	onSelect: (id: string | null) => void;
	errors: Record<string, string>;
}) {
	// Switched-off accounts are not fetched, so a tab for one would always be empty. They still
	// exist on the settings page, which is where switching them back on belongs.
	const shown = accounts.filter((account) => account.enabled);
	if (shown.length < 2) return null;

	return (
		/*
		 * Scrolls sideways rather than wrapping.
		 *
		 * Four accounts in a 300px column is two rows if it wraps, and the second row pushes the
		 * search field and the whole list down — a layout that changes height as somebody signs in
		 * somewhere else. The scrollbar itself is already hidden app-wide by `styles.css`.
		 */
		<div
			role="group"
			aria-label="账号"
			className="flex shrink-0 items-center gap-1 overflow-x-auto px-3 pb-1.5"
		>
			<Tab label="全部" active={active === null} onClick={() => onSelect(null)} />
			{shown.map((account) => (
				<Tab
					key={account.id}
					label={short(account.label)}
					tip={`${account.label}${errors[account.id] ? ` — ${errors[account.id]}` : ""}`}
					active={active === account.id}
					failing={Boolean(errors[account.id])}
					onClick={() => onSelect(account.id)}
					icon={<Avatar accountId={account.id} login={account.login} url={account.avatarUrl} size={14} />}
				/>
			))}
		</div>
	);
}

/**
 * The label, minus the host.
 *
 * Labels default to `login · host`, which is what disambiguates them in settings and is far too
 * long for a tab. The host is the part you already know by the time you are choosing between two
 * tabs, so it goes to the tooltip and the name stays.
 */
function short(label: string): string {
	const cut = label.indexOf(" · ");
	return cut > 0 ? label.slice(0, cut) : label;
}

function Tab({
	label,
	tip,
	active,
	failing,
	icon,
	onClick,
}: {
	label: string;
	tip?: string;
	active: boolean;
	failing?: boolean;
	icon?: React.ReactNode;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			data-ly-tip={tip}
			aria-pressed={active}
			className={`flex h-[26px] max-w-[140px] shrink-0 items-center gap-1.5 rounded-lg pr-2.5 text-label whitespace-nowrap transition-colors ${
				icon ? "pl-1.5" : "pl-2.5"
			} ${active ? "bg-card-hover text-ink" : "text-ink-muted hover:text-ink"}`}
		>
			{icon}
			<span className="min-w-0 truncate">{label}</span>
			{/* Marks the tab rather than the list, so a failing account is visible from any tab. */}
			{failing && <span aria-hidden className="h-[5px] w-[5px] shrink-0 rounded-full bg-danger" />}
		</button>
	);
}
