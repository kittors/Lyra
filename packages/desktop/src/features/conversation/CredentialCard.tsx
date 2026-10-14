/**
 * The card the agent raises when it needs a password, a key or a token.
 *
 * What is typed here goes to the main process on its own channel (`credentials.submit`) and from there
 * to the command that uses it; the model gets the name. The card closes when the approval resolves,
 * which the main process does only once the value is held — a card that closed first would say
 * "done" about something that may still be refused (a key that does not open).
 *
 * Two kinds of words, drawn apart: the purpose is the model's, quoted, and may be wrong; the kind and
 * where the value may be used are the app's, and are what will be enforced.
 */

import type { CredentialPrompt } from "@lyra/core";
import { Check, X } from "lucide-react";
import { useState } from "react";
import { useI18n } from "../../i18n/index.ts";
import { activeLocale } from "../../i18n/translate.ts";
import { bridge, onPhone } from "../../services/index.ts";
import { ChoiceMark } from "../../ui/primitives/ChoiceMark.tsx";
import { CredentialFields, type CredentialValues, KIND_ICON, KIND_LABEL, PROBLEM_LABEL } from "../vault/index.ts";

const BUTTON = "flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-label transition-colors disabled:opacity-50";

export function CredentialCard({
	requestId,
	purpose,
	prompt,
	sessionId,
	reject,
}: {
	requestId: string;
	/** The model's sentence about what it is for. */
	purpose: string;
	prompt: CredentialPrompt;
	sessionId: string | null;
	reject: () => Promise<void>;
}) {
	const { t } = useI18n();
	const [values, setValues] = useState<CredentialValues>({});
	const [remember, setRemember] = useState(false);
	// A saved one is offered before anything is typed; 重新输入 is the way past it.
	const [typing, setTyping] = useState(!prompt.saved);
	const [pending, setPending] = useState(false);
	const [problem, setProblem] = useState("");
	const phone = onPhone();
	const KindIcon = KIND_ICON[prompt.kind];

	async function submit(useSaved: boolean) {
		if (pending || !sessionId) return;
		setPending(true);
		setProblem("");
		try {
			const result = await bridge.credentials.submit(sessionId, requestId, useSaved ? { useSaved: true } : { values, remember });
			// Held in the main process now; nothing typed stays behind in this one.
			if (result.ok) setValues({});
			else setProblem(t(PROBLEM_LABEL[result.problem]));
		} catch (failure) {
			setProblem(failure instanceof Error ? failure.message : String(failure));
		} finally {
			setPending(false);
		}
	}

	async function decline() {
		if (pending) return;
		setPending(true);
		try {
			await reject();
		} catch (failure) {
			setProblem(failure instanceof Error ? failure.message : String(failure));
			setPending(false);
		}
	}

	const saved = prompt.saved;
	return (
		<div className="flex min-h-0 flex-col" data-ly-credential-card={prompt.kind}>
			<div className="min-h-0 overflow-y-auto px-4 pb-1">
				{purpose.trim() && (
					<p className="mb-2.5 border-l-2 border-line pl-2.5 text-label leading-relaxed text-ink-muted whitespace-pre-wrap break-words" data-ly-credential-purpose="">
						{purpose}
					</p>
				)}
				<p className="mb-3 flex flex-wrap items-center gap-x-1.5 text-detail text-ink" data-ly-credential-fact="">
					<KindIcon size={13} strokeWidth={1.8} className="shrink-0 text-ink-muted" aria-hidden />
					<span>{t(KIND_LABEL[prompt.kind])}</span>
					<span className="text-ink-faint">·</span>
					<span className="break-all">{prompt.target ? t("credential.onlyFor", { target: prompt.target }) : t("credential.anywhere")}</span>
				</p>
				{phone ? (
					<p className="pb-2 text-label text-ink-muted" data-ly-credential-phone="">{t("credential.phoneOnly")}</p>
				) : typing ? (
					<form
						onSubmit={(event) => {
							event.preventDefault();
							void submit(false);
						}}
					>
						<CredentialFields kind={prompt.kind} values={values} onChange={setValues} autoFocus quiet />
						<p className="mt-2 text-caption text-ink-faint">{t("credential.modelSeesName")}</p>
						<button type="submit" className="hidden" tabIndex={-1} aria-hidden />
					</form>
				) : saved ? (
					<p className="rounded-lg bg-card px-3 py-2.5 text-label text-ink" data-ly-credential-saved="">
						{t("credential.savedOne", { date: new Date(saved.createdAt).toLocaleDateString(activeLocale()) })}
						{saved.username && <span className="text-ink-muted"> · {saved.username}</span>}
					</p>
				) : null}
				{problem && (
					<p role="alert" className="mt-2 break-words text-caption text-danger">
						{problem}
					</p>
				)}
			</div>
			<div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5 px-4 pt-2 pb-3" aria-busy={pending}>
				<button type="button" disabled={pending} onClick={() => void decline()} className={`${BUTTON} mr-auto text-ink-muted hover:bg-card-hover hover:text-ink active:bg-elevated`}>
					<X size={14} />
					{t("permission.reject")}
				</button>
				{!phone && typing && (
					<button type="button" role="checkbox" aria-checked={remember} onClick={() => setRemember((on) => !on)} className={`group ${BUTTON} text-ink-muted hover:text-ink`} data-ly-credential-remember="">
						<ChoiceMark checked={remember} kind="checkbox" />
						{t("credential.remember")}
					</button>
				)}
				{!phone && !typing && saved && (
					<button type="button" disabled={pending} onClick={() => setTyping(true)} className={`${BUTTON} text-ink-muted hover:bg-card-hover hover:text-ink active:bg-elevated`}>
						{t("credential.typeAnew")}
					</button>
				)}
				{!phone && (
					<button
						type="button"
						disabled={pending}
						onClick={() => void submit(!typing)}
						data-ly-credential-submit=""
						className={`${BUTTON} bg-ink px-3 font-medium text-shell transition-opacity hover:opacity-90 active:opacity-75`}
					>
						<Check size={14} />
						{typing ? t("credential.submit") : t("credential.useSaved")}
					</button>
				)}
			</div>
		</div>
	);
}
