/**
 * Client for the desktop sync server.
 *
 * Two channels: HTTP for commands and history, a WebSocket for live agent events. The
 * WebSocket is best-effort — on reconnect the client re-reads the session log from the last
 * sequence number it saw, so a dropped connection never loses a turn.
 */

import type { AgentEvent, RemoteSettings, SessionMeta, SessionRecord, UserContent } from "./protocol";

export interface Connection {
	host: string;
	port: number;
	token: string;
}

export class SyncClient {
	private connection: Connection;
	private socket: WebSocket | null = null;
	private listeners = new Set<(sessionId: string, event: AgentEvent) => void>();
	private stateListeners = new Set<(state: "connecting" | "open" | "closed") => void>();
	private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	private closedByUser = false;

	constructor(connection: Connection) {
		this.connection = connection;
	}

	get baseUrl(): string {
		return `http://${this.connection.host}:${this.connection.port}`;
	}

	// -------------------------------------------------------------------------
	// HTTP
	// -------------------------------------------------------------------------

	private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
		const response = await fetch(`${this.baseUrl}${path}`, {
			...init,
			headers: {
				"content-type": "application/json",
				authorization: `Bearer ${this.connection.token}`,
				...init.headers,
			},
		});
		if (!response.ok) {
			const detail = await response.text().catch(() => "");
			throw new Error(`HTTP ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`);
		}
		return (await response.json()) as T;
	}

	static async ping(host: string, port: number): Promise<boolean> {
		try {
			const response = await fetch(`http://${host}:${port}/api/ping`, {
				signal: AbortSignal.timeout(5000),
			});
			if (!response.ok) return false;
			const body = (await response.json()) as { app?: string };
			return body.app === "lyra";
		} catch {
			return false;
		}
	}

	async verify(): Promise<boolean> {
		try {
			await this.listSessions();
			return true;
		} catch {
			return false;
		}
	}

	listSessions(): Promise<{ sessions: SessionMeta[] }> {
		return this.request("/api/sessions");
	}

	settings(): Promise<RemoteSettings> {
		return this.request("/api/settings");
	}

	records(projectId: string, sessionId: string, since = 0): Promise<{ records: SessionRecord[] }> {
		return this.request(`/api/sessions/${projectId}/${sessionId}?since=${since}`);
	}

	status(projectId: string, sessionId: string): Promise<{
		meta: SessionMeta;
		running: boolean;
		pendingApprovals: { id: string; request: { kind: string; title: string; detail: string } }[];
	}> {
		return this.request(`/api/sessions/${projectId}/${sessionId}/status`);
	}

	prompt(projectId: string, sessionId: string, content: UserContent[]): Promise<{ accepted: boolean }> {
		return this.request(`/api/sessions/${projectId}/${sessionId}/prompt`, {
			method: "POST",
			body: JSON.stringify({ content }),
		});
	}

	abort(projectId: string, sessionId: string): Promise<{ aborted: boolean }> {
		return this.request(`/api/sessions/${projectId}/${sessionId}/abort`, { method: "POST" });
	}

	approve(
		projectId: string,
		sessionId: string,
		requestId: string,
		decision: "once" | "always" | "reject",
	): Promise<{ resolved: boolean }> {
		return this.request(`/api/sessions/${projectId}/${sessionId}/approve`, {
			method: "POST",
			body: JSON.stringify({ requestId, decision }),
		});
	}

	setModel(projectId: string, sessionId: string, modelId: string): Promise<{ ok: boolean }> {
		return this.request(`/api/sessions/${projectId}/${sessionId}/model`, {
			method: "POST",
			body: JSON.stringify({ modelId }),
		});
	}

	rename(projectId: string, sessionId: string, title: string): Promise<{ ok: boolean; meta: SessionMeta }> {
		return this.request(`/api/sessions/${projectId}/${sessionId}/rename`, {
			method: "POST",
			body: JSON.stringify({ title }),
		});
	}

	createSession(cwd: string, modelId?: string): Promise<{ meta: SessionMeta }> {
		return this.request("/api/sessions", { method: "POST", body: JSON.stringify({ cwd, modelId }) });
	}

	// -------------------------------------------------------------------------
	// WebSocket
	// -------------------------------------------------------------------------

	onEvent(listener: (sessionId: string, event: AgentEvent) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	onStateChange(listener: (state: "connecting" | "open" | "closed") => void): () => void {
		this.stateListeners.add(listener);
		return () => this.stateListeners.delete(listener);
	}

	connect(): void {
		if (this.socket) return;
		this.closedByUser = false;
		this.emitState("connecting");

		const socket = new WebSocket(
			`ws://${this.connection.host}:${this.connection.port}/ws?token=${encodeURIComponent(this.connection.token)}`,
		);
		this.socket = socket;

		socket.onopen = () => this.emitState("open");

		socket.onmessage = (event) => {
			let payload: { type?: string; sessionId?: string; event?: AgentEvent };
			try {
				payload = JSON.parse(String(event.data));
			} catch {
				return;
			}
			if (payload.type !== "agent_event" || !payload.sessionId || !payload.event) return;
			for (const listener of this.listeners) listener(payload.sessionId, payload.event);
		};

		socket.onclose = () => {
			this.socket = null;
			this.emitState("closed");
			if (!this.closedByUser) this.scheduleReconnect();
		};

		socket.onerror = () => socket.close();
	}

	disconnect(): void {
		this.closedByUser = true;
		if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
		this.reconnectTimer = null;
		this.socket?.close();
		this.socket = null;
	}

	private scheduleReconnect(): void {
		if (this.reconnectTimer) return;
		this.reconnectTimer = setTimeout(() => {
			this.reconnectTimer = null;
			this.connect();
		}, 3000);
	}

	private emitState(state: "connecting" | "open" | "closed"): void {
		for (const listener of this.stateListeners) listener(state);
	}
}
