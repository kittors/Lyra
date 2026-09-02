/**
 * Sync server.
 *
 * The desktop app is the source of truth: it owns the filesystem, the shell and the MCP
 * processes. The phone is a thin client that replays the same session log and drives the same
 * `AgentSession`, so a turn started on the desktop can be watched and steered from the phone
 * and vice versa.
 *
 * Transport: HTTP for request/response, WebSocket for live agent events. Auth is a bearer
 * token the user pairs once; the server only listens on the LAN.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { networkInterfaces } from "node:os";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { WebSocketServer, type WebSocket } from "ws";
import type { AgentEvent, AgentSession, SessionStorage, Settings, UserContent } from "@lyra/core";
import type { SyncStatus } from "./ipc-types.ts";

export interface SyncServerDeps {
	getSettings(): Settings;
	saveSettings(settings: Settings): Promise<void>;
	store: SessionStorage;
	resolveSession(projectId: string, sessionId: string): Promise<AgentSession | null>;
	createSession(cwd: string, modelId: string): Promise<AgentSession>;
}

export class SyncServer {
	private deps: SyncServerDeps;
	private http: Server | null = null;
	private wss: WebSocketServer | null = null;
	private clients = new Set<WebSocket>();
	private token: string | null = null;
	private port = 4517;

	constructor(deps: SyncServerDeps) {
		this.deps = deps;
	}

	get running(): boolean {
		return this.http !== null;
	}

	async start(port: number, token: string | null): Promise<SyncStatus> {
		if (this.http) await this.stop();
		this.port = port;
		this.token = token ?? randomUUID().replace(/-/g, "");

		if (!token) {
			const settings = this.deps.getSettings();
			await this.deps.saveSettings({ ...settings, sync: { ...settings.sync, token: this.token } });
		}

		const server = createServer((req, res) => void this.handleHttp(req, res));
		this.wss = new WebSocketServer({ noServer: true });

		server.on("upgrade", (request, socket, head) => {
			const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
			if (url.pathname !== "/ws" || !this.authorize(url.searchParams.get("token"))) {
				/*
				 * The refusal is a courtesy, and the socket may already be gone.
				 *
				 * A client that gave up between opening the connection and this line leaves a pipe
				 * with nothing at the far end, and writing to one throws `EPIPE` — which, on a raw
				 * socket from `upgrade`, has no listener and reaches the top of the main process.
				 * The connection is being closed either way; failing to say why is not worth taking
				 * the app down for.
				 */
				socket.on("error", () => {});
				try {
					socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
				} catch {}
				socket.destroy();
				return;
			}
			this.wss?.handleUpgrade(request, socket, head, (ws) => {
				this.clients.add(ws);
				ws.on("close", () => this.clients.delete(ws));
				ws.on("error", () => this.clients.delete(ws));
				ws.send(JSON.stringify({ type: "hello", version: 1 }));
			});
		});

		await new Promise<void>((resolve, reject) => {
			server.once("error", reject);
			// Binding to 0.0.0.0 is what makes the phone able to reach it; the token is the gate.
			server.listen(port, "0.0.0.0", () => resolve());
		});

		this.http = server;
		return this.status();
	}

	async stop(): Promise<void> {
		for (const client of this.clients) client.close();
		this.clients.clear();
		this.wss?.close();
		this.wss = null;
		await new Promise<void>((resolve) => {
			if (!this.http) return resolve();
			this.http.close(() => resolve());
		});
		this.http = null;
	}

	broadcast(sessionId: string, event: AgentEvent): void {
		if (this.clients.size === 0) return;
		const payload = JSON.stringify({ type: "agent_event", sessionId, event });
		for (const client of this.clients) {
			if (client.readyState === 1) client.send(payload);
		}
	}

	status(): SyncStatus {
		const addresses = localAddresses();
		return {
			running: this.running,
			port: this.port,
			token: this.token,
			addresses,
			clients: this.clients.size,
			pairingUrl:
				this.running && this.token && addresses[0]
					? `lyra://pair?host=${addresses[0]}&port=${this.port}&token=${this.token}`
					: null,
		};
	}

	// -------------------------------------------------------------------------
	// HTTP routes
	// -------------------------------------------------------------------------

	private async handleHttp(req: IncomingMessage, res: ServerResponse): Promise<void> {
		const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
		const send = (status: number, body: unknown) => {
			res.writeHead(status, { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*" });
			res.end(JSON.stringify(body));
		};

		if (req.method === "OPTIONS") {
			res.writeHead(204, {
				"access-control-allow-origin": "*",
				"access-control-allow-headers": "authorization, content-type",
				"access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
			});
			res.end();
			return;
		}

		// Unauthenticated: lets the phone confirm it found a Lyra host before pairing.
		if (url.pathname === "/api/ping") {
			send(200, { app: "lyra", version: 1, requiresToken: true });
			return;
		}

		const header = req.headers.authorization ?? "";
		if (!this.authorize(header.replace(/^Bearer /i, ""))) {
			send(401, { error: "unauthorized" });
			return;
		}

		try {
			const segments = url.pathname.split("/").filter(Boolean);

			if (req.method === "GET" && url.pathname === "/api/sessions") {
				send(200, { sessions: await this.deps.store.listSessions() });
				return;
			}

			if (req.method === "GET" && url.pathname === "/api/settings") {
				const settings = this.deps.getSettings();
				// The phone needs the model list to render a picker, but never the API keys.
				send(200, {
					permissionMode: settings.permissionMode,
					thinking: settings.thinking,
					defaultModelId: settings.defaultModelId,
					projects: settings.projects,
					models: settings.providers
						.filter((p) => p.enabled)
						.flatMap((p) => p.models.map((m) => ({ id: m.id, name: m.name, provider: p.name, api: p.api }))),
				});
				return;
			}

			// /api/sessions/:projectId/:sessionId[/action]
			if (segments[0] === "api" && segments[1] === "sessions" && segments.length >= 4) {
				const [, , projectId, sessionId, action] = segments;

				if (req.method === "GET" && !action) {
					const since = Number(url.searchParams.get("since") ?? "0");
					const records = [];
					for await (const record of this.deps.store.read(projectId, sessionId, since)) records.push(record);
					send(200, { records });
					return;
				}

				const session = await this.deps.resolveSession(projectId, sessionId);
				if (!session) {
					send(404, { error: "session_not_found" });
					return;
				}

				if (req.method === "POST" && action === "prompt") {
					const body = (await readJson(req)) as { content?: UserContent[]; text?: string };
					const content: UserContent[] = body.content ?? [{ type: "text", text: String(body.text ?? "") }];
					if (content.length === 0) {
						send(400, { error: "empty_prompt" });
						return;
					}
					void session.prompt(content);
					send(202, { accepted: true, sessionId });
					return;
				}

				if (req.method === "POST" && action === "model") {
					const body = (await readJson(req)) as { modelId?: string };
					if (!body.modelId) {
						send(400, { error: "modelId_required" });
						return;
					}
					// Refused once the conversation has started — the stored history carries
					// provider-specific handles another model cannot replay. Reported rather
					// than swallowed, so the phone can say why instead of silently not changing.
					const changed = await session.setModel(String(body.modelId));
					if (!changed) {
						send(409, { error: "model_locked", meta: session.meta });
						return;
					}
					send(200, { ok: true });
					return;
				}

				if (req.method === "POST" && action === "abort") {
					session.abort();
					send(200, { aborted: true });
					return;
				}

				if (req.method === "POST" && action === "rename") {
					const body = (await readJson(req)) as { title?: string };
					const newTitle = (body.title ?? "").trim();
					if (!newTitle) {
						send(400, { error: "title_required" });
						return;
					}
					await session.rename(newTitle);
					send(200, { ok: true, meta: session.meta });
					return;
				}

				if (req.method === "POST" && action === "approve") {
					const body = (await readJson(req)) as { requestId?: string; decision?: "once" | "always" | "reject" };
					const ok = session.resolveApproval(String(body.requestId), body.decision ?? "reject");
					send(ok ? 200 : 404, { resolved: ok });
					return;
				}

				if (req.method === "GET" && action === "status") {
					send(200, {
						meta: session.meta,
						running: session.running,
						pendingApprovals: session.listPendingApprovals(),
					});
					return;
				}
			}

			if (req.method === "POST" && url.pathname === "/api/sessions") {
				const body = (await readJson(req)) as { cwd?: string; modelId?: string };
				if (!body.cwd) {
					send(400, { error: "cwd_required" });
					return;
				}
				const session = await this.deps.createSession(body.cwd, body.modelId ?? "");
				if (body.modelId) await session.setModel(body.modelId);
				send(201, { meta: session.meta });
				return;
			}

			send(404, { error: "not_found" });
		} catch (error) {
			send(500, { error: error instanceof Error ? error.message : String(error) });
		}
	}

	/** Constant-time compare so the token cannot be recovered by timing the response. */
	private authorize(candidate: string | null): boolean {
		if (!this.token || !candidate) return false;
		const a = Buffer.from(this.token);
		const b = Buffer.from(candidate);
		return a.length === b.length && timingSafeEqual(a, b);
	}
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
	const chunks: Buffer[] = [];
	let size = 0;
	for await (const chunk of req) {
		size += (chunk as Buffer).length;
		if (size > 8 * 1024 * 1024) throw new Error("Request body too large");
		chunks.push(chunk as Buffer);
	}
	if (chunks.length === 0) return {};
	return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function localAddresses(): string[] {
	const out: string[] = [];
	for (const entries of Object.values(networkInterfaces())) {
		for (const entry of entries ?? []) {
			if (entry.family === "IPv4" && !entry.internal) out.push(entry.address);
		}
	}
	return out;
}
