/**
 * The sidebar's list, as rules rather than as a rendering.
 *
 * These were four conditions buried in a 474-line component, and each one is the kind that is only
 * noticed when it is wrong: a pinned project vanishing because it has no sessions yet, a search
 * dissolving the projects it filtered within, a half-started conversation disappearing out from
 * under the message being sent in it.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { activeProviderLabel, groupSessions, listableSessions } from "../src/features/sidebar/grouping.ts";

type Session = Parameters<typeof listableSessions>[0][number];

function session(over: Partial<Session>): Session {
	return {
		id: "s1",
		title: "会话",
		cwd: "/a",
		projectName: "a",
		messageCount: 2,
		archived: false,
		updatedAt: 0,
		createdAt: 0,
		...over,
	} as Session;
}

const projects = [
	{ path: "/pinned", name: "置顶项目", pinned: true, lastOpenedAt: 2 },
	{ path: "/a", name: "a", pinned: false, lastOpenedAt: 1 },
];

test("archived sessions are not listed; they live in settings", () => {
	const kept = listableSessions([session({ id: "x", archived: true }), session({ id: "y" })], null);
	assert.deepEqual(
		kept.map((s) => s.id),
		["y"],
	);
});

test("an empty session is not a conversation yet, unless it is the one being started", () => {
	const sessions = [session({ id: "empty", messageCount: 0 }), session({ id: "started", messageCount: 0 })];
	assert.deepEqual(
		listableSessions(sessions, "started").map((s) => s.id),
		["started"],
	);
});

test("archived sessions never enter the live list even if active", () => {
	const filed = session({ id: "filed", archived: true });
	assert.deepEqual(
		listableSessions([filed, session({ id: "other" })], "filed").map((s) => s.id),
		["other"],
	);
	assert.deepEqual(
		listableSessions([filed, session({ id: "other" })], "other").map((s) => s.id),
		["other"],
	);
});

test("a conversation that has just been sent to stays listed after you click away", () => {
	/*
	 * The row is only exempt from the "must have a message" rule while it is selected, so a session
	 * carrying the stored `messageCount: 0` vanished the moment another conversation was opened.
	 * `send` counts the message it just sent, which is what this depends on.
	 */
	const justSent = session({ id: "just-sent", messageCount: 1 });
	assert.deepEqual(
		listableSessions([justSent], "somebody-else").map((s) => s.id),
		["just-sent"],
	);
});

test("a pinned project keeps its row with no sessions; an unpinned one does not", () => {
	const { pinned, projects: rest } = groupSessions([], projects, "");
	assert.deepEqual(
		pinned.map((g) => g.path),
		["/pinned"],
	);
	assert.deepEqual(rest, []);
});

/*
 * 会话全归档之后，那一行留不留——是个设置，不是个定论。
 *
 * 归档掉最后一条对话是在说这个项目告一段落了，有人希望它跟着一起收起来。但项目从侧边栏凭空
 * 消失，也是让人找不着自己活儿的一种方式。所以默认留着，想收起来的自己去开。
 */
test("an emptied project keeps its row by default", () => {
	const emptied = new Set(["/pinned", "/a"]);
	const { pinned } = groupSessions([], projects, "", [], [], undefined, "updatedAt", emptied, false);
	assert.deepEqual(
		pinned.map((g) => g.path),
		["/pinned"],
		"默认不消失",
	);
});

test("with hideEmptiedProjects on, an emptied project folds away — pinned or not", () => {
	const emptied = new Set(["/pinned", "/a"]);
	const { pinned, projects: rest } = groupSessions([], projects, "", [], [], undefined, "updatedAt", emptied, true);
	assert.deepEqual(pinned, [], "置顶也挡不住——它空了");
	assert.deepEqual(rest, []);
});

