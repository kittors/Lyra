import * as SecureStore from "expo-secure-store";
import { create } from "zustand";
import { SyncClient, type Connection, type SocketState } from "./client";
import { summarizeToolCall } from "./toolSummary";
import type {
	AgentEvent,
	AssistantMessage,
	Message,
	RemoteSettings,
	SessionMeta,
	UserContent,
} from "./protocol";

const CONNECTION_KEY = "lyra.connection";

export interface ToolRun {
	toolCallId: string;
	toolName: string;
	summary: string;
	status: "running" | "done" | "error";
	output?: string;
	details?: unknown;
}

export interface PendingApproval {
	id: string;
	kind: string;
	title: string;
	detail: string;
}

interface MobileState {
	hydrated: boolean;
	connection: Connection | null;
	client: SyncClient | null;
	socketState: SocketState;

	sessions: SessionMeta[];
	settings: RemoteSettings | null;
	loadingSessions: boolean;
	error: string | null;

	activeSession: SessionMeta | null;
	messages: Message[];
	toolRuns: Record<string, ToolRun>;
	approvals: PendingApproval[];
	running: boolean;
	/** Highest record seq applied, so a reconnect can resume instead of re-reading everything. */
	seq: number;

	hydrate(): Promise<void>;
	pair(connection: Connection): Promise<boolean>;
	unpair(): Promise<void>;
	refreshSessions(): Promise<void>;
	openSession(meta: SessionMeta): Promise<void>;
	closeSession(): void;
	send(text: string): Promise<void>;
	abort(): Promise<void>;
	approve(id: string, decision: "once" | "always" | "reject"): Promise<void>;
	createSession(cwd: string): Promise<SessionMeta | null>;
	setModel(modelId: string): Promise<void>;
}

