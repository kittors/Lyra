/**
 * 有自己工作树的会话：输入框上方那颗 chip 说它的分支、领先落后多少；点开是工作树菜单——合并回去、
 * 同步进来、同步卡在冲突上时交给对话或放弃。结果写在菜单里，不弹 toast。
 *
 * 没建成工作树的会话在同一个位置留一个提醒；删除确认框说清楚工作树里留下什么。
 */

import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { act, createElement as h } from "react";
import type { SessionMeta, UserContent } from "@lyra/core";
import type { MergeOutcome, SessionSnapshot, SyncOutcome, WorkspaceInfo, WorktreeState } from "../../electron/ipc-types.ts";
import { LayoutProvider } from "../../src/app/layout.tsx";
import { SessionScope } from "../../src/app/session-scope.tsx";
import { Composer } from "../../src/features/composer/Composer.tsx";
import { deleteSessionQuestion } from "../../src/features/modals/index.ts";
import { I18nProvider } from "../../src/i18n/index.ts";
import { useApp, type AppState } from "../../src/store/index.ts";
import { click, mount, type Mounted } from "../helpers/mount.ts";

const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
const TREE = "/Users/me/.lyra/worktrees/app-1a2b3c4d";
const WORKSPACE: WorkspaceInfo = { path: TREE, name: "app", isGitRepo: true, branch: "lyra/session-1a2b3c4d", worktreeOf: "/work/app" };

function meta(extra: Partial<SessionMeta> = {}): SessionMeta {
	return {
		id: "a", title: "做一个功能", cwd: TREE, projectId: "/work/app", projectName: "app", createdAt: 1, updatedAt: 2, modelId: "", messageCount: 4, seq: 1, usage,
		worktree: { project: "/work/app", branch: "lyra/session-1a2b3c4d", base: "main" },
		...extra,
	};
}

function state(extra: Partial<WorktreeState> = {}): WorktreeState {
	return { branch: "lyra/session-1a2b3c4d", base: "main", present: true, ahead: 2, behind: 1, uncommitted: 0, merging: false, conflicted: [], ...extra };
}

let current: WorktreeState;
let merges: string[];
let syncs: string[];
let aborts: string[];
let mergeOutcome: MergeOutcome;
let syncOutcome: SyncOutcome;
let sent: Array<{ content: UserContent[]; sessionId?: string | null }>;
let archived: Array<[string, boolean]>;
let previous: AppState;
let views: Mounted[];

beforeEach(() => {
	current = state();
	merges = [];
	syncs = [];
	aborts = [];
	mergeOutcome = { kind: "merged", commits: 2, base: "main" };
	syncOutcome = { kind: "synced", commits: 1, base: "main" };
	sent = [];
	archived = [];
	views = [];
	previous = useApp.getState();
	Object.defineProperty(window, "lyra", {
		configurable: true,
		value: {
			platform: "darwin",
			worktree: {
				state: async () => current,
				merge: async (id: string) => {
					merges.push(id);
					return mergeOutcome;
				},
				sync: async (id: string) => {
					syncs.push(id);
					return syncOutcome;
				},
				abortSync: async (id: string) => {
					aborts.push(id);
					current = state({ merging: false, conflicted: [] });
					return true;
				},
			},
			git: { generalScratch: async () => "/scratch", stat: async () => ({ added: 0, removed: 0, files: 0 }), branches: async () => ({ local: [], remote: [], current: null }) },
			workspace: { info: async () => WORKSPACE, reveal: async () => {} },
			sessions: {
				transcript: async (): Promise<SessionSnapshot | null> => null,
				capabilities: async () => null,
				contextBreakdown: async () => null,
			},
			subAgents: { list: async () => [] },
			commands: { list: async () => ({ commands: [], skills: [], agents: [] }) },
			delivery: { get: async () => null },
		},
	});
	useApp.setState({
		activeSessionId: "a", pendingSessionId: null, meta: meta(), messages: [], toolRuns: {}, running: false,
		workspace: WORKSPACE, scratchCwd: null, scratchRoots: ["/scratch"], settings: null, switchingBranch: null,
		sessions: [meta()], sessionCache: {}, workspaceByPath: {},
		activity: {}, turns: {}, carried: {}, queued: {}, drafts: {}, notices: [], view: "chat",
		send: async (content: UserContent[], options?: { sessionId?: string | null }) => {
			sent.push({ content, sessionId: options?.sessionId });
			return true;
		},
		setSessionArchived: async (one: SessionMeta, value: boolean) => {
			archived.push([one.id, value]);
		},
	});
});

