/**
 * Credentials for the conversations of one process: asked for on a card, held by name, handed to
 * the one command or page that needs them, and taken out of everything that comes back.
 *
 * A value exists in three places and no others: this broker's memory, the vault (only when the
 * person ticked "remember"), and — for the length of one command — the helper process or agent
 * socket that gives it to ssh. Nothing here puts a value into an event, a tool result, a log line or
 * an error message; the tests drive a sentinel through every path to hold that.
 */

import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { type Granted, prepareCommand } from "./command-env.ts";
import { restoreMarkers } from "./markers.ts";
import { Redactor, type RedactSecret } from "./redact.ts";
import { addSaved, copyableOf, listSaved, type SavedInput, type SavedOutcome, type SavedPatch, screenTexts, sealedValues, updateSaved } from "./saved.ts";
import { type KeyProblem, readPrivateKey } from "./ssh-agent.ts";
import { type CredentialRecord, type CredentialVault, vaultStore } from "./store.ts";
import { readValues, secretsOf, validateSpec } from "./spec.ts";
import {
	type CredentialAccess,
	type CredentialAsk,
	type CredentialMeta,
	type CredentialSpec,
	type CredentialSubmission,
	type FieldKey,
	fieldsFor,
	type PreparedCommand,
	type RequestOutcome,
} from "./types.ts";

interface Unlocked extends Granted {
	/** Let in from the vault rather than typed here; an `every-use` one is asked about each time. */
	fromVault: boolean;
}

interface Waiting {
	session: string;
	spec: CredentialSpec;
	saved: CredentialRecord | null;
	unlocked?: Unlocked;
}

export type SubmitProblem = KeyProblem | "missing" | "expired" | "no-saved";
export type SubmitResult = { ok: true } | { ok: false; problem: SubmitProblem };

/** A command named a credential this conversation does not have. Said to the model as is. */
export class CredentialUnavailable extends Error {
	constructor(name: string, refused: boolean) {
		super(
			refused
				? `The user declined to let this command use the credential "${name}".`
				: `No credential named "${name}" in this conversation. One filled earlier is gone after the app restarts unless it was saved; ask for it again with request_credential.`,
		);
		this.name = "CredentialUnavailable";
	}
}

export interface CredentialBrokerOptions {
	vault?: CredentialVault;
	/** Where a command's sockets and askpass wrapper are made. The OS temp directory, which is per user. */
	runtimeDir?: () => string;
	now?: () => number;
}

const labelled = (one: Granted): RedactSecret[] => secretsOf(one.meta.name, one.meta.kind, one.values);

export class CredentialBroker {
	private readonly vault: CredentialVault;
	private readonly runtimeDir: () => string;
	private readonly now: () => number;
	private readonly sessions = new Map<string, Map<string, Unlocked>>();
	private readonly waiting = new Map<string, Waiting>();
	/** Each conversation's masker and the values it was built from: every tool result goes through one. */
	private readonly redactors = new Map<string, { secrets: RedactSecret[]; redactor: Redactor }>();

	constructor(options: CredentialBrokerOptions = {}) {
		this.vault = options.vault ?? vaultStore();
		this.runtimeDir = options.runtimeDir ?? tmpdir;
		this.now = options.now ?? Date.now;
	}

	forSession(session: string): CredentialAccess {
		return {
			request: (spec, ask) => this.request(session, spec, ask),
			prepare: (names, command, ask) => this.prepare(session, names, command, ask),
			reveal: (label) => this.reveal(session, label),
			describe: (name) => this.held(session).get(name)?.meta,
			secrets: () => [...this.held(session).values()].flatMap(labelled),
			redactor: () => this.redactorFor(session),
			restore: (text) => restoreMarkers(text, (label) => this.reveal(session, label)),
		};
	}

	private redactorFor(session: string): Redactor {
		const secrets = [...this.held(session).values()].flatMap(labelled);
		const cached = this.redactors.get(session);
		const same = cached && cached.secrets.length === secrets.length && cached.secrets.every((one, at) => one.label === secrets[at]!.label && one.value === secrets[at]!.value);
		if (same) return cached.redactor;
		const redactor = new Redactor(secrets);
		this.redactors.set(session, { secrets, redactor });
		return redactor;
	}

	/** A conversation was deleted: whatever it held goes with it. */
	forget(session: string): void {
		this.sessions.delete(session);
		this.redactors.delete(session);
		for (const [key, waiting] of this.waiting) if (waiting.session === session) this.waiting.delete(key);
	}

	private held(session: string): Map<string, Unlocked> {
		let held = this.sessions.get(session);
		if (!held) this.sessions.set(session, (held = new Map()));
		return held;
	}

