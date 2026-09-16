import { translate } from "../../i18n/translate.ts";
import { Check, PencilLine, SkipForward, X } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import type { ApprovalDecision, QuestionFields } from "@lyra/core";
import { Input } from "../../ui/inputs/NativeField.tsx";
import { ChoiceMark } from "../../ui/primitives/ChoiceMark.tsx";
import { Scroller } from "../../ui/scroll/Scroller.tsx";

const EMPTY_OPTIONS: NonNullable<QuestionFields["options"]> = [];

export function QuestionChoices({ options = EMPTY_OPTIONS, allowCustomInput, selectionMode = "single", allowSkip = false, defaultOptionIndex, children, answer }: QuestionFields & {
	children?: ReactNode;
	answer(decision: ApprovalDecision): Promise<void>;
}) {
	const choices = options.map(option => typeof option === "string" ? { label: option } : option);
	const [selected, setSelected] = useState<number[]>(defaultOptionIndex !== undefined ? [defaultOptionIndex] : []);
	const [text, setText] = useState("");
	const [custom, setCustom] = useState(options.length === 0);
	const submitting = useRef(false);
	const composing = useRef(false);
	const [pending, setPending] = useState(false);
	const [error, setError] = useState("");
	const values = [...selected.map(index => choices[index]?.label).filter((label): label is string => label !== undefined), ...(custom && text.trim() ? [text.trim()] : [])];
	const canSubmit = values.length > 0 && (!custom || Boolean(text.trim()));
	async function submit(decision: ApprovalDecision) {
		if (submitting.current || composing.current) return;
		submitting.current = true;
		setPending(true); setError("");
		try { await answer(decision); }
		catch (failure) {
			submitting.current = false;
			setError(failure instanceof Error ? failure.message : String(failure));
			setPending(false);
		}
	}
	// oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- Escape applies to every focusable control within this form.
	return <form className="flex min-h-0 flex-col" aria-busy={pending}
		onSubmit={event => { event.preventDefault(); if (canSubmit) void submit({ answer: selectionMode === "multi" ? values : values[0] }); }}
		onKeyDown={event => { if (event.nativeEvent.isComposing || composing.current) return; if (event.key === "Escape" && allowSkip) { event.preventDefault(); void submit("skip"); } }}>
		<Scroller className="ly-approval-scroll min-h-0 max-h-[min(360px,40dvh)]" contentClassName="px-4 py-2">
			{children}
			<fieldset disabled={pending} className="mt-3 flex min-w-0 flex-col gap-2">
				<legend className="sr-only">{translate(selectionMode === "multi" ? "question.selectMany" : "question.selectOne")}</legend>
				{choices.map((option, index) => {
					const on = selected.includes(index);
					return <label key={option.label} className={`group flex w-full cursor-pointer items-start gap-2.5 rounded-xl border p-2.5 text-left text-label transition-colors duration-[var(--ly-t-quick)] has-[:focus-visible]:border-accent/50 ${on ? "border-accent/40 bg-accent/[0.04]" : "border-line-soft hover:border-ink-faint/30 hover:bg-card-hover/40"}`}>
						<input type={selectionMode === "multi" ? "checkbox" : "radio"} name="question-choice" checked={on} className="sr-only" onChange={() => {
							setSelected(current => selectionMode === "multi" ? current.includes(index) ? current.filter(value => value !== index) : [...current, index] : [index]);
							if (selectionMode === "single") setCustom(false);
						}} />
						<ChoiceMark kind={selectionMode === "multi" ? "checkbox" : "radio"} checked={on} className="mt-0.5" />
						<span className="min-w-0 flex-1 break-words"><span className="text-ink">{option.label}</span>{option.description && <span className="mt-1 block text-caption text-ink-muted">{option.description}</span>}</span>
						{option.recommended && <span className="shrink-0 rounded-full bg-accent/10 px-2 py-0.5 text-caption text-accent">{translate("question.recommended")}</span>}
					</label>;
				})}
				{allowCustomInput && <button type="button" aria-label={translate("question.custom")} aria-expanded={custom} disabled={pending} onClick={() => { setCustom(value => !value); if (selectionMode === "single") setSelected([]); }} className={`flex w-full items-center gap-2.5 rounded-xl border p-2.5 text-left text-label transition-colors duration-[var(--ly-t-quick)] ${custom ? "border-accent/40 bg-accent/[0.04]" : "border-line-soft hover:border-ink-faint/30 hover:bg-card-hover/40"}`}><PencilLine size={14} />{translate("question.otherCard")}</button>}
				{allowCustomInput && custom && <div className="rounded-lg bg-input p-2">
					<Input autoFocus aria-label={translate("question.custom")} placeholder={translate("question.customPlaceholder")} value={text} disabled={pending} onChange={event => setText(event.target.value)} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }} className="min-h-8 w-full bg-transparent px-1 text-label text-ink placeholder:text-ink-faint" />
					<span className="block text-right text-caption text-ink-faint">{text.length}</span>
				</div>}
			</fieldset>
		</Scroller>
		<div className="shrink-0 border-t border-line-soft px-4 py-3">
			<div className="flex flex-wrap items-center justify-end gap-2">
				{allowSkip && <button type="button" disabled={pending} onClick={() => void submit("skip")} className="mr-auto flex min-h-8 items-center gap-1.5 rounded-lg px-2 text-label text-ink-muted hover:bg-card-hover disabled:opacity-50"><SkipForward size={14} />{translate("question.skip")}</button>}
				<button type="button" disabled={pending} onClick={() => void submit("reject")} className="flex min-h-8 items-center gap-1.5 rounded-lg px-2 text-label text-ink-muted hover:bg-card-hover disabled:opacity-50"><X size={14} />{translate("common.cancel")}</button>
				<button type="submit" aria-label={translate(custom ? "question.sendAnswer" : "question.confirm")} disabled={pending || !canSubmit} className="flex min-h-8 items-center gap-1.5 rounded-lg bg-ink px-3 text-label text-shell disabled:opacity-40"><Check size={14} />{translate(custom ? "question.sendAnswer" : "question.confirm")}</button>
			</div>
			{defaultOptionIndex !== undefined && allowSkip && <p className="mt-2 text-caption text-ink-muted">{translate("question.skipDefault", { choice: choices[defaultOptionIndex]?.label ?? "" })}</p>}
			{error && <p role="alert" className="mt-2 break-words text-caption text-danger">{error}</p>}
		</div>
	</form>;
}
