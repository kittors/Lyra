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
	return <div className="px-4 pt-1 pb-3">
		<div className="flex flex-wrap items-center justify-end gap-1.5" aria-busy={pending}>
			<button type="button" disabled={pending} onClick={() => void submit("reject")} className="flex min-h-8 items-center gap-1.5 rounded-lg px-2.5 text-label text-ink-muted transition-colors hover:bg-card-hover active:bg-elevated disabled:opacity-50"><X size={14} />
				{translate("permission.reject")}
			</button>
			<button type="button" disabled={pending} onClick={() => void submit("always")} data-ly-tip={subject ? translate("permission.neverAskFor", { subject }) : translate("permission.neverAsk")} className="flex min-h-8 items-center gap-1.5 rounded-lg px-2.5 text-label text-ink-muted transition-colors hover:bg-card-hover active:bg-elevated disabled:opacity-50"><ShieldCheck size={14} />
				{translate("permission.never")}
			</button>
			<button type="button" disabled={pending} onClick={() => void submit("once")} className="flex min-h-8 items-center gap-1.5 rounded-lg bg-ink px-3 text-label font-medium text-shell transition-opacity hover:opacity-90 active:opacity-75 disabled:opacity-50"><Check size={14} />
				{translate("permission.once")}
			</button>
		</div>
		{error && <p role="alert" className="mt-2 break-words text-caption text-danger">{error}</p>}
	</div>;
}
