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
import { writeFileAtomic } from "../utils/atomic-write.ts";
import { materializeJsonlLine, parkRecordPayload, rehydrateMessages } from "./payload.ts";
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
	 * How hard this conversation asks the model to think.
	 *
	 * Per session because that is the unit the decision belongs to: one conversation is a long
	 * refactor worth paying `high` for and the next is "what does this flag do". Held globally,
	 * turning one up turned all of them up — including the ones already running somewhere else,
	 * which is a bill nobody agreed to.
	 *
	 * Written when the session is created, with the app default of that moment (`create`). It used
	 * to stay absent until someone changed it inside the conversation, so that a session nobody had
	 * an opinion about would follow the default as it moved. Seen from the window there is no such
	 * session: the level picked in a new chat before its first message is an opinion about that
	 * chat, yet it can only land on the app default — there is no session to hold it yet — and the
	 * session was then created without it. Picking a level in the next new chat moved the first one
	 * along, in its label and in what its turns actually asked for (reported against 0.9.19). The
	 * default is where new conversations start, not a dial for the ones already under way.
	 *
	 * Absent now only on sessions written before that, and after `setThinking(null)`; both mean
	 * "whatever the settings say".
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
	| { seq: number; ts: number; type: "usage"; source: "title-summary" | "side-chat" | (string & {}); providerId: string; modelId: string; usage: Usage }
	/**
	 * Its own record type rather than a `meta` write: archiving must not touch `updatedAt`,
	 * and a `meta` record always refreshes it. Sending it through the log also means a phone
	 * syncing with `?since=N` learns the session was archived, same as any other change.
	 */
	| { seq: number; ts: number; type: "archive"; archived: boolean }
	/**
	 * 换了项目归属：`cwd`、`projectId`、`projectName` 三个一起变。
	 *
	 * 自成一条记录而不是写成 `meta`，和 `archive` 同一个道理：把一段对话归到别的项目下不是一次
	 * 活动，`updatedAt` 不该跟着跳——否则一条半年没动过的会话，只因为被整理了一下就窜到列表最
	 * 前面。走日志也让用 `?since=N` 同步的客户端知道它挪了窝，而这恰恰是它下次该去哪个目录找
	 * 这个文件的依据：日志按 `projectId` 分目录存，换项目就是换目录。
	 */
	| { seq: number; ts: number; type: "move"; cwd: string; projectId: string; projectName: string }
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

