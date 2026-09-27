/**
 * What an MCP server's configuration looks like — the shapes only.
 *
 * Apart from `client.ts`, which starts servers, and `placeholders.ts`, which fills in what they
 * need, because both read these and one of them calls the other: with the shapes in the client, the
 * placeholder rules imported the client that imported them.
 */

/** 一个空位，以及包对它的说明（都来自包的 manifest，见 `plugins/loader.ts`）。 */
export interface McpNeed {
	name: string;
	/** 一句话：这是什么、拿来干什么。 */
	description?: string;
	/** 去哪里申请——界面上那个「去获取」的链接。 */
	url?: string;
	/** 是不是机密。默认按名字猜（见 `looksSecret`）；连接串之类不叫 KEY 的也可以声明成机密。 */
	secret?: boolean;
	/** 可以不填：不填就当空字符串，服务照样起。 */
	optional?: boolean;
}

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
	/**
	 * 启动时的环境变量。值里可以有 `${NAME}` 空位，连接时填——见 `mcp/placeholders.ts`。
	 * 人在界面上填的密钥也记在这里，落盘时进保险箱（`config/settings.ts`）。
	 */
	env?: Record<string, string>;
	/** 包对它那几个空位的说明：是什么、去哪申请、能不能不填。 */
	needs?: McpNeed[];
	enabled: boolean;
	origin?: McpOrigin;
}

export interface McpHttpServer {
	id: string;
	name: string;
	transport: "http" | "sse";
	url: string;
	/** 值里可以有 `${NAME}` 空位（典型的是 `Authorization: Bearer ${TOKEN}`），连接时填。 */
	headers?: Record<string, string>;
	/**
	 * 空位的取值处：人填的令牌记在这里。不是进程环境，也不随请求发出——只用来填 URL 和请求头里
	 * 的空位。和 stdio 共用一个字段名，是为了「填密钥」在两种服务上是同一件事。
	 */
	env?: Record<string, string>;
	needs?: McpNeed[];
	enabled: boolean;
	origin?: McpOrigin;
}

export type McpServerConfig = McpStdioServer | McpHttpServer;
