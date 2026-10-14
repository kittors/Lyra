import type { CredentialKind } from "@lyra/core";

/** What a credential is called when its title gives nothing to go on — a title in Chinese, say. */
const KIND_NAME: Record<CredentialKind, string> = { password: "password", login: "login", token: "token", ssh_key: "ssh-key" };

/**
 * The reference name the form offers for a title: `NAS admin` is `nas-admin`, and a title with no
 * Latin letters in it falls back to the kind. Never one already taken — `add` refuses those, and a
 * form that suggests what it will then refuse is a trap.
 */
export function suggestName(title: string, kind: CredentialKind, taken: readonly string[]): string {
	const slug = title
		.normalize("NFKD")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.slice(0, 32)
		.replace(/^-+|-+$/g, "");
	const base = slug || KIND_NAME[kind];
	if (!taken.includes(base)) return base;
	for (let n = 2; ; n++) if (!taken.includes(`${base}-${n}`)) return `${base}-${n}`;
}