export const useMobile = create<MobileState>((set, get) => ({
	hydrated: false,
	connection: null,
	client: null,
	socketState: "closed",
	sessions: [],
	settings: null,
	loadingSessions: false,
	error: null,
	activeSession: null,
	messages: [],
	toolRuns: {},
	approvals: [],
	running: false,
	seq: 0,

	async hydrate() {
		const raw = await SecureStore.getItemAsync(CONNECTION_KEY).catch(() => null);
		if (!raw) {
			set({ hydrated: true });
			return;
		}
		try {
			const connection = JSON.parse(raw) as Connection;
			attach(connection, set, get);
			set({ connection, hydrated: true });
			await get().refreshSessions();
		} catch {
			set({ hydrated: true });
		}
	},

	async pair(connection) {
		/*
		 * A relayed connection is verified before it gets here, and cannot be verified the same way.
		 *
		 * `verify` asks the sync server a question over HTTP; a relay answers no HTTP the app knows.
		 * What stands in for it is the room: both ends derive it from the token, so meeting in one
		 * already proves the token matches — see `SyncClient.pingRelay`, which waits for the desktop
		 * to actually be in there rather than settling for an empty room.
		 */
		if (!connection.relay) {
			const client = new SyncClient(connection);
			if (!(await client.verify())) {
				set({ error: "地址或令牌不正确，请检查桌面端的「移动端同步」页面。" });
				return false;
			}
		}
		// Keychain writes can fail (locked device, web preview); pairing should still work
		// for the current session rather than dropping the user back to the pairing screen.
		await SecureStore.setItemAsync(CONNECTION_KEY, JSON.stringify(connection)).catch(() => undefined);
		attach(connection, set, get);
		set({ connection, error: null });
		await get().refreshSessions();
		return true;
	},

	async unpair() {
		get().client?.disconnect();
		await SecureStore.deleteItemAsync(CONNECTION_KEY).catch(() => undefined);
		set({
			connection: null,
			client: null,
			sessions: [],
			settings: null,
			activeSession: null,
			messages: [],
			toolRuns: {},
			approvals: [],
		});
	},

	async refreshSessions() {
		const client = get().client;
		if (!client) return;
		set({ loadingSessions: true, error: null });
		try {
			const [sessions, settings] = await Promise.all([client.listSessions(), client.settings()]);
			// Archived sessions are hidden on the desktop too; the two lists have to agree.
			set({ sessions: sessions.sessions.filter((s) => !s.archived), settings });
		} catch (error) {
			set({ error: error instanceof Error ? error.message : String(error) });
		} finally {
			set({ loadingSessions: false });
		}
	},

	async openSession(meta) {
		const client = get().client;
		if (!client) return;
		set({ activeSession: meta, messages: [], toolRuns: {}, approvals: [], seq: 0, error: null });

		try {
			const [{ records }, status] = await Promise.all([
				client.records(meta.projectId, meta.id),
				client.status(meta.projectId, meta.id).catch(() => null),
			]);

			/*
			 * Replayed with sequence numbers so a truncate record can drop the right tail.
			 *
			 * Editing a message on the desktop rewrites history from that point. Without this
			 * the phone would replay the discarded reply as though it still stood, and show an
			 * answer to a question that had been withdrawn.
			 */
			let entries: { seq: number; message: Message }[] = [];
			let seq = 0;
			for (const record of records) {
				seq = Math.max(seq, record.seq);
				if (record.type === "message") entries.push({ seq: record.seq, message: record.message });
				else if (record.type === "truncate") entries = entries.filter((e) => e.seq <= record.afterSeq);
			}
			const messages = entries.map((e) => e.message);

			set({
				messages,
				seq,
				toolRuns: rebuildToolRuns(messages),
				running: status?.running ?? false,
				approvals:
					status?.pendingApprovals.map((p) => ({
						id: p.id,
						kind: p.request.kind,
						title: p.request.title,
						detail: p.request.detail,
					})) ?? [],
			});
		} catch (error) {
			set({ error: error instanceof Error ? error.message : String(error) });
		}
	},

	closeSession() {
		set({ activeSession: null, messages: [], toolRuns: {}, approvals: [], running: false, seq: 0 });
	},

	async send(text) {
		const { client, activeSession } = get();
		if (!client || !activeSession || !text.trim()) return;
		const content: UserContent[] = [{ type: "text", text: text.trim() }];
		// Show it immediately; the desktop echoes it back as a message_start we then dedupe.
		set({ messages: [...get().messages, { role: "user", content, timestamp: Date.now() }], running: true });
		try {
			await client.prompt(activeSession.projectId, activeSession.id, content);
		} catch (error) {
			set({ error: error instanceof Error ? error.message : String(error), running: false });
		}
	},

	async abort() {
		const { client, activeSession } = get();
		if (client && activeSession) await client.abort(activeSession.projectId, activeSession.id).catch(() => undefined);
	},

	async approve(id, decision) {
		const { client, activeSession } = get();
		if (!client || !activeSession) return;
		set({ approvals: get().approvals.filter((a) => a.id !== id) });
		await client.approve(activeSession.projectId, activeSession.id, id, decision).catch(() => undefined);
	},

	/**
	 * Choose the model, only while the conversation is still empty.
	 *
	 * The desktop refuses this outright once there is history — stored messages carry
	 * provider-specific handles (response ids, thinking signatures, encrypted reasoning) that
	 * another model cannot replay. Checked here too so the picker does not have to round-trip
	 * to be told no, and the optimistic update now waits for the server to agree: it used to
	 * paint the new model regardless, leaving the phone showing one the session was not using.
	 */
	async setModel(modelId) {
		const { client, activeSession, messages } = get();
		if (!client || !activeSession || messages.length > 0) return;
		const result = await client
			.setModel(activeSession.projectId, activeSession.id, modelId)
			.catch(() => null);
		if (!result?.ok) return;
		set({ activeSession: { ...activeSession, modelId } });
	},

	async createSession(cwd) {
		const client = get().client;
		if (!client) return null;
		try {
			const { meta } = await client.createSession(cwd, get().settings?.defaultModelId ?? undefined);
			await get().refreshSessions();
			return meta;
		} catch (error) {
			set({ error: error instanceof Error ? error.message : String(error) });
			return null;
		}
	},
}));

type Setter = (partial: Partial<MobileState>) => void;
type Getter = () => MobileState;

function attach(connection: Connection, set: Setter, get: Getter): void {
	get().client?.disconnect();
	const client = new SyncClient(connection);

	client.onStateChange((socketState) => {
		if (socketState !== "unauthorized") {
			set({ socketState });
			return;
		}
		/*
		 * A rotated token will never recover by reconnecting. Drop only that stale credential;
		 * ordinary network closes still take the reconnect path in SyncClient.
		 */
		void get()
			.unpair()
			.then(() => set({ error: "桌面端配对令牌已更新，请重新配对。" }));
	});
	client.onEvent((sessionId, event) => applyEvent(sessionId, event, set, get));
	client.connect();
	set({ client });
}

