import type { ModelConfig, ThinkingLevel, ThinkingOption } from "@lyra/core";
// From the leaf, not the barrel: a value from `@lyra/core`'s index breaks the renderer build — see `EffortMenu.tsx`.
import { resolveModelThinkingOptions, resolveThinkingOption } from "@lyra/core/thinking-options";
import { translate } from "../../i18n/translate.ts";
import type { MessageKey } from "../../i18n/index.ts";

type Translate = (key: MessageKey) => string;

/**
 * A model's levels in the interface language — what every list of them on screen should show.
 *
 * Core draws its built-in levels in Chinese (`TEXT` in `thinking-options.ts`), so a list built
 * straight from `resolveModelThinkingOptions` reads 「低/中/高」 in an English window. The sub-agent
 * settings did exactly that while the composer beside them spoke the interface language.
 *
 * Levels configured on the model keep their own words, even under a standard id: a name somebody
 * wrote is not ours to translate.
 */
export function localizedThinkingOptions(model: ModelConfig | null | undefined, t: Translate): ThinkingOption[] {
	const builtin = model?.thinkingOptions === undefined;
	return resolveModelThinkingOptions(model).map((option) => localizeThinkingOption(option, builtin, t));
}

/**
 * The word for the level this model actually runs at — the one `resolveReasoningEffort` sends.
 *
 * "Off" only where the model can stop reasoning. On one that cannot, turning thinking off runs its
 * shallowest level, and the composer names that level rather than an "Off" the request does not do.
 */
export function effortLabel(level: ThinkingLevel, model?: ModelConfig | null, t?: Translate): string {
	const selected = resolveThinkingOption(level, model);
	if (!selected) return t?.("thinking.off") ?? translate("common.close");
	return localizeThinkingOption(selected, model?.thinkingOptions === undefined, t).label;
}

function localizeThinkingOption(option: ThinkingOption, builtin: boolean, t?: Translate): ThinkingOption {
	if (!builtin || !t) return option;
	const labelKey = thinkingLabelKey(option.id);
	const detailKey = thinkingDetailKey(option.id);
	return {
		...option,
		label: labelKey ? t(labelKey) : option.label,
		detail: detailKey ? t(detailKey) : option.detail,
	};
}

function thinkingLabelKey(level: ThinkingLevel): MessageKey | null {
	switch (level) {
		case "off": return "thinking.off";
		case "minimal": return "thinking.minimal";
		case "low": return "thinking.low";
		case "medium": return "thinking.medium";
		case "high": return "thinking.high";
		case "xhigh": return "thinking.xhigh";
		case "max": return "thinking.max";
		case "ultra": return "thinking.ultra";
		default: return null;
	}
}

function thinkingDetailKey(level: ThinkingLevel): MessageKey | null {
	switch (level) {
		case "off": return "thinking.detail.off";
		case "minimal": return "thinking.detail.minimal";
		case "low": return "thinking.detail.low";
		case "medium": return "thinking.detail.medium";
		case "high": return "thinking.detail.high";
		case "xhigh": return "thinking.detail.xhigh";
		case "max": return "thinking.detail.max";
		case "ultra": return "thinking.detail.ultra";
		default: return null;
	}
}
