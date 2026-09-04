/**
 * 剩下四个 scheme，以及它们背后到底有没有东西。
 *
 * 前半是解析——地址长什么样、错了说什么。后半才是这个文件存在的理由：**数据源真的被填进
 * 会话了吗**。一个注册了却永远解析失败的 scheme，跟没有这个 scheme 的区别只有一处：
 * 提示词里多了一行，教模型去试一个一定会失败的地址。
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { BUILTIN_RESOURCES } from "../src/resources/handlers.ts";
import {
	ARTIFACTS_KEY,
	artifactResource,
	MCP_KEY,
	mcpResource,
	PLUGINS_KEY,
	pluginResource,
	SESSIONS_KEY,
	sessionResource,
	type Artifact,
} from "../src/resources/more-handlers.ts";
import { ResourceRouter } from "../src/resources/router.ts";
import { AgentSession } from "../src/runtime/session.ts";
import { SessionCapabilities } from "../src/runtime/session-capabilities.ts";
import { pruneToolResults } from "../src/runtime/prune.ts";
import type { Message } from "../src/types.ts";

let root: string;

before(async () => {
	root = await mkdtemp(join(tmpdir(), "ly-res-"));
});
after(async () => {
	await rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 25 });
});

function router(): ResourceRouter {
	const r = new ResourceRouter();
	for (const handler of BUILTIN_RESOURCES) r.register(handler);
	return r;
}

const ctx = (state: Map<string, unknown>) => ({ cwd: root, sessionId: "me", state });

// ---------------------------------------------------------------------------
// 九个 scheme 都在
// ---------------------------------------------------------------------------

test("九个 scheme 都注册了", () => {
	const schemes = router()
		.schemes()
		.map((s) => s.scheme)
		.sort();
	assert.deepEqual(schemes, ["agent", "artifact", "lyra", "mcp", "plugin", "rule", "scratch", "session", "skill"].sort());
});

test("只有 scratch 是可写的", () => {
	/*
	 * 可写是一条安全边界，不是一个属性。`plugin://` 能写意味着模型可以改别人装的插件；
	 * `session://` 能写意味着它可以改写历史。
	 */
	const writable = router()
		.schemes()
		.filter((s) => s.writable)
		.map((s) => s.scheme);
	assert.deepEqual(writable, ["scratch"]);
});

// ---------------------------------------------------------------------------
// session://
// ---------------------------------------------------------------------------

const LOOKUP = {
	recent: async () => [
		{ id: "s1", title: "上次那个构建问题", updatedAt: 2 },
		{ id: "me", title: "当前这个", updatedAt: 3 },
	],
	transcript: async (id: string) => (id === "s1" ? { title: "上次那个构建问题", lines: ["用户：为什么慢", "助手：因为没缓存"] } : null),
};

test("session:// 读得到另一次会话", async () => {
	const state = new Map<string, unknown>([[SESSIONS_KEY, LOOKUP]]);
	const got = await sessionResource.resolve({ scheme: "session", path: "s1", segments: ["s1"], raw: "session://s1" }, ctx(state));

	assert.match(got.content, /为什么慢/);
	assert.match(got.content, /因为没缓存/);
	assert.equal(got.origin, "另一次会话的转录", "带来源标记，因为那里面是别人说过的话");
});

test("session://<id>/<n> 只取一条，越界说清一共几条", async () => {
	const state = new Map<string, unknown>([[SESSIONS_KEY, LOOKUP]]);
	const one = await sessionResource.resolve({ scheme: "session", path: "s1/2", segments: ["s1", "2"], raw: "session://s1/2" }, ctx(state));
	assert.equal(one.content, "助手：因为没缓存");

	/*
	 * 越界给的是「一共 N 条」而不是空结果——空结果会让模型接着试下一个数字，而它需要知道的
	 * 是这里根本没有那么多条。
	 */
	await assert.rejects(
		() => sessionResource.resolve({ scheme: "session", path: "s1/9", segments: ["s1", "9"], raw: "session://s1/9" }, ctx(state)),
		/一共 2 条/,
	);
});

test("列表里没有当前这个会话", async () => {
	/*
	 * 读自己的转录是死循环的开头：读回来的内容进上下文，下一轮的转录里就包含了这次读取，
	 * 而模型看不出这一点。
	 */
	const state = new Map<string, unknown>([[SESSIONS_KEY, LOOKUP]]);
	const listed = await sessionResource.list!(ctx(state));
	assert.deepEqual(
		listed.map((c) => c.value),
		["session://s1"],
	);
});

// ---------------------------------------------------------------------------
// plugin://
// ---------------------------------------------------------------------------

