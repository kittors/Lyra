/**
 * 一台 MCP 服务要用、却不能写进它自己那份声明里的值：密钥、令牌、连接串。
 *
 * 一个包装好的 MCP 服务是一行命令，而大半有用的服务那一行命令里都缺一样东西——Brave 要
 * `BRAVE_API_KEY`，GitHub 要一个访问令牌，Postgres 要一个连接串。这些值属于装它的那个人，包里
 * 只能留一个空位。
 *
 * 空位的写法照 Claude Code 的 `.mcp.json`：`${NAME}`，出现在参数、`env` 的值、URL、请求头里都
 * 算。从前这里没有这一层：包装只能要么不收录这些服务，要么让人去手改 `~/.lyra/settings.json`
 * ——设置页上没有 env 的编辑框，一个要密钥的服务装上之后只会带着字面上的 `${BRAVE_API_KEY}`
 * 起来，报一句谁也看不懂的鉴权失败。
 *
 * 连接时填：先看这台服务自己记着的值（人在「插件管理」里填的，存在保险箱里，见
 * `config/settings.ts`），再看登录 shell 的环境（已经 `export` 过的人不用再填一遍），都没有就
 * 不启动，报出缺的是哪几个——一个带着空位起来的进程，失败的方式只会更难懂。
 */

import type { McpNeed, McpServerConfig } from "./types.ts";

export type { McpNeed } from "./types.ts";

const PLACEHOLDER = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

/** 一段文本里的空位名，按出现顺序、不重复。 */
export function placeholdersIn(text: string): string[] {
	const found: string[] = [];
	for (const match of text.matchAll(PLACEHOLDER)) {
		if (!found.includes(match[1]!)) found.push(match[1]!);
	}
	return found;
}

/** 整段就是一个空位（`"${BRAVE_API_KEY}"`）——这种值是模板，不是人填的内容。 */
export function isPlaceholder(value: string): boolean {
	return /^\$\{[A-Za-z_][A-Za-z0-9_]*\}$/.test(value.trim());
}

const SECRET_WORDS = new Set(["KEY", "TOKEN", "SECRET", "PASSWORD", "PASS", "PASSWD", "PAT", "AUTH", "CREDENTIAL", "CREDENTIALS", "COOKIE", "DSN"]);
const DATABASE_WORDS = new Set(["DATABASE", "DB", "POSTGRES", "POSTGRESQL", "PG", "MYSQL", "MONGO", "MONGODB", "REDIS", "CONNECTION"]);

/**
 * 名字像不像机密：密钥、令牌、密码、数据库连接串。
 *
 * 按 `_` 切成词再认，不按子串：子串会把 `PATH` 认成 `PAT`（访问令牌）、把 `API_BASE_URL` 认成连接串。
 * 拿不准的时候宁可当机密——存进保险箱不会坏事，明文写进 settings.json 会。
 */
export function looksSecret(name: string): boolean {
	const words = name.toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);
	// 词尾也算：`APIKEY`、`PGPASSWORD`、`BOTTOKEN` 是连写的同一个意思。
	if (words.some((word) => SECRET_WORDS.has(word) || /(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD)$/.test(word))) return true;
	// 带密码的连接串：`DATABASE_URL`、`MONGODB_URI`、`REDIS_URL`、`CONNECTION_STRING`。
	return words.some((word) => DATABASE_WORDS.has(word)) && words.some((word) => word === "URL" || word === "URI" || word === "STRING");
}

/** 一台服务声明里出现的全部空位：命令、参数、env 的值、URL、请求头。 */
export function placeholdersOf(server: McpServerConfig): string[] {
	const texts =
		server.transport === "stdio"
			? [server.command, ...(server.args ?? []), ...Object.values(server.env ?? {})]
			: [server.url, ...Object.values(server.headers ?? {})];
	const found: string[] = [];
	for (const text of texts) for (const name of placeholdersIn(text)) if (!found.includes(name)) found.push(name);
	return found;
}

/**
 * 这台服务要人填的值：声明里的空位，加上包在 manifest 里说明过的那些。
 *
 * 两边取并集，而不是只信 manifest：一个没写说明的包照样有空位，而空位才是「不填就起不来」的
 * 那个事实。说明只负责把它讲清楚。
 */
export function needsOf(server: McpServerConfig): McpNeed[] {
	const declared = new Map((server.needs ?? []).map((need) => [need.name, need]));
	const names = [...placeholdersOf(server)];
	for (const name of declared.keys()) if (!names.includes(name)) names.push(name);
	return names.map((name) => declared.get(name) ?? { name });
}

/**
 * 某个空位现在有没有值：人填过的，或者登录 shell 里已经有的。
 *
 * 人填过的值住在这台服务的 `env` 里（HTTP 服务也借用这个字段，它在那里不是进程环境，只是取值
 * 的地方）。还是模板本身的、空的，都不算填过。
 */
export function valueFor(server: McpServerConfig, name: string, environment: Record<string, string | undefined>): string | undefined {
	const own = server.env?.[name];
	if (own !== undefined && own !== "" && !isPlaceholder(own)) return own;
	const inherited = environment[name];
	return inherited !== undefined && inherited !== "" ? inherited : undefined;
}

/** 还缺哪几个——不能不填的、人没填、环境里也没有的。 */
export function missingFor(server: McpServerConfig, environment: Record<string, string | undefined>): string[] {
	return needsOf(server)
		.filter((need) => !need.optional && valueFor(server, need.name, environment) === undefined)
		.map((need) => need.name);
}

/** 缺值的服务不启动。错误里带着缺的名字，界面据此画「去填」而不是一段报错。 */
export class McpMissingValues extends Error {
	readonly missing: string[];

	constructor(server: string, missing: string[]) {
		super(`「${server}」还缺 ${missing.join("、")}，填上之后才能启动`);
		this.name = "McpMissingValues";
		this.missing = missing;
	}
}

/**
 * 把空位填上，得到一份可以直接拿去启动的声明。
 *
 * 缺值就抛 `McpMissingValues`，不拿半截的声明去碰运气。可选的空位填空字符串。
 */
export function resolveServer(server: McpServerConfig, environment: Record<string, string | undefined>): McpServerConfig {
	const missing = missingFor(server, environment);
	if (missing.length > 0) throw new McpMissingValues(server.name, missing);
	const fill = (text: string) => text.replace(PLACEHOLDER, (_whole, name: string) => valueFor(server, name, environment) ?? "");
	if (server.transport === "stdio") {
		const env: Record<string, string> = {};
		for (const [key, value] of Object.entries(server.env ?? {})) {
			/*
			 * An optional value nobody filled is left out, not passed as "". Unset is what the server's
			 * own default expects; an empty string is a value — measured: Redis's port, Obsidian's and
			 * AWS's region variables all crash the server when they arrive empty.
			 */
			if (isPlaceholder(value) && valueFor(server, value.trim().slice(2, -1), environment) === undefined) continue;
			env[key] = fill(value);
		}
		return { ...server, command: fill(server.command), args: (server.args ?? []).map(fill), env };
	}
	const headers: Record<string, string> = {};
	for (const [key, value] of Object.entries(server.headers ?? {})) headers[key] = fill(value);
	/*
	 * HTTP 服务的 `env` 只是取值的地方，不跟着请求走——把人填的密钥当请求头以外的任何东西发出去，
	 * 都是在往一个没要它的地方送密钥。
	 */
	const { env: _values, ...rest } = server;
	return { ...rest, url: fill(server.url), headers };
}
