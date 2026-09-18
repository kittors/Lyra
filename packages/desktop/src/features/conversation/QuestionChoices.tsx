import { translate } from "../../i18n/translate.ts";
import { Check, SkipForward, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { ApprovalDecision, QuestionFields } from "@lyra/core";
import { Input } from "../../ui/inputs/NativeField.tsx";
import { Scroller } from "../../ui/scroll/Scroller.tsx";

const EMPTY_OPTIONS: NonNullable<QuestionFields["options"]> = [];

function rowTone(on: boolean): string {
	// Same idle wash as `.ly-user-bubble`. Selected is only a quieter accent fill: no mark, no index.
	return `group flex w-full min-w-0 cursor-pointer gap-3 rounded-lg px-3 py-2 text-left text-label transition-colors duration-[var(--ly-t-quick)] ${on ? "bg-accent/[0.08]" : "bg-card hover:bg-card-hover"}`;
}

export function QuestionChoices({ options = EMPTY_OPTIONS, allowCustomInput, selectionMode = "single", allowSkip = false, defaultOptionIndex, children, answer }: QuestionFields & {
	children?: ReactNode;
	answer(decision: ApprovalDecision): Promise<void>;
}) {
	const choices = options.map(option => typeof option === "string" ? { label: option } : option);
	const [selected, setSelected] = useState<number[]>(defaultOptionIndex !== undefined ? [defaultOptionIndex] : []);
	const [text, setText] = useState("");
	const [otherOn, setOtherOn] = useState(options.length === 0);
	const submitting = useRef(false);
	const composing = useRef(false);
	const formRef = useRef<HTMLFormElement>(null);
	const customRef = useRef<HTMLInputElement>(null);
	const [pending, setPending] = useState(false);
	const [error, setError] = useState("");
	const values = [...selected.map(index => choices[index]?.label).filter((label): label is string => label !== undefined), ...(otherOn && text.trim() ? [text.trim()] : [])];
	const canSubmit = values.length > 0 && (!otherOn || Boolean(text.trim()));
	const kind = selectionMode === "multi" ? "checkbox" : "radio";

	useEffect(() => { formRef.current?.focus(); }, []);

	function pick(index: number) {
		setSelected(current => selectionMode === "multi" ? current.includes(index) ? current.filter(value => value !== index) : [...current, index] : [index]);
		if (selectionMode === "single") setOtherOn(false);
	}
	function selectOther() {
		setOtherOn(true);
		if (selectionMode === "single") setSelected([]);
	}
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
	function onFormKey(event: React.KeyboardEvent<HTMLFormElement>) {
		if (event.nativeEvent.isComposing || composing.current) return;
		if (event.key === "Escape" && allowSkip) { event.preventDefault(); void submit("skip"); return; }
		const target = event.target;
		if (target instanceof HTMLInputElement && target.type !== "radio" && target.type !== "checkbox") return;
		if (target instanceof HTMLTextAreaElement) return;
		if (event.key >= "1" && event.key <= "9") {
			const index = Number(event.key) - 1;
			if (index < choices.length) { event.preventDefault(); pick(index); }
			return;
		}
		if (event.key === "0" && allowCustomInput) {
			event.preventDefault();
			selectOther();
			customRef.current?.focus();
		}
	}
	// oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- Escape and digit keys apply to every control in this form.
	return <form ref={formRef} tabIndex={-1} data-ly-question-form data-ly-choice-mode={selectionMode} className="flex min-h-0 flex-1 flex-col outline-none" aria-busy={pending}
		onSubmit={event => { event.preventDefault(); if (canSubmit) void submit({ answer: selectionMode === "multi" ? values : values[0] }); }}
		onKeyDown={onFormKey}>
		<Scroller className="ly-approval-scroll min-h-0 max-h-[min(320px,36dvh)]" top="fade" bottom="fade" contentClassName="px-4 py-2">
			{children}
			<fieldset disabled={pending} className="mt-3 flex min-w-0 flex-col gap-1.5">
				<legend className="sr-only">{translate(selectionMode === "multi" ? "question.selectMany" : "question.selectOne")}</legend>
				{choices.map((option, index) => {
					const on = selected.includes(index);
					return <label key={option.label} data-ly-question-option className={`${rowTone(on)} items-center`}>
						<input type={kind} name="question-choice" checked={on} className="sr-only" onChange={() => pick(index)} />
						<span className="min-w-0 flex-1">
							<span data-ly-question-label className="block break-words text-ink">{option.label}</span>
							{option.description && <span className="mt-0.5 block text-caption leading-relaxed text-ink-muted">{option.description}</span>}
						</span>
						{option.recommended && <span data-ly-question-recommended className="shrink-0 self-center rounded-full bg-accent/10 px-2 py-0.5 text-caption text-accent">{translate("question.recommended")}</span>}
					</label>;
				})}
			</fieldset>
		</Scroller>
		{allowCustomInput && <div className="shrink-0 px-4 pb-1 pt-1">
			<label data-ly-question-other className={`${rowTone(otherOn)} items-center`}>
				<input type={kind} name="question-choice" checked={otherOn} className="sr-only" onChange={() => { selectOther(); customRef.current?.focus(); }} />
				<span className="shrink-0 leading-[1.5] text-ink">{translate("question.other")}</span>
				<Input ref={customRef} aria-label={translate("question.custom")} placeholder={translate("question.customPlaceholder")} value={text} disabled={pending}
					onChange={event => { setText(event.target.value); selectOther(); }}
					onFocus={selectOther}
					onCompositionStart={() => { composing.current = true; }}
					onCompositionEnd={() => { composing.current = false; }}
					className="h-7 min-w-0 flex-1 rounded-md bg-shell px-2.5 text-label text-ink placeholder:text-ink-faint" />
			</label>
		</div>}
		<div data-ly-question-footer className="shrink-0 px-4 pb-3 pt-1">
			<div className="flex flex-wrap items-center justify-end gap-2">
				{allowSkip && <button type="button" disabled={pending} onClick={() => void submit("skip")} className="mr-auto flex h-8 items-center gap-1.5 rounded-lg px-2 text-label text-ink-muted hover:bg-card-hover disabled:opacity-50"><SkipForward size={14} />{translate("question.skip")}</button>}
				<button type="button" disabled={pending} onClick={() => void submit("reject")} className="flex h-8 items-center gap-1.5 rounded-lg px-2 text-label text-ink-muted hover:bg-card-hover disabled:opacity-50"><X size={14} />{translate("common.cancel")}</button>
				<button type="submit" aria-label={translate(otherOn ? "question.sendAnswer" : "question.confirm")} disabled={pending || !canSubmit} className="flex h-8 items-center gap-1.5 rounded-lg bg-ink px-3 text-label text-shell disabled:opacity-40"><Check size={14} />{translate(otherOn ? "question.sendAnswer" : "question.confirm")}</button>
			</div>
			{defaultOptionIndex !== undefined && allowSkip && <p className="mt-2 text-caption text-ink-muted">{translate("question.skipDefault", { choice: choices[defaultOptionIndex]?.label ?? "" })}</p>}
			{error && <p role="alert" className="mt-2 break-words text-caption text-danger">{error}</p>}
		</div>
	</form>;
}