	private reveal(session: string, label: string): string | undefined {
		const [name, field] = label.split(".", 2) as [string, FieldKey | undefined];
		const unlocked = this.held(session).get(name);
		if (!unlocked) return undefined;
		if (field) return field === "username" ? unlocked.meta.username : unlocked.values[field];
		return unlocked.values.password ?? unlocked.values.token ?? unlocked.values.private_key;
	}

	private async request(session: string, spec: CredentialSpec, ask: CredentialAsk): Promise<RequestOutcome> {
		const problem = validateSpec(spec);
		if (problem) return { status: "invalid", message: problem };
		const existing = this.held(session).get(spec.name);
		/*
		 * Asked for a name this conversation already holds: no second card, and the answer says what it
		 * is and where it may be used. That is how a model learns about one the person handed over with a
		 * mark (`letIn`) — it knows the name and has to guess the rest; a guess that missed used to open a
		 * fresh card that replaced the one the person had just given.
		 */
		if (existing) return { status: "provided", meta: existing.meta };
		/*
		 * Offered only under the same name and kind. Matching a saved credential by its target alone
		 * could hand over a different account on the same server.
		 */
		const saved = await this.vault.get(spec.name);
		return this.ask(session, spec, saved && saved.kind === spec.kind ? saved : null, ask);
	}

	private async ask(session: string, spec: CredentialSpec, saved: CredentialRecord | null, ask: CredentialAsk): Promise<RequestOutcome> {
		const key = randomUUID();
		this.waiting.set(key, { session, spec, saved });
		let waiting: Waiting | undefined;
		let decision: Awaited<ReturnType<CredentialAsk>>;
		try {
			decision = await ask({
				kind: "credential",
				title: spec.title,
				detail: spec.purpose,
				subject: `credential:${spec.name}`,
				credential: {
					key,
					name: spec.name,
					kind: spec.kind,
					...(spec.target ? { target: spec.target } : {}),
					fields: fieldsFor(spec.kind),
					...(saved ? { saved: { createdAt: saved.createdAt, ...(saved.target ? { target: saved.target } : {}), ...(saved.username ? { username: saved.username } : {}) } } : {}),
				},
			});
		} finally {
			waiting = this.waiting.get(key);
			this.waiting.delete(key);
		}
		// "once" with nothing submitted is an approval that skipped the card: it grants nothing.
		if (decision !== "once" || !waiting?.unlocked) return { status: "declined" };
		return { status: "provided", meta: waiting.unlocked.meta };
	}

	/** The person filled the card. Called from IPC with what they typed; the value goes no further. */
	async submit(key: string, submission: CredentialSubmission): Promise<SubmitResult> {
		const waiting = this.waiting.get(key);
		if (!waiting) return { ok: false, problem: "expired" };
		const { spec } = waiting;
		let unlocked: Unlocked;
		if (submission.useSaved) {
			if (!waiting.saved) return { ok: false, problem: "no-saved" };
			const opened = this.open(waiting.saved);
			if ("problem" in opened) return { ok: false, problem: opened.problem };
			unlocked = opened;
			await this.vault.put({ ...waiting.saved, usedAt: this.now() });
		} else {
			const read = readValues(spec.kind, submission.values);
			if ("problem" in read) return { ok: false, problem: read.problem };
			const { values } = read;
			const meta: CredentialMeta = {
				name: spec.name,
				kind: spec.kind,
				title: spec.title,
				...(spec.target ? { target: spec.target } : {}),
				...(values.username ? { username: values.username } : {}),
				saved: submission.remember === true,
				createdAt: this.now(),
				approval: waiting.saved?.approval ?? "per-conversation",
			};
			const opened = this.open({ ...meta, values });
			if ("problem" in opened) return { ok: false, problem: opened.problem };
			unlocked = { ...opened, fromVault: false };
			if (submission.remember) await this.vault.put({ name: meta.name, kind: meta.kind, title: meta.title, ...(meta.target ? { target: meta.target } : {}), ...(meta.username ? { username: meta.username } : {}), createdAt: meta.createdAt, approval: meta.approval, values: sealedValues(values) });
		}
		// Unlocked for masking at the same moment it becomes usable: nothing can print it before it is masked.
		this.held(waiting.session).set(spec.name, unlocked);
		waiting.unlocked = unlocked;
		return { ok: true };
	}

