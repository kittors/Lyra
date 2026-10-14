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
import { useState } from "react";
import { useI18n } from "../../i18n/index.ts";
import { bridge } from "../../services/index.ts";
import { Input } from "../../ui/inputs/NativeField.tsx";
import { Dialog, DialogAction } from "../../ui/overlay/Dialog.tsx";
import { InlineSelect, Segmented, TextInput } from "../settings/index.ts";
import { CredentialFields, type CredentialValues } from "./CredentialFields.tsx";
import { APPROVAL_LABEL, KIND_ICON, KIND_LABEL, KIND_ORDER, PROBLEM_LABEL } from "./labels.ts";
import { suggestName } from "./naming.ts";

const APPROVALS: readonly CredentialApproval[] = ["per-conversation", "every-use", "never"];

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
	const [deleting, setDeleting] = useState(false);
	const name = typedName ?? suggestName(title, kind, taken);
	const Icon = KIND_ICON[kind];

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

	if (deleting && item) {
		return (
			<Dialog
				onClose={onClose}
				label={t("vault.deleteConfirm", { name: item.title })}
				title={t("vault.deleteConfirm", { name: item.title })}
				detail={t("vault.deleteDetail")}
				actions={(dismiss) => (
					<>
						<div className="flex-1" />
						<DialogAction onClick={() => setDeleting(false)}>{t("common.cancel")}</DialogAction>
						<DialogAction
							tone="danger"
							data-ly-vault-delete-confirm=""
							onClick={() =>
								dismiss(() => {
									void bridge.credentials.remove(item.name).finally(onChanged);
									onClose();
								})
							}
						>
							{t("common.delete")}
						</DialogAction>
					</>
				)}
			/>
		);
	}

	return (
		<Dialog
			onClose={onClose}
			label={adding ? t("vault.addTitle") : item.title}
			title={adding ? t("vault.addTitle") : item.title}
			icon={<Icon size={15} strokeWidth={1.8} className="shrink-0 text-ink-muted" aria-hidden />}
			bodyClassName="max-h-[min(560px,64dvh)]"
			actions={(dismiss) => (
				<>
					{!adding && (
						<DialogAction tone="danger" onClick={() => setDeleting(true)} data-ly-vault-delete="">
							{t("common.delete")}
						</DialogAction>
					)}
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
					className="space-y-4 pb-1"
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
								}}
								options={KIND_ORDER.map((one) => ({ value: one, label: t(KIND_LABEL[one]) }))}
							/>
						</div>
					)}
					<label className="block">
						<span className="mb-1.5 block text-detail text-ink-muted">{t("vault.titleLabel")}</span>
						<TextInput value={title} onChange={setTitle} autoFocus={adding} placeholder={t("vault.titlePlaceholder")} maxLength={80} data-ly-vault-title="" />
					</label>
					{adding && (
						<label className="block">
							<span className="mb-1.5 block text-detail text-ink-muted">{t("vault.nameLabel")}</span>
							{/*
							 * The reference as a message writes it, the name typed into its middle. The box is as
							 * wide as the name — monospace, so `ch` is exact — and the closing bracket follows it
							 * rather than standing at the far end of the field.
							 */}
							<div className="ly-field w-full gap-0 font-mono text-code" data-ly-field="">
								<span className="shrink-0 text-ink-faint">[credential:</span>
								<Input
									value={name}
									onChange={(event) => setTypedName(event.target.value.toLowerCase())}
									spellCheck={false}
									autoComplete="off"
									maxLength={40}
									aria-label={t("vault.nameLabel")}
									data-ly-vault-name=""
									style={{ width: `calc(${Math.max(name.length, 1)}ch + 2px)` }}
									className="h-full min-w-0 shrink bg-transparent text-ink outline-none"
								/>
								<span className="shrink-0 text-ink-faint" data-ly-vault-name-end="">]</span>
							</div>
						</label>
					)}
					{reentering ? (
						<CredentialFields kind={kind} values={values} onChange={setValues} autoFocus={!adding} />
					) : (
						<div className="flex items-center justify-between gap-3 rounded-lg bg-card px-3 py-2.5" data-ly-vault-value-kept="">
							<span className="text-label text-ink-muted">{t("vault.valueKept")}</span>
							<button type="button" onClick={() => setReentering(true)} className="text-label text-ink transition-colors hover:text-accent" data-ly-vault-reenter="">
								{t("vault.reenter")}
							</button>
						</div>
					)}
					<label className="block">
						<span className="mb-1.5 block text-detail text-ink-muted">{t("vault.targetLabel")}</span>
						<TextInput value={target} onChange={setTarget} mono spellCheck={false} autoComplete="off" placeholder={t("vault.targetPlaceholder")} data-ly-vault-target="" />
					</label>
					<div className="flex items-center justify-between gap-3">
						<span className="text-detail text-ink-muted">{t("vault.approvalLabel")}</span>
						<InlineSelect value={approval} onChange={setApproval} ariaLabel={t("vault.approvalLabel")} options={APPROVALS.map((one) => ({ value: one, label: t(APPROVAL_LABEL[one]) }))} />
					</div>
					{problem && (
						<p role="alert" className="break-words text-caption text-danger" data-ly-vault-problem="">
							{problem}
						</p>
					)}
					<button type="submit" className="hidden" tabIndex={-1} aria-hidden />
				</form>
			)}
		</Dialog>
	);
}
