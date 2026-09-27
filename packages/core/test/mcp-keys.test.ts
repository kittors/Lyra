/**
 * MCP 服务要的钥匙：包里留空位，人来填，填的值进保险箱，缺了就不启动、说清缺什么。
 *
 * 从前这一整条链不存在。一个要 `BRAVE_API_KEY` 的服务装上之后带着字面上的 `${BRAVE_API_KEY}`
 * 起来，报一句谁也看不懂的鉴权失败；设置页上也没有地方填。`bearer_token_env_var` 倒是读了，但读的是
 * 安装那一刻的环境，把令牌明文写进 settings.json，之后换了令牌也不会再读。
 *
 * 这里一条条问真的代码：空位认得出来、说明分得到对的服务上、缺值的服务拿到的状态是「缺什么」而
 * 不是一段报错、填好的值落盘时进了保险箱而文件里只剩空位、读回来又是原值。
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, test } from "node:test";

import { DEFAULT_SETTINGS, loadSettings, migrateSecrets, saveSettings, settingsPath, type Settings } from "../src/config/settings.ts";
import { resetVault } from "../src/config/vault.ts";
import { McpManager, type McpServerConfig } from "../src/mcp/client.ts";
import {
	isPlaceholder,
	looksSecret,
	McpMissingValues,
	missingFor,
	needsOf,
	placeholdersOf,
	resolveServer,
} from "../src/mcp/placeholders.ts";
import { loadPlugins } from "../src/plugins/loader.ts";

const made: string[] = [];
const previous = { home: process.env.LYRA_HOME, userProfile: process.env.USERPROFILE };

beforeEach(async () => {
	const home = await mkdtemp(join(tmpdir(), "lyra-mcp-keys-"));
	made.push(home);
	process.env.LYRA_HOME = home;
	process.env.USERPROFILE = home;
	resetVault();
});

after(async () => {
	if (previous.home === undefined) delete process.env.LYRA_HOME;
	else process.env.LYRA_HOME = previous.home;
	if (previous.userProfile === undefined) delete process.env.USERPROFILE;
	else process.env.USERPROFILE = previous.userProfile;
	await Promise.all(made.map((dir) => rm(dir, { recursive: true, force: true })));
});

/** 一个名字保证不会在谁的登录 shell 里出现的空位。 */
const KEY = "LYRA_TEST_ONLY_BRAVE_KEY_7Q";

function brave(extra: Partial<McpServerConfig> = {}): McpServerConfig {
	return {
		id: "brave__brave",
		name: "brave",
		transport: "stdio",
		command: "npx",
		args: ["-y", "@brave/brave-search-mcp-server"],
		env: { [KEY]: `\${${KEY}}` },
		enabled: true,
		...extra,
	} as McpServerConfig;
}

// ---------------------------------------------------------------------------
// 空位本身
// ---------------------------------------------------------------------------

test("空位在命令、参数、env 的值、URL、请求头里都认得出来，按出现顺序、不重复", () => {
	const stdio: McpServerConfig = {
		id: "a",
		name: "a",
		transport: "stdio",
		command: "${BIN}",
		args: ["--token", "${TOKEN}", "--again", "${TOKEN}"],
		env: { DB: "postgres://${USER_NAME}:${PASSWORD}@host/db" },
		enabled: true,
	};
	assert.deepEqual(placeholdersOf(stdio), ["BIN", "TOKEN", "USER_NAME", "PASSWORD"]);
	const http: McpServerConfig = {
		id: "b",
		name: "b",
		transport: "http",
		url: "https://mcp.example.com/${WORKSPACE}/mcp",
		headers: { Authorization: "Bearer ${API_TOKEN}" },
		enabled: true,
	};
	assert.deepEqual(placeholdersOf(http), ["WORKSPACE", "API_TOKEN"]);
	assert.equal(isPlaceholder("${A_B}"), true);
	assert.equal(isPlaceholder("Bearer ${A_B}"), false, "带着别的字的不是纯空位——那是模板");
});

test("像不像机密按词认：PATH 不是访问令牌，API_BASE_URL 不是连接串", () => {
	for (const name of ["BRAVE_API_KEY", "GITHUB_PERSONAL_ACCESS_TOKEN", "NOTION_TOKEN", "OPENAI_APIKEY", "DATABASE_URL", "MONGODB_URI", "SLACK_BOT_TOKEN", "PGPASSWORD", "GITLAB_PAT", "SENTRY_DSN"]) {
		assert.equal(looksSecret(name), true, name);
	}
	for (const name of ["PATH", "API_BASE_URL", "ALLOWED_DIRECTORIES", "LOG_LEVEL", "HOME", "TIMEZONE"]) {
		assert.equal(looksSecret(name), false, name);
	}
});

