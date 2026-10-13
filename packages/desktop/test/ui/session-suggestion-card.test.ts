/**
 * The card a `spawn_session` call leaves in the conversation: Start → "Started · Open" → there.
 *
 * Start runs the real `startSession`, with only the two main-process calls stood in for. Guarded:
 * it does not switch away from the conversation on screen, the new one is listed and running, its
 * first message is the card's prompt, and `spawnedFrom` goes down with the create request. The card
 * reads "Started" from the session list's `spawnedFrom` — which is why it still does after a reopen.
 */

import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { createElement as h } from "react";
import type { SessionMeta, SessionSuggestionDetails, ToolCallContent, UserContent } from "@lyra/core";
import { SessionScope } from "../../src/app/session-scope.tsx";
import { SessionSuggestionCards } from "../../src/features/conversation/SessionSuggestionCard.tsx";
import { translate } from "../../src/i18n/translate.ts";
import { useApp, type ToolRun } from "../../src/store/index.ts";
import { click, mount } from "../helpers/mount.ts";

const usage = { input: 0, output: 0, total: 0, cacheRead: 0, cacheWrite: 0, cost: 0 } as unknown as SessionMeta["usage"];
const meta = (id: string, over: Partial<SessionMeta> = {}): SessionMeta => ({
	id, title: id, cwd: "/work/project", projectId: "p", projectName: "project",
	createdAt: 1, updatedAt: 2, modelId: "fake/model", messageCount: 2, seq: 2, usage, ...over,
});

const DETAILS: SessionSuggestionDetails = {
	kind: "session_suggestion",
	title: "删掉没人调用的分组函数",
	summary: "改侧栏时看到 groupLegacy 已经没有调用方了。新会话会确认后删掉它和它的测试。",
	prompt: "In packages/desktop/src/lib/sidebar-grouping.ts, groupLegacy has no callers. Delete it and its tests.",
};
const CALL: ToolCallContent = { type: "toolCall", id: "toolu_spawn", name: "spawn_session", arguments: { title: DETAILS.title, summary: DETAILS.summary, prompt: DETAILS.prompt } };
const run = (status: ToolRun["status"], details?: unknown): ToolRun => ({
	toolCallId: CALL.id, toolName: "spawn_session", summary: "Suggest session", args: CALL.arguments, status, startedAt: 1,
	...(status === "running" ? {} : { result: { content: [], details } }),
});

/** What the card asked the main process for. */
let created: { cwd: string; modelId: string; initial: { content: UserContent[]; spawnedFrom?: unknown; displayText?: string; title?: string; worktree?: boolean } }[];
let prompted: { id: string; content: UserContent[]; options: unknown }[];
const realOpen = useApp.getState().openSessionById;

beforeEach(() => {
	created = [];
	prompted = [];
	localStorage.clear();
	Object.defineProperty(window, "lyra", { configurable: true, value: {
		bootWindow: { id: "test", kind: "primary", sessionId: null, panelKind: null, panelScope: null },
		sessions: {
			create: async (cwd: string, modelId: string, initial: { content: UserContent[]; spawnedFrom?: SessionMeta["spawnedFrom"] }) => {
				created.push({ cwd, modelId, initial });
				const fresh = meta("s-new", { title: "new", messageCount: 1, pendingPrompt: true, ...(initial.spawnedFrom ? { spawnedFrom: initial.spawnedFrom } : {}) });
				return { meta: fresh, messages: [{ role: "user", content: initial.content, timestamp: 1 }], running: true, pendingApprovals: [] };
			},
		},
		agent: {
			prompt: async (id: string, content: UserContent[], options: unknown) => {
				prompted.push({ id, content, options });
				return meta(id, { title: "new", messageCount: 1, spawnedFrom: { sessionId: "s-origin", toolCallId: CALL.id } });
			},
		},
	} });
	useApp.setState({
		activeSessionId: "s-origin", meta: meta("s-origin"), sessions: [meta("s-origin")], sessionCache: {}, activity: {}, turns: {}, notices: [],
		workspace: { path: "/work/project", name: "project", isGitRepo: true, branch: "main" },
		settings: { defaultModelId: "fake/model", projects: [] } as never,
		toolRuns: { [CALL.id]: run("done", DETAILS) },
	});
});

afterEach(() => {
	Reflect.deleteProperty(window, "lyra");
	useApp.setState({ toolRuns: {}, activeSessionId: null, sessions: [], sessionCache: {}, activity: {}, turns: {}, workspace: null, openSessionById: realOpen });
});

