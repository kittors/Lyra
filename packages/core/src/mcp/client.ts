/**
 * MCP integration.
 *
 * Each configured server is connected over stdio or streamable HTTP, its tool list is
 * fetched once, and every tool is exposed to the agent under a `mcp__<server>__<tool>`
 * name so two servers can both publish a `search` tool without colliding.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
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

export class McpManager {
	private connections = new Map<string, McpConnection>();
	private failures = new Map<string, string>();

	async connectAll(servers: McpServerConfig[]): Promise<McpServerStatus[]> {
		await this.closeAll();
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
		const client = new Client({ name: "lyra", version: "0.1.0" }, { capabilities: {} });
		const transport =
			server.transport === "stdio"
				? new StdioClientTransport({
						command: server.command,
						args: server.args ?? [],
						env: { ...(process.env as Record<string, string>), ...server.env },
					})
				: server.transport === "sse"
					? new SSEClientTransport(new URL(server.url), {
							requestInit: { headers: server.headers },
						})
					: new StreamableHTTPClientTransport(new URL(server.url), {
							requestInit: { headers: server.headers },
						});

		// A misconfigured stdio server can hang forever on startup; do not block the session on it.
		await withTimeout(client.connect(transport), CONNECT_TIMEOUT_MS, `Connecting to MCP server "${server.name}"`);

		const listed = await withTimeout(client.listTools(), CONNECT_TIMEOUT_MS, `Listing tools of "${server.name}"`);
		const tools = listed.tools.map((tool) => toAgentTool(server, client, tool));

		const connection: McpConnection = {
			config: server,
			client,
			tools,
			close: async () => {
				await client.close().catch(() => {});
			},
		};
		this.connections.set(server.id, connection);
		this.failures.delete(server.id);
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
				const listed = await withTimeout(connection.client.listResources(), CONNECT_TIMEOUT_MS, `Listing resources of "${connection.config.name}"`).catch(
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

		const result = await withTimeout(connection.client.readResource({ uri }), CONNECT_TIMEOUT_MS, `Reading ${uri}`);
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
		await Promise.all([...this.connections.values()].map((c) => c.close()));
		this.connections.clear();
		this.failures.clear();
	}
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
				if (decision === "reject") return { content: [{ type: "text", text: "The user rejected this MCP call." }], isError: true };
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