test("a project that never had a session is unaffected by the setting", () => {
	/*
	 * 「一条都没有过」和「都归档了」是两回事。前者是刚加进列表的项目，藏起来就没地方点着开第一
	 * 条了——不管那个开关开没开，它都按老规矩来：只有置顶的才值得占一行。
	 */
	for (const hide of [false, true]) {
		const { pinned, projects: rest } = groupSessions([], projects, "", [], [], undefined, "updatedAt", new Set(), hide);
		assert.deepEqual(pinned.map((g) => g.path), ["/pinned"], `hideEmptied=${hide}`);
		assert.deepEqual(rest, [], `hideEmptied=${hide}`);
	}
});

test("a project still holding one live session is never folded away", () => {
	const live = session({ id: "alive", cwd: "/pinned" });
	// 归档了一条、还剩一条：项目还在进行中，开关开着也得留着。
	const { pinned } = groupSessions([live], projects, "", [], [], undefined, "updatedAt", new Set(["/a"]), true);
	assert.deepEqual(
		pinned.map((g) => g.path),
		["/pinned"],
	);
});

test("searching filters sessions without dissolving their projects", () => {
	const sessions = [
		session({ id: "1", title: "改一下登录", cwd: "/a" }),
		session({ id: "2", title: "登录页样式", cwd: "/b", projectName: "b" }),
		session({ id: "3", title: "无关的事", cwd: "/a" }),
	];
	const { projects: rest } = groupSessions(sessions, projects, "登录");
	assert.deepEqual(
		rest.map((g) => [g.path, g.sessions.map((s) => s.id)]),
		[
			["/a", ["1"]],
			["/b", ["2"]],
		],
	);
});

test("projects keep their configured order; unknown ones go last", () => {
	const sessions = [session({ id: "1", cwd: "/z", projectName: "z" }), session({ id: "2", cwd: "/a" })];
	const { projects: rest } = groupSessions(sessions, projects, "");
	assert.deepEqual(
		rest.map((g) => g.path),
		["/a", "/z"],
	);
});
test("project sessions follow custom sessionOrder only in manual sort mode", () => {
	const s1 = session({ id: "s1", cwd: "/a", updatedAt: 100, createdAt: 300 });
	const s2 = session({ id: "s2", cwd: "/a", updatedAt: 200, createdAt: 100 });
	const s3 = session({ id: "s3", cwd: "/a", updatedAt: 300, createdAt: 200 });
	const sNew = session({ id: "sNew", cwd: "/a", updatedAt: 400, createdAt: 400 });

	// In manual sort mode
	const { projects: manualRes } = groupSessions(
		[s1, s2, s3, sNew],
		[{ id: "p1", name: "A", path: "/a", pinned: false, lastOpenedAt: 0 }],
		"",
		[],
		[],
		{ "/a": ["s3", "s1", "s2"] },
		"manual",
	);
	assert.deepEqual(
		manualRes[0].sessions.map((s) => s.id),
		["sNew", "s3", "s1", "s2"],
	);

	// In updatedAt mode, sessionOrder should be bypassed and sorted by updatedAt desc
	const { projects: updateRes } = groupSessions(
		[s1, s2, s3, sNew],
		[{ id: "p1", name: "A", path: "/a", pinned: false, lastOpenedAt: 0 }],
		"",
		[],
		[],
		{ "/a": ["s3", "s1", "s2"] },
		"updatedAt",
	);
	assert.deepEqual(
		updateRes[0].sessions.map((s) => s.id),
		["sNew", "s3", "s2", "s1"],
	);

	// In createdAt mode, sorted by createdAt desc
	const { projects: createdRes } = groupSessions(
		[s1, s2, s3, sNew],
		[{ id: "p1", name: "A", path: "/a", pinned: false, lastOpenedAt: 0 }],
		"",
		[],
		[],
		{ "/a": ["s3", "s1", "s2"] },
		"createdAt",
	);
	assert.deepEqual(
		createdRes[0].sessions.map((s) => s.id),
		["sNew", "s1", "s3", "s2"],
	);
});