test("要填的值是空位和包里说明的并集；说明只负责讲清楚", () => {
	const server = brave({ needs: [{ name: KEY, description: "Brave 的 API key", url: "https://brave.com/search/api/" }, { name: "EXTRA", optional: true }] });
	assert.deepEqual(needsOf(server), [
		{ name: KEY, description: "Brave 的 API key", url: "https://brave.com/search/api/" },
		{ name: "EXTRA", optional: true },
	]);
	assert.deepEqual(needsOf(brave()), [{ name: KEY }], "没写说明的包照样有空位");
});

test("取值先看服务自己记着的，再看环境；空的、还是空位本身的都不算", () => {
	assert.deepEqual(missingFor(brave(), {}), [KEY]);
	assert.deepEqual(missingFor(brave(), { [KEY]: "" }), [KEY], "环境里是空字符串等于没有");
	assert.deepEqual(missingFor(brave(), { [KEY]: "from-shell" }), [], "登录 shell 里 export 过的不用再填");
	assert.deepEqual(missingFor(brave({ env: { [KEY]: "typed" } }), {}), []);
	assert.deepEqual(missingFor(brave({ needs: [{ name: "OPTIONAL_ONE", optional: true }] }), { [KEY]: "x" }), [], "可以不填的不算缺");

	const resolved = resolveServer(brave({ env: { [KEY]: "typed" }, args: ["--key=${" + KEY + "}"] }), { [KEY]: "from-shell" });
	assert.equal(resolved.transport, "stdio");
	if (resolved.transport !== "stdio") return;
	assert.deepEqual(resolved.args, ["--key=typed"], "人填的比环境里的优先");
	assert.equal(resolved.env?.[KEY], "typed");
});

test("缺值的直接抛 McpMissingValues，带着缺的名字；HTTP 的取值处不跟着请求走", () => {
	assert.throws(
		() => resolveServer(brave(), {}),
		(error: unknown) => error instanceof McpMissingValues && error.missing.join() === KEY && error.message.includes(KEY),
	);
	const http = resolveServer(
		{
			id: "gh",
			name: "github",
			transport: "http",
			url: "https://api.githubcopilot.com/mcp/",
			headers: { Authorization: "Bearer ${GH_TOKEN_FOR_TEST}" },
			env: { GH_TOKEN_FOR_TEST: "ghp_typed" },
			enabled: true,
		},
		{},
	);
	if (http.transport !== "http") return assert.fail("还是 HTTP 服务");
	assert.equal(http.headers?.Authorization, "Bearer ghp_typed");
	assert.equal("env" in http, false, "填好的值只进请求头，不作为别的什么跟着连接走");
});

// ---------------------------------------------------------------------------
// 连接
// ---------------------------------------------------------------------------

test("缺钥匙的服务不启动，状态里写着缺哪几个——不是一段启动失败的报错", async () => {
	const manager = new McpManager({ timeoutMs: 2000 });
	try {
		// 命令故意是一个不存在的程序：要是真去启动了，报的就会是「找不到命令」而不是缺钥匙。
		const [status] = await manager.connectAll([brave({ command: "definitely-not-a-real-binary-lyra" })]);
		assert.equal(status?.state, "failed");
		assert.deepEqual(status?.missing, [KEY]);
		assert.match(status?.error ?? "", new RegExp(KEY));
	} finally {
		await manager.dispose();
	}
});

// ---------------------------------------------------------------------------
// 包里怎么写
// ---------------------------------------------------------------------------

async function bundleRoot(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "lyra-mcp-bundles-"));
	made.push(root);
	return root;
}

async function writeBundle(root: string, id: string, files: Record<string, unknown>): Promise<void> {
	for (const [path, content] of Object.entries(files)) {
		const full = join(root, id, path);
		await mkdir(join(full, ".."), { recursive: true });
		await writeFile(full, typeof content === "string" ? content : JSON.stringify(content));
	}
}

