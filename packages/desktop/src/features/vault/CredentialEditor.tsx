/**
 * Adding a credential to the vault, or changing one.
 *
 * A saved value is never shown or sent back here: editing one keeps it unless 重新填写 is pressed, and
 * then every field of its kind is typed again — a username changed alone would have to be sealed
 * with a password this page does not have. The reference name is fixed once saved: conversations and
 * messages already name it.
 */

import type { CredentialApproval, CredentialKind, CredentialMeta } from "@lyra/core";
import { CREDENTIAL_NAME, targetAllowed } from "@lyra/core/credential-fields";
import { useLayoutEffect, useRef, useState } from "react";
import { useI18n } from "../../i18n/index.ts";
import { bridge } from "../../services/index.ts";
import { Input } from "../../ui/inputs/NativeField.tsx";
import { Dialog, DialogAction } from "../../ui/overlay/Dialog.tsx";
import { Field, GlyphMark, InlineSelect, Segmented, TextInput } from "../settings/index.ts";
import { CredentialFields, type CredentialValues } from "./CredentialFields.tsx";
import { APPROVAL_LABEL, KIND_ICON, KIND_LABEL, KIND_ORDER, PROBLEM_LABEL } from "./labels.ts";
import { suggestName } from "./naming.ts";

const APPROVALS: readonly CredentialApproval[] = ["per-conversation", "every-use", "never"];
const NO_VALUES: CredentialValues = {};
const ignore = () => {};

export function CredentialEditor({
	item,
	taken,
	onClose,
	onChanged,
}: {
	/** The one being changed; null to add one. */
	item: CredentialMeta | null;
	/** Names already used, so the suggested one is free. */
	taken: readonly string[];
	onClose: () => void;
	onChanged: () => void;
}) {
	const { t } = useI18n();
	const adding = item === null;
	const [kind, setKind] = useState<CredentialKind>(item?.kind ?? "password");
	const [title, setTitle] = useState(item?.title ?? "");
	// Derived from the title until it is typed into; then it is the person's.
	const [typedName, setTypedName] = useState<string | null>(item?.name ?? null);
	const [values, setValues] = useState<CredentialValues>(item?.username ? { username: item.username } : {});
	const [target, setTarget] = useState(item?.target ?? "");
	const [approval, setApproval] = useState<CredentialApproval>(item?.approval ?? "per-conversation");
	const [reentering, setReentering] = useState(adding);
	const [problem, setProblem] = useState("");
	const [saving, setSaving] = useState(false);
	// Each kind's boxes, measured; null until the ruler has been laid out.
	const [heights, setHeights] = useState<Record<CredentialKind, number> | null>(null);
	const [switched, setSwitched] = useState(false);
	const name = typedName ?? suggestName(title, kind, taken);
	const reserve = adding && heights ? Math.max(...Object.values(heights)) - heights[kind] : 0;

	function localProblem(): string | null {
		if (!title.trim()) return t("credential.problemTitle");
		if (adding && !CREDENTIAL_NAME.test(name)) return t("credential.problemName");
		if (target.trim() && !targetAllowed(target.trim())) return t("credential.problemTarget");
		return null;
	}

	async function save(dismiss: (after?: () => void) => void) {
		if (saving) return;
		const local = localProblem();
		if (local) return setProblem(local);
		setSaving(true);
		setProblem("");
		try {
			const result = item
				? await bridge.credentials.update(item.name, { title: title.trim(), target: target.trim() || null, approval, ...(reentering ? { values } : {}) })
				: await bridge.credentials.add({ name, kind, title: title.trim(), ...(target.trim() ? { target: target.trim() } : {}), approval, values });
			if (!result.ok) return setProblem(t(PROBLEM_LABEL[result.problem]));
			// Held by the main process now; nothing typed outlives the form.
			setValues({});
			onChanged();
			dismiss();
		} catch (failure) {
			setProblem(failure instanceof Error ? failure.message : String(failure));
		} finally {
			setSaving(false);
		}
	}

	return (
		<Dialog
			onClose={onClose}
			label={adding ? t("vault.addTitle") : item.title}
			title={adding ? t("vault.addTitle") : item.title}
			icon={<GlyphMark glyph={KIND_ICON[kind]} name={t(KIND_LABEL[kind])} size={22} />}
			reserve={reserve}
			bodyClassName=""
			actions={(dismiss) => (
				<>
					<div className="flex-1" />
					<DialogAction onClick={() => dismiss()}>{t("common.cancel")}</DialogAction>
					<DialogAction tone="primary" disabled={saving} onClick={() => void save(dismiss)} data-ly-vault-save="">
						{t("common.save")}
					</DialogAction>
				</>
			)}
		>
			{(dismiss) => (
				<form
					data-ly-vault-editor={adding ? "add" : "edit"}
					className="relative flex flex-col gap-4 pb-1"
					onSubmit={(event) => {
						event.preventDefault();
						void save(dismiss);
					}}
				>
					{adding && (
						// In a row of its own it would stretch to the dialog's width with its segments bunched at the left.
						<div className="flex">
							<Segmented
								value={kind}
								onChange={(next) => {
									setKind(next);
									setValues({});
									setSwitched(true);
								}}
								options={KIND_ORDER.map((one) => ({ value: one, label: t(KIND_LABEL[one]) }))}
							/>
						</div>
					)}
					<div>
						<Field label={t("vault.titleLabel")}>
							<TextInput value={title} onChange={setTitle} autoFocus={adding} placeholder={t("vault.titlePlaceholder")} maxLength={80} data-ly-vault-title="" />
						</Field>
						<Reference name={name} editable={adding} onChange={setTypedName} />
					</div>
					{reentering ? (
						// A switch fades the new kind's boxes in; opening the dialog already has its own entrance.
						<div key={kind} className={switched ? "ly-swap-in" : undefined}>
							<CredentialFields kind={kind} values={values} onChange={setValues} autoFocus={!adding} row />
						</div>
					) : (
						// The saved value as a box that will not open: dots, never the value, and the way to replace it.
						<Field label={t(KIND_LABEL[kind])}>
							<div className="ly-field w-full gap-3 pr-1.5" data-ly-field="" data-ly-vault-value-kept="">
								{item?.username && <span className="shrink-0 text-ink">{item.username}</span>}
								<span className="min-w-0 flex-1 truncate tracking-[0.2em] text-ink-faint" aria-label={t("vault.valueKept")}>
									••••••••
								</span>
								<button type="button" onClick={() => setReentering(true)} className="h-7 shrink-0 rounded-md px-2.5 text-label text-ink-muted transition-colors hover:bg-card-hover hover:text-ink" data-ly-vault-reenter="">
									{t("vault.reenter")}
								</button>
							</div>
						</Field>
					)}
					<Field label={t("vault.targetLabel")} hint={t("vault.targetHint")}>
						<TextInput value={target} onChange={setTarget} mono spellCheck={false} autoComplete="off" placeholder="ssh://user@host" data-ly-vault-target="" />
					</Field>
					<div className="flex items-center justify-between gap-3">
						<span className="text-label text-ink-muted">{t("vault.approvalLabel")}</span>
						<InlineSelect value={approval} onChange={setApproval} ariaLabel={t("vault.approvalLabel")} options={APPROVALS.map((one) => ({ value: one, label: t(APPROVAL_LABEL[one]) }))} />
					</div>
					{problem && (
						<p role="alert" className="break-words rounded-[9px] border border-danger/35 bg-danger/8 px-3 py-2 text-detail leading-relaxed text-danger" data-ly-vault-problem="">
							{problem}
						</p>
					)}
					<button type="submit" className="hidden" tabIndex={-1} aria-hidden />
					{adding && <KindRuler onMeasure={setHeights} />}
				</form>
			)}
		</Dialog>
	);
}