afterEach(async () => {
	for (const view of views) await view.unmount();
	useApp.setState(previous, true);
	Reflect.deleteProperty(window, "lyra");
});

async function settle() {
	for (let i = 0; i < 6; i++) await act(async () => {});
}

async function composer(): Promise<Mounted> {
	const view = await mount(h(I18nProvider, { locale: "zh-CN", children: h(LayoutProvider, { children: h(SessionScope.Provider, { value: "a" }, h(Composer)) }) }));
	views.push(view);
	await settle();
	return view;
}

const chipOf = (view: Mounted) => view.all<HTMLButtonElement>("button[aria-haspopup='menu']").find((one) => one.textContent?.includes("lyra/session-1a2b3c4d"));
/** The menu draws in a portal on the body. */
const menuText = () => (document.querySelector("[aria-label='工作树']")?.textContent ?? "").replace(/\s+/g, " ");
const item = (label: string) => [...document.querySelectorAll<HTMLButtonElement>("[role='menuitem']")].find((one) => one.textContent?.includes(label));

async function openMenu(view: Mounted) {
	const chip = chipOf(view);
	assert.ok(chip, `no worktree chip: ${view.text().slice(0, 300)}`);
	await click(chip);
	await settle();
}

test("工作树会话的 chip 说分支和领先落后，不再是能切分支的那颗", async () => {
	const view = await composer();
	const chip = chipOf(view);
	assert.ok(chip, `no worktree chip: ${view.text().slice(0, 300)}`);
	assert.equal(chip.querySelector("[data-ly-worktree-marks]")?.textContent, "↑2↓1");
	assert.equal(chip.getAttribute("data-ly-tip"), "这个对话的工作树：lyra/session-1a2b3c4d");
	await openMenu(view);
	assert.ok(!document.querySelector("[aria-label='切换分支']"), "the branch switcher opened instead");
	assert.match(menuText(), /从 main 切出 · 领先 2 · 落后 1/);
});

test("合并：结果留在菜单里，顺手可以归档这个对话", async () => {
	const view = await composer();
	await openMenu(view);
	const merge = item("合并到 main");
	assert.ok(merge && !merge.disabled, "merge is not on offer");
	await click(merge);
	await settle();
	assert.deepEqual(merges, ["a"]);
	assert.equal(document.querySelector("[data-ly-worktree-note]")?.textContent, "已把 2 个提交合并到 main归档这个对话");
	const archive = item("归档这个对话");
	assert.ok(archive, "no archive offer after merging");
	await click(archive);
	assert.deepEqual(archived, [["a", true]]);
});

test("合并有冲突：说出文件和下一步，不是一句失败", async () => {
	mergeOutcome = { kind: "conflict", files: ["README.md", "src/a.ts"], base: "main" };
	const view = await composer();
	await openMenu(view);
	await click(item("合并到 main")!);
	await settle();
	const note = document.querySelector("[data-ly-worktree-note]");
	assert.equal(note?.getAttribute("data-ly-worktree-note"), "warn");
	assert.match(note?.textContent ?? "", /README\.md, src\/a\.ts。先从 main 同步/);
});

