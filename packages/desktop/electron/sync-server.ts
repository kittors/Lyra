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
import type { AgentEvent, AgentSession, SessionStorage, Settings, ThinkingLevel, UserContent } from "@lyra/core";
import type { SyncStatus } from "./ipc-types.ts";
import { allowedMethods, callRpc, type RpcDeps } from "./sync-rpc.ts";
import { RelayLink, relaySocketUrl } from "./sync-relay.ts";
import { serveApp } from "./sync-app.ts";

export interface SyncServerDeps {
	getSettings(): Settings;
	saveSettings(settings: Settings): Promise<void>;
	store: SessionStorage;
	resolveSession(projectId: string, sessionId: string): Promise<AgentSession | null>;
	createSession(cwd: string, modelId: string): Promise<AgentSession>;
	/**
	 * What the renderer asks about a project directory.
	 *
	 * Injected rather than imported: it reaches Electron's `BrowserWindow` through its own imports,
	 * and this server is otherwise plain Node — importing it here made the whole module unloadable
	 * outside Electron, which is where its tests run.
	 */
	workspaceInfo(path: string): Promise<unknown>;
	/** The session hub's own functions, handed in for the same reason; see `sync-rpc.ts`. */
	live(sessionId: string): AgentSession | undefined;
	activate(projectId: string, sessionId: string): Promise<AgentSession | null>;
	getOrCreate(cwd: string, modelId: string): Promise<AgentSession>;
	snapshot(session: AgentSession): Promise<unknown>;
	touch(sessionId: string): void;
}

export class SyncServer {
	private deps: SyncServerDeps;
	private http: Server | null = null;
	private wss: WebSocketServer | null = null;
	/** The outbound half, when a relay is configured. See `sync-relay.ts`. */
	private relay: RelayLink | null = null;
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
		/*
		 * Already serving what was asked for, so there is nothing to do.
		 *
		 * Turning the service on reaches here twice. The IPC handler writes `sync.enabled: true`
		 * and *that* is what starts the server — the settings hook in `main.ts` watches the flag —
		 * and then the handler starts it again itself. Without this, the second call tore down a
		 * working listener to rebind an identical one.
		 *
		 * A token of `null` means "keep whatever you have", so it does not count as a change.
		 */
		if (this.http && this.port === port && (!token || this.token === token)) return this.status();
		if (this.http) await this.stop();

		/*
		 * 契约和实现先对上，再开始监听。
		 *
		 * `allowedMethods` 自己的注释写着「在启动时检查，而不是只在测试里检查」，理由也写清楚了：
		 * `RPC` 里有、而契约没标 `remote` 的方法是一个洞——谁拿到配对令牌，就能调一个没有人声明过
		 * 的方法。而这个函数**从来没有被调用过**，那句「在启动时」一直只是一句话。
		 *
		 * 抛出去，是它自己给的答案：一台愿意提供未声明方法的桌面端，不该把服务起起来。
		 */
		allowedMethods();