	/**
	 * A record as a held credential; a saved key is parsed once, here, not on every signature.
	 * `saved` is the record's own when it has one — a card filled without "remember" is not saved.
	 */
	private open(record: Omit<CredentialMeta, "saved"> & { saved?: boolean; values: Partial<Record<FieldKey, string>> }): Unlocked | { problem: KeyProblem } {
		const { values, ...rest } = record;
		const meta: CredentialMeta = { saved: true, ...rest };
		if (record.kind !== "ssh_key") return { meta, values, fromVault: true };
		const read = readPrivateKey(values.private_key ?? "", values.passphrase);
		if ("problem" in read) return read;
		return { meta, values, key: read.key, fromVault: true };
	}

	private async prepare(session: string, names: readonly string[], command: string, ask: CredentialAsk): Promise<PreparedCommand> {
		const granted: Unlocked[] = [];
		for (const name of new Set(names)) granted.push(await this.grant(session, name, ask));
		return prepareCommand(granted, command, this.runtimeDir(), (one) => this.held(session).get(one.meta.name) === one);
	}

	/** One credential for one command, asking first when it was saved and has not been let in. */
	private async grant(session: string, name: string, ask: CredentialAsk): Promise<Unlocked> {
		const held = this.held(session).get(name);
		if (held && !(held.fromVault && held.meta.approval === "every-use")) return held;
		const saved = await this.vault.get(name);
		if (!saved) {
			if (held) return held;
			throw new CredentialUnavailable(name, false);
		}
		if (saved.approval === "never" && !held) {
			const opened = this.open(saved);
			if ("problem" in opened) throw new CredentialUnavailable(name, false);
			this.held(session).set(name, opened);
			await this.vault.put({ ...saved, usedAt: this.now() });
			return opened;
		}
		const spec: CredentialSpec = { name, kind: saved.kind, title: saved.title, purpose: "", ...(saved.target ? { target: saved.target } : {}) };
		const outcome = await this.ask(session, spec, saved, ask);
		const granted = this.held(session).get(name);
		if (outcome.status !== "provided" || !granted) throw new CredentialUnavailable(name, true);
		return granted;
	}

	/** Saved credentials, without their values — what the vault page lists. */
	saved(): Promise<CredentialMeta[]> {
		return listSaved(this.vault);
	}

	async addSaved(input: SavedInput): Promise<SavedOutcome> {
		return addSaved(this.vault, input, this.now());
	}

	async updateSaved(name: string, patch: SavedPatch): Promise<SavedOutcome> {
		const outcome = await updateSaved(this.vault, name, patch);
		if (outcome.ok) this.follow(name, outcome.record);
		return outcome;
	}

	/** For the clipboard, which the main process writes: see `copyableOf`. */
	async copyable(name: string): Promise<{ text: string; secret: boolean } | null> {
		const record = await this.vault.get(name);
		return record ? copyableOf(record) : null;
	}

	/** Forgotten everywhere: removed from the vault and from every conversation that let it in from there. */
	async removeSaved(name: string): Promise<void> {
		await this.vault.remove(name);
		this.follow(name, null);
	}

	/**
	 * Conversations that let a saved credential in follow what happens to it on the vault page.
	 *
	 * A narrowed target that only took effect in new conversations would leave the old reach open
	 * exactly where it was being used; a removed one must stop working where it was in use. A new
	 * object replaces the old, so an agent socket serving the old key stops signing with it at once.
	 */
	private follow(name: string, record: CredentialRecord | null): void {
		for (const held of this.sessions.values()) {
			if (!held.get(name)?.fromVault) continue;
			const opened = record && this.open(record);
			if (!opened || "problem" in opened) held.delete(name);
			else held.set(name, opened);
		}
	}

	/**
	 * What the person sent, with every value they hold here replaced by its mark, and the saved
	 * credentials it names — before anything is written or sent.
	 *
	 * A value pasted by mistake becomes `[credential:name]`; the vault page's "copy reference" is that
	 * mark already. Either way the message names a saved credential, which `letIn` then hands to the
	 * conversation. Two steps because a first message is screened before its conversation has an id.
	 */
	async screenPrompt(session: string | null, texts: readonly string[]): Promise<{ texts: string[]; named: string[] }> {
		const held = session ? [...this.held(session).values()].flatMap(labelled) : [];
		const screened = screenTexts(await this.vault.list(), held, texts);
		return { texts: screened.texts, named: screened.named.map((record) => record.name) };
	}

	/** Saved credentials the person handed this conversation themselves: let in without a card. */
	async letIn(session: string, names: readonly string[]): Promise<void> {
		if (names.length === 0) return;
		const held = this.held(session);
		for (const record of await this.vault.list()) {
			if (!names.includes(record.name) || held.has(record.name)) continue;
			const opened = this.open(record);
			if (!("problem" in opened)) held.set(record.name, opened);
		}
	}
}
