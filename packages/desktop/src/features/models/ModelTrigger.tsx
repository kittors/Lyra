/**
 * The model, as it appears in a composer row.
 *
 * One component because there is one thing being shown. The main composer, the side chat and
 * anything else that grows a field later are all the same question — "what will answer this?" —
 * and an answer that looks different in each place reads as three different questions.
 *
 * Not `ModelSelect`, which is the form control the settings pages use. That one is a bordered box
 * sized like a text field, which is right in a settings row and wrong in a composer: the field
 * already has a border, and a second one inside it draws a box around one control out of five.
 * The side chat used it for a while and that is exactly how it looked.
 *
 * A mark and a name, and everything else in the tooltip. Where the model is inherited rather than
 * chosen, `inheriting` says so there — on screen it was a second label in the row saying 「随主
 * 会话」, which is a sentence about configuration in a place meant for writing a message.
 */

import { modelIdentity, modelTooltip } from "../../lib/model-grouping.ts";
import { RollingText, useRolled } from "../../ui/motion/RollingText.tsx";
import { useApp } from "../../store/index.ts";
import { useI18n } from "../../i18n/index.ts";
import { usePopover } from "../../ui/overlay/Popover.tsx";
import { ModelIcon } from "./ModelIcon.tsx";
import { formatWindow, ModelMenu, type ModelSelection } from "./ModelMenu.tsx";

export function ModelTrigger({
	modelId,
	ariaLabel,
	inheriting,
	disabled,
	selection,
}: {
	/** The model that will actually answer — chosen here, or inherited. The mark and name come from it. */
	modelId: string | null | undefined;
	ariaLabel: string;
	/** Added to the tooltip when this model is inherited rather than picked here. */
	inheriting?: string;
	disabled?: boolean;
	/**
	 * A selection of its own, for a field that does not send to the active conversation.
	 *
	 * Left out, the menu changes the model of the conversation on screen, which is what the main
	 * composer wants.
	 */
	selection?: ModelSelection;
}) {
	const { t } = useI18n();
	const settings = useApp((s) => s.settings);
	const menu = usePopover();
	const identity = modelIdentity(settings, modelId);
	// The house is only said out loud when two models share a name and the name alone is ambiguous.
	const name = identity ? (identity.ambiguous ? `${identity.provider.name} · ${identity.model.name}` : identity.model.name) : null;
	const rolls = useRolled(modelId ?? "");
	const tooltip = modelTooltip(identity, formatWindow);
	return (
		<>
			<button
				type="button"
				onClick={menu.toggle}
				disabled={disabled}
				data-ly-tip={inheriting && identity ? `${tooltip}\n${inheriting}` : tooltip}
				aria-label={ariaLabel}
				aria-haspopup="menu"
				aria-expanded={menu.open}
				className={`ly-composer-control flex min-w-0 items-center gap-1.5 rounded-md px-2 text-label transition-colors disabled:opacity-60 ${
					menu.open ? "bg-card-hover text-ink" : "text-ink-muted hover:bg-card-hover hover:text-ink"
				}`}
			>
				{/* Keyed on the model, so picking a different house turns the mark over with
				    the label beside it rather than swapping under it. */}
				<ModelIcon key={modelId} model={identity?.model.modelId} name={name} className={rolls ? "ly-roll" : ""} />
				{/*
				 * The one thing in the row that yields, so it is also what says the row is out of
				 * room: everything else is `shrink-0`, and this truncating is exactly the moment
				 * there was not enough width to go round. `fit.ts` reads this element — the class is
				 * the handle — which is why a short name keeps its meter at any width.
				 */}
				<RollingText className="ly-fit-probe min-w-0 truncate">{name ?? t("composer.selectModel")}</RollingText>
			</button>
			{menu.open && !disabled && <ModelMenu anchor={menu.anchor} onClose={menu.close} selection={selection} />}
		</>
	);
}
