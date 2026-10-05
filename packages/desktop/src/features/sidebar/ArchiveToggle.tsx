/**
 * The way into the archive, and back out of it.
 *
 * Archiving is the sidebar's own reversible action, and until now the only way to reverse it was
 * 设置 › 已归档的聊天 — three clicks and a different pane away from the list you archived it out
 * of. This is the same collection at the place it belongs to.
 *
 * One button in one place for both directions. The archive replaces the list rather than opening
 * beside it, so the control that put you there is the one that takes you back — and it stays in
 * the same spot so leaving is not a matter of finding anything.
 */

import { Archive, X } from "lucide-react";
import { StripButton } from "./SidebarTabs.tsx";
import { useI18n } from "../../i18n/index.ts";
import { useLayout } from "../../app/layout.tsx";

export function ArchiveToggle({ open, count, onToggle }: { open: boolean; count: number; onToggle: () => void }) {
	const { t } = useI18n();
	const { compact } = useLayout();
	const label = open ? t("sidebar.exitArchive") : count > 0 ? t("sidebar.archivedCount", { count }) : t("sidebar.archived");

	return (
		<StripButton label={label} active={open} onClick={onToggle}>
			{/*
			 * The two marks trade places rather than one being swapped for the other.
			 *
			 * Both are always mounted and stacked, and what animates is a rotation through each
			 * other — which is the only way this reads as one control changing state. Rendering
			 * whichever icon matches the state gives a hard cut, and a hard cut here looks like the
			 * button was replaced by a different button that happens to be in the same place.
			 */}
			<Archive
				size={14}
				strokeWidth={1.9}
				aria-hidden
				className={`absolute transition-[opacity,transform] duration-[var(--ly-t-base)] ease-[var(--ly-e-out)] ${
					open ? "scale-75 rotate-90 opacity-0" : "scale-100 rotate-0 opacity-100"
				}`}
			/>
			<X
				size={14.5}
				strokeWidth={2}
				aria-hidden
				className={`absolute transition-[opacity,transform] duration-[var(--ly-t-base)] ease-[var(--ly-e-out)] ${
					open ? "scale-100 rotate-0 opacity-100" : "scale-75 -rotate-90 opacity-0"
				}`}
			/>
			{/*
			 * A dot rather than a numeral: the count is in the tooltip, and at this size a two-digit
			 * number beside an icon is a smudge. It says only that there is something in there —
			 * which is the whole question a closed archive raises.
			 */}
			{!open && count > 0 && (
				<span
					aria-hidden
					// In a 24px button 5px would sit on the icon, so it goes closer to the corner.
					className={`absolute h-[4px] w-[4px] rounded-full bg-ink-faint ${compact ? "top-[5px] right-[5px]" : "top-[2px] right-[2px]"}`}
				/>
			)}
		</StripButton>
	);
}
