import type { UiLocale } from "@lyra/core";
import { en } from "./en.ts";
import { fr } from "./fr.ts";
import { ja } from "./ja.ts";
import { ko } from "./ko.ts";
import { ru } from "./ru.ts";
import { zhCN, type MessageCatalog, type MessageKey, type PluralForms } from "./zh-CN.ts";
import { zhTW } from "./zh-TW.ts";

export type ResolvedUiLocale = Exclude<UiLocale, "system">;
export type { MessageKey, PluralForms };

export const MESSAGE_CATALOGS: Record<ResolvedUiLocale, MessageCatalog> = {
	"zh-CN": zhCN,
	"zh-TW": zhTW,
	en,
	fr,
	ru,
	ko,
	ja,
};
