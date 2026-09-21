/**
 * What 创建项目 and 编辑项目 write, and what opening a project must not overwrite.
 *
 * The second half is the older bug and the reason the first half needed a guard at all. Opening a
 * project rebuilt its entry from `workspaceInfo`, whose `name` is the directory's `basename` — so
 * everything the user had said about the project was thrown away on the next switch away and back.
 * A rename reverted silently; the source folders would have gone the same way, which would have
 * made the dialog that sets them a form whose answers do not survive the afternoon.
 */

import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { DEFAULT_SETTINGS, type Settings } from "@lyra/core";
import type { SessionSnapshot, WorkspaceInfo } from "../../electron/ipc-types.ts";
import { useApp } from "../../src/store/index.ts";

const usage = { input: 0, output: 0, total: 0, cacheRead: 0, cacheWrite: 0, cost: { input: 0, output: 0, total: 0, cacheRead: 0, cacheWrite: 0 } };

function workspace(path: string): WorkspaceInfo {
	// `name` is the basename, exactly as `workspaceInfo` answers — that is the whole point here.
	return { path, name: path.split("/").pop() ?? path, isGitRepo: false, branch: null };
}

function snapshot(id: string, cwd: string): SessionSnapshot {
	return {
		meta: { id, title: id, projectId: cwd, projectName: cwd, cwd, createdAt: 1, updatedAt: 2, modelId: "", messageCount: 1, seq: 2, usage },
		messages: [],
		running: false,
		pendingApprovals: [],
	};
}

let saves: Settings[];

function projects() {
	return useApp.getState().settings?.projects ?? [];
}

beforeEach(() => {
	saves = [];
	useApp.setState({
		settings: { ...DEFAULT_SETTINGS, projects: [] },
		workspace: null,
		scratchCwd: null,
		scratchRoots: [],
		selectionEpoch: 0,
		activeSessionId: null,
		meta: null,
		messages: [],
		sessions: [],
		sessionCache: {},
		toolRuns: {},
		running: false,
		todos: [],
		compactions: [],
		commandRuns: [],
		approvals: [],
		loadingSession: false,
		pendingUserMessage: null,
		activity: {},
		turns: {},
		carried: {},
		notices: [],
		capabilities: null,
		view: "chat",
		stopped: null,
		retrying: null,
		turnStartedAt: null,
		turnTokens: 0,
	});
	Object.defineProperty(window, "lyra", {
		configurable: true,
		value: {
			workspace: { info: async (path: string) => workspace(path) },
			git: { generalScratch: async () => "/scratch" },
			settings: {
				save: async (settings: Settings) => {
					saves.push(settings);
					// The real one broadcasts the saved settings back; the store reads them again.
					useApp.setState({ settings });
					return settings;
				},
			},
			sessions: {
				create: async (cwd: string) => snapshot("new", cwd),
				capabilities: async () => null,
				transcript: async (projectId: string, id: string) => snapshot(id, projectId),
			},
			subAgents: { list: async () => [] },
			agent: { prompt: async (id: string) => snapshot(id, "/app").meta },
		},
	});
});

// ---------------------------------------------------------------- 创建项目

test("创建项目 keeps the name that was typed, not the folder's", async () => {
	await useApp.getState().createProject("后端服务", ["/Users/x/api"]);
	assert.deepEqual(
		projects().map((p) => [p.name, p.path]),
		[["后端服务", "/Users/x/api"]],
	);
});

test("an unnamed project falls back to the folder's name", async () => {
	await useApp.getState().createProject("   ", ["/Users/x/api"]);
	assert.equal(projects()[0].name, "api");
});

test("the first folder is the project's path; the rest are its other source folders", async () => {
	await useApp.getState().createProject("双仓", ["/Users/x/app", "/Users/x/api"]);
	const [entry] = projects();
	assert.equal(entry.path, "/Users/x/app");
	assert.deepEqual(entry.folders, ["/Users/x/app", "/Users/x/api"]);
});

