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
/**
 * `quiet` 是列表行里那一种：平时只有字，悬停、展开时才浮出一块底。设置页一列七行、每行两颗
 * 灰底胶囊的时候，页面读起来是十四个输入框，而用户要找的是那一两行改过的。
 */
export function ModelSelect({ ariaLabel, disabled, inheritedModelId, inheritedSource, quiet, ...selection }: ModelSelection & { ariaLabel: string; disabled?: boolean; inheritedModelId?: string; inheritedSource?: string; quiet?: boolean }) {
	const { t } = useI18n();
	const settings = useApp((s) => s.settings);
	const menu = usePopover();
	const models = settings ? availableModels(settings) : [];
	const selected = models.find(({ model }) => model.id === (selection.value || inheritedModelId));
	const ambiguous = selected && models.filter(({ model }) => model.name.trim().toLowerCase() === selected.model.name.trim().toLowerCase()).length > 1;
	const label = selected ? ambiguous ? `${selected.model.name} · ${selected.provider.name}` : selected.model.name : selection.value || inheritedModelId ? t("model.unavailable") : inheritedSource ? translate("sideChat.noModel") : selection.inheritLabel;
	return <>
		<button type="button" aria-label={ariaLabel} aria-haspopup="menu" aria-expanded={menu.open} disabled={disabled}
			onClick={menu.toggle} data-ly-select="" data-ly-tip={selected ? `${selected.provider.name} · ${selected.model.name}${!selection.value ? ` · ${selection.inheritDetail ?? selection.inheritLabel}` : ""}` : selection.value || selection.inheritDetail}
			data-set={selection.value ? "" : undefined}
			className={`${quiet ? "ly-field-quiet" : "ly-field"} ly-scroll max-w-[240px] justify-between gap-2 disabled:opacity-60`}>
			{selected ? <ModelIcon model={selected.model.modelId} name={selected.model.name} size={14} /> : <Box size={14} className="shrink-0 text-ink-muted" />}
			{/* 安静的那种把「随主会话」贴在名字后面读成一句，空白留到箭头前；框里那种照旧两端对齐。 */}
			{/* 挤不下时先让出位置的是「随主会话」，不是模型名——模型名才是这一格要回答的。 */}
			<span className={`min-w-0 text-left ${quiet ? "shrink" : "flex-1"}`}><ScrollText text={label} /></span>
			{!selection.value && inheritedSource && <span className={`text-caption ${quiet ? "min-w-0 shrink-[100] truncate text-ink-faint" : "shrink-0 text-ink-muted"}`}>{inheritedSource}</span>}
			{quiet && <span className="flex-1" />}
			<ChevronDown size={12} className={`shrink-0 text-ink-faint transition-transform duration-[var(--ly-t-quick)] ${menu.open ? "rotate-180" : ""}`} />
		</button>
		{menu.open && !disabled && <ModelMenu anchor={menu.anchor} onClose={menu.close} selection={selection} />}
	</>;
}