test("the settings row counts models across enabled providers only", () => {
	const label = activeProviderLabel([
		{ name: "Relay", enabled: true, models: [1, 2] },
		{ name: "旧的", enabled: false, models: [1] },
	]);
	assert.equal(label, "Relay · 2 个模型");
});

test("with nothing configured the settings row says so", () => {
	assert.equal(activeProviderLabel([]), "未配置模型供应商");
});

test("project-less conversations are loose rows, not a project each and not a project at all", () => {
	/*
	 * They are real sessions worth returning to — a review asked about yesterday should be one
	 * click away — but their directory is the app's own. Grouped by directory the usual way, each
	 * one becomes a project called `owner-repo-6381` sitting among the user's actual work; grouped
	 * under one folder row, that row is a project named after not being one.
	 */
	const roots = ["/home/.lyra/workspaces"];
	const sessions = [
		session({ id: "work", cwd: "/a" }),
		session({ id: "review-1", cwd: "/home/.lyra/workspaces/owner-repo-1" }),
		session({ id: "review-2", cwd: "/home/.lyra/workspaces/owner-repo-2" }),
	];

	const { projects: rest, loose } = groupSessions(sessions, projects, "", roots);

	assert.deepEqual(
		loose.map((s) => s.id),
		["review-1", "review-2"],
		"both are loose despite living in different directories",
	);
	assert.deepEqual(
		rest.map((g) => g.path),
		["/a"],
		"and none of them invents a project",
	);
});

test("loose rows are newest first, whatever order they arrived in", () => {
	const roots = ["/home/.lyra/workspaces"];
	const sessions = [
		session({ id: "older", cwd: "/home/.lyra/workspaces/general", updatedAt: 10 }),
		session({ id: "newest", cwd: "/home/.lyra/workspaces/general", updatedAt: 30 }),
		session({ id: "middle", cwd: "/home/.lyra/workspaces/general", updatedAt: 20 }),
	];
	assert.deepEqual(
		groupSessions(sessions, [], "", roots).loose.map((s) => s.id),
		["newest", "middle", "older"],
	);
});

test("every historical root is recognised, not just the current one", () => {
	// The directory has been renamed twice. Sessions record the path they were created under, so
	// forgetting an old one turns every already-opened review back into a fake project.
	const sessions = [
		session({ id: "oldest", cwd: "/home/.lyra/pr/owner-repo-1" }),
		session({ id: "old", cwd: "/home/.lyra/scratch/owner-repo-2" }),
		session({ id: "new", cwd: "/home/.lyra/workspaces/owner-repo-3" }),
	];

	const { projects: rest, loose } = groupSessions(sessions, [], "", [
		"/home/.lyra/workspaces",
		"/home/.lyra/scratch",
		"/home/.lyra/pr",
	]);
	assert.deepEqual(
		loose.map((s) => s.id),
		["oldest", "old", "new"],
	);
	assert.deepEqual(rest, [], "none of them is a project");
});

test("a project whose path merely starts the same is still its own project", () => {
	// The root arrives without a trailing slash; a plain `startsWith` would swallow
	// `/home/.lyra/prototypes` into the loose rows.
	const sessions = [session({ id: "prototypes", cwd: "/home/.lyra/prototypes" })];

	const { projects: rest, loose } = groupSessions(sessions, [], "", ["/home/.lyra/pr"]);
	assert.deepEqual(loose, []);
	assert.equal(rest[0].path, "/home/.lyra/prototypes");
});

test("with no roots known yet, nothing is treated as project-less", () => {
	const sessions = [session({ id: "review", cwd: "/home/.lyra/workspaces/owner-repo-1" })];
	const { projects: rest, loose } = groupSessions(sessions, [], "", []);
	assert.deepEqual(loose, []);
	assert.equal(rest[0].path, "/home/.lyra/workspaces/owner-repo-1");
});