async function waitFor(check: () => boolean, what: string): Promise<void> {
	for (let i = 0; i < 50 && !check(); i++) await new Promise((resolve) => setTimeout(resolve, 0));
	assert.ok(check(), `等不到：${what}`);
}

const card = () => h(SessionScope.Provider, { value: "s-origin" }, h(SessionSuggestionCards, { calls: [CALL] }));

test("建议：小标签、标题、说明、一颗「开始」、一个关闭", async () => {
	const view = await mount(card());
	try {
		const section = view.find("[data-ly-session-suggestion]");
		assert.equal(section.getAttribute("data-ly-session-suggestion"), "suggested");
		assert.ok(view.text().includes(translate("sessionOps.suggested")));
		assert.equal(view.find("[data-ly-suggestion-title]").textContent, DETAILS.title);
		assert.equal(view.find("[data-ly-suggestion-summary]").textContent, DETAILS.summary);
		const start = view.find("[data-ly-suggestion-action]");
		assert.equal(start.getAttribute("data-ly-suggestion-action"), "start");
		assert.equal(start.textContent, translate("sessionOps.start"));
		assert.equal(start.getAttribute("data-variant"), "primary", "这张卡上唯一要按的那一颗");
		assert.ok(view.find("[data-ly-suggestion-dismiss]"));
	} finally {
		await view.unmount();
	}
});

test("开始：在这个对话的项目里建会话、发出那段提示词，当前对话不切走；卡片变成「进行中 · 打开」", async () => {
	const view = await mount(card());
	try {
		await click(view.find('[data-ly-suggestion-action="start"]'));
		await waitFor(() => prompted.length === 1, "第一条发出去");

		assert.deepEqual(created, [{
			cwd: "/work/project",
			modelId: "fake/model",
			// Named by the card, and asked the composer's question with the setting's answer (off here).
			initial: { title: DETAILS.title, worktree: false, content: [{ type: "text", text: DETAILS.prompt }], spawnedFrom: { sessionId: "s-origin", toolCallId: CALL.id } },
		}]);
		assert.deepEqual(prompted, [{ id: "s-new", content: [{ type: "text", text: DETAILS.prompt }], options: { resumePending: true } }]);

		const state = useApp.getState();
		assert.equal(state.activeSessionId, "s-origin", "人还在原来那个对话里");
		assert.ok(state.sessions.some((session) => session.id === "s-new"), "新会话进了侧栏");
		assert.equal(state.activity["s-new"], "running", "而且在跑");

		await waitFor(() => view.find("[data-ly-session-suggestion]").getAttribute("data-ly-session-suggestion") === "started", "卡片翻成已开始");
		const action = view.find("[data-ly-suggestion-action]");
		assert.equal(action.getAttribute("data-ly-suggestion-action"), "open");
		assert.equal(action.textContent, `${translate("sessionOps.running")} · ${translate("common.open")}`, "the conversation it started is running, and the card says so");
	} finally {
		await view.unmount();
	}
});

test("卡片上也能选在新工作树里开始：默认跟设置，选了就带下去，开始以后这个开关就没了", async () => {
	useApp.setState({ settings: { defaultModelId: "fake/model", projects: [], worktrees: { autoCreateOnNewSession: false } } as never });
	const view = await mount(card());
	try {
		const toggle = () => view.all<HTMLButtonElement>("[data-ly-worktree-toggle]")[0];
		assert.equal(toggle()?.getAttribute("aria-pressed"), "false");
		await click(toggle());
		assert.equal(toggle()?.getAttribute("aria-pressed"), "true");
		await click(view.find('[data-ly-suggestion-action="start"]'));
		await waitFor(() => created.length === 1, "建会话");
		assert.equal(created[0].initial.worktree, true);
		await waitFor(() => view.find("[data-ly-session-suggestion]").getAttribute("data-ly-session-suggestion") === "started", "卡片翻成已开始");
		assert.equal(toggle(), undefined, "a started conversation cannot be moved into a copy");
	} finally {
		await view.unmount();
	}
});

test("项目不是 Git 仓库：卡片上没有工作树开关，请求里也没有这一项", async () => {
	useApp.setState({ workspace: { path: "/work/project", name: "project", isGitRepo: false, branch: null } });
	const view = await mount(card());
	try {
		assert.equal(view.all("[data-ly-worktree-toggle]").length, 0);
		await click(view.find('[data-ly-suggestion-action="start"]'));
		await waitFor(() => created.length === 1, "建会话");
		assert.equal(Object.hasOwn(created[0].initial, "worktree"), false);
	} finally {
		await view.unmount();
	}
});