function applyEvent(sessionId: string, event: AgentEvent, set: Setter, get: Getter): void {
	const state = get();
	if (state.activeSession?.id !== sessionId) {
		// The title lands with the first message; renaming in place beats waiting for the
		// turn to end and re-fetching the whole list.
		if (event.type === "title") {
			set({ sessions: state.sessions.map((s) => (s.id === sessionId ? { ...s, title: event.title } : s)) });
			return;
		}
		// Still refresh the list so the sidebar title and updated time stay current.
		if (event.type === "agent_end") void get().refreshSessions();
		return;
	}

	switch (event.type) {
		case "agent_start":
			set({ running: true });
			break;

		case "message_start": {
			if (isDuplicateUserEcho(state.messages, event.message)) break;
			set({ messages: [...state.messages, event.message] });
			break;
		}

		case "message_update": {
			const messages = [...state.messages];
			const index = messages.length - 1;
			if (index >= 0 && messages[index].role === "assistant") messages[index] = event.message;
			else messages.push(event.message);
			set({ messages });
			break;
		}

		case "message_end": {
			const messages = [...state.messages];
			const index = findSlot(messages, event.message);
			if (index >= 0) messages[index] = event.message;
			else if (!isDuplicateUserEcho(messages, event.message)) messages.push(event.message);
			set({ messages });
			break;
		}

		case "tool_start":
			set({
				toolRuns: {
					...state.toolRuns,
					[event.toolCallId]: {
						toolCallId: event.toolCallId,
						toolName: event.toolName,
						summary: event.summary,
						status: "running",
					},
				},
			});
			break;

		case "tool_end":
			set({
				toolRuns: {
					...state.toolRuns,
					[event.toolCallId]: {
						toolCallId: event.toolCallId,
						toolName: event.toolName,
						summary: state.toolRuns[event.toolCallId]?.summary ?? event.toolName,
						status: event.isError ? "error" : "done",
						output: event.result.content
							.map((c) => (c.type === "text" ? c.text : "[图片]"))
							.join("\n")
							.slice(0, 4000),
						details: event.result.details,
					},
				},
			});
			break;

		case "approval_request":
			set({
				approvals: [
					...state.approvals,
					{ id: event.requestId, kind: event.kind, title: event.title, detail: event.detail },
				],
			});
			break;

		case "title":
			set({
				activeSession: state.activeSession ? { ...state.activeSession, title: event.title } : state.activeSession,
				sessions: state.sessions.map((s) => (s.id === sessionId ? { ...s, title: event.title } : s)),
			});
			break;

		case "rewound":
			// A message was edited elsewhere; the reply it drew no longer follows from what was
			// said, so it goes. Cannot be inferred from the messages that arrive next — the
			// replacement looks like an ordinary new one.
			set({ messages: state.messages.slice(0, event.messageCount), toolRuns: {} });
			break;

		case "agent_end":
			set({ running: false, approvals: [] });
			void get().refreshSessions();
			break;
	}
}

/** The desktop echoes the prompt we optimistically rendered; match on text to avoid a double bubble. */
function isDuplicateUserEcho(messages: Message[], incoming: Message): boolean {
	if (incoming.role !== "user") return false;
	const incomingText = incoming.content.map((c) => (c.type === "text" ? c.text : "")).join("");
	for (let i = messages.length - 1; i >= Math.max(0, messages.length - 3); i--) {
		const candidate = messages[i];
		if (candidate.role !== "user") continue;
		const text = candidate.content.map((c) => (c.type === "text" ? c.text : "")).join("");
		if (text === incomingText) return true;
	}
	return false;
}

function findSlot(messages: Message[], incoming: Message): number {
	if (incoming.role === "toolResult") {
		return messages.findIndex((m) => m.role === "toolResult" && m.toolCallId === incoming.toolCallId);
	}
	for (let i = messages.length - 1; i >= 0; i--) {
		const candidate = messages[i];
		if (candidate.role !== incoming.role) continue;
		if (candidate.role === "assistant" && incoming.role === "assistant") {
			return candidate.stopReason === "pending" || candidate.timestamp === incoming.timestamp ? i : -1;
		}
		if (candidate.timestamp === incoming.timestamp) return i;
	}
	return -1;
}

function rebuildToolRuns(messages: Message[]): Record<string, ToolRun> {
	const runs: Record<string, ToolRun> = {};
	for (const message of messages) {
		if (message.role === "assistant") {
			for (const block of message.content) {
				if (block.type !== "toolCall") continue;
				runs[block.id] = {
					toolCallId: block.id,
					toolName: block.name,
					summary: summarizeToolCall(block.name, block.arguments),
					status: "running",
				};
			}
		} else if (message.role === "toolResult") {
			const run = runs[message.toolCallId];
			if (!run) continue;
			run.status = message.isError ? "error" : "done";
			run.output = message.content
				.map((c) => (c.type === "text" ? c.text : "[图片]"))
				.join("\n")
				.slice(0, 4000);
			run.details = message.details;
		}
	}
	return runs;
}

export function assistantText(message: AssistantMessage): string {
	return message.content
		.filter((c): c is { type: "text"; text: string } => c.type === "text")
		.map((c) => c.text)
		.join("");
}