test("manifest 里的 env 说明分给用到它的那台服务；只有一台时全给它", async () => {
	const root = await bundleRoot();
	await writeBundle(root, "search", {
		".lyra-plugin/plugin.json": {
			name: "search",
			mcpServers: ".mcp.json",
			env: [
				{ name: "BRAVE_KEY", description: "Brave 的 key", url: "https://brave.com/search/api/", secret: true },
				{ name: "TAVILY_KEY", description: "Tavily 的 key" },
				{ name: "not a name" },
			],
		},
		".mcp.json": {
			mcpServers: {
				brave: { command: "npx", args: ["-y", "brave"], env: { BRAVE_API_KEY: "${BRAVE_KEY}" } },
				tavily: { command: "npx", args: ["-y", "tavily"], env: { TAVILY_API_KEY: "${TAVILY_KEY}" } },
			},
		},
	});
	await writeBundle(root, "solo", {
		".lyra-plugin/plugin.json": { name: "solo", mcpServers: ".mcp.json", env: [{ name: "SOLO_TOKEN", description: "进程自己从环境里读" }] },
		".mcp.json": { mcpServers: { solo: { command: "solo-mcp" } } },
	});
	const { mcpBundles } = await loadPlugins([{ dir: root, source: "user" }]);
	const servers = Object.fromEntries(mcpBundles.flatMap((bundle) => bundle.servers).map((server) => [server.name, server]));
	assert.deepEqual(servers.brave?.needs?.map((need) => need.name), ["BRAVE_KEY"]);
	assert.equal(servers.brave?.needs?.[0]?.url, "https://brave.com/search/api/");
	assert.deepEqual(servers.tavily?.needs?.map((need) => need.name), ["TAVILY_KEY"]);
	assert.deepEqual(servers.solo?.needs?.map((need) => need.name), ["SOLO_TOKEN"], "声明里没提、进程自己读环境的，也能说明");
	assert.equal(servers.brave?.transport === "stdio" && servers.brave.env?.BRAVE_API_KEY, "${BRAVE_KEY}", "空位原样留着，连接时才填");
});

test("bearer_token_env_var 变成请求头里的空位，不再在安装那一刻把令牌读出来写死", async () => {
	const root = await bundleRoot();
	process.env.LYRA_TEST_BEARER = "should-not-be-baked";
	try {
		await writeBundle(root, "remote", {
			".mcp.json": { mcpServers: { remote: { type: "http", url: "https://mcp.example.com/mcp", bearer_token_env_var: "LYRA_TEST_BEARER" } } },
		});
		const { mcpBundles } = await loadPlugins([{ dir: root, source: "user" }]);
		const server = mcpBundles[0]?.servers[0];
		if (server?.transport !== "http") return assert.fail("应当读成 HTTP 服务");
		assert.deepEqual(server.headers, { Authorization: "Bearer ${LYRA_TEST_BEARER}" });
	} finally {
		delete process.env.LYRA_TEST_BEARER;
	}
});

test("Claude Code 的两种写法都认：plugin.json 里内联的，和不带 mcpServers 外壳的 .mcp.json", async () => {
	const root = await bundleRoot();
	await writeBundle(root, "inline", {
		".claude-plugin/marketplace.json": "{}",
		"plugin.json": { name: "inline", mcpServers: { db: { command: "db-mcp", args: ["--dsn", "${DB_DSN}"] } } },
	});
	await writeBundle(root, "flat", { ".mcp.json": { sentry: { type: "http", url: "https://mcp.sentry.dev/mcp" } } });
	const { mcpBundles, diagnostics } = await loadPlugins([{ dir: root, source: "user" }]);
	const names = mcpBundles.flatMap((bundle) => bundle.servers.map((server) => server.name)).sort();
	assert.deepEqual(names, ["db", "sentry"], JSON.stringify(diagnostics));
});

test("一个 manifest 写坏了只坏它自己：别的包照样出来，坏字段当没写", async () => {
	const root = await bundleRoot();
	const skill = "---\nname: review\ndescription: 审一遍改动，找出真正会出问题的地方。\n---\n\n做点什么。\n";
	await writeBundle(root, "good", { "plugin.json": { name: "good" }, "skills/review/SKILL.md": skill });
	// `skills` 写成数组、logo 写成对象、keywords 混着数字——从前这些会在扫描里抛出来，整页一个都不剩。
	await writeBundle(root, "weird", {
		"plugin.json": { name: "weird", skills: ["a", "b"], keywords: ["x", 1], interface: { logo: { src: "x.png" }, displayName: "Weird" }, mcpServers: 42 },
		"skills/review/SKILL.md": skill,
	});
	await writeBundle(root, "broken-mcp", { "plugin.json": { name: "broken-mcp", mcpServers: ".mcp.json" }, ".mcp.json": { mcpServers: { a: null, b: "npx x", c: { command: "ok-mcp" } } } });
	const { plugins, mcpBundles } = await loadPlugins([{ dir: root, source: "user" }]);
	assert.deepEqual(plugins.map((plugin) => plugin.id).sort(), ["good", "weird"]);
	const weird = plugins.find((plugin) => plugin.id === "weird");
	assert.equal(weird?.skills.length, 1, "写错的 skills 当没写，回落到 ./skills/");
	assert.deepEqual(weird?.manifest.keywords, ["x"]);
	assert.equal(weird?.manifest.interface?.displayName, "Weird");
	assert.equal(typeof weird?.manifest.interface?.logo, "undefined");
	assert.deepEqual(mcpBundles.flatMap((bundle) => bundle.servers.map((server) => server.name)), ["c"], "不是服务声明的项跳过，不是整份作废");
});

