/**
 * The boxes a credential's value is typed into: one per field of its kind.
 *
 * Shared by the card a conversation raises and the vault page's form, and drawn from the same table
 * the broker reads values by (`fieldsFor`), so neither can ask for a field the other would drop.
 */

import type { CredentialKind, FieldKey } from "@lyra/core";
import { fieldsFor } from "@lyra/core/credential-fields";
import { useI18n } from "../../i18n/index.ts";
import { TextArea } from "../../ui/inputs/TextArea.tsx";
import { Field, SecretInput, TextInput } from "../settings/index.ts";
import { FIELD_LABEL } from "./labels.ts";

export type CredentialValues = Partial<Record<FieldKey, string>>;

export function CredentialFields({
	kind,
	values,
	onChange,
	autoFocus = false,
	quiet = false,
	placeholder,
}: {
	kind: CredentialKind;
	values: CredentialValues;
	onChange: (values: CredentialValues) => void;
	/** Into the first box: whoever opened this is about to type into it. */
	autoFocus?: boolean;
	/** No label over a kind's only box: the card has already said what kind it is. */
	quiet?: boolean;
	/** In the empty box the secret is typed into — the card says there that the model will not see it. */
	placeholder?: string;
}) {
	const { t } = useI18n();
	const fields = fieldsFor(kind);
	return (
		<div className="flex flex-col gap-3.5" data-ly-credential-fields={kind}>
			{fields.map((field, index) => {
				const value = values[field.key] ?? "";
				const set = (next: string) => onChange({ ...values, [field.key]: next });
				const label = t(FIELD_LABEL[field.key]);
				const focus = autoFocus && index === 0;
				const box = field.multiline ? (
					<TextArea
						value={value}
						onChange={set}
						rows={4}
						autoFocus={focus}
						spellCheck={false}
						autoComplete="off"
						aria-label={label}
						placeholder={t("credential.privateKeyHint")}
						// Dots once there is something to hide; the placeholder stays readable.
						className={`font-mono text-code ${value ? "ly-secret-text" : ""}`}
					/>
				) : field.secret ? (
					<SecretInput value={value} onChange={set} autoFocus={focus} label={label} placeholder={field.optional ? undefined : placeholder} />
				) : (
					<TextInput value={value} onChange={set} autoFocus={focus} aria-label={label} spellCheck={false} autoComplete="off" />
				);
				return (
					<div key={field.key} data-ly-credential-field={field.key}>
						{quiet && fields.length === 1 ? (
							box
						) : (
							<Field label={label} hint={field.optional ? t("credential.optional") : undefined}>
								{box}
							</Field>
						)}
					</div>
				);
			})}
		</div>
	);
}