/*
 * One folder writes no `folders` at all.
 *
 * Every settings file in existence says nothing here and means `[path]`. A one-folder project
 * created today has to be indistinguishable from one created last year, or the field starts
 * carrying information it does not have.
 */
test("a one-folder project writes no folders field", async () => {
	await useApp.getState().createProject("单仓", ["/Users/x/app"]);
	assert.equal(projects()[0].folders, undefined);
});

test("pointing 创建项目 at a folder already on the list edits that project instead of adding a second", async () => {
	await useApp.getState().createProject("第一次", ["/Users/x/app"]);
	await useApp.getState().createProject("第二次", ["/Users/x/app", "/Users/x/api"]);
	assert.equal(projects().length, 1);
	assert.equal(projects()[0].name, "第二次");
	assert.deepEqual(projects()[0].folders, ["/Users/x/app", "/Users/x/api"]);
});

test("a project with no folders is not a project", async () => {
	await useApp.getState().createProject("空的", []);
	assert.deepEqual(projects(), []);
});

// ---------------------------------------------------------------- 编辑项目

test("编辑项目 renames without touching the folders", async () => {
	await useApp.getState().createProject("旧名", ["/Users/x/app", "/Users/x/api"]);
	await useApp.getState().updateProject("/Users/x/app", { name: "新名" });
	assert.equal(projects()[0].name, "新名");
	assert.deepEqual(projects()[0].folders, ["/Users/x/app", "/Users/x/api"]);
});

test("an empty name leaves the old one rather than clearing it", async () => {
	await useApp.getState().createProject("旧名", ["/Users/x/app"]);
	await useApp.getState().updateProject("/Users/x/app", { name: "  " });
	assert.equal(projects()[0].name, "旧名");
});

test("taking the last extra folder out puts the entry back to having none", async () => {
	await useApp.getState().createProject("双仓", ["/Users/x/app", "/Users/x/api"]);
	await useApp.getState().updateProject("/Users/x/app", { folders: ["/Users/x/app"] });
	assert.equal(projects()[0].folders, undefined);
});

test("the main folder stays first however the dialog hands the list back", async () => {
	await useApp.getState().createProject("双仓", ["/Users/x/app"]);
	await useApp.getState().updateProject("/Users/x/app", { folders: ["/Users/x/api", "/Users/x/app"] });
	assert.deepEqual(projects()[0].folders, ["/Users/x/app", "/Users/x/api"]);
});

// ---------------------------------------------------------------- 打开项目

test("opening a project keeps the name it was given and the folders it was configured with", async () => {
	await useApp.getState().createProject("我的项目", ["/Users/x/app", "/Users/x/api"]);
	await useApp.getState().openWorkspace("/Users/x/app");
	const [entry] = projects();
	assert.equal(entry.name, "我的项目", "opening reverted the name to the directory's basename");
	assert.deepEqual(entry.folders, ["/Users/x/app", "/Users/x/api"], "opening dropped the extra source folders");
});

/*
 * And the header has to say the same thing the sidebar does.
 *
 * `workspace` is what the window title, the composer's chip and the git panel read, and it comes
 * from `workspaceInfo` — which knows the directory and nothing about the project. A rename that
 * only reached settings showed up in one list and nowhere else.
 */
test("the open workspace carries the project's name, not the directory's", async () => {
	await useApp.getState().createProject("我的项目", ["/Users/x/app"]);
	await useApp.getState().openWorkspace("/Users/x/app");
	assert.equal(useApp.getState().workspace?.name, "我的项目");
});

test("a directory that is not a project still opens under its own name", async () => {
	await useApp.getState().openWorkspace("/Users/x/somewhere");
	assert.equal(useApp.getState().workspace?.name, "somewhere");
	assert.equal(projects()[0].name, "somewhere");
});
