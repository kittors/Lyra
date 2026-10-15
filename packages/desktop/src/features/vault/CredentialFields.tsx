/**
 * The boxes a credential's value is typed into: one per field of its kind.
 *
 * Shared by the card a conversation raises and the vault page's form, and drawn from the same table
 * the broker reads values by (`fieldsFor`), so neither can ask for a field the other would drop.
 */

import type { CredentialKind, FieldKey } from "@lyra/core";
import { fieldsFor } from "@lyra/core/credential-fields";
import { useI18n } from "../../i18n/index.ts";
import { Textarea } from "../../ui/inputs/NativeField.tsx";
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
	row = false,
	placeholder,
}: {
	kind: CredentialKind;
	values: CredentialValues;
	onChange: (values: CredentialValues) => void;
	/** Into the first box: whoever opened this is about to type into it. */
	autoFocus?: boolean;
	/** No label over a kind's only box: the card has already said what kind it is. */
	quiet?: boolean;
	/**
	 * Every box of the kind side by side, each one line tall — for the vault's dialog, which keeps one
	 * height across the kinds: stacked, a login is two rows and a private key five lines more than a
	 * password, and the shorter kinds were left with a gap the size of the difference.
	 *
	 * A private key is pasted, not read — it turns to dots the moment it is in — so one line holds it
	 * as well as four did. What the hints under the boxes said moves into the boxes.
	 */
	row?: boolean;
	/** In the empty box the secret is typed into — the card says there that the model will not see it. */
	placeholder?: string;
}) {
	const { t } = useI18n();
	const fields = fieldsFor(kind);
	return (
		<div className={row ? `grid gap-3 ${fields.length > 1 ? "grid-cols-2" : "grid-cols-1"}` : "flex flex-col gap-3.5"} data-ly-credential-fields={kind}>
			{fields.map((field, index) => {
				const value = values[field.key] ?? "";
				const set = (next: string) => onChange({ ...values, [field.key]: next });
				const label = t(FIELD_LABEL[field.key]);
				const focus = autoFocus && index === 0;
				const box =
					field.multiline && row ? (
						// A textarea still, so the key's line breaks survive the paste; an input drops them.
						<div className="ly-field w-full" data-ly-field="">
							<Textarea
								value={value}
								onChange={(event) => set(event.target.value)}
								rows={1}
								autoFocus={focus}
								spellCheck={false}
								autoComplete="off"
								aria-label={label}
								placeholder={t("credential.privateKeyPaste")}
								className={`min-w-0 flex-1 resize-none overflow-hidden whitespace-pre bg-transparent text-ink outline-none placeholder:text-ink-faint ${value ? "ly-secret-text tracking-wide" : ""}`}
							/>
						</div>
					) : field.multiline ? (
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
						<SecretInput
							value={value}
							onChange={set}
							autoFocus={focus}
							label={label}
							placeholder={field.optional ? (row ? t("credential.optionalShort") : undefined) : placeholder}
						/>
					) : (
						<TextInput value={value} onChange={set} autoFocus={focus} aria-label={label} spellCheck={false} autoComplete="off" />
					);
				return (
					<div key={field.key} className={row ? "min-w-0" : undefined} data-ly-credential-field={field.key}>
						{quiet && fields.length === 1 ? (
							box
						) : (
							<Field label={label} hint={field.optional && !row ? t("credential.optional") : undefined}>
								{box}
							</Field>
						)}
					</div>
				);
			})}
		</div>
	);
}