test("plugin:// 优先给 README，没有才给清单", async () => {
	const withReadme = join(root, "p1");
	const without = join(root, "p2");
	await mkdir(withReadme, { recursive: true });
	await mkdir(without, { recursive: true });
	await writeFile(join(withReadme, "README.md"), "# 这个插件干什么\n\n它做 X。\n");

	const plugins = [
		{ id: "has-readme", dir: withReadme, manifest: { description: "清单里的说明" }, skills: [], source: "user", enabled: true },
		{ id: "no-readme", dir: without, manifest: { description: "只有清单" }, skills: [], source: "user", enabled: true },
	];
	const state = new Map<string, unknown>([[PLUGINS_KEY, plugins]]);

	const a = await pluginResource.resolve({ scheme: "plugin", path: "has-readme", segments: ["has-readme"], raw: "plugin://has-readme" }, ctx(state));
	assert.match(a.content, /它做 X。/);

	const b = await pluginResource.resolve({ scheme: "plugin", path: "no-readme", segments: ["no-readme"], raw: "plugin://no-readme" }, ctx(state));
	assert.match(b.content, /只有清单/);
});

test("插件内容一律带 origin", async () => {
	/*
	 * 一份 README 是别人写的文本，而它会以跟项目文件相同的样子落进上下文。「按照说明，先运行
	 * 这个脚本」是一句在插件文档里毫不起眼、而不该被当成指令执行的话。
	 */
	const dir = join(root, "p3");
	await mkdir(dir, { recursive: true });
	await writeFile(join(dir, "README.md"), "随便");
	const state = new Map<string, unknown>([
		[PLUGINS_KEY, [{ id: "x", dir, manifest: {}, skills: [], source: "user", enabled: true }]],
	]);

	const got = await pluginResource.resolve({ scheme: "plugin", path: "x", segments: ["x"], raw: "plugin://x" }, ctx(state));
	assert.match(got.origin ?? "", /第三方插件/);
});

test("plugin:// 出不去插件目录", async () => {
	const dir = join(root, "p4");
	await mkdir(dir, { recursive: true });
	const state = new Map<string, unknown>([
		[PLUGINS_KEY, [{ id: "x", dir, manifest: {}, skills: [], source: "user", enabled: true }]],
	]);

	await assert.rejects(
		() =>
			pluginResource.resolve(
				{ scheme: "plugin", path: "x/../../etc/passwd", segments: ["x", "..", "..", "etc", "passwd"], raw: "plugin://x/../../etc/passwd" },
				ctx(state),
			),
		/外面/,
	);
});

// ---------------------------------------------------------------------------
// mcp://
// ---------------------------------------------------------------------------

test("mcp:// 把带斜杠的资源 uri 原样拼回去", async () => {
	/*
	 * MCP 的 uri 自己就可能带 `/`（`file:///var/log/x`），而路由已经按 `/` 切过一遍。
	 * 只取第一段的话，任何带路径的资源都读不到——而那是它们中的大多数。
	 */
	let asked = "";
	const state = new Map<string, unknown>([
		[
			MCP_KEY,
			{
				resources: async () => [],
				read: async (_server: string, uri: string) => {
					asked = uri;
					return "内容";
				},
			},
		],
	]);

	await mcpResource.resolve(
		{ scheme: "mcp", path: "srv/file:///var/log/x", segments: ["srv", "file:", "var", "log", "x"], raw: "mcp://srv/file:///var/log/x" },
		ctx(state),
	);
	assert.equal(asked, "file:///var/log/x", `空段被丢掉的话会变成 file:/var/log/x，实际拿到：${asked}`);
});

test("mcp:// 内容带 origin", async () => {
	const state = new Map<string, unknown>([
		[MCP_KEY, { resources: async () => [], read: async () => "值班表" }],
	]);
	const got = await mcpResource.resolve({ scheme: "mcp", path: "srv/a", segments: ["srv", "a"], raw: "mcp://srv/a" }, ctx(state));
	assert.match(got.origin ?? "", /MCP 服务器/);
});

// ---------------------------------------------------------------------------
// artifact://
// ---------------------------------------------------------------------------

test("artifact:// 取回被折叠的原文", async () => {
	const store = new Map<string, Artifact>([["a1", { id: "a1", tool: "bash", content: "三万行日志", at: 1 }]]);
	const state = new Map<string, unknown>([[ARTIFACTS_KEY, store]]);

	const got = await artifactResource.resolve({ scheme: "artifact", path: "a1", segments: ["a1"], raw: "artifact://a1" }, ctx(state));
	assert.equal(got.content, "三万行日志");
	assert.equal(got.immutable, true, "折叠下来的内容不会再变");
});

