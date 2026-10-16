/**
 * The composer's image and video model button: one small mark beside the chat model.
 *
 * Only there when there is something to choose between — two image models, or two video models. A
 * conversation with one of each has nothing to switch, and a control that can only show what is
 * already true is clutter in a row that has room for five things.
 *
 * A wand — what makes things, whichever kinds there are — and no name. The row has room for one
 * model's name and it is the chat model's: that is the one answering. Which image and video model a
 * drawing will use is in the tooltip, and the mark turns accent when this conversation has its own
 * pick rather than following the default — the one fact worth seeing without hovering, since it is
 * the one that differs from every other conversation.
 */

import { ChevronRight, WandSparkles } from "lucide-react";
import { useRef } from "react";
import { type MediaKind, mediaModelRows, resolveMediaModel } from "@lyra/core/image-models";
import { useScopedMeta } from "../../app/session-scope.tsx";
import { useI18n } from "../../i18n/index.ts";
import { useApp } from "../../store/index.ts";
import { MenuItem } from "../../ui/overlay/Menu.tsx";
import { usePopover } from "../../ui/overlay/Popover.tsx";
import { MediaModelMenu } from "./MediaModelMenu.tsx";

export function MediaModelButton({ disabled }: { disabled?: boolean }) {
	const { t } = useI18n();
	const settings = useApp((s) => s.settings);
	const meta = useScopedMeta();
	const menu = usePopover();
	const providers = settings?.providers;
	const counts = { image: mediaModelRows(providers, "image").length, video: mediaModelRows(providers, "video").length };
	if (counts.image < 2 && counts.video < 2) return null;

	const own = Boolean(meta?.imageModelId || meta?.videoModelId);
	const current = (kind: MediaKind) =>
		resolveMediaModel(providers, kind, {
			session: kind === "video" ? meta?.videoModelId : meta?.imageModelId,
			preferred: kind === "video" ? settings?.videoModelId : settings?.imageModelId,
		}).row?.model.name ?? "";
	const tip = [counts.image ? t("mediaMenu.tipImage", { name: current("image") }) : "", counts.video ? t("mediaMenu.tipVideo", { name: current("video") }) : ""].filter(Boolean).join("\n");

	return (
		<>
			<button
				type="button"
				onClick={menu.toggle}
				disabled={disabled}
				data-ly-tip={tip}
				data-ly-media-button=""
				data-own={own ? "true" : undefined}
				aria-label={t("mediaMenu.button")}
				aria-haspopup="menu"
				aria-expanded={menu.open}
				className={`ly-composer-control grid shrink-0 place-items-center rounded-lg px-1.5 transition-colors disabled:opacity-60 ${
					menu.open ? "bg-card-hover text-ink" : own ? "text-accent hover:bg-card-hover" : "text-ink-muted hover:bg-card-hover hover:text-ink"
				}`}
			>
				<WandSparkles size={15} strokeWidth={1.8} aria-hidden />
			</button>
			{menu.open && !disabled && <MediaModelMenu anchor={menu.anchor} onClose={menu.close} />}
		</>
	);
}

/**
 * The same choice as a row in the model's sheet, on a phone — where the composer's row keeps to the
 * attachment, the model and send (see `PhoneTurnSettings`). It says what each kind is set to and
 * opens the same menu, as a sheet over the one it is in. Absent where the wand would be.
 */
export function MediaModelRow() {
	const { t } = useI18n();
	const settings = useApp((s) => s.settings);
	const meta = useScopedMeta();
	const menu = usePopover();
	const row = useRef<HTMLDivElement>(null);
	const providers = settings?.providers;
	const counts = { image: mediaModelRows(providers, "image").length, video: mediaModelRows(providers, "video").length };
	if (counts.image < 2 && counts.video < 2) return null;
	const current = (kind: MediaKind) =>
		resolveMediaModel(providers, kind, {
			session: kind === "video" ? meta?.videoModelId : meta?.imageModelId,
			preferred: kind === "video" ? settings?.videoModelId : settings?.imageModelId,
		}).row?.model.name ?? "";
	const names = [counts.image ? current("image") : "", counts.video ? current("video") : ""].filter(Boolean).join(" · ");
	return (
		<div ref={row}>
			<MenuItem
				icon={<WandSparkles size={16} strokeWidth={1.8} />}
				detail={names || undefined}
				trailing={<ChevronRight size={15} strokeWidth={2} aria-hidden className="mt-[3px] shrink-0 text-ink-faint" />}
				onClick={() => {
					if (row.current) menu.openAt(row.current);
				}}
			>
				{t("mediaMenu.button")}
			</MenuItem>
			{menu.open && <MediaModelMenu anchor={menu.anchor} onClose={menu.close} />}
		</div>
	);
}
