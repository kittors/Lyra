/**
 * Which value, if any, answers a prompt that ssh, sudo or git put to the askpass helper.
 *
 * This is the one place a credential's binding is enforced for commands, so it errs towards
 * refusing. A refusal costs one failed command with a sentence explaining it; answering the wrong
 * prompt hands a password to a server that was never meant to see it.
 *
 * - **A confirmation is never answered.** In `force` mode ssh sends its host-key question
 *   (`… (yes/no/[fingerprint])?`) to askpass too — measured with a throwaway sshd — and a password
 *   is not an answer to it.
 * - **A prompt that names its destination is answered by a credential bound there**, or by one
 *   bound nowhere — the card said "anywhere" when it was filled. `root@100.64.0.5's password:` never
 *   gets a password bound to another server, so a command naming two cannot leak one to the other.
 * - **A prompt that names none** — `sudo`'s, a key passphrase — is answered only by a credential
 *   bound nowhere: a password the model asked for a particular server is not your sudo password.
 * - **Two that fit equally is a refusal**, not a guess.
 */

import { type CredentialKind, type CredentialTarget, parseTarget } from "./types.ts";

export interface AskpassSecret {
	name: string;
	kind: CredentialKind;
	target?: string;
	username?: string;
	/** The password, or the token for a git remote. */
	secret: string;
}

export type AskpassRefusal = "confirmation" | "unknown-prompt" | "no-match" | "no-username" | "ambiguous";

export type AskpassDecision = { answer: string; name: string } | { refused: AskpassRefusal };

interface Destination {
	user?: string;
	host: string;
}

/** `user@host` in ssh's two password prompt shapes, and the URL in git's. */
function destinationOf(prompt: string): { destination?: Destination; wants: "password" | "username" } | null {
	const git = /^(Username|Password) for '([^']+)'/i.exec(prompt);
	if (git) {
		try {
			const url = new URL(git[2]!);
			return {
				wants: git[1]!.toLowerCase() === "username" ? "username" : "password",
				destination: { host: url.hostname.toLowerCase(), ...(url.username ? { user: decodeURIComponent(url.username) } : {}) },
			};
		} catch {
			return null;
		}
	}
	// `root@host's password:` (password auth) and `(root@host) Password:` (keyboard-interactive).
	const ssh = /^\(?([^@\s()]+)@([^\s'()]+?)\)?(?:'s)?\s+password:\s*$/i.exec(prompt.trim());
	if (ssh) return { wants: "password", destination: { user: ssh[1]!, host: ssh[2]!.toLowerCase() } };
	if (/pass(word|phrase)/i.test(prompt)) return { wants: "password" };
	return null;
}

function fits(target: CredentialTarget, destination: Destination): boolean {
	if (target.host !== destination.host) return false;
	// A target that names no user fits any; one that names a user fits only that user.
	return !target.user || !destination.user || target.user === destination.user;
}

export function chooseAnswer(prompt: string, secrets: readonly AskpassSecret[]): AskpassDecision {
	if (/\byes\/no\b|\(y\/n\)|fingerprint|are you sure|allow use of key|confirm/i.test(prompt)) return { refused: "confirmation" };
	const asked = destinationOf(prompt);
	if (!asked) return { refused: "unknown-prompt" };

	const usable = secrets.filter((one) => one.kind !== "ssh_key" && (asked.wants === "password" || one.username));
	const candidates = asked.destination
		? usable.filter((one) => {
				const target = parseTarget(one.target);
				// Bound nowhere fits anywhere: the model asked for it without saying where, and the card said so.
				return !target || fits(target, asked.destination!);
			})
		: usable.filter((one) => !parseTarget(one.target));
	if (candidates.length === 0) return { refused: asked.wants === "username" ? "no-username" : "no-match" };

	/*
	 * A credential bound to this destination outranks one bound nowhere: when both are declared, the
	 * prompt was written for the specific one.
	 */
	const bound = asked.destination ? candidates.filter((one) => parseTarget(one.target)) : [];
	const pool = bound.length > 0 ? bound : candidates;
	if (pool.length > 1) return { refused: "ambiguous" };
	const chosen = pool[0]!;
	return { answer: asked.wants === "username" ? chosen.username! : chosen.secret, name: chosen.name };
}

/** One line for the command's result, so a refused prompt is not mistaken for a wrong password. */
export function refusalNote(prompt: string, refusal: AskpassRefusal): string {
	const asked = prompt.replace(/\s+/g, " ").trim().slice(0, 120);
	switch (refusal) {
		case "confirmation":
			return `[credentials: did not answer "${asked}" — confirmations are not answered with a credential. For a first connection, ask the user to confirm the host key, or pass -o StrictHostKeyChecking=accept-new if they agree.]`;
		case "no-match":
			return `[credentials: did not answer "${asked}" — none of this command's credentials is bound to that destination.]`;
		case "no-username":
			return `[credentials: did not answer "${asked}" — git asked for a username and none of this command's credentials has one. Use a login credential, or put the user in the remote URL.]`;
		case "ambiguous":
			return `[credentials: did not answer "${asked}" — more than one of this command's credentials fits; declare only the one this command needs.]`;
		default:
			return `[credentials: did not answer "${asked}" — not a password prompt this helper recognises.]`;
	}
}
