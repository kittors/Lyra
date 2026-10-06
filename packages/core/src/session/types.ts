/**
 * The shapes a session is stored in: its meta, and the records it is made of.
 *
 * Apart from the store so that what reads them — the replay, the spend table, the import of old
 * logs — does not have to reach into the class that writes them.
 */

import type { AgentEvent } from "../agent/events.ts";
import type { Message, ThinkingLevel, Usage } from "../types.ts";

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
	 * Filed under another project: `cwd`, `projectId` and `projectName` change together.
	 *
	 * A record of its own rather than a `meta`, for the reason `archive` is one: re-filing a
	 * conversation is not using it, and `updatedAt` must not jump — a session untouched for half a
	 * year would otherwise leap to the top of the list for being tidied. Being a record also tells a
	 * client syncing with `?since=N` that it moved.
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