/*
 * 一个项目可以由好几个文件夹组成，在第二个文件夹里开的会话不该另起一行。
 *
 * 这是「加了第二个源文件夹」在侧边栏上唯一看得见的地方：那个文件夹之前很可能自己是个项目，
 * 或者是一堆没归属的会话——合进来之后它们要跟着走，否则列表上会同时出现「这个项目」和
 * 「这个项目的一半」。
 */
const multi = [{ path: "/app", name: "app", pinned: false, lastOpenedAt: 1, folders: ["/app", "/api"] }];

test("一个会话开在附加源文件夹里，归到这个项目下", () => {
	const sessions = [session({ id: "in-app", cwd: "/app" }), session({ id: "in-api", cwd: "/api" })];
	const { projects: rest } = groupSessions(sessions, multi, "");
	assert.deepEqual(
		rest.map((g) => g.path),
		["/app"],
	);
	assert.deepEqual(
		rest[0].sessions.map((s) => s.id).sort(),
		["in-api", "in-app"],
	);
});

/*
 * 只认文件夹本身，不认它下面的子目录。
 *
 * `/app/packages/core` 里开的会话一直是自成一组的（见 `grouping.ts` 里 `owner` 那段注释），
 * 加一个源文件夹不该顺手改掉这条，那是对列表上每一个项目的改动。
 */
test("附加文件夹的子目录还是自成一组，跟主文件夹的子目录一个待遇", () => {
	const sessions = [session({ id: "deep-api", cwd: "/api/src" }), session({ id: "deep-app", cwd: "/app/packages" })];
	const { projects: rest } = groupSessions(sessions, multi, "");
	// `/app` itself is absent because it has no sessions of its own and is not pinned — the
	// existing rule, unchanged. The point here is that neither subdirectory was folded into it.
	assert.deepEqual(
		rest.map((g) => g.path).sort(),
		["/api/src", "/app/packages"],
	);
});

test("名字只是前缀相同的邻居没被吃进来", () => {
	const sessions = [session({ id: "neighbour", cwd: "/api-old" })];
	const { projects: rest } = groupSessions(sessions, multi, "");
	assert.ok(rest.some((g) => g.path === "/api-old"));
});

/*
 * 「移除项目」得真的把它从列表里去掉。
 *
 * `removeProject` 只把条目从 `settings.projects` 里滤掉，注释说这是「stop listing this, not
 * delete my work」。可这里会照着会话的 `cwd` 把分组重新造出来——移除项目并不删它的会话，于是
 * 那些会话还指着同一个路径，分组下一帧就回来了。用户看到的就是「删不掉」：目录都从磁盘上删了，
 * 侧边栏里那一组还在。
 *
 * 所以移除的时候要连同它的会话一起归档——归档是既有的、可撤销的手段，会话一条没少，只是不在
 * 主列表里了。这条钉的是「归档之后不会被重新造出来」。
 */
test("移除项目之后，它不会因为还有会话就被重新造回来", () => {
	const gone = "/removed";
	const sessions = [
		session({ id: "kept", cwd: "/a" }),
		// 它的会话已经跟着一起归档了，所以进不了列表。
		session({ id: "with-removed", cwd: gone, projectName: "removed", archived: true }),
	];
	const { projects: rest } = groupSessions(listableSessions(sessions, null), projects, "");
	assert.equal(
		rest.some((group) => group.path === gone),
		false,
		"归档掉它的会话之后，这一组不该再出现",
	);
});

test("只移除条目、会话还留在列表里，那一组就会自己长回来", () => {
	const gone = "/removed";
	// 这是修复前的样子，也是这条修复要防的：条目没了，会话还在，分组照旧。
	const sessions = [session({ id: "orphan", cwd: gone, projectName: "removed" })];
	const { projects: rest } = groupSessions(listableSessions(sessions, null), projects, "");
	assert.equal(
		rest.some((group) => group.path === gone),
		true,
		"这不是要保留的行为，是在说明为什么移除必须连会话一起处理",
	);
});
