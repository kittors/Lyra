import type { ApprovalRisk } from "@lyra/core";
import { MESSAGE_CATALOGS, type MessageKey } from "../../i18n/messages/index.ts";
import type { MessageVariables } from "../../i18n/translate.ts";

/** Whitespace-only formatting differences must not repeat the entire question above itself. */
export function approvalReason(reason: string | undefined, detail: string): string | undefined {
	const normalize = (value: string) => value.replace(/\s+/gu, " ").trim();
	return reason && normalize(reason) && normalize(reason) !== normalize(detail) ? reason : undefined;
}

/**
 * The approval policy's finding, worded for the window.
 *
 * A built-in rule arrives as a code and is said from the catalogues (`risk.<code>`, one per rule
 * in core's `RISK_REASONS`; the type below stops a rule being added without them). `text` is the
 * policy's own sentence: what a plugin's policy, which has no codes, gives — and what a code this
 * build has no entry for falls back to, where the alternative is an empty line or a crash on an
 * undefined template.
 */
export function riskSentence(
	risk: ApprovalRisk | undefined,
	t: (key: MessageKey, variables?: MessageVariables) => string,
): string | undefined {
	if (!risk) return undefined;
	if (!risk.code) return risk.text;
	const key: MessageKey = `risk.${risk.code}`;
	return key in MESSAGE_CATALOGS["zh-CN"] ? t(key, risk.params) : risk.text;
}
