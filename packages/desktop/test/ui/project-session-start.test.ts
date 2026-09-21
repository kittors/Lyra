import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { DEFAULT_SETTINGS, type Settings, type UserContent } from "@lyra/core";
import type { LyraApi, SessionSnapshot, WorkspaceInfo } from "../../electron/ipc-types.ts";
import { startProjectSession } from "../../src/store/project-session.ts";
import { useApp } from "../../src/store/index.ts";

const content: UserContent[] = [{ type: "text", text: "Continue in this project" }];
const usage = { input: 0, output: 0, total: 0, cacheRead: 0, cacheWrite: 0, cost: { input: 0, output: 0, total: 0, cacheRead: 0, cacheWrite: 0 } };
function snapshot(id: string, cwd: string): SessionSnapshot {
	return {
		meta: { id, title: id, projectId: cwd, projectName: cwd, cwd, createdAt: 1, updatedAt: 2, modelId: "", messageCount: 1, seq: 2, usage },
		messages: [{ role: "user", content, timestamp: 10 }], running: false, pendingApprovals: [],
	};
}
function workspace(path: string): WorkspaceInfo { return { path, name: path, isGitRepo: false, branch: null }; }
function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>(done => { resolve = done; });
	return { promise, resolve };
}

let readWorkspace: LyraApi["workspace"]["info"];
let readScratch: LyraApi["git"]["generalScratch"];
let saveSettings: LyraApi["settings"]["save"];
let saves: Settings[];
const previous = snapshot("old", "/worktree");

beforeEach(() => {
	readWorkspace = async path => workspace(path);
	readScratch = async () => "/scratch";
	saveSettings = async settings => settings;
	saves = [];
	useApp.setState({
		settings: { ...DEFAULT_SETTINGS, projects: [{ id: "/root", path: "/root", name: "Root", pinned: true, lastOpenedAt: 1 }] },
		workspace: workspace("/worktree"), scratchCwd: null, scratchRoots: [], selectionEpoch: 0,
		activeSessionId: previous.meta.id, meta: previous.meta, messages: previous.messages, sessions: [previous.meta],
		sessionCache: {}, toolRuns: {}, running: false, todos: [], compactions: [], commandRuns: [], approvals: [],
		loadingSession: false, pendingUserMessage: null, activity: {}, turns: {}, carried: {}, notices: [], capabilities: null,
		view: "chat", stopped: null, retrying: null, turnStartedAt: null, turnTokens: 0,
	});
	Object.defineProperty(window, "lyra", { configurable: true, value: {
		workspace: { info: (path: string) => readWorkspace(path) },
		git: { generalScratch: () => readScratch() },
		settings: { save: (settings: Settings) => { saves.push(settings); return saveSettings(settings); } },
		sessions: {
			create: async (cwd: string) => snapshot("new", cwd), capabilities: async () => null,
			transcript: async (projectId: string, id: string) => snapshot(id, projectId),
		},
		subAgents: { list: async () => [] },
		agent: { prompt: async (id: string) => snapshot(id, useApp.getState().workspace?.path ?? "").meta },
	} });
});

test("saving project recency cannot clear a session submitted in the visible new draft", async () => {
	const saveStarted = deferred<void>();
	const saved = deferred<Settings>();
	saveSettings = settings => { saveStarted.resolve(); return saved.promise.then(() => settings); };
	const opening = startProjectSession("/root");
	await saveStarted.promise;
	assert.equal(useApp.getState().workspace?.path, "/root");
	assert.equal(useApp.getState().activeSessionId, null);
	assert.equal(await useApp.getState().send(content), true);
	assert.equal(useApp.getState().activeSessionId, "new");
	const current = useApp.getState();
	saved.resolve(saves[0]);
	await opening;
	assert.equal(useApp.getState().activeSessionId, "new", "a late settings write cannot restart the newly submitted session");
	assert.equal(useApp.getState().meta, current.meta);
	assert.equal(useApp.getState().messages, current.messages);
	assert.equal(useApp.getState().running, true);
});

test("opening a workspace parks the old session and clears turn state before saving without leaving settings", async () => {
	const saveStarted = deferred<void>();
	const saved = deferred<Settings>();
	saveSettings = settings => { saveStarted.resolve(); return saved.promise.then(() => settings); };
	const todos = [{ content: "Old task", status: "in_progress" } satisfies NonNullable<ReturnType<typeof useApp.getState>["todos"]>[number]];
	useApp.setState({ view: "settings", running: true, todos, stopped: "interrupt", turnStartedAt: 1, turnTokens: 25 });
	const opening = useApp.getState().openWorkspace("/root");
	await saveStarted.promise;
	const current = useApp.getState();
	assert.equal(current.view, "settings");
	assert.equal(current.activeSessionId, null);
	assert.equal(current.running, false);
	assert.equal(current.stopped, null);
	assert.equal(current.turnStartedAt, null);
	assert.equal(current.turnTokens, 0);
	assert.deepEqual(current.todos, []);
	assert.equal(current.sessionCache.old.meta, previous.meta);
	assert.equal(current.sessionCache.old.messages, previous.messages);
	assert.equal(current.sessionCache.old.state?.todos, todos);
	saved.resolve(saves[0]);
	await opening;
	assert.equal(useApp.getState().view, "settings");
});

