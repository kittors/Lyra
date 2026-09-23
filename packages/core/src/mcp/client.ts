/**
 * MCP integration.
 *
 * Each configured server is connected over stdio or streamable HTTP, its tool list is
 * fetched once, and every tool is exposed to the agent under a `mcp__<server>__<tool>`
 * name so two servers can both publish a `search` tool without colliding.
 */

import { execFile } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { DEFAULT_INHERITED_ENV_VARS, StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { commandEnv } from "../sandbox/login-path.ts";
import type { JsonSchema, Tool, ToolResult, UserContent } from "../types.ts";

/**
 * Where a server's configuration came from.
 *
 * Set for one installed from a registry, absent for one somebody typed in. The distinction is
 * what lets the settings page offer 卸载 for the first and 删除 for the second, and clean up the
 * bundle's directory when the last server it brought is gone.
 *
 * It replaced a `pluginId`, which said something that is no longer true: a plugin is a bundle of
 * *skills*. A directory whose entire content is a `.mcp.json` was never a plugin — it is an MCP
 * server that arrived in a git repository, and calling it a plugin is what put the same Context7
 * in two places at once, with two switches that could not see each other.
 */
export interface McpOrigin {
	/** Directory name under `~/.lyra/mcp`; also the entry's id in the registry it came from. */
	bundle: string;
	/** Which registry listed it, for telling two entries of the same name apart. */
	registry?: string;
	version?: string;
}

export interface McpStdioServer {
	id: string;
	name: string;
	transport: "stdio";
	command: string;
	args?: string[];
	env?: Record<string, string>;
	enabled: boolean;
	origin?: McpOrigin;
}

export interface McpHttpServer {
	id: string;
	name: string;
	transport: "http" | "sse";
	url: string;
	headers?: Record<string, string>;
	enabled: boolean;
	origin?: McpOrigin;
}

export type McpServerConfig = McpStdioServer | McpHttpServer;

export interface McpServerStatus {
	id: string;
	name: string;
	origin?: McpOrigin;
	state: "connected" | "failed" | "disabled";
	toolCount: number;
	error?: string;
	tools: { name: string; description: string }[];
}

export interface McpConnection {
	config: McpServerConfig;
	client: Client;
	tools: Tool[];
	close(): Promise<void>;
}

const CONNECT_TIMEOUT_MS = 30_000;

export interface McpManagerOptions {
	/** How long connecting, and then listing tools, may each take. Tests shorten it. */
	timeoutMs?: number;
}

export class McpManager {
	private connections = new Map<string, McpConnection>();
	private failures = new Map<string, string>();
	private readonly timeoutMs: number;
	/**
	 * Bumped by every `closeAll`, so a connect that was already under way when it ran can tell that
	 * its answer is no longer wanted — and stop the server instead of registering it.
	 */
	private epoch = 0;
	private disposed = false;
	/** The replacement in progress; the next one starts after it. See `connectAll`. */
	private replacing: Promise<unknown> = Promise.resolve();

	constructor(options: McpManagerOptions = {}) {
		this.timeoutMs = options.timeoutMs ?? CONNECT_TIMEOUT_MS;
	}

	/**
	 * Replace every connection with ones to `servers`.
	 *
	 * One replacement at a time. Three things reload a session's capabilities — the file watcher,
	 * the end of a turn releasing a change it held back, and the desktop app saving an agent
	 * definition — and nothing kept them apart. Two replacements running together each closed what
	 * was there when they started and then both connected; the second to finish overwrote the
	 * first's connection in the map without closing it, and that server ran until the app quit.
	 */
	connectAll(servers: McpServerConfig[]): Promise<McpServerStatus[]> {
		const run = this.replacing.then(() => this.replaceAll(servers));
		this.replacing = run.catch(() => {});
		return run;
	}

	private async replaceAll(servers: McpServerConfig[]): Promise<McpServerStatus[]> {
		await this.closeAll();
		// A reload that was queued behind the one running when the session was disposed.
		if (this.disposed) return [];
		const results = await Promise.all(
			servers.map(async (server): Promise<McpServerStatus> => {
				if (!server.enabled) {
					return { id: server.id, name: server.name, origin: server.origin, state: "disabled", toolCount: 0, tools: [] };
				}
				try {
					const connection = await this.connect(server);
					return {
						id: server.id,
						name: server.name,
						origin: server.origin,
						state: "connected",
						toolCount: connection.tools.length,
						tools: connection.tools.map((t) => ({ name: t.name, description: t.description })),
					};
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					this.failures.set(server.id, message);
					return { id: server.id, name: server.name, origin: server.origin, state: "failed", toolCount: 0, error: message, tools: [] };
				}
			}),
		);
		return results;
	}

	async connect(server: McpServerConfig): Promise<McpConnection> {
		if (this.disposed) throw new Error(`MCP server "${server.name}" was not started: its session has been closed`);
		const epoch = this.epoch;
		const client = new Client({ name: "lyra", version: "0.1.0" }, { capabilities: {} });
		const transport =
			server.transport === "stdio"
				? new TreeKillingStdioTransport({
						command: server.command,
						args: server.args ?? [],
						env: stdioEnv(server.env),
					})
				: server.transport === "sse"
					? new SSEClientTransport(new URL(server.url), {
							requestInit: { headers: server.headers },
						})
					: new StreamableHTTPClientTransport(new URL(server.url), {
							requestInit: { headers: server.headers },
						});

		/*
		 * Every way out of here that does not register the connection closes it.
		 *
		 * A server that never answers must not hold the session up, so there is a deadline — but
		 * giving up on a promise does not stop the process behind it. The SDK's own request timeout
		 * was 60s against our 30s, and a server answering in between finished connecting a client
		 * nobody held; one that connected and then failed `tools/list` was dropped the same way.
		 * Both kept running until the app quit.
		 *
		 * The SDK is handed the same timeout so it gives up on its request when we do. Ours stays as
		 * well: it also covers what the SDK does not time — an SSE stream that opens and never sends
		 * its endpoint, the `initialized` notification over HTTP.
		 */
		let listed: Awaited<ReturnType<Client["listTools"]>>;
		try {
			await withTimeout(client.connect(transport, { timeout: this.timeoutMs }), this.timeoutMs, `Connecting to MCP server "${server.name}"`);
			listed = await withTimeout(client.listTools(undefined, { timeout: this.timeoutMs }), this.timeoutMs, `Listing tools of "${server.name}"`);
		} catch (error) {
			await client.close().catch(() => {});
			throw error;
		}
		// Closed while this one was starting: nobody is going to read this connection, or close it.
		if (epoch !== this.epoch) {
			await client.close().catch(() => {});
			throw new Error(`MCP server "${server.name}" was disconnected while it was still starting`);
		}

		const tools = listed.tools.map((tool) => toAgentTool(server, client, tool));
		const connection: McpConnection = {
			config: server,
			client,
			tools,
			close: async () => {
				await client.close().catch(() => {});
			},
		};
		const previous = this.connections.get(server.id);
		this.connections.set(server.id, connection);
		this.failures.delete(server.id);
		// A map entry is the only handle on a connection; overwriting it without closing is a leak.
		if (previous) await previous.close();
		return connection;
	}

	/** Every tool from every connected server, ready to hand to the agent loop. */
	allTools(): Tool[] {
		return [...this.connections.values()].flatMap((c) => c.tools);
	}

	/**
	 * 每台服务器声明的资源，给 `mcp://`。
	 *
	 * MCP 有 tools 和 resources 两半，而我们一直只接了前一半——一台提供「当前值班表」
	 * 「昨天的构建日志」的服务器，它的工具能调，它的资源读不了。
	 *
	 * 一台服务器不支持 resources 是**正常**的（协议里它是可选的），所以拿不到就当没有：
	 * 一台服务器把整个列表变成错误，会让另外三台的资源也跟着不可见。
	 */
	async allResources(): Promise<{ server: string; uri: string; name?: string; description?: string }[]> {
		const perServer = await Promise.all(
			[...this.connections.values()].map(async (connection) => {
				const listed = await withTimeout(connection.client.listResources(), this.timeoutMs, `Listing resources of "${connection.config.name}"`).catch(
					() => null,
				);
				return (listed?.resources ?? []).map((resource) => ({
					server: connection.config.id,
					uri: String(resource.uri),
					name: typeof resource.name === "string" ? resource.name : undefined,
					description: typeof resource.description === "string" ? resource.description : undefined,
				}));
			}),
		);
		return perServer.flat();
	}

	/**
	 * 读一个资源。
	 *
	 * 一个资源可以有多段内容（协议允许），拼起来给模型——挑第一段会静默丢掉后面的，
	 * 而「只读到了一部分」是这里最难被发现的一种错。二进制段跳过：它进不了文本上下文，
	 * 而把 base64 塞进去只会烧掉一屏 token。
	 */
	async readResource(serverId: string, uri: string): Promise<string> {
		const connection = this.connections.get(serverId);
		if (!connection) throw new Error(`没有连着叫 "${serverId}" 的 MCP 服务器。`);

		const result = await withTimeout(connection.client.readResource({ uri }), this.timeoutMs, `Reading ${uri}`);
		const parts = (result.contents ?? [])
			.map((part) => (typeof (part as { text?: unknown }).text === "string" ? ((part as { text: string }).text) : null))
			.filter((text): text is string => text !== null);

		if (parts.length === 0) throw new Error(`${uri} 没有可读的文本内容（可能是二进制资源）。`);
		return parts.join("\n\n");
	}

	statuses(): McpServerStatus[] {
		const out: McpServerStatus[] = [];
		for (const connection of this.connections.values()) {
			out.push({
				id: connection.config.id,
				name: connection.config.name,
				origin: connection.config.origin,
				state: "connected",
				toolCount: connection.tools.length,
				tools: connection.tools.map((t) => ({ name: t.name, description: t.description })),
			});
		}
		for (const [id, error] of this.failures) {
			out.push({ id, name: id, state: "failed", toolCount: 0, error, tools: [] });
		}
		return out;
	}

	async closeAll(): Promise<void> {
		this.epoch += 1;
		const open = [...this.connections.values()];
		this.connections.clear();
		this.failures.clear();
		await Promise.all(open.map((c) => c.close()));
	}

	/**
	 * Close everything, for good.
	 *
	 * Separate from `closeAll`, which a reload also uses: a reload that was already queued when the
	 * session went away would otherwise start every server again, for a session nobody will close.
	 */
	async dispose(): Promise<void> {
		this.disposed = true;
		await this.closeAll();
	}
}

/**
 * The SDK's stdio transport, with a close that reaches the server on Windows.
 *
 * There the SDK starts anything that is not an `.exe` — `npx`, a `.cmd` shim — through `cmd.exe /d
 * /s /c` (cross-spawn), and its close ends stdin, waits, then `kill()`s: which terminates `cmd.exe`
 * and nothing under it. The real server was orphaned, ran for the rest of the session and kept its
 * files open, so updating or uninstalling the bundle it came from failed halfway with EPERM.
 *
 * The tree has to be taken while `cmd.exe` is still there to name it — once it is gone `/T` has no
 * root to walk from — so this runs before the SDK's close rather than after. That skips the SDK's
 * grace period on Windows: a server stopped this way does not see stdin close first. An orphan
 * holding the plugin's files open is the worse of the two.
 */
class TreeKillingStdioTransport extends StdioClientTransport {
	override async close(): Promise<void> {
		const pid = this.pid;
		// `pid` is null once the process has exited, so a PID the OS has since reused is never named.
		if (process.platform === "win32" && pid !== null) await killTree(pid);
		await super.close();
	}
}

function killTree(pid: number): Promise<void> {
	return new Promise((resolve) => {
		// The Electron main process has no console; without `windowsHide` every stop flashes one.
		execFile("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true }, () => resolve());
	});
}

/**
 * The environment a stdio server is started with: the one the agent's own commands get, then the
 * server's configured `env` on top.
 *
 * It was `process.env`. From an icon that is launchd's four system directories and nothing else,
 * and most servers are configured as `npx -y @scope/server` — so `npx` was not found wherever nvm,
 * fnm or volta put it, or it was found and the download timed out without the `https_proxy` the
 * user's shell exports. `commandEnv` is what repairs both for `bash` and hooks; see `login-path.ts`.
 *
 * On Windows the SDK lays its own copy of a few variables underneath ours, spelled in capitals
 * (`DEFAULT_INHERITED_ENV_VARS`), while `{ ...process.env }` keeps the system's spelling — `Path`,
 * `SystemRoot`. Left alone, the child gets both `PATH` and `Path`, and which one it reads is decided
 * by Node sorting the keys, not by us: a `Path` the user set in the server's `env` loses to the
 * SDK's inherited `PATH`. So names are folded case-insensitively, the later write wins, and those
 * few are written in the SDK's spelling so they replace its copy instead of sitting beside it.
 */
function stdioEnv(overrides: Record<string, string> | undefined): Record<string, string> {
	const env: Record<string, string> = {};
	const windows = process.platform === "win32";
	const spelled = new Map<string, string>();
	const put = (key: string, value: string | undefined) => {
		if (value === undefined) return;
		if (!windows) {
			env[key] = value;
			return;
		}
		const folded = key.toUpperCase();
		const previous = spelled.get(folded);
		if (previous !== undefined) delete env[previous];
		const name = DEFAULT_INHERITED_ENV_VARS.includes(folded) ? folded : key;
		spelled.set(folded, name);
		env[name] = value;
	};
	for (const [key, value] of Object.entries(commandEnv(process.env))) put(key, value);
	for (const [key, value] of Object.entries(overrides ?? {})) put(key, value);
	return env;
}

interface RawMcpTool {
	name: string;
	description?: string;
	inputSchema?: unknown;
}

function toAgentTool(server: McpServerConfig, client: Client, raw: RawMcpTool): Tool {
	const qualifiedName = `mcp__${sanitize(server.id)}__${sanitize(raw.name)}`;

	const description = raw.description ?? `${raw.name} (from MCP server ${server.name})`;

	return {
		name: qualifiedName,
		description,
		// The prompt's tool list gets one line each; MCP descriptions are often paragraphs.
		snippet: `${firstSentence(description)} (via ${server.name})`,
		parameters: normalizeSchema(raw.inputSchema),
		mutating: true,
		summarize: () => `${server.name}: ${raw.name}`,

		async execute(args, ctx): Promise<ToolResult> {
			if (ctx.requestApproval) {
				const decision = await ctx.requestApproval({
					kind: "mcp",
					title: `${server.name} → ${raw.name}`,
					detail: JSON.stringify(args, null, 2).slice(0, 2000),
					subject: qualifiedName,
				});
				if (decision !== "once" && decision !== "always") return { content: [{ type: "text", text: "The user rejected this MCP call." }], isError: true };
			}

			try {
				const response = await client.callTool(
					{ name: raw.name, arguments: (args ?? {}) as Record<string, unknown> },
					undefined,
					{ signal: ctx.signal },
				);
				const content = normalizeContent(response.content);
				return {
					content: content.length > 0 ? content : [{ type: "text", text: "(the server returned no content)" }],
					details: { kind: "mcp", server: server.name, tool: raw.name, structured: response.structuredContent },
					isError: response.isError === true,
				};
			} catch (error) {
				return {
					content: [{ type: "text", text: `MCP call failed: ${error instanceof Error ? error.message : String(error)}` }],
					isError: true,
				};
			}
		},
	};
}

function normalizeContent(raw: unknown): UserContent[] {
	if (!Array.isArray(raw)) return [];
	const out: UserContent[] = [];
	for (const block of raw as Record<string, unknown>[]) {
		if (block?.type === "text" && typeof block.text === "string") {
			out.push({ type: "text", text: block.text });
		} else if (block?.type === "image" && typeof block.data === "string") {
			out.push({ type: "image", data: block.data, mimeType: String(block.mimeType ?? "image/png") });
		} else if (block?.type === "resource") {
			// Embedded resources arrive as { resource: { text | blob, uri } }.
			const resource = block.resource as Record<string, unknown> | undefined;
			if (typeof resource?.text === "string") out.push({ type: "text", text: resource.text });
			else if (resource?.uri) out.push({ type: "text", text: `[resource ${String(resource.uri)}]` });
		}
	}
	return out;
}

/** MCP servers may omit the schema or send a non-object; the providers require an object schema. */
function normalizeSchema(schema: unknown): JsonSchema {
	if (schema && typeof schema === "object" && (schema as JsonSchema).type === "object") return schema as JsonSchema;
	return { type: "object", properties: {}, additionalProperties: true };
}

function sanitize(value: string): string {
	return value.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function firstSentence(text: string): string {
	const line = text.split("\n")[0].trim();
	const stop = line.search(/[.。](\s|$)/);
	const sentence = stop === -1 ? line : line.slice(0, stop);
	return sentence.length > 110 ? `${sentence.slice(0, 110)}…` : sentence;
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			promise,
			new Promise<never>((_, reject) => {
				timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
			}),
		]);
	} finally {
		if (timer) clearTimeout(timer);
	}
}