/** A stripped image with no file name is the blank tile. Do not reuse that cache. */
function displayImagesReady(messages: Message[]): boolean {
	for (const message of messages) {
		if (message.role !== "user" && message.role !== "toolResult") continue;
		for (const part of message.content) {
			if (part.type === "image" && !part.data && !part.media) return false;
		}
	}
	return true;
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

	private displayCacheFor(projectId: string, sessionId: string): string {
		return join(this.dirFor(projectId), `${sessionId}.display.json`);
	}

	private async expectedSeq(projectId: string, sessionId: string): Promise<number | null> {
		const remembered = this.latestMeta.get(`${projectId}/${sessionId}`);
		if (remembered) return remembered.seq;
		const listed = await this.listSessions();
		return listed.find((session) => session.projectId === projectId && session.id === sessionId)?.seq ?? null;
	}

	private async readDisplayCache(projectId: string, sessionId: string) {
		const expected = await this.expectedSeq(projectId, sessionId);
		if (expected == null) return null;
		const raw = await readFile(this.displayCacheFor(projectId, sessionId), "utf8").catch(() => null);
		if (!raw) return null;
		try {
			const parsed = JSON.parse(raw) as {
				v?: number;
				seq?: number;
				meta: SessionMeta;
				messages: Message[];
				entries: { seq: number; message: Message }[];
				compactions: number[];
				commandRuns?: CommandRun[];
				compaction: Boundary | null;
			};
			if (parsed.v !== 2 || parsed.seq !== expected || !parsed.meta || !Array.isArray(parsed.messages)) return null;
			if (!displayImagesReady(parsed.messages)) return null;
			return parsed;
		} catch {
			return null;
		}
	}

	private async writeDisplayCache(
		projectId: string,
		sessionId: string,
		loaded: {
			meta: SessionMeta;
			messages: Message[];
			entries: { seq: number; message: Message }[];
			compactions: number[];
			commandRuns?: CommandRun[];
			compaction: Boundary | null;
		},
	): Promise<void> {
		// Best-effort: a cache that is not written is rebuilt from the log next time.
		try {
			await mkdir(this.dirFor(projectId), { recursive: true });
			await writeFileAtomic(this.displayCacheFor(projectId, sessionId), JSON.stringify({ v: 2, seq: loaded.meta.seq, ...loaded }));
		} catch {
			// Nothing to clean up: the helper removes its own temporary file.
		}
	}

	async create(cwd: string, modelId: string, title = "New session", options: Pick<SessionMeta, "thinking"> = {}): Promise<SessionMeta> {
		const projectId = projectIdFor(cwd);
		/*
		 * One reading of the clock for the whole creation.
		 *
		 * It was read for `createdAt`, again for `updatedAt`, and again inside the append — so the
		 * meta record on disk said one time and the index another whenever the calls straddled a
		 * millisecond. A rebuilt index then disagreed with the one it replaced, and a session moved
		 * or archived afterwards carried the wrong `updatedAt` into the list.
		 */
		const now = Date.now();
		const meta: SessionMeta = {
			id: randomUUID(),
			title,
			cwd,
			projectId,
			projectName: basename(cwd) || cwd,
			createdAt: now,
			updatedAt: now,
			modelId,
			...(options.thinking ? { thinking: options.thinking } : {}),
			messageCount: 0,
			usage: emptyUsage(),
			seq: 0,
		};
		await mkdir(this.dirFor(projectId), { recursive: true });
		await this.appendExclusive(meta, { type: "meta", meta }, now);
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

	/**
	 * `now` is both the record's `ts` and, for anything but filing it away, the session's new
	 * `updatedAt` — one reading, so that `load` can rebuild the second from the first exactly.
	 */
	private async appendExclusive(meta: SessionMeta, payload: SessionRecordInput, now = Date.now()): Promise<SessionMeta> {
		const key = this.keyFor(meta);
		// Callers may hold a stale snapshot; the store's own copy is the source of truth.
		const base = this.latestMeta.get(key) ?? meta;
		if (payload.type === "title" && payload.source === "auto" && base.titleSetByUser) return base;
		const next: SessionMeta = { ...base, seq: base.seq + 1, updatedAt: now };

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
		if (payload.type === "move") {
			// 同 `archive`：换个归属不是一次活动。
			next.updatedAt = base.updatedAt;
			const movePayload = payload as { cwd?: string; projectId?: string; projectName?: string };
			if (movePayload.cwd !== undefined) next.cwd = movePayload.cwd;
			if (movePayload.projectId !== undefined) next.projectId = movePayload.projectId;
			if (movePayload.projectName !== undefined) next.projectName = movePayload.projectName;
		}
		if (payload.type === "meta") {
			// A meta record carries caller-side changes such as the selected model.
			Object.assign(next, payload.meta, { seq: next.seq, updatedAt: next.updatedAt, usage: payload.meta.usage ?? next.usage });
			// A model/settings snapshot cannot undo an explicit name chosen while it was in flight.
			if (base.titleSetByUser) { next.title = base.title; next.titleSetByUser = true; }
		}

		const persisted = payload.type === "meta" && base.titleSetByUser
			? { ...payload, meta: { ...payload.meta, title: next.title, titleSetByUser: true } }
			: payload;
		const record: SessionRecord = { seq: next.seq, ts: now, ...parkRecordPayload(persisted) };
		await mkdir(this.dirFor(meta.projectId), { recursive: true });
		await appendFile(this.fileFor(meta.projectId, meta.id), `${JSON.stringify(record)}\n`, "utf8");
		await unlink(this.displayCacheFor(meta.projectId, meta.id)).catch(() => undefined);
		this.latestMeta.set(key, next);
		await this.writeIndex(next);
		return next;
	}

	/** Read the appended tail without rescanning the committed prefix. */
	readChanges(projectId: string, sessionId: string, cursor?: SessionReadCursor): Promise<SessionRecordChanges<SessionRecord>> {
		return readRecordChanges(this.fileFor(projectId, sessionId), cursor);
	}

	/** Stream records, optionally only those newer than `sinceSeq`. */
	async *read(
		projectId: string,
		sessionId: string,
		sinceSeq = 0,
		options?: { display?: boolean },
	): AsyncGenerator<SessionRecord> {
		const file = this.fileFor(projectId, sessionId);
		if (!(await stat(file).catch(() => null))) return;

		const rl = createInterface({ input: createReadStream(file, "utf8"), crlfDelay: Infinity });
		try {
			for await (const line of rl) {
				if (!line.trim()) continue;
				let record: SessionRecord;
				try {
					record = JSON.parse(options?.display ? materializeJsonlLine(line) : line);
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
		options?: { display?: boolean },
	): Promise<{
		meta: SessionMeta;
		messages: Message[];
		entries: { seq: number; message: Message }[];
		compactions: number[];
		commandRuns?: CommandRun[];
		compaction: Boundary | null;
	} | null> {
		if (options?.display) {
			const cached = await this.readDisplayCache(projectId, sessionId);
			if (cached) return cached;
		}
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
		let subagentEntries: { seq: number; usage: Usage }[] = [];
		/*
		 * And the newest of them in full, which is what the *model* is given.
		 *
		 * The transcript and the model's view diverge at this point, on purpose — the reader scrolls
		 * back through everything, the model is handed the summary and what followed it. Only the
		 * latest boundary matters: each compaction summarises the one before it, so the newest is
		 * the only one still standing for anything.
		 */
		let compaction: Boundary | null = null;
		for await (const record of this.read(projectId, sessionId, 0, options)) {
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
			} else if (record.type === "event" && record.event.type === "subagent_message" && record.event.message.role === "assistant") {
				subagentEntries.push({ seq: record.seq, usage: record.event.message.usage });
			} else if (record.type === "message") { if (record.message) entries.push({ seq: record.seq, message: record.message }); }
			else if (record.type === "title" && meta) {
				if (record.source !== "auto" || !meta.titleSetByUser) meta.title = record.title;
				if (record.source === "user") meta.titleSetByUser = true;
			}
			else if (record.type === "usage") auxiliaryUsage = addUsage(auxiliaryUsage, record.usage);
			else if (record.type === "archive" && meta) meta.archived = record.archived;
			else if (record.type === "move" && meta) {
				meta.cwd = record.cwd;
				meta.projectId = record.projectId;
				meta.projectName = record.projectName;
			}
			else if (record.type === "truncate") {
				entries = entries.filter((e) => e.seq <= record.afterSeq);
				subagentEntries = subagentEntries.filter((e) => e.seq <= record.afterSeq);
				for (const [id, entry] of commandRuns) if (entry.seq > record.afterSeq) commandRuns.delete(id);
				while (compactions.length && compactions[compactions.length - 1] > entries.length) compactions.pop();
				// A rewind past the boundary retires it: the tail it was paired with is gone.
				if (compaction && compaction.keptFrom > entries.length) compaction = null;
			}
			if (meta) {
				meta.seq = record.seq;
				/*
				 * `updatedAt` the way `appendExclusive` set it: every record is activity except filing
				 * the session away. Taken from the last meta record instead, a rebuilt index dated a
				 * session by when it was created or its model last changed, not by when it was used.
				 */
				if (record.type !== "archive" && record.type !== "move" && typeof record.ts === "number") meta.updatedAt = record.ts;
			}
		}
		if (!meta) return null;
		let messages = entries.map((e) => e.message);
		if (!options?.display) {
			const hydrated = await rehydrateMessages(messages);
			if (hydrated !== messages) {
				messages = hydrated;
				entries = entries.map((entry, index) => ({ ...entry, message: hydrated[index] ?? entry.message }));
			}
		}
		meta.messageCount = messages.length;
		// Re-accumulate usage across assistant messages and sub-agent assistant turns
		let totalUsage = auxiliaryUsage;
		for (const entry of subagentEntries) {
			if (entry.usage) totalUsage = addUsage(totalUsage, entry.usage);
		}
		for (const msg of messages) {
			if (msg.role === "assistant" && msg.usage) {
				totalUsage = addUsage(totalUsage, msg.usage);
			}
		}
		if (totalUsage.total > 0 || meta.usage.total === 0) {
			meta.usage = totalUsage;
		}
		/*
		 * Seed the append queue's view so a reopened session keeps numbering where it left off —
		 * unless an append has moved it past what this read saw.
		 *
		 * The file is read first and the view set afterwards, and an append can land in between.
		 * Putting the older meta back then made the next append reuse a sequence number, which a
		 * client syncing with `?since=N` skips. At the same `seq` the log wins: it is where counts
		 * such as `messageCount` are right again after a truncation.
		 */
		const key = this.keyFor(meta);
		const cached = this.latestMeta.get(key);
		if (!cached || meta.seq >= cached.seq) this.latestMeta.set(key, meta);
		const loaded = {
			meta,
			messages,
			entries,
			compactions,
			compaction,
			commandRuns: [...commandRuns.values()].map((entry) => entry.run),
		};
		if (options?.display) await this.writeDisplayCache(projectId, sessionId, loaded);
		return loaded;
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
			 * Through the shared helper, whose temporary name is unique per write: two conversations
			 * created at once — which the desktop does whenever a window restores several — shared
			 * `index.json.<pid>.tmp`, and the first rename took the file out from under the second
			 * (`ENOENT`), leaving that session out of the index. It also waits out the moment a
			 * scanner holds the file open on Windows. See `utils/atomic-write.ts`.
			 */
			await writeFileAtomic(this.indexPath, JSON.stringify(next, null, 2));
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
		const surviving = await this.load(projectId, sessionId);
		const survivingUsage = surviving?.meta.usage ?? loaded.meta.usage;
		// The index tracks message count; a truncate is the one write that lowers it.
		const corrected = await this.append(meta, { type: "meta", meta: { ...meta, messageCount: messages.length, usage: survivingUsage } });
		return { meta: { ...corrected, messageCount: messages.length, usage: survivingUsage }, messages };
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

	/**
	 * 把一条会话搬到另一个项目下。
	 *
	 * 搬的是**文件**，不只是几个字段：日志按 `projectId` 分目录存（`sessions/<projectId>/<id>.jsonl`），
	 * 而 `projectId` 是 cwd 的哈希——换项目就是换目录。只改 meta 不挪文件的话，下一次
	 * `load(新projectId, id)` 什么都找不到，那条对话就等于凭空消失了。
	 *
	 * 顺序是**先挪文件、再写记录**。`rename` 在同一个文件系统里是一步到位的，追加不是：挪成功而
	 * 记录没写成，把文件挪回去就回到了原样；反过来先写记录，中途断电留下的是一条自称在新项目、
	 * 文件却还躺在旧目录里的会话——那要靠 `rebuildIndex` 全盘重扫才捞得回来。
	 *
	 * 返回 null 表示索引里没有这条会话。一个还没刷新的侧边栏可以对着一条已经被删掉的会话点「移动
	 * 到」，那不值得抛异常。
	 */
	async move(projectId: string, sessionId: string, cwd: string, projectName: string): Promise<SessionMeta | null> {
		const current = (await this.listSessions()).find((s) => s.projectId === projectId && s.id === sessionId);
		if (!current) return null;
		// 调用方手里的那份可能是旧的；store 自己记的才是权威，`seq` 尤其。
		const base = (await this.listSessions()).find((s) => s.projectId === projectId && s.id === sessionId) ?? current;
		const nextProjectId = projectIdFor(cwd);

		/*
		 * 已经在那个项目里了：不动文件，但该写的记录照写。
		 *
		 * 项目被重命名过的时候就是这一支——目录不变，`projectName` 变了。两样都没变才是真的无事
		 * 可做，此时连一条空记录都不该留。
		 */
		if (nextProjectId === base.projectId) {
			if (base.cwd === cwd && base.projectName === projectName) return base;
			return this.append(base, { type: "move", cwd, projectId: nextProjectId, projectName });
		}

		/*
		 * 等旧钥匙上排着的写入走完再动手。
		 *
		 * 写队列和 `latestMeta` 都按 `projectId/id` 索引，而下面要把钥匙换成新的。此刻还在路上的
		 * 那一次追加认的是旧钥匙、写的是旧路径——文件已经不在那儿了，它会在旧目录里重新长出一个
		 * 只有一条记录的残片。
		 */
		await this.writeQueues.get(this.keyFor(base))?.catch(() => undefined);

		const from = this.fileFor(base.projectId, sessionId);
		const to = this.fileFor(nextProjectId, sessionId);
		await mkdir(this.dirFor(nextProjectId), { recursive: true });
		/*
		 * 目标目录里已经有同名文件——不覆盖。
		 *
		 * id 是 UUID，正常情况下撞不上；撞上的是手工拷贝过 profile 的机器，而那一次覆盖会把另一条
		 * 对话整个抹掉，连日志都不剩。宁可这一步失败。
		 */
		if (await stat(to).catch(() => null)) throw new Error(`目标项目下已存在同名会话文件：${to}`);

		await rename(from, to);
		const moved: SessionMeta = { ...base, cwd, projectId: nextProjectId, projectName };
		try {
			// 钥匙跟着文件搬。放进去的必须带上新的 projectId，但保留 base.updatedAt 和 seq
			this.latestMeta.delete(this.keyFor(base));
			this.latestMeta.set(this.keyFor(moved), { ...base, cwd, projectId: nextProjectId, projectName });
			const result = await this.append(moved, { type: "move", cwd, projectId: nextProjectId, projectName });
			// 显示缓存是按旧路径命名的，跟着旧目录留在那儿就是个孤儿。
			await unlink(this.displayCacheFor(base.projectId, sessionId)).catch(() => undefined);
			return result;
		} catch (cause) {
			// 记录没写成，文件挪回去——对外就当这次移动从没发生过。
			await rename(to, from).catch(() => undefined);
			this.latestMeta.delete(this.keyFor(moved));
			this.latestMeta.set(this.keyFor(base), base);
			throw cause;
		}
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