test("开始以后，卡片说出那个会话在做什么：进行中、已完成、没跑完，看过之后回到已开始", async () => {
	useApp.setState({ sessions: [meta("s-origin"), meta("s-new", { spawnedFrom: { sessionId: "s-origin", toolCallId: CALL.id } })] });
	const view = await mount(card());
	try {
		const said = () => view.find("[data-ly-suggestion-action]").textContent;
		const open = translate("common.open");
		for (const [activity, key] of [["running", "sessionOps.running"], ["waiting", "sessionOps.running"], ["done", "sessionOps.done"], ["failed", "sessionOps.failed"]] as const) {
			useApp.setState({ activity: { "s-new": activity } });
			await waitFor(() => said() === `${translate(key)} · ${open}`, `${activity} 时说 ${translate(key)}`);
		}
		useApp.setState({ activity: {} });
		await waitFor(() => said() === `${translate("sessionOps.started")} · ${open}`, "看过之后");
	} finally {
		await view.unmount();
	}
});

test("提建议的对话跑在自己的工作树里：新会话开在它所属的项目上，不开进那棵工作树", async () => {
	const inWorktree = { ...meta("s-origin", { cwd: "/work/project/.worktrees/lyra-fix" }), worktree: { project: "/work/project", branch: "lyra/fix" } } as SessionMeta;
	useApp.setState({ meta: inWorktree, sessions: [inWorktree], workspace: { path: "/work/project/.worktrees/lyra-fix", name: "project", isGitRepo: true, branch: "lyra/fix" } });
	const view = await mount(card());
	try {
		await click(view.find('[data-ly-suggestion-action="start"]'));
		await waitFor(() => created.length === 1, "建会话");
		assert.equal(created[0].cwd, "/work/project");
	} finally {
		await view.unmount();
	}
});

test("「开始」的建会话请求留着口子：卡片以后给的选项（比如开新工作树）原样带下去", async () => {
	await useApp.getState().startSession(DETAILS.prompt, { sessionId: "s-origin", toolCallId: CALL.id }, { displayText: "看得见的那句" });
	assert.equal(created.length, 1);
	assert.equal(created[0].initial.displayText, "看得见的那句");
	assert.deepEqual(created[0].initial.spawnedFrom, { sessionId: "s-origin", toolCallId: CALL.id }, "选项盖不掉来源");
});

test("已开始：点「打开」去那个会话；重开（会话列表里已有那条 spawnedFrom）一开始就是已开始", async () => {
	const opened: string[] = [];
	useApp.setState({
		sessions: [meta("s-origin"), meta("s-new", { spawnedFrom: { sessionId: "s-origin", toolCallId: CALL.id } })],
		openSessionById: async (id: string) => { opened.push(id); return true; },
	});
	const view = await mount(card());
	try {
		assert.equal(view.find("[data-ly-session-suggestion]").getAttribute("data-ly-session-suggestion"), "started");
		await click(view.find('[data-ly-suggestion-action="open"]'));
		assert.deepEqual(opened, ["s-new"]);
		assert.equal(created.length, 0, "没有再开一个");
	} finally {
		await view.unmount();
	}
});

test("别的对话里同一个调用 id 开出来的会话，不算这张卡的", async () => {
	useApp.setState({ sessions: [meta("s-origin"), meta("s-other-child", { spawnedFrom: { sessionId: "s-fork", toolCallId: CALL.id } })] });
	const view = await mount(card());
	try {
		assert.equal(view.find("[data-ly-session-suggestion]").getAttribute("data-ly-session-suggestion"), "suggested");
	} finally {
		await view.unmount();
	}
});

test("关闭只是这台机器上收起来：卡片没了，重新挂上也不再出现", async () => {
	const view = await mount(card());
	try {
		await click(view.find("[data-ly-suggestion-dismiss]"));
		assert.equal(view.all("[data-ly-session-suggestion]").length, 0);
	} finally {
		await view.unmount();
	}
	const again = await mount(card());
	try {
		assert.equal(again.all("[data-ly-session-suggestion]").length, 0, "记在 localStorage 里");
		assert.equal(created.length, 0, "收起不是开始");
	} finally {
		await again.unmount();
	}
});

test("参数被退回的调用、还没返回的调用，都不画卡片", async () => {
	useApp.setState({ toolRuns: { [CALL.id]: run("error", undefined) } });
	const refused = await mount(card());
	try {
		assert.equal(refused.all("[data-ly-session-suggestion]").length, 0);
	} finally {
		await refused.unmount();
	}
	useApp.setState({ toolRuns: { [CALL.id]: run("running") } });
	const pending = await mount(card());
	try {
		assert.equal(pending.all("[data-ly-session-suggestion]").length, 0);
	} finally {
		await pending.unmount();
	}
});
