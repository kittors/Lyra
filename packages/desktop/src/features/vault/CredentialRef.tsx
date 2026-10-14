/**
 * `[credential:name]` in a message, drawn as a chip that copies the value when clicked.
 *
 * The model can name a credential and never read one, so this is how "what is my NAS password" is
 * answered: the reply names it (`list_credentials` in core tells the model how), the person clicks, and
 * the main process puts the value on the clipboard and clears it 30 seconds later. The value never comes
 * into this process. The same chip stands for a reference the person pasted into their own message.
 *
 * Shaped like a file link in a sentence (`[data-ly-file-link]`): one inline box on the baseline, the
 * kind's mark and the title. A name nothing is saved under stays a chip without a click.
 */

import { Check, Copy, KeyRound } from "lucide-react";
import { useScopedSessionId } from "../../app/session-scope.tsx";
import { useI18n } from "../../i18n/index.ts";
import { available, bridge } from "../../services/index.ts";
import { useCopyFeedback } from "../../ui/primitives/CopyButton.tsx";
import { useKnownCredential } from "./known.ts";
import { KIND_ICON } from "./labels.ts";

export function CredentialRef({ name }: { name: string }) {
	const { t } = useI18n();
	const sessionId = useScopedSessionId();
	const meta = useKnownCredential(name, sessionId);
	const { state, run } = useCopyFeedback();

	if (!meta) {
		const why = !available("credentials", "copy") ? t("credential.refPhone") : meta === null ? t("credential.refUnknown") : undefined;
		return (
			<span data-ly-credential-ref="" data-state="unknown" data-ly-tip={why}>
				<KeyRound size={13} strokeWidth={1.9} aria-hidden />
				<span data-ly-credential-ref-name>{name}</span>
			</span>
		);
	}

	const key = meta.kind === "ssh_key";
	const copy = t(key ? "vault.copyPublicKey" : meta.kind === "token" ? "vault.copyToken" : "vault.copyPassword");
	const tip = state === "done" ? (key ? t("vault.copiedPublicKey") : t("vault.copiedSecret", { s: 30 })) : state === "failed" ? t("copy.failed") : copy;
	const Icon = KIND_ICON[meta.kind];
	return (
		<button
			type="button"
			data-ly-credential-ref=""
			data-state={state}
			data-ly-tip={tip}
			aria-label={`${copy} ${meta.title}`}
			onClick={(event) => {
				// The message row gives a click a meaning of its own.
				event.stopPropagation();
				run(async () => (await bridge.credentials.copy(name, sessionId ?? undefined)).copied);
			}}
		>
			<Icon size={13} strokeWidth={1.9} aria-hidden />
			<span data-ly-credential-ref-name>{meta.title}</span>
			{/* Says what a click does before anyone has to hover for it; the tick after says it happened. */}
			{state === "done" ? <Check size={12} strokeWidth={2.2} className="ly-pop text-ok" aria-hidden /> : <Copy size={12} strokeWidth={1.9} data-ly-credential-ref-copy="" aria-hidden />}
		</button>
	);
}
