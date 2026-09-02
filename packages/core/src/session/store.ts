/**
 * Session storage.
 *
 * Sessions are append-only JSONL logs. Every record carries a monotonic `seq`, which is what
 * makes cross-device sync cheap: a client that has seen up to seq N asks for everything after
 * N and replays it. Nothing is ever rewritten in place, so a phone reconnecting mid-turn
 * cannot miss or duplicate events.
 */

import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { appendFile, mkdir, readdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { createInterface } from "node:readline";
import type { AgentEvent } from "../agent/events.ts";
import type { Message, ThinkingLevel, Usage } from "../types.ts";
import type { SessionStorage } from "./storage.ts";
import { addUsage, emptyUsage } from "../types.ts";

export interface SessionMeta {
	id: string;
	title: string;
	cwd: string;
	projectId: string;
	projectName: string;
	createdAt: number;
	updatedAt: number;
	modelId: string;
	messageCount: number;
	usage: Usage;
	archived?: boolean;
	/**
	 * How many messages were already written when the model was last changed mid-conversation.
	 *
	 * Everything before this index was produced by a different model, and carries that provider's
	 * opaque handles — an Anthropic thinking signature, a Responses reasoning item id, an encrypted
	 * payload. They are only meaningful to the provider that issued them; replayed to another they
	 * are rejected, not ignored. See `stripStaleHandles`.
	 *
	 * Absent on a session whose model never changed, which is the ordinary case and behaves exactly
	 * as before.
	 */
	modelSwitchedAt?: number;
	/**
	 * How hard this conversation thinks, when it differs from the global default.
	 *
	 * Effort belongs to the conversation, not to the app. One window is renaming a variable and the
	 * next is working out why a migration deadlocks, and those want different settings — with a
	 * single global level, turning one up turned the other up too, and the cost of the expensive
	 * setting was paid by every session that never asked for it.
	 *
	 * Absent on sessions that never chose, which is every session written before this existed: they
	 * read `settings.thinking` exactly as they used to. Storing the choice rather than defaulting it
	 * at creation is what keeps that true — a session that has not chosen still follows the default
	 * when the default moves.
	 */
	thinking?: ThinkingLevel;
	/**
	 * Someone typed this title, so nothing else gets to replace it.
	 *
	 * The first prompt names the conversation after itself, which is the right default for the
	 * conversations nobody names — and wrong for every one somebody did. Naming a session before
	 * asking anything is the ordinary way to use it, and the automatic title landed on top of the
	 * name a moment later: the rename looked like it had worked, right up until the first message.
	 */
	titleSetByUser?: boolean;
	/** Highest sequence number written. Sync clients compare against this. */
	seq: number;
}

export type SessionRecord =
	| { seq: number; ts: number; type: "meta"; meta: SessionMeta }
	| { seq: number; ts: number; type: "message"; message: Message }
	| { seq: number; ts: number; type: "event"; event: AgentEvent }
	| { seq: number; ts: number; type: "title"; title: string }
	/**
	 * Its own record type rather than a `meta` write: archiving must not touch `updatedAt`,
	 * and a `meta` record always refreshes it. Sending it through the log also means a phone
	 * syncing with `?since=N` learns the session was archived, same as any other change.
	 */
	| { seq: number; ts: number; type: "archive"; archived: boolean }
	/**
	 * Everything after `afterSeq` is void.
	 *
	 * Editing a message rewrites history — the reply it drew, and everything that followed,
	 * no longer follows from what was said. Recorded rather than achieved by rewriting the
	 * file, so the log stays append-only and a client syncing with `?since=N` finds out the
	 * same way it finds out about anything else.
	 */
	| { seq: number; ts: number; type: "truncate"; afterSeq: number };

/**
 * Where the model's view of a session begins, once history has been summarised.
 *
 * `keptFrom` indexes into the restored message list; `summary` stands in for everything before it,
 * and is empty when that history was dropped rather than condensed — which is a different thing to
 * tell the model, and so a difference worth storing.
 */
export interface Boundary {
	summary: string;
	keptFrom: number;
}

/** `Omit` over a union collapses it into one shape; distribute so each variant keeps its own fields. */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** A record as supplied by callers, before the store stamps `seq` and `ts`. */
export type SessionRecordInput = DistributiveOmit<SessionRecord, "seq" | "ts">;

export function lyraHome(): string {
	return process.env.LYRA_HOME || join(homedir(), ".lyra");
}

export function projectIdFor(cwd: string): string {
	return createHash("sha256").update(cwd).digest("hex").slice(0, 16);
}

export class SessionStore implements SessionStorage {
	readonly root: string;
	/**
	 * Serializes appends per session and holds the authoritative meta.
	 *
	 * Parallel tool calls each persist their own result, and they all start from the same
	 * `meta` snapshot the caller happens to be holding. Without this, three concurrent
	 * appends all computed `seq = meta.seq + 1` and wrote three records with the same
	 * sequence number — a client syncing with `?since=N` would then silently skip two of
	 * them. The queue makes "read latest seq, increment, write" atomic per session.
	 */
	private writeQueues = new Map<string, Promise<SessionMeta>>();
	private latestMeta = new Map<string, SessionMeta>();

	constructor(root = join(lyraHome(), "sessions")) {
		this.root = root;
	}

	private keyFor(meta: Pick<SessionMeta, "projectId" | "id">): string {
		return `${meta.projectId}/${meta.id}`;
	}

	private dirFor(projectId: string): string {
		return join(this.root, projectId);
	}

	private fileFor(projectId: string, sessionId: string): string {
		return join(this.dirFor(projectId), `${sessionId}.jsonl`);
	}

	async create(cwd: string, modelId: string, title = "New session"): Promise<SessionMeta> {
		const projectId = projectIdFor(cwd);
		const meta: SessionMeta = {
			id: randomUUID(),
			title,
			cwd,
			projectId,
			projectName: basename(cwd) || cwd,
			createdAt: Date.now(),
			updatedAt: Date.now(),
			modelId,
			messageCount: 0,
			usage: emptyUsage(),
			seq: 0,
		};
		await mkdir(this.dirFor(projectId), { recursive: true });
		await this.append(meta, { type: "meta", meta });
		return meta;
	}

	/** Append one record and return the updated meta, with `seq` advanced. */
	async append(meta: SessionMeta, payload: SessionRecordInput): Promise<SessionMeta> {
		const key = this.keyFor(meta);
		const previous = this.writeQueues.get(key);
		// A failed append must not poison the queue for later writes.
		const next = (previous ? previous.catch(() => undefined) : Promise.resolve()).then(() =>
			this.appendExclusive(meta, payload),
		);
		this.writeQueues.set(key, next);
		return next;
	}

	private async appendExclusive(meta: SessionMeta, payload: SessionRecordInput): Promise<SessionMeta> {
		const key = this.keyFor(meta);
		// Callers may hold a stale snapshot; the store's own copy is the source of truth.
		const base = this.latestMeta.get(key) ?? meta;
		const next: SessionMeta = { ...base, seq: base.seq + 1, updatedAt: Date.now() };

		if (payload.type === "message") {
			next.messageCount = base.messageCount + 1;
			if (payload.message.role === "assistant") next.usage = addUsage(base.usage, payload.message.usage);
		}
		if (payload.type === "title") next.title = payload.title;
		if (payload.type === "archive") {
			next.archived = payload.archived;
			// Filing something away is not activity; the list stays sorted by last real use.
			next.updatedAt = base.updatedAt;
		}
		if (payload.type === "meta") {
			// A meta record carries caller-side changes such as the selected model.
			Object.assign(next, payload.meta, { seq: next.seq, updatedAt: next.updatedAt, usage: next.usage });
		}

		const record = { seq: next.seq, ts: Date.now(), ...payload } as SessionRecord;
		await mkdir(this.dirFor(meta.projectId), { recursive: true });
		await appendFile(this.fileFor(meta.projectId, meta.id), `${JSON.stringify(record)}\n`, "utf8");
		this.latestMeta.set(key, next);
		await this.writeIndex(next);
		return next;
	}

	/** Stream records, optionally only those newer than `sinceSeq`. */
	async *read(projectId: string, sessionId: string, sinceSeq = 0): AsyncGenerator<SessionRecord> {
		const file = this.fileFor(projectId, sessionId);
		if (!(await stat(file).catch(() => null))) return;

		const rl = createInterface({ input: createReadStream(file, "utf8"), crlfDelay: Infinity });
		try {
			for await (const line of rl) {
				if (!line.trim()) continue;
				let record: SessionRecord;
				try {
					record = JSON.parse(line);
				} catch {
					// A crash mid-append can leave a partial final line; skip it rather than failing the load.
					continue;
				}
				if (record.seq > sinceSeq) yield record;
			}
		} finally {
			rl.close();
		}
	}

	async messages(projectId: string, sessionId: string): Promise<Message[]> {
		const out: Message[] = [];
		for await (const record of this.read(projectId, sessionId)) {
			if (record.type === "message") out.push(record.message);
		}
		return out;
	}

	async load(
		projectId: string,
		sessionId: string,
	): Promise<{ meta: SessionMeta; messages: Message[]; compactions: number[]; compaction: Boundary | null } | null> {
		let meta: SessionMeta | null = null;
		// Kept with their sequence numbers so a truncate record can drop the right tail.
		let entries: { seq: number; message: Message }[] = [];
		/*
		 * Where history was summarised, as positions in the transcript.
		 *
		 * Recorded at load rather than derived, because there is nothing in the messages themselves
		 * to show it happened: the log keeps every original message either way. The window draws a
		 * divider at each of these.
		 */
		const compactions: number[] = [];
		/*
		 * And the newest of them in full, which is what the *model* is given.
		 *
		 * The transcript and the model's view diverge at this point, on purpose — the reader scrolls
		 * back through everything, the model is handed the summary and what followed it. Only the
		 * latest boundary matters: each compaction summarises the one before it, so the newest is
		 * the only one still standing for anything.
		 */
		let compaction: Boundary | null = null;
		for await (const record of this.read(projectId, sessionId)) {
			if (record.type === "meta") meta = record.meta;
			else if (record.type === "event" && record.event.type === "compacted") {
				compactions.push(entries.length);
				/*
				 * `kept` is absent on records written before compaction was stored, and on pruning
				 * passes that moved no boundary. Both mean the same thing here: no boundary to
				 * restore, so the session opens on its full history and compacts again if it has to.
				 */
				const { summary, kept } = record.event;
				if (kept !== undefined) {
					compaction = { summary: summary ?? "", keptFrom: Math.max(0, entries.length - kept) };
				}
			} else if (record.type === "message") entries.push({ seq: record.seq, message: record.message });
			else if (record.type === "title" && meta) meta.title = record.title;
			else if (record.type === "archive" && meta) meta.archived = record.archived;
			else if (record.type === "truncate") {
				entries = entries.filter((e) => e.seq <= record.afterSeq);
				// A rewind past the boundary retires it: the tail it was paired with is gone.
				if (compaction && compaction.keptFrom > entries.length) compaction = null;
			}
			if (meta) meta.seq = record.seq;
		}
		if (!meta) return null;
		const messages = entries.map((e) => e.message);
		meta.messageCount = messages.length;
		// Re-accumulate usage across assistant messages if it was lost/cleared
		let totalUsage = emptyUsage();
		for (const msg of messages) {
			if (msg.role === "assistant" && msg.usage) {
				totalUsage = addUsage(totalUsage, msg.usage);
			}
		}
		if (totalUsage.total > 0 || meta.usage.total === 0) {
			meta.usage = totalUsage;
		}
		// Seed the append queue's view so a reopened session keeps numbering where it left off.
		this.latestMeta.set(this.keyFor(meta), meta);
		return { meta, messages, compactions, compaction };
	}

	// -------------------------------------------------------------------------
	// Index: a single file listing every session, so the sidebar loads without
	// opening every JSONL log.
	// -------------------------------------------------------------------------

	private get indexPath(): string {
		return join(this.root, "index.json");
	}

	async listSessions(): Promise<SessionMeta[]> {
		const raw = await readFile(this.indexPath, "utf8").catch(() => null);
		if (!raw) return this.rebuildIndex();
		try {
			const parsed = JSON.parse(raw) as SessionMeta[];
			return Array.isArray(parsed) ? parsed.sort((a, b) => b.updatedAt - a.updatedAt) : [];
		} catch {
			return this.rebuildIndex();
		}
	}

	private async writeIndex(meta: SessionMeta): Promise<void> {
		const all = await this.listSessions();
		const next = [meta, ...all.filter((s) => s.id !== meta.id)].sort((a, b) => b.updatedAt - a.updatedAt);
		await mkdir(this.root, { recursive: true });
		// Write-then-rename so a crash cannot leave a truncated index.
		const tmp = `${this.indexPath}.${process.pid}.tmp`;
		await writeFile(tmp, JSON.stringify(next, null, 2), "utf8");
		await rename(tmp, this.indexPath);
	}

	/** Reconstruct the index by scanning every session log. Used when the index is missing or corrupt. */
	async rebuildIndex(): Promise<SessionMeta[]> {
		const metas: SessionMeta[] = [];
		const projects = await readdir(this.root, { withFileTypes: true }).catch(() => []);
		for (const project of projects) {
			if (!project.isDirectory()) continue;
			const files = await readdir(join(this.root, project.name)).catch(() => []);
			for (const file of files) {
				if (!file.endsWith(".jsonl")) continue;
				const loaded = await this.load(project.name, file.replace(/\.jsonl$/, "")).catch(() => null);
				if (loaded) metas.push(loaded.meta);
			}
		}
		metas.sort((a, b) => b.updatedAt - a.updatedAt);
		await mkdir(this.root, { recursive: true }).catch(() => {});
		await writeFile(this.indexPath, JSON.stringify(metas, null, 2), "utf8").catch(() => {});
		return metas;
	}

	/**
	 * Drop a message and everything after it.
	 *
	 * Returns the messages that survive, so the caller can reset its own in-memory copy to
	 * match without re-reading the log. Null when the index is out of range — a stale UI can
	 * ask to edit a message that has since been truncated by another client.
	 */
	async truncateFrom(
		projectId: string,
		sessionId: string,
		messageIndex: number,
	): Promise<{ meta: SessionMeta; messages: Message[] } | null> {
		const loaded = await this.load(projectId, sessionId);
		if (!loaded || messageIndex < 0 || messageIndex >= loaded.messages.length) return null;

		// The seq to keep is the one just before the record carrying the doomed message.
		let seen = 0;
		let cutoff: number | null = null;
		for await (const record of this.read(projectId, sessionId)) {
			if (record.type !== "message") continue;
			if (seen === messageIndex) {
				cutoff = record.seq - 1;
				break;
			}
			seen += 1;
		}
		if (cutoff === null) return null;

		const meta = await this.append(loaded.meta, { type: "truncate", afterSeq: cutoff });
		const messages = loaded.messages.slice(0, messageIndex);
		// The index tracks message count; a truncate is the one write that lowers it.
		const corrected = await this.append(meta, { type: "meta", meta: { ...meta, messageCount: messages.length } });
		return { meta: { ...corrected, messageCount: messages.length }, messages };
	}

	/**
	 * Move a session in or out of the archive.
	 *
	 * Returns null when the session is not in the index — a stale sidebar can ask about one
	 * that has since been deleted, and that is not worth throwing over.
	 */
	async setArchived(projectId: string, sessionId: string, archived: boolean): Promise<SessionMeta | null> {
		const current = (await this.listSessions()).find((s) => s.projectId === projectId && s.id === sessionId);
		if (!current) return null;
		return this.append(current, { type: "archive", archived });
	}

	async delete(projectId: string, sessionId: string): Promise<void> {
		await unlink(this.fileFor(projectId, sessionId)).catch(() => {});
		const all = await this.listSessions();
		await mkdir(this.root, { recursive: true });
		await writeFile(this.indexPath, JSON.stringify(all.filter((s) => s.id !== sessionId), null, 2), "utf8");
	}

	/**
	 * Drop sessions that were created but never used.
	 *
	 * A session with no messages holds nothing — no transcript, no usage, not even a title.
	 * They accumulate from any path that reserves a session up front and then does not send
	 * anything: a scheduled task that failed to start, a client that navigated away. Run at
	 * launch, this keeps that debris from filling the sidebar.
	 *
	 * `minAgeMs` protects sessions that were only just created: another client may be mid-way
	 * through its own "new session, about to send" sequence, and deleting that out from under
	 * it would break a live conversation before it starts.
	 */
	async pruneEmpty(minAgeMs = 5 * 60_000): Promise<number> {
		const cutoff = Date.now() - minAgeMs;
		const empty = (await this.listSessions()).filter((s) => s.messageCount === 0 && s.createdAt < cutoff);
		if (empty.length === 0) return 0;
		await this.deleteMany(empty.map((s) => ({ projectId: s.projectId, id: s.id })));
		return empty.length;
	}

	/** Delete several sessions with a single index rewrite, for "empty the archive". */
	async deleteMany(targets: { projectId: string; id: string }[]): Promise<void> {
		await Promise.all(targets.map((t) => unlink(this.fileFor(t.projectId, t.id)).catch(() => {})));
		const gone = new Set(targets.map((t) => t.id));
		const all = await this.listSessions();
		await mkdir(this.root, { recursive: true });
		await writeFile(this.indexPath, JSON.stringify(all.filter((s) => !gone.has(s.id)), null, 2), "utf8");
	}
}