test("有没提交的改动、对话在运行：合并点不了，并说为什么", async () => {
	current = state({ uncommitted: 3 });
	const view = await composer();
	await openMenu(view);
	assert.ok(item("合并到 main")?.disabled);
	assert.match(item("合并到 main")?.textContent ?? "", /先提交 3 个文件的改动/);
	assert.match(menuText(), /3 个文件未提交/);
	await view.unmount();
	views = [];
	document.body.replaceChildren();

	current = state();
	useApp.setState({ running: true });
	const busy = await composer();
	await openMenu(busy);
	assert.ok(item("合并到 main")?.disabled);
	assert.ok(item("从 main 同步")?.disabled);
	assert.match(item("合并到 main")?.textContent ?? "", /对话还在运行/);
});

test("同步卡在冲突上：列出文件，交给这个对话解决，或者放弃这次同步", async () => {
	current = state({ merging: true, conflicted: ["README.md"] });
	const view = await composer();
	assert.ok(chipOf(view)?.querySelector("[data-ly-worktree-marks] svg"), "the chip carries no conflict mark");
	await openMenu(view);
	assert.match(menuText(), /同步 main 时有冲突/);
	assert.equal(document.querySelector("[data-ly-worktree-conflicts]")?.textContent, "README.md");
	assert.ok(!item("从 main 同步"), "a second sync offered over the one waiting");
	await click(item("交给这个对话解决")!);
	await settle();
	assert.equal(sent.length, 1);
	assert.equal(sent[0].sessionId, "a", "sent to another conversation");
	const text = sent[0].content[0]?.type === "text" ? sent[0].content[0].text : "";
	assert.match(text, /README\.md/);

	await openMenu(view);
	await click(item("放弃这次同步")!);
	await settle();
	assert.deepEqual(aborts, ["a"]);
	assert.ok(item("从 main 同步"), "sync is not back once the conflict was abandoned");
});

test("工作树目录收回去了：chip 变灰，合并照样能点，同步要等目录回来", async () => {
	current = state({ present: false, behind: 0 });
	const view = await composer();
	assert.match(chipOf(view)?.className ?? "", /text-ink-muted/);
	await openMenu(view);
	assert.match(menuText(), /目录已移除，提交都在分支上/);
	assert.ok(!item("合并到 main")?.disabled);
	assert.match(item("从 main 同步")?.textContent ?? "", /工作树目录已移除/);
	assert.ok(item("在访达中显示")?.disabled);
});

test("没建成工作树：同一个位置留一个提醒，点开是原因", async () => {
	useApp.setState({
		meta: meta({ worktree: undefined, cwd: "/work/app", worktreeError: "fatal: invalid reference: main" }),
		workspace: { path: "/work/app", name: "app", isGitRepo: true, branch: "main" },
	});
	const view = await composer();
	assert.ok(!chipOf(view), "a worktree chip for a conversation without one");
	const mark = view.host.querySelector<HTMLButtonElement>("[data-ly-worktree-failed]");
	assert.ok(mark, "no reminder that the worktree was not made");
	await click(mark);
	await settle();
	const note = document.querySelector("[data-ly-worktree-failed-note]");
	assert.match(note?.textContent ?? "", /直接在项目目录里运行/);
	assert.match(note?.textContent ?? "", /fatal: invalid reference: main/);
});

test("删除确认：说出工作树里留下的东西", async () => {
	current = state({ uncommitted: 2, ahead: 3 });
	const asked = await deleteSessionQuestion(meta(), () => {});
	const view = await mount(h("p", null, asked.detail));
	views.push(view);
	assert.match(view.text(), /工作树里还有 2 个文件没提交，会留在 ~\/\.lyra\/worktrees\/app-1a2b3c4d。/, "the home folder written as ~");
	assert.match(view.text(), /分支 lyra\/session-1a2b3c4d 上有 3 个提交没合并，分支会留着。/);

	current = state({ ahead: 0 });
	const clean = await deleteSessionQuestion(meta(), () => {});
	const cleanView = await mount(h("p", null, clean.detail));
	views.push(cleanView);
	assert.match(cleanView.text(), /它的工作树会一起移除。/);

	const plain = await deleteSessionQuestion(meta({ worktree: undefined }), () => {});
	assert.equal(typeof plain.detail, "string", "a conversation without a worktree asks as before");
});
