/**
 * What each kind, field, setting and refusal is called, for the vault page and the credential card.
 *
 * One table for both, because they describe the same thing to the same person: a card that says 令牌
 * where the vault says 访问令牌 reads as two different things.
 */

import type { CredentialApproval, CredentialKind, FieldKey, SavedProblem, SubmitProblem } from "@lyra/core";
import { KeyRound, KeySquare, LockKeyhole, type LucideIcon, UserRound } from "lucide-react";
import type { MessageKey } from "../../i18n/messages/index.ts";

export const KIND_LABEL: Record<CredentialKind, MessageKey> = {
	password: "credential.kindPassword",
	login: "credential.kindLogin",
	token: "credential.kindToken",
	ssh_key: "credential.kindSshKey",
};

export const KIND_ICON: Record<CredentialKind, LucideIcon> = {
	password: LockKeyhole,
	login: UserRound,
	token: KeySquare,
	ssh_key: KeyRound,
};

/** The order the kinds are offered in: the commonest first. */
export const KIND_ORDER: readonly CredentialKind[] = ["password", "login", "token", "ssh_key"];

export const FIELD_LABEL: Record<FieldKey, MessageKey> = {
	username: "credential.fieldUsername",
	password: "credential.fieldPassword",
	token: "credential.fieldToken",
	private_key: "credential.fieldPrivateKey",
	passphrase: "credential.fieldPassphrase",
};

export const APPROVAL_LABEL: Record<CredentialApproval, MessageKey> = {
	"every-use": "credential.approvalEveryUse",
	"per-conversation": "credential.approvalPerConversation",
	never: "credential.approvalNever",
};

/** Why something was not saved or not taken, as one sentence. `invalid` is sorted out by the form before it is sent. */
export const PROBLEM_LABEL: Record<SavedProblem | SubmitProblem, MessageKey> = {
	missing: "credential.problemMissing",
	"not-a-key": "credential.problemNotAKey",
	"needs-passphrase": "credential.problemNeedsPassphrase",
	"wrong-passphrase": "credential.problemWrongPassphrase",
	"public-key": "credential.problemPublicKey",
	expired: "credential.problemExpired",
	"no-saved": "credential.problemNoSaved",
	exists: "credential.problemExists",
	gone: "credential.problemGone",
	invalid: "credential.problemInvalid",
};