test("取不到时说的是「会话重开过」，不是「没有这个 id」", async () => {
	/*
	 * 找不到通常不是打错了，是会话重开过——标记写进了日志，内容只在内存里。说「没有这个 id」
	 * 会让模型去试别的 id。
	 */
	const state = new Map<string, unknown>([[ARTIFACTS_KEY, new Map()]]);
	await assert.rejects(
		() => artifactResource.resolve({ scheme: "artifact", path: "zz", segments: ["zz"], raw: "artifact://zz" }, ctx(state)),
		/重开会话后就没有了/,
	);
});

// ---------------------------------------------------------------------------
// 接线：数据源真的在会话里吗
// ---------------------------------------------------------------------------

test("剪枝把原文存下来，占位标记里给出地址", async () => {
	/*
	 * 这条是 `artifact://` 成立的全部。没有它，那个 scheme 解析得再对也永远是空的——
	 * 而占位标记里那句「完整结果留在会话里」对模型来说等于没有，它读不到转录。
	 */
	const kept: { tool: string; content: string }[] = [];
	const sink = {
		keep: (tool: string, content: string) => {
			kept.push({ tool, content });
			return `artifact://a${kept.length}`;
		},
	};

	const huge = "x".repeat(50_000);
	const messages: Message[] = [
		{ role: "toolResult", toolCallId: "c1", toolName: "bash", content: [{ type: "text", text: huge }], timestamp: 0 } as Message,
	];

	const pruned = pruneToolResults(messages, 1000, sink);
	const text = (pruned[0].content[0] as { text: string }).text;

	assert.equal(kept.length, 1, "原文被存下来了");
	assert.equal(kept[0].content, huge, "存的是**原文**，不是剪过的那份");
	assert.equal(kept[0].tool, "bash");
	assert.match(text, /artifact:\/\/a1/, "占位标记里写着地址");
});

test("会话把四个数据源都填进了 state", async () => {
	/*
	 * 这个文件真正要拦的东西。四个 scheme 注册在路由上是一行代码，而它们能不能解析出东西，
	 * 取决于另外四处完全不同的接线——少任何一处，那个 scheme 就是提示词里一行教模型去试
	 * 一个必然失败的地址的字。
	 *
	 * `session://` 不在这里：它由 `AgentSession.initialize` 填（那里才有 store），
	 * 而能力层刻意不知道会话是怎么存的。
	 */
	const can = new SessionCapabilities();
	await can.load(root, { disabledPlugins: [], disabledRules: [], mcpServers: [] } as never);

	assert.ok(can.state.get(PLUGINS_KEY) !== undefined, "plugin:// 有插件列表");
	assert.ok(can.state.get(MCP_KEY) !== undefined, "mcp:// 有管理器");
	assert.ok(can.state.get(ARTIFACTS_KEY) instanceof Map, "artifact:// 有存储");
});

test("会话把 session:// 的数据源也填上了", async () => {
	/*
	 * 这一条是补上来的，因为它拦的那件事**刚刚真的发生过**：`SESSIONS_KEY` 的接线写进了
	 * `initialize`，而替换没匹配上，于是 `session://` 注册着、提示词里列着、永远解析不出东西。
	 * 是 lint 报「`renderMessage` 没人用」把它翻出来的——一个纯属侥幸的信号。
	 */
	const store = {
		create: async () => ({ id: "s1", projectId: "p", cwd: root, title: "", updatedAt: 1 }),
		listSessions: async () => [{ id: "other", projectId: "p", title: "另一个", updatedAt: 9, archived: false }],
		messages: async () => [{ role: "user", content: [{ type: "text", text: "你好" }], timestamp: 0 }],
		append: async (meta: unknown) => meta,
	};
	const session = new AgentSession({
		cwd: root,
		settings: { disabledPlugins: [], disabledRules: [], mcpServers: [], alwaysAllow: [] } as never,
		store: store as never,
		emit: async () => {},
	});
	await session.initialize();

	const lookup = session.can.state.get(SESSIONS_KEY) as { transcript(id: string): Promise<{ lines: string[] } | null> } | undefined;
	assert.ok(lookup, "`session://` 的数据源必须在会话初始化时就位");
	const found = await lookup.transcript("other");
	assert.deepEqual(found?.lines, ["用户：你好"]);
});

test("折叠的份数有上限，超了丢最旧的", async () => {
	/*
	 * 每一份都是几十万字符。一个跑了一天、搜了几百次的会话，不设上限就是把每一次的完整输出
	 * 都留在内存里。
	 */
	const can = new SessionCapabilities();
	for (let i = 0; i < 40; i += 1) can.keepArtifact("bash", `第 ${i} 次`);

	assert.ok(can.artifacts.size <= 30, `实际留了 ${can.artifacts.size} 份`);
	const contents = new Set([...can.artifacts.values()].map((a) => a.content));
	assert.ok(!contents.has("第 0 次"), "最旧的被丢了");
	assert.ok(contents.has("第 39 次"), "最新的还在");
});