test("starting again in the current project resets once without reading or saving the workspace", async () => {
	let expanded = 0;
	readWorkspace = async () => { throw new Error("the current workspace needs no lookup"); };
	await startProjectSession("/worktree", () => { expanded++; });
	assert.equal(expanded, 1);
	assert.equal(useApp.getState().activeSessionId, null);
	assert.equal(useApp.getState().sessionCache.old.meta, previous.meta);
	assert.equal(useApp.getState().selectionEpoch, 1);
	assert.equal(saves.length, 0);
});

test("starting in another project opens chat immediately without stealing a later view during lookup or save", async () => {
	const pending = deferred<WorkspaceInfo>();
	const saveStarted = deferred<void>();
	const saved = deferred<Settings>();
	readWorkspace = () => pending.promise;
	saveSettings = settings => { saveStarted.resolve(); return saved.promise.then(() => settings); };
	useApp.setState({ view: "settings" });
	const opening = startProjectSession("/root");
	assert.equal(useApp.getState().view, "chat");
	useApp.getState().setView("settings");
	pending.resolve(workspace("/root"));
	await saveStarted.promise;
	assert.equal(useApp.getState().view, "settings");
	useApp.getState().setView("pull-requests");
	saved.resolve(saves[0]);
	await opening;
	assert.equal(useApp.getState().view, "pull-requests");
});

for (const missing of [true, false]) {
	test(`a ${missing ? "missing" : "failed"} workspace lookup keeps the selected conversation`, async () => {
		readWorkspace = async () => { if (missing) return null; throw new Error("workspace unavailable"); };
		if (missing) await startProjectSession("/root");
		else await assert.rejects(startProjectSession("/root"), /workspace unavailable/);
		assert.equal(useApp.getState().workspace?.path, "/worktree");
		assert.equal(useApp.getState().activeSessionId, "old");
		assert.equal(useApp.getState().messages, previous.messages);
		assert.equal(saves.length, 0);
	});
}

test("a slower earlier workspace lookup cannot clear a conversation started in the later project", async () => {
	const first = deferred<WorkspaceInfo>();
	readWorkspace = path => path === "/root" ? first.promise : Promise.resolve(workspace(path));
	const earlier = startProjectSession("/root");
	await startProjectSession("/later");
	assert.equal(await useApp.getState().send(content), true);
	first.resolve(workspace("/root"));
	await earlier;
	assert.equal(useApp.getState().workspace?.path, "/later");
	assert.equal(useApp.getState().activeSessionId, "new");
	assert.equal(useApp.getState().meta?.cwd, "/later");
	assert.equal(saves.length, 1);
});

test("a newer blank-session selection cancels a pending workspace lookup", async () => {
	const pending = deferred<WorkspaceInfo>();
	readWorkspace = () => pending.promise;
	const opening = startProjectSession("/root");
	await useApp.getState().newSession();
	pending.resolve(workspace("/root"));
	await opening;
	assert.equal(useApp.getState().workspace?.path, "/worktree");
	assert.equal(useApp.getState().activeSessionId, null);
	assert.equal(saves.length, 0);
});

test("starting again in the current project cancels a pending different-project lookup", async () => {
	const pending = deferred<WorkspaceInfo>();
	readWorkspace = () => pending.promise;
	const opening = startProjectSession("/root");
	await startProjectSession("/worktree");
	pending.resolve(workspace("/root"));
	await opening;
	assert.equal(useApp.getState().workspace?.path, "/worktree");
	assert.equal(useApp.getState().activeSessionId, null);
	assert.equal(useApp.getState().sessionCache.old.meta, previous.meta);
	assert.equal(saves.length, 0);
});

test("opening another conversation cancels a pending workspace lookup", async () => {
	const pending = deferred<WorkspaceInfo>();
	readWorkspace = () => pending.promise;
	const opening = startProjectSession("/root");
	const selected = snapshot("selected", "/worktree");
	await useApp.getState().openSession(selected.meta);
	assert.equal(useApp.getState().activeSessionId, "selected");
	assert.deepEqual(useApp.getState().messages, selected.messages);
	pending.resolve(workspace("/root"));
	await opening;
	assert.equal(useApp.getState().workspace?.path, "/worktree");
	assert.equal(useApp.getState().activeSessionId, "selected");
	assert.deepEqual(useApp.getState().messages, selected.messages);
	assert.equal(saves.length, 0);
});

test("choosing a projectless chat cancels an older project lookup", async () => {
	const pending = deferred<WorkspaceInfo>();
	readWorkspace = () => pending.promise;
	const opening = startProjectSession("/root");
	await useApp.getState().clearWorkspace();
	assert.equal(useApp.getState().workspace, null);
	assert.equal(useApp.getState().scratchCwd, "/scratch");
	pending.resolve(workspace("/root"));
	await opening;
	assert.equal(useApp.getState().workspace, null, "the older project cannot replace a later projectless selection");
	assert.equal(useApp.getState().scratchCwd, "/scratch");
	assert.equal(saves.length, 0);
});

test("a late scratch lookup cannot clear a session started in a later project", async () => {
	const pending = deferred<string>();
	readScratch = () => pending.promise;
	const clearing = useApp.getState().clearWorkspace();
	await startProjectSession("/later");
	assert.equal(await useApp.getState().send(content), true);
	pending.resolve("/scratch");
	await clearing;
	assert.equal(useApp.getState().workspace?.path, "/later");
	assert.equal(useApp.getState().activeSessionId, "new");
	assert.equal(useApp.getState().meta?.cwd, "/later");
	assert.equal(useApp.getState().scratchCwd, null);
});