		this.port = port;
		this.token = token ?? randomUUID().replace(/-/g, "");

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
				// Calls can arrive here as well as over HTTP — see `onSocketMessage`.
				ws.on("message", (data) => void this.onSocketMessage(ws, data));
				ws.send(JSON.stringify({ type: "hello", version: 1 }));
			});
		});

		await new Promise<void>((resolve, reject) => {
			server.once("error", reject);
			// Binding to 0.0.0.0 is what makes the phone able to reach it; the token is the gate.
			server.listen(port, "0.0.0.0", () => resolve());
		});

		this.http = server;
		this.linkRelay();

		/*
		 * The generated token is stored *after* the socket is bound, and the order is load-bearing.
		 *
		 * Saving settings runs the settings hook, and that hook starts the sync server when it sees
		 * `sync.enabled` — so persisting the token from in here re-enters this method. Do it before
		 * binding and the re-entrant call finds `this.http` still null, sails past the check above,
		 * binds the port itself, and then the original call reaches its own `listen` and fails with
		 * `EADDRINUSE` on a port that nothing outside this process holds. Which is what the toggle
		 * reported: "address already in use" about the service it had just started.
		 *
		 * Bound first, the re-entrant call sees a running server on the same port and returns.
		 */
		if (!token) {
			const settings = this.deps.getSettings();
			await this.deps.saveSettings({ ...settings, sync: { ...settings.sync, token: this.token } });
		}

		return this.status();
	}

	async stop(): Promise<void> {
		for (const client of this.clients) client.close();
		this.clients.clear();
		this.relay?.stop();
		this.relay = null;
		this.wss?.close();
		this.wss = null;
		await new Promise<void>((resolve) => {
			if (!this.http) return resolve();
			this.http.close(() => resolve());
		});
		this.http = null;
	}

	/**
	 * Open the outbound link, if one is configured, and treat it as another client.
	 *
	 * A relayed phone is added to `clients` exactly like a direct one, so `broadcast` reaches it
	 * without knowing the difference and calls arriving through it go to the same allowlist. The
	 * only asymmetry is who dialled.
	 */
	private linkRelay(): void {
		this.relay?.stop();
		this.relay = null;

		const configured = this.deps.getSettings().sync.relayUrl;
		const url = configured ? relaySocketUrl(configured) : null;
		if (!url || !this.token) return;

		this.relay = new RelayLink(url, this.token, {
			joined: (socket) => {
				this.clients.add(socket);
				socket.send(JSON.stringify({ type: "hello", version: 1 }));
			},
			left: (socket) => this.clients.delete(socket),
			message: (socket, data) => void this.onSocketMessage(socket, JSON.stringify(data)),
		});
		this.relay.start();
	}

	/** What the allowlist needs, in one place: it is asked for from two transports now. */
	private rpcDeps(): RpcDeps {
		return {
			store: () => this.deps.store,
			settings: () => this.deps.getSettings(),
			saveSettings: (next) => this.deps.saveSettings(next),
			workspaceInfo: (path) => this.deps.workspaceInfo(path),
			live: (id) => this.deps.live(id),
			activate: (projectId, id) => this.deps.activate(projectId, id),
			getOrCreate: (cwd, modelId) => this.deps.getOrCreate(cwd, modelId),
			snapshot: (session) => this.deps.snapshot(session),
			touch: (id) => this.deps.touch(id),
		};
	}

	/**
	 * A call that arrived over the socket rather than as a POST.
	 *
	 * The two are the same call — same allowlist, same handlers — and the socket exists because a
	 * relay can only carry frames. A relay joins two WebSockets and copies bytes; an HTTP request
	 * has nowhere to go through one. So everything the phone needs has to fit down this pipe, and
	 * `/api/rpc` stays for the direct case and for anything already speaking it.
	 *
	 * Errors answer rather than throw, for the same reason the HTTP route returns 200 on a refusal:
	 * this connection is the phone's only one, and an exception in a message handler takes it down.
	 */
	private async onSocketMessage(ws: WebSocket, raw: unknown): Promise<void> {
		let message: { type?: unknown; id?: unknown; method?: unknown; args?: unknown };
		try {
			message = JSON.parse(String(raw)) as typeof message;
		} catch {
			return;
		}
		if (message.type !== "rpc" || typeof message.id !== "string") return;

		const method = typeof message.method === "string" ? message.method : "";
		const args = Array.isArray(message.args) ? message.args : [];
		let result: Awaited<ReturnType<typeof callRpc>>;
		try {
			result = await callRpc(this.rpcDeps(), method, args);
		} catch (error) {
			result = { ok: false, error: error instanceof Error ? error.message : String(error) };
		}
		if (ws.readyState === 1) ws.send(JSON.stringify({ type: "rpc_result", id: message.id, ...result }));
	}

	broadcast(sessionId: string, event: AgentEvent): void {
		this.send(JSON.stringify({ type: "agent_event", sessionId, event }));
	}

	/**
	 * Tell the phone the settings changed.
	 *
	 * Without this the two halves agree only until someone changes something: the phone reads the
	 * settings once at boot and would go on showing the old model, the old theme and the old
	 * permission mode until it was restarted. The renderer already subscribes — this is the end that
	 * was missing.
	 *
	 * The whole object, not a diff. It is small, it is sent rarely, and a diff would need the two
	 * ends to agree on how to apply one.
	 */
	broadcastSettings(settings: Settings): void {
		this.send(JSON.stringify({ type: "settings_changed", settings }));
	}

	/** To every client still connected. A closing socket is not an error worth reporting. */
	private send(payload: string): void {
		if (this.clients.size === 0) return;
		for (const client of this.clients) {
			if (client.readyState === 1) client.send(payload);
		}
	}

	status(): SyncStatus {
		const addresses = localAddresses();
		const sync = this.deps.getSettings().sync;
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
			// Passed through rather than resolved here: which of the three a pairing code should
			// carry is the person's choice in front of the picker, not this server's.
			publicUrl: sync.publicUrl?.trim() || null,
			relayUrl: sync.relayUrl?.trim() || null,
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

		/*
		 * The interface itself, served before the token check.
		 *
		 * A browser loading `<script src>` and `<link href>` attaches no Authorization header, so
		 * gating these would leave the page unable to fetch the things it is made of. They are safe
		 * to serve openly because they carry none of your data: it is the same bundle anyone can
		 * build from this repository. Everything under `/api/` still needs the token, and that is
		 * where the sessions are.
		 */
		if (req.method === "GET" && (url.pathname === "/app" || url.pathname.startsWith("/app/"))) {
			/*
			 * The trailing slash is load-bearing.
			 *
			 * The page references its bundle as `./assets/…`, and a browser resolves that against
			 * the *directory* of the current URL. At `/app` that directory is `/`, so every asset
			 * is requested from `/assets/…` — which is not this route, falls through to the token
			 * check, and comes back 401. The page then renders as a blank screen with no error on
			 * it, because the HTML loaded perfectly and nothing inside it did.
			 */
			if (url.pathname === "/app") {
				res.writeHead(302, { location: "/app/" });
				res.end();
				return;
			}
			if (await serveApp(url.pathname, res)) return;
			send(404, { error: "not-found" });
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

			/*
			 * One endpoint for everything the phone's renderer asks of the desktop.
			 *
			 * It runs the desktop's own React app, which talks to `window.lyra` — 177 methods. A
			 * route per method would be 177 routes that drift; an allowlist in one file is both the
			 * dispatch and the security boundary. See `sync-rpc.ts` for what is on it and why.
			 */
			if (req.method === "POST" && url.pathname === "/api/rpc") {
				const body = (await readJson(req)) as { method?: unknown; args?: unknown };
				const method = typeof body.method === "string" ? body.method : "";
				const args = Array.isArray(body.args) ? body.args : [];
				const result = await callRpc(this.rpcDeps(), method, args);
				// 200 either way: a refused method is an answer, not a transport failure, and the
				// phone keeps one long-lived connection that a 4xx would make it re-examine.
				send(200, result);
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

				/*
				 * The conversation's reasoning level, from the phone.
				 *
				 * Unlike the model this is never refused: no stored message carries a handle that
				 * a different level invalidates. `null` hands the conversation back to the app
				 * default rather than pinning it to today's value.
				 */
				if (req.method === "POST" && action === "thinking") {
					const body = (await readJson(req)) as { thinking?: string | null };
					const level = body.thinking == null ? null : (String(body.thinking) as ThinkingLevel);
					await session.setThinking(level);
					send(200, { ok: true, meta: session.meta });
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

/**
 * Interface names that belong to something other than the network the phone is on.
 *
 * A developer machine is full of these — Docker's bridge, VirtualBox's host-only adapter, WSL's
 * vEthernet, a VPN's tun — and every one of them has a perfectly valid private IPv4 that the
 * phone cannot reach. Listed first in the picker, they are what someone scans, and the failure
 * is silent and confusing: the QR code is fine, the token is fine, the address is simply on a
 * network that exists only inside this computer.
 */
const VIRTUAL_INTERFACE = /^(docker|br-|veth|virbr|vmnet|vboxnet|utun|tun|tap|ppp|zt|wg|Loopback|vEthernet|Hyper-V|VMware|VirtualBox|Npcap|Bluetooth|Mihomo|Clash|sing-box)/i;
/** RFC 2544 benchmarking space, commonly claimed by system proxy TUN adapters such as Mihomo. */
const BENCHMARK_NETWORK = /^198\.(?:18|19)\./;

/**
 * Ranked so the first one is the address most likely to work.
 *
 * `localAddresses()[0]` is what the pairing URL uses and what the picker preselects, so the order
 * is the whole difference between "scan it and you are connected" and "scan it, wait, and try the
 * next one". Ordinary home and office networks (192.168.x, 10.x) come first, then the rest of the
 * private space, and anything on a virtual adapter goes last rather than being dropped — a machine
 * whose only route to the phone genuinely is a bridge should still be able to pair, just not by
 * default.
 */
function rank(address: string, name: string): number {
	if (VIRTUAL_INTERFACE.test(name) || BENCHMARK_NETWORK.test(address)) return 3;
	if (address.startsWith("192.168.")) return 0;
	if (address.startsWith("10.")) return 1;
	return 2;
}

/** Just the fields the ranking reads, so a test can describe a machine without inventing one. */
export interface InterfaceEntry {
	address: string;
	family: string;
	internal: boolean;
}

/**
 * The ranking, over a set of interfaces given to it.
 *
 * Takes the interfaces rather than reading them so the interesting half — which of a laptop's six
 * addresses leads — can be tested against a described machine instead of whichever one the tests
 * happen to run on.
 */
export function rankAddresses(interfaces: Record<string, InterfaceEntry[] | undefined>): string[] {
	const found: { address: string; score: number }[] = [];
	for (const [name, entries] of Object.entries(interfaces)) {
		for (const entry of entries ?? []) {
			// `169.254.x` is what an interface gives itself when DHCP never answered: it is a
			// symptom of no network, not an address anything can be reached on.
			if (entry.family !== "IPv4" || entry.internal || entry.address.startsWith("169.254.")) continue;
			found.push({ address: entry.address, score: rank(entry.address, name) });
		}
	}
	found.sort((a, b) => a.score - b.score);
	// Distinct: one adapter can hold the same address twice across aliases.
	return [...new Set(found.map((entry) => entry.address))];
}

export function localAddresses(): string[] {
	return rankAddresses(networkInterfaces());
}
