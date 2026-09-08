/**
 * What a failure means, said in the language of the person reading it.
 *
 * Errors arrive here as whatever threw them: a sentence from Chromium, a provider's JSON, an errno
 * from the filesystem. Passed through untouched they are at best unhelpful and at worst misleading
 * — `Failed to get sources.` appeared over the top of macOS's own screen-recording prompt, in
 * English, saying nothing about the permission the dialog behind it was asking for. Two accounts of
 * one moment, and the wrong one on top.
 *
 * So known shapes are recognised and restated: what happened, and what to do about it. Anything not
 * recognised is passed through, because a wrong translation is worse than an untranslated one — the
 * original at least leads somewhere when searched for.
 *
 * Pure, so `node --test` can hold it to every case below.
 */

import type { MessageKey } from "../../i18n/messages/index.ts";
import { translate } from "../../i18n/translate.ts";

export interface Explained {
	/** The headline, in the reader's language. */
	message: string;
	/** What to do about it, when there is something. */
	hint?: string;
	/**
	 * Whether to say it at all.
	 *
	 * Some failures are already being reported by the system, better than this could: macOS puts up
	 * its own dialog naming the app and offering to open the settings page. A toast beside it is a
	 * second voice on the same subject.
	 */
	silent?: boolean;
}

/**
 * One rule: what it recognises, and what it says instead.
 *
 * Keys rather than sentences, because this table is built once at module load and read for years
 * afterwards — a sentence baked in here would be whatever language the window was set to on the
 * first import, which is nothing anybody chose. `explain` looks them up at the moment of asking.
 */
interface Rule {
	match: RegExp;
	message: MessageKey;
	hint?: MessageKey;
	/** See `Explained.silent`. */
	silent?: boolean;
}

const RULES: Rule[] = [
	{
		/*
		 * The screen-recording refusal, which macOS is already explaining in a dialog of its own.
		 *
		 * Silent rather than restated: the system prompt names the app, says what it wants and opens
		 * the settings page. Anything added beside it is noise on top of a better explanation, and
		 * the English sentence Chromium throws — `Failed to get sources.` — reads as a bug rather
		 * than as a permission that has not been granted.
		 */
		match: /failed to get sources/i,
		message: "toastHelp.screenRecording",
		hint: "toastHelp.screenRecordingFix",
		silent: true,
	},
	{
		match: /\bEACCES\b|\bEPERM\b|operation not permitted/i,
		message: "toastHelp.noAccess",
		hint: "toastHelp.noAccessFix",
	},
	{
		match: /\bENOENT\b|no such file or directory/i,
		message: "toastHelp.notFound",
		hint: "toastHelp.notFoundFix",
	},
	{
		match: /\bENOSPC\b|no space left/i,
		message: "toastHelp.diskFull",
		hint: "toastHelp.diskFullFix",
	},
	{
		match: /\bECONNREFUSED\b/i,
		message: "toastHelp.refused",
		hint: "toastHelp.refusedFix",
	},
	{
		match: /\bETIMEDOUT\b|\bESOCKETTIMEDOUT\b|timed? ?out/i,
		message: "toastHelp.timeout",
		hint: "toastHelp.timeoutFix",
	},
	{
		match: /\bENOTFOUND\b|getaddrinfo/i,
		message: "toastHelp.dns",
		hint: "toastHelp.dnsFix",
	},
	{
		match: /\bECONNRESET\b|\bEPIPE\b|socket hang up/i,
		message: "toastHelp.reset",
		hint: "toastHelp.resetFix",
	},
	{
		/*
		 * A provider's own 5xx, usually arriving as a wall of JSON.
		 *
		 * The status code is the only part worth reading at a glance; the rest belongs in the
		 * transcript's error line where it can be expanded, not in a toast.
		 */
		match: /HTTP 5\d\d|internal_server_error|"type"\s*:\s*"server_error"/i,
		message: "toastHelp.upstream",
		hint: "toastHelp.upstreamFix",
	},
	{
		match: /HTTP 429|rate.?limit/i,
		message: "toastHelp.rateLimited",
		hint: "toastHelp.rateLimitedFix",
	},
	{
		match: /HTTP 401|HTTP 403|invalid.?api.?key|unauthorized/i,
		message: "toastHelp.badKey",
		hint: "toastHelp.badKeyFix",
	},
];

/**
 * Restate a failure, or hand it back unchanged.
 *
 * The first matching rule wins, so the list above is ordered from most specific to least.
 */
export function explain(message: string): Explained {
	const text = message.trim();
	for (const rule of RULES) {
		if (!rule.match.test(text)) continue;
		return {
			message: translate(rule.message),
			...(rule.hint ? { hint: translate(rule.hint) } : {}),
			...(rule.silent ? { silent: true } : {}),
		};
	}
	return { message: text };
}
