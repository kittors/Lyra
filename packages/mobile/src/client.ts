/**
 * Client for the desktop sync server.
 *
 * Two channels: HTTP for commands and history, a WebSocket for live agent events. The
 * WebSocket is best-effort — on reconnect the client re-reads the session log from the last
 * sequence number it saw, so a dropped connection never loses a turn.
 */

import { roomFor } from "./sha256.ts";
import type { AgentEvent, RemoteSettings, SessionMeta, SessionRecord, UserContent } from "./protocol";

export type SocketState = "connecting" | "open" | "closed" | "unauthorized";
export type VerificationStatus = "verified" | "unauthorized" | "unreachable";

export interface Connection {
	host: string;
	port: number;
	token: string;
	/**
	 * Speak https/wss rather than http/ws.
	 *
	 * A desktop on the LAN is plain http — it is on the same network and there is no certificate
	 * to have. Anything reached through a reverse proxy or a tunnel is almost always TLS, and
	 * guessing wrong is not a degraded connection but no connection: http against a TLS port hangs
	 * until it times out, and the error names neither cause.
	 */
	tls?: boolean;
	/**
	 * This endpoint is a relay to meet at, not the desktop itself.
	 *
	 * Kept so the UI can say which way it is connected — "通过中转" is worth showing, because it
	 * explains both the extra hop of latency and why it still works away from home.
	 */
	relay?: boolean;
	/**
	 * The desktop's platform, learned when pairing.
	 *
	 * The renderer reads it before its first paint to decide where the window controls go and which
	 * shortcut glyphs to print. It describes the machine the session runs on, not this phone.
	 */
	platform?: string;
}

class HttpStatusError extends Error {
	readonly status: number;

	constructor(status: number, message: string) {
		super(message);
		this.status = status;
	}
}

export class SyncClient {
	private connection: Connection;
	private socket: WebSocket | null = null;
	private listeners = new Set<(sessionId: string, event: AgentEvent) => void>();
	private stateListeners = new Set<(state: SocketState) => void>();
	private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	private closedByUser = false;

	constructor(connection: Connection) {
		this.connection = connection;
	}

	get baseUrl(): string {
		return `${this.connection.tls ? "https" : "http"}://${this.connection.host}:${this.connection.port}`;
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
			throw new HttpStatusError(
				response.status,
				`HTTP ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`,
			);
		}
		return (await response.json()) as T;
	}

	static async ping(host: string, port: number, tls = false): Promise<boolean> {
		try {
			const response = await fetch(`${tls ? "https" : "http"}://${host}:${port}/api/ping`, {
				signal: AbortSignal.timeout(5000),
			});
			if (!response.ok) return false;
			const body = (await response.json()) as { app?: string };
			return body.app === "lyra";
		} catch {
			return false;
		}
	}

	/**
	 * Whether a relay is reachable and will let us into our room.
	 *
	 * Not `ping`: a relay is not a sync server. It answers no HTTP route the app knows and has no
	 * opinion about the token, so the question it *can* answer is whether the desktop is in the room
	 * — which is `ready`, and is a stronger answer than either half alone. It says the relay works,
	 * that the desktop is dialled in, and that both ends derived the same room, which they can only
	 * do from the same token. That last part is why this doubles as the token check on this path.
	 *
	 * `waiting` is not enough: it means the room opened and nobody else is in it, which is equally
	 * what a wrong token looks like — a room of one, belonging to nobody.
	 */
	static pingRelay(host: string, port: number, tls: boolean, token: string): Promise<boolean> {
		return new Promise((resolve) => {
			let socket: WebSocket;
			try {
				socket = new WebSocket(`${tls ? "wss" : "ws"}://${host}:${port}`);
			} catch {
				resolve(false);
				return;
			}

			const done = (ok: boolean) => {
				clearTimeout(timer);
				try {
					socket.close();
				} catch {
					/* already gone */
				}
				resolve(ok);
			};
			// Longer than the direct ping: this crosses the internet twice, and the relay itself
			// allows ten seconds before it hangs up on a socket that has said nothing.
			const timer = setTimeout(() => done(false), 8000);

			socket.onopen = () => socket.send(JSON.stringify({ type: "hello", room: roomFor(token) }));
			socket.onerror = () => done(false);
			socket.onclose = () => done(false);
			socket.onmessage = (event) => {
				let message: { type?: string };
				try {
					message = JSON.parse(String(event.data)) as typeof message;
				} catch {
					return;
				}
				if (message.type === "ready") done(true);
				// `waiting` is not an answer yet — the desktop may still be dialling in — so it is
				// left to the timeout. `refused` (room-full, bad hello) is a definite no.
				else if (message.type === "refused") done(false);
			};
		});
	}

	async verifyStatus(): Promise<VerificationStatus> {
		try {
			await this.request("/api/sessions", { signal: AbortSignal.timeout(5000) });
			return "verified";
		} catch (error) {
			if (error instanceof HttpStatusError && (error.status === 401 || error.status === 403)) {
				return "unauthorized";
			}
			return "unreachable";
		}
	}

	async verify(): Promise<boolean> {
		return (await this.verifyStatus()) === "verified";
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

	onStateChange(listener: (state: SocketState) => void): () => void {
		this.stateListeners.add(listener);
		return () => this.stateListeners.delete(listener);
	}

	connect(): void {
		if (this.socket) return;
		this.closedByUser = false;
		this.emitState("connecting");

		const socket = new WebSocket(
			`${this.connection.tls ? "wss" : "ws"}://${this.connection.host}:${this.connection.port}/ws?token=${encodeURIComponent(this.connection.token)}`,
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
			if (!this.closedByUser) void this.reconnectOrReportAuth();
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

	/** A rejected handshake looks like an ordinary close, so ask HTTP before treating it as an outage. */
	private async reconnectOrReportAuth(): Promise<void> {
		const verification = await this.verifyStatus();
		if (this.closedByUser || this.socket) return;
		if (verification === "unauthorized") {
			this.emitState("unauthorized");
			return;
		}
		this.scheduleReconnect();
	}

	private scheduleReconnect(): void {
		if (this.reconnectTimer) return;
		this.reconnectTimer = setTimeout(() => {
			this.reconnectTimer = null;
			this.connect();
		}, 3000);
	}

	private emitState(state: SocketState): void {
		for (const listener of this.stateListeners) listener(state);
	}
}
