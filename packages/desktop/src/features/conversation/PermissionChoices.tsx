import { translate } from "../../i18n/translate.ts";
import { Check, ShieldCheck, X } from "lucide-react";
import { useRef, useState } from "react";

export function PermissionChoices({ subject, answer }: {
	subject?: string;
	answer(decision: "once" | "always" | "reject"): Promise<void>;
}) {
	const submitting = useRef(false);
	const [pending, setPending] = useState(false);
	const [error, setError] = useState("");
	async function submit(decision: "once" | "always" | "reject") {
		if (submitting.current) return;
		submitting.current = true;
		setPending(true); setError("");
		try { await answer(decision); }
		catch (failure) {
			submitting.current = false; setPending(false);
			setError(failure instanceof Error ? failure.message : String(failure));
		}
	}
	return <div className="shrink-0 border-t border-line-soft px-4 py-3">
		<div className="flex flex-wrap items-center justify-end gap-1.5" aria-busy={pending}>
			<button type="button" disabled={pending} onClick={() => void submit("reject")} className="grid place-items-center min-h-8 rounded-lg text-label text-ink-muted transition-colors hover:bg-card-hover active:bg-elevated disabled:opacity-50 w-8"
			data-ly-tip={translate("permission.reject")}
			aria-label={translate("permission.reject")}
		><X size={14} /></button>
			<button type="button" disabled={pending} onClick={() => void submit("always")} data-ly-tip={subject ? translate("permission.neverAskFor", { subject }) : translate("permission.neverAsk")} className="grid place-items-center min-h-8 rounded-lg text-label text-ink-muted transition-colors hover:bg-card-hover active:bg-elevated disabled:opacity-50 w-8"
			aria-label={translate("permission.never")}
		><ShieldCheck size={14} /></button>
			<button type="button" disabled={pending} onClick={() => void submit("once")} className="grid place-items-center min-h-8 rounded-lg bg-ink text-label font-medium text-shell transition-opacity hover:opacity-90 active:opacity-75 disabled:opacity-50 w-8"
			data-ly-tip={translate("permission.once")}
			aria-label={translate("permission.once")}
		><Check size={14} /></button>
		</div>
		{error && <p role="alert" className="mt-2 break-words text-caption text-danger">{error}</p>}
	</div>;
}
