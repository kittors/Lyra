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
import type { AgentEvent, CommandRun } from "../agent/events.ts";
import type { Message, ThinkingLevel, Usage } from "../types.ts";
import type { SessionStorage } from "./storage.ts";
import { addUsage, emptyUsage } from "../types.ts";
import { readRecordChanges, type SessionReadCursor, type SessionRecordChanges } from "./read-changes.ts";

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
	/** A submitted opening message is durable before its runtime is initialized. */
	pendingPrompt?: boolean;
	/** Desktop workspace preparation is deferred until execution, never transcript reading. */
	workspaceSetup?: "worktree";
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
	 * How hard this conversation asks the model to think, when it differs from the app default.
	 *
	 * Per session because that is the unit the decision belongs to: one conversation is a long
	 * refactor worth paying `high` for and the next is "what does this flag do". Held globally,
	 * turning one up turned all of them up — including the ones already running somewhere else,
	 * which is a bill nobody agreed to.
	 *
	 * Absent means "whatever the settings say", which is what every session written before this
	 * existed means, and what a session nobody has expressed an opinion about should go on meaning
	 * as the default moves.
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
	| { seq: number; ts: number; type: "title"; title: string; source?: "user" | "auto" }
	| { seq: number; ts: number; type: "usage"; source: "title-summary"; providerId: string; modelId: string; usage: Usage }
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
	/** Stable rewrite time; retained replies describe the old request until a newer reply arrives. */
	at?: number;
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
	/**
	 * Serializes mutations to `index.json`.
	 *
	 * Writing the index is write-to-temp-then-rename. On Windows, renaming over an existing file
	 * while another handle is touching it fails with EPERM or EBUSY. Serializing index mutations
	 * ensures atomic updates do not collide during concurrent session creation or archiving.
	 */
	private indexQueue: Promise<unknown> = Promise.resolve();

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
		if (payload.type === "title" && payload.source === "auto" && base.titleSetByUser) return base;
		const next: SessionMeta = { ...base, seq: base.seq + 1, updatedAt: Date.now() };

		/*
		 * 子 Agent 烧的 token 也是这个会话烧的。
		 *
		 * 它的消息落盘成 `type: "event"` 里的 `subagent_message`，不是 `type: "message"`，所以下面那条
		 * 按定义够不着——于是一整个委派的用量从来没进过会话统计。实测代价（2026-09-11，用户的两个会话）：
		 *
		 *     会话 A  主 Agent 发出 1,155,989   子 Agent 发出 1,623,591   统计漏掉 58.4%
		 *     会话 B  主 Agent 发出 2,506,233   子 Agent 发出 1,543,053   统计漏掉 38.1%
		 *
		 * 第一个会话里子 Agent 比主 Agent 还多烧 40%，而卡片上的数字只有主 Agent 那一半。按 token 判断
		 * 一次对话花了多少，这个数直接误导。
		 *
		 * **只算助手消息**，和主 Agent 那条一个道理：一条助手消息 = 一次请求，用量记在它身上，工具结果和
		 * 用户消息都不带用量，算进来只会重复。
		 *
		 * `messageCount` **不加**：那个数是给人看「这段对话有多长」的，而子 Agent 的往返是委派内部的事，
		 * 混进来会让一次委派看起来像聊了几十轮。用量是成本、条数是篇幅，两件事。
		 */
		if (payload.type === "event" && payload.event.type === "subagent_message" && payload.event.message.role === "assistant") {
			next.usage = addUsage(base.usage, payload.event.message.usage);
		}

		if (payload.type === "message") {
			next.messageCount = base.messageCount + 1;
			if (payload.message.role === "assistant") next.usage = addUsage(base.usage, payload.message.usage);
		}
		if (payload.type === "title") {
			next.title = payload.title;
			if (payload.source === "user") next.titleSetByUser = true;
		}
		if (payload.type === "usage") next.usage = addUsage(base.usage, payload.usage);
		if (payload.type === "archive") {
			next.archived = payload.archived;
			// Filing something away is not activity; the list stays sorted by last real use.
			next.updatedAt = base.updatedAt;
		}
		if (payload.type === "meta") {
			// A meta record carries caller-side changes such as the selected model.
			Object.assign(next, payload.meta, { seq: next.seq, updatedAt: next.updatedAt, usage: next.usage });
			// A model/settings snapshot cannot undo an explicit name chosen while it was in flight.
			if (base.titleSetByUser) { next.title = base.title; next.titleSetByUser = true; }
		}

		const persisted = payload.type === "meta" && base.titleSetByUser
			? { ...payload, meta: { ...payload.meta, title: next.title, titleSetByUser: true } }
			: payload;
		const record: SessionRecord = { seq: next.seq, ts: Date.now(), ...persisted };
		await mkdir(this.dirFor(meta.projectId), { recursive: true });
		await appendFile(this.fileFor(meta.projectId, meta.id), `${JSON.stringify(record)}\n`, "utf8");
		this.latestMeta.set(key, next);
		await this.writeIndex(next);
		return next;
	}

	/** Read the appended tail without rescanning the committed prefix. */
	readChanges(projectId: string, sessionId: string, cursor?: SessionReadCursor): Promise<SessionRecordChanges<SessionRecord>> {
		return readRecordChanges(this.fileFor(projectId, sessionId), cursor);
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
				/*
				 * A line that parses but is not a record — `null`, a bare number, an array.
				 *
				 * Damage does not always make a line unparseable: a write cut short at the wrong byte, or
				 * a file an external tool has been through, can leave something `JSON.parse` accepts and
				 * nothing here can use. Reading `record.seq` off it threw, and the throw came out of the
				 * IPC handler, so one such line made the whole session refuse to open — a much worse
				 * outcome than the missing record it stands for.
				 */
				if (typeof record !== "object" || record === null) continue;
				if (record.seq > sinceSeq) yield record;
			}
		} finally {
			rl.close();
		}
	}

	/**
	 * Every message in the log, in order — and nothing that is not one.
	 *
	 * The guard on `record.message` is the whole of a crash that reached people. A record saying it
	 * is a message but carrying none — `{"type":"message"}`, which is what `JSON.stringify` writes
	 * when the message is `undefined` — used to be pushed through as-is, leaving a hole in the array.
	 * Nothing here reads the messages, so the hole travelled the length of the app in silence: into
	 * the live session, out through `snapshot`, across the IPC boundary, and into the window, where
	 * the first pass over the transcript hit `undefined.role` and took the whole interface down.
	 *
	 * It only ever showed up on a session that was *running*, which is what made it look like a bug
	 * about long tasks. A session sitting idle is read by `load` below, and `load` totals the usage —
	 * so it touched `.role` itself and threw in the main process, where the renderer catches it and
	 * shows a failed-to-read notice instead. Same broken file, two completely different symptoms,
	 * decided by nothing more than which of these two functions did the reading.
	 *
	 * Dropping the record is right: it has no message in it. Whatever was meant to be there is gone
	 * either way, and one lost message reads better than a session that cannot be opened at all.
	 */
	async messages(projectId: string, sessionId: string): Promise<Message[]> {
		const out: Message[] = [];
		for await (const record of this.read(projectId, sessionId)) {
			if (record.type === "message" && record.message) out.push(record.message);
		}
		return out;
	}

	async load(
		projectId: string,
		sessionId: string,
	): Promise<{
		meta: SessionMeta;
		messages: Message[];
		entries: { seq: number; message: Message }[];
		compactions: number[];
		commandRuns?: CommandRun[];
		compaction: Boundary | null;
	} | null> {
		let meta: SessionMeta | null = null;
		// Kept with their sequence numbers so a truncate record can drop the right tail.
		let entries: { seq: number; message: Message }[] = [];
		let auxiliaryUsage = emptyUsage();
		/*
		 * Where history was summarised, as positions in the transcript.
		 *
		 * Recorded at load rather than derived, because there is nothing in the messages themselves
		 * to show it happened: the log keeps every original message either way. The window draws a
		 * divider at each of these.
		 */
		const compactions: number[] = [];
		const commandRuns = new Map<string, { seq: number; run: CommandRun }>();
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
			else if (record.type === "event" && record.event.type === "command_status") {
				const run = record.event.command;
				commandRuns.set(run.id, { seq: record.seq, run: run.status === "running" ? { ...run, status: "cancelled", detail: "压缩中断，未完成的操作没有自动重试。" } : run });
			}
			else if (record.type === "event" && record.event.type === "compacted") {
				compactions.push(entries.length);
				/*
				 * `kept` is absent on records written before compaction was stored, and on pruning
				 * passes that moved no boundary. Both mean the same thing here: no boundary to
				 * restore, so the session opens on its full history and compacts again if it has to.
				 */
				const { summary, kept } = record.event;
				if (kept !== undefined) {
					compaction = { at: record.ts, summary: summary ?? "", keptFrom: Math.max(0, entries.length - kept) };
				}
			// A message record with no message in it leaves a hole in the transcript; see `messages` above.
			} else if (record.type === "message") { if (record.message) entries.push({ seq: record.seq, message: record.message }); }
			else if (record.type === "title" && meta) {
				if (record.source !== "auto" || !meta.titleSetByUser) meta.title = record.title;
				if (record.source === "user") meta.titleSetByUser = true;
			}
			else if (record.type === "usage") auxiliaryUsage = addUsage(auxiliaryUsage, record.usage);
			else if (record.type === "archive" && meta) meta.archived = record.archived;
			else if (record.type === "truncate") {
				entries = entries.filter((e) => e.seq <= record.afterSeq);
				for (const [id, entry] of commandRuns) if (entry.seq > record.afterSeq) commandRuns.delete(id);
				while (compactions.length && compactions[compactions.length - 1] > entries.length) compactions.pop();
				// A rewind past the boundary retires it: the tail it was paired with is gone.
				if (compaction && compaction.keptFrom > entries.length) compaction = null;
			}
			if (meta) meta.seq = record.seq;
		}
		if (!meta) return null;
		const messages = entries.map((e) => e.message);
		meta.messageCount = messages.length;
		// Re-accumulate usage across assistant messages if it was lost/cleared
		let totalUsage = auxiliaryUsage;
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
		return {
			meta,
			messages,
			entries,
			compactions,
			compaction,
			commandRuns: [...commandRuns.values()].map((entry) => entry.run),
		};
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
		const nextTask = this.indexQueue.catch(() => undefined).then(async () => {
			const all = await this.listSessions();
			const next = [meta, ...all.filter((s) => s.id !== meta.id)].sort((a, b) => b.updatedAt - a.updatedAt);
			await mkdir(this.root, { recursive: true });
			/*
			 * Write-then-rename so a crash cannot leave a truncated index.
			 *
			 * The temporary name carries more than the pid. Two writes racing inside one process — two
			 * conversations created at once, which the desktop does whenever a window restores several
			 * — both wrote to the same path, and the first rename took the file out from under the
			 * second: `ENOENT ... index.json.NNN.tmp -> index.json`, and the session that lost is not
			 * in the index at all.
			 *
			 * On Windows, renaming over an existing file while another write/read handle is open fails
			 * with EPERM. Retrying briefly smooths over external scanners (e.g. antivirus or search indexer).
			 */
			const tmp = `${this.indexPath}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`;
			await writeFile(tmp, JSON.stringify(next, null, 2), "utf8");
			let renamed = false;
			for (let attempt = 0; attempt < 8; attempt++) {
				try {
					await rename(tmp, this.indexPath);
					renamed = true;
					break;
				} catch (err: unknown) {
					const code = (err as { code?: string })?.code;
					if ((code === "EPERM" || code === "EBUSY") && attempt < 7) {
						await new Promise((r) => setTimeout(r, 20 * (attempt + 1)));
						continue;
					}
					throw err;
				}
			}
			if (!renamed) await rename(tmp, this.indexPath);
		});
		this.indexQueue = nextTask;
		await nextTask;
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
		if (!loaded || !Number.isInteger(messageIndex) || messageIndex < 0 || messageIndex >= loaded.messages.length) return null;

		/*
		 * Turn atomicity: never cut inside a tool-call turn.
		 * If messageIndex points to a toolResult, snap back past the assistant
		 * turn that triggered it so calls and results are never torn apart.
		 */
		let targetIndex = messageIndex;
		while (targetIndex > 0 && loaded.messages[targetIndex]?.role === "toolResult") {
			targetIndex -= 1;
		}

		// The seq to keep is the one just before the record carrying the doomed message.
		const cutoff = loaded.entries[targetIndex].seq - 1;

		const meta = await this.append(loaded.meta, { type: "truncate", afterSeq: cutoff });
		const messages = loaded.messages.slice(0, targetIndex);
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