/**
 * Every kind's boxes, laid out where nobody sees them, so the dialog keeps one height across kinds.
 *
 * The card sits centred in the window: a kind taller than the others moved both of its edges on every
 * switch. `row` is what makes the kinds equal — one row each, so there is no gap to leave under the
 * shorter ones. This catches what `row` cannot promise, a label that wraps in one language and not in
 * the next, and keeps that difference under the form as `reserve`. Measured rather than assumed, for
 * the same reason.
 */
function KindRuler({ onMeasure }: { onMeasure: (update: (previous: Record<CredentialKind, number> | null) => Record<CredentialKind, number>) => void }) {
	const ruler = useRef<HTMLDivElement>(null);
	useLayoutEffect(() => {
		const element = ruler.current;
		if (!element) return;
		const boxes = [...element.children] as HTMLElement[];
		/*
		 * The used height, not offsetHeight or the rect: offsetHeight rounds a 232.5px box to 233 and the
		 * card came out half a pixel taller on one kind; the rect is scaled while the dialog's entrance
		 * is still playing, which is exactly when this first runs.
		 */
		const measure = () =>
			onMeasure((previous) => {
				const next = Object.fromEntries(boxes.map((box) => [box.dataset.kind, Number.parseFloat(getComputedStyle(box).height) || 0])) as Record<CredentialKind, number>;
				return previous && KIND_ORDER.every((one) => previous[one] === next[one]) ? previous : next;
			});
		// Before the first paint, so the dialog opens at the height it will keep.
		measure();
		// Fonts arriving, the language changing, a window narrow enough to wrap a hint.
		const observer = new ResizeObserver(measure);
		for (const box of boxes) observer.observe(box);
		return () => observer.disconnect();
	}, [onMeasure]);
	return (
		<div ref={ruler} aria-hidden inert className="pointer-events-none invisible absolute inset-x-0 top-0 h-0 overflow-hidden" data-ly-vault-ruler="">
			{KIND_ORDER.map((one) => (
				<div key={one} data-kind={one}>
					<CredentialFields kind={one} values={NO_VALUES} onChange={ignore} row />
				</div>
			))}
		</div>
	);
}

/**
 * The reference as a message writes it, under the name it is derived from.
 *
 * A line rather than a field of its own: it is what the name turns into, and is rarely changed. The
 * name is typed into the middle of it, in a box as wide as the name — monospace, so `ch` is exact —
 * so the closing bracket follows the text instead of standing at the far end of the line.
 */
function Reference({ name, editable, onChange }: { name: string; editable: boolean; onChange: (name: string) => void }) {
	const { t } = useI18n();
	return (
		<div className="mt-1.5 flex items-baseline gap-2 text-detail text-ink-faint" data-ly-vault-reference="">
			<span className="shrink-0">{t("vault.nameLabel")}</span>
			<span className="flex min-w-0 items-baseline font-mono">
				[credential:
				{editable ? (
					<Input
						value={name}
						onChange={(event) => onChange(event.target.value.toLowerCase())}
						spellCheck={false}
						autoComplete="off"
						maxLength={40}
						aria-label={t("vault.nameLabel")}
						data-ly-vault-name=""
						style={{ width: `calc(${Math.max(name.length, 1)}ch + 2px)` }}
						className="min-w-0 bg-transparent text-ink-muted underline decoration-ink-faint/50 decoration-dotted underline-offset-4 outline-none hover:text-ink focus:text-ink focus:decoration-accent"
					/>
				) : (
					<span className="text-ink-muted">{name}</span>
				)}
				<span data-ly-vault-name-end="">]</span>
			</span>
		</div>
	);
}