// ---------------------------------------------------------------------------
// 落盘
// ---------------------------------------------------------------------------

function settingsWith(...mcpServers: McpServerConfig[]): Settings {
	return { ...DEFAULT_SETTINGS, mcpServers };
}

test("填好的钥匙落盘时进保险箱，文件里只剩空位；读回来还是原值", async () => {
	const server = brave({ env: { [KEY]: "bsa-secret-value", LOG_LEVEL: "debug" } });
	await saveSettings(settingsWith(server));
	const onDisk = await readFile(settingsPath(), "utf8");
	assert.equal(onDisk.includes("bsa-secret-value"), false, "明文不在 settings.json 里");
	const written = JSON.parse(onDisk) as Settings;
	const row = written.mcpServers[0];
	assert.equal(row?.transport === "stdio" && row.env?.[KEY], `\${${KEY}}`, "原处留着那个空位");
	assert.equal(row?.transport === "stdio" && row.env?.LOG_LEVEL, "debug", "不是机密的照旧明文");

	resetVault();
	const loaded = await loadSettings();
	const back = loaded.mcpServers[0];
	assert.equal(back?.transport === "stdio" && back.env?.[KEY], "bsa-secret-value");
});

test("包声明成机密的，名字不像也进保险箱；删掉服务，它的钥匙一起忘掉", async () => {
	const server = brave({ env: { WORKSPACE_HANDLE: "acme-private" }, needs: [{ name: "WORKSPACE_HANDLE", secret: true }] });
	await saveSettings(settingsWith(server));
	assert.equal((await readFile(settingsPath(), "utf8")).includes("acme-private"), false);
	assert.match(await readFile(join(process.env.LYRA_HOME!, "credentials.json"), "utf8"), /mcp:brave__brave:WORKSPACE_HANDLE/);

	await saveSettings(settingsWith());
	resetVault();
	await saveSettings(settingsWith(brave({ env: { WORKSPACE_HANDLE: "${WORKSPACE_HANDLE}" }, needs: [{ name: "WORKSPACE_HANDLE", secret: true }] })));
	const loaded = await loadSettings();
	const row = loaded.mcpServers[0];
	assert.equal(row?.transport === "stdio" && row.env?.WORKSPACE_HANDLE, "${WORKSPACE_HANDLE}", "服务删过一次，旧钥匙不会借尸还魂");
});

test("文件里已有的明文钥匙，启动时搬进保险箱", async () => {
	await mkdir(join(process.env.LYRA_HOME!), { recursive: true });
	await writeFile(settingsPath(), JSON.stringify({ ...DEFAULT_SETTINGS, mcpServers: [brave({ env: { GITHUB_PERSONAL_ACCESS_TOKEN: "ghp_plaintext", PATH_HINT: "/opt" } })] }));
	assert.equal(await migrateSecrets(), 1);
	const onDisk = await readFile(settingsPath(), "utf8");
	assert.equal(onDisk.includes("ghp_plaintext"), false);
	assert.equal(onDisk.includes("/opt"), true);
	const loaded = await loadSettings();
	const row = loaded.mcpServers[0];
	assert.equal(row?.transport === "stdio" && row.env?.GITHUB_PERSONAL_ACCESS_TOKEN, "ghp_plaintext");
	assert.equal(await migrateSecrets(), 0, "第二次什么都不用搬");
});

test("可选的值没填就不传这个变量，而不是传一个空字符串", () => {
	const server = brave({
		env: { [KEY]: "typed", REDIS_PORT: "${REDIS_PORT}", REGION: "${REGION}" },
		needs: [{ name: "REDIS_PORT", optional: true }, { name: "REGION", optional: true }],
	});
	const resolved = resolveServer(server, { REGION: "ap-east-1" });
	if (resolved.transport !== "stdio") return assert.fail("还是 stdio");
	assert.equal("REDIS_PORT" in (resolved.env ?? {}), false, "空着的可选变量不出现——服务自己的默认值才生效");
	assert.equal(resolved.env?.REGION, "ap-east-1", "环境里有的照样填上");
	assert.equal(resolved.env?.[KEY], "typed");
});
