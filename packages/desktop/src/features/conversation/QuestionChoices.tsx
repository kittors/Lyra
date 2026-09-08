import { translate } from "../../i18n/translate.ts";
import { ArrowUp, ArrowUpRight, PencilLine, X } from "lucide-react";
import { useRef, useState } from "react";
import type { ApprovalDecision } from "@lyra/core";
import { Input } from "../../ui/inputs/NativeField.tsx";

export function QuestionChoices({ options, allowCustomInput, answer }: {
	options: string[];
	allowCustomInput: boolean;
	answer(decision: ApprovalDecision): Promise<void>;
}) {
	const [text, setText] = useState("");
	const [custom, setCustom] = useState(options.length === 0);
	const submitting = useRef(false);
	const [pending, setPending] = useState(false);
	const [error, setError] = useState("");
	async function submit(decision: ApprovalDecision) {
		if (submitting.current) return;
		submitting.current = true;
		setPending(true);
		setError("");
		try { await answer(decision); }
		catch (failure) {
			submitting.current = false;
			setError(failure instanceof Error ? failure.message : String(failure));
			setPending(false);
		}
	}
	return <div className="pt-3 pb-1" aria-busy={pending}>
		<div className="flex flex-wrap items-center justify-end gap-1.5">
			<button type="button" disabled={pending} onClick={() => void submit("reject")}
				className="flex min-h-8 items-center gap-1.5 rounded-lg px-2.5 text-label text-ink-muted transition-colors hover:bg-card-hover active:bg-elevated disabled:opacity-50"><X size={14} className="shrink-0" />取消</button>
			{allowCustomInput && options.length > 0 && <button type="button" aria-label={translate("question.custom")} aria-expanded={custom} disabled={pending} onClick={() => setCustom(value => !value)} className={`flex min-h-8 items-center gap-1.5 rounded-lg px-2.5 text-label transition-colors hover:bg-card-hover active:bg-elevated disabled:opacity-50 ${custom ? "bg-card-hover text-ink" : "text-ink-muted"}`}><PencilLine size={14} className="shrink-0" />其他想法</button>}
			{options.map((option) => <button key={option} type="button" disabled={pending}
				onClick={() => void submit({ answer: option })}
				className="flex min-h-8 max-w-full items-center gap-1.5 rounded-lg bg-card px-2.5 py-1.5 text-left text-label text-ink transition-colors hover:bg-card-hover active:bg-elevated disabled:opacity-50"><ArrowUpRight size={14} className="shrink-0 text-ink-muted" /><span className="min-w-0 break-words">{option}</span></button>)}
		</div>
		{allowCustomInput && custom && <form className="mt-2 flex items-center gap-2 rounded-lg bg-input p-1" onSubmit={(event) => { event.preventDefault(); if (text.trim()) void submit({ answer: text.trim() }); }}>
			<Input autoFocus aria-label={translate("question.custom")} placeholder={translate("question.customPlaceholder")} value={text} disabled={pending} onChange={(event) => setText(event.target.value)}
				className="min-h-8 min-w-0 flex-1 bg-transparent px-2 text-label text-ink placeholder:text-ink-faint" />
			<button type="submit" aria-label={translate("question.sendAnswer")} disabled={pending || !text.trim()} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-ink text-shell transition-opacity hover:opacity-90 disabled:opacity-40"><ArrowUp size={15} /></button>
		</form>}
		{error && <p role="alert" className="mt-2 break-words text-caption text-danger">{error}</p>}
	</div>;
}
