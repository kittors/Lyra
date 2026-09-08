import { translate } from "../../i18n/translate.ts";
import { availableModels } from "@lyra/core/model-roles";
import { Box, ChevronDown } from "lucide-react";
import { useApp } from "../../store/index.ts";
import { usePopover } from "../../ui/overlay/Popover.tsx";
import { ScrollText } from "../../ui/scroll/ScrollText.tsx";
import { ModelIcon } from "./ModelIcon.tsx";
import { ModelMenu, type ModelSelection } from "./ModelMenu.tsx";
import { useI18n } from "../../i18n/index.ts";

/** Configuration picks share the model catalogue without changing the active conversation. */
export function ModelSelect({ ariaLabel, disabled, inheritedModelId, inheritedSource, ...selection }: ModelSelection & { ariaLabel: string; disabled?: boolean; inheritedModelId?: string; inheritedSource?: string }) {
	const { t } = useI18n();
	const settings = useApp((s) => s.settings);
	const menu = usePopover();
	const models = settings ? availableModels(settings) : [];
	const selected = models.find(({ model }) => model.id === (selection.value || inheritedModelId));
	const ambiguous = selected && models.filter(({ model }) => model.name.trim().toLowerCase() === selected.model.name.trim().toLowerCase()).length > 1;
	const label = selected ? ambiguous ? `${selected.model.name} · ${selected.provider.name}` : selected.model.name : selection.value || inheritedModelId ? t("model.unavailable") : inheritedSource ? translate("sideChat.noModel") : selection.inheritLabel;
	return <>
		<button type="button" aria-label={ariaLabel} aria-haspopup="menu" aria-expanded={menu.open} disabled={disabled}
			onClick={menu.toggle} data-ly-tip={selected ? `${selected.provider.name} · ${selected.model.name}${!selection.value ? ` · ${selection.inheritDetail ?? selection.inheritLabel}` : ""}` : selection.value || selection.inheritDetail}
			className="ly-scroll flex h-[30px] min-w-0 max-w-[220px] items-center gap-2 rounded-lg border border-line px-2.5 text-label text-ink transition-colors hover:bg-hover disabled:opacity-60">
			{selected ? <ModelIcon model={selected.model.modelId} name={selected.model.name} size={14} /> : <Box size={14} className="shrink-0 text-ink-muted" />}
			<span className="min-w-0 flex-1 text-left"><ScrollText text={label} /></span>
			{!selection.value && inheritedSource && <span className="shrink-0 text-caption text-ink-muted">{inheritedSource}</span>}
			<ChevronDown size={12} className={`shrink-0 text-ink-faint transition-transform duration-[var(--ly-t-quick)] ${menu.open ? "rotate-180" : ""}`} />
		</button>
		{menu.open && !disabled && <ModelMenu anchor={menu.anchor} onClose={menu.close} selection={selection} />}
	</>;
}
