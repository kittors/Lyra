/**
 * The branch menu under a screen lists, and switches, that screen's repository.
 *
 * Measured in a real window (`e2e/split-scope-more-probe.ts branch`): with focus on 甲 (alpha-app),
 * the branch chip under 乙 (beta-lib), reached by keyboard, opened a menu listing alpha-app's
 * branches, and choosing one ran `git switch` in alpha-app — the repository of the conversation
 * beside it. The menu read the live slot's project, which describes only the focused screen.
 *
 * The chip's busy mark had the same fault in a milder form: one flag for the window, so a switch in
 * one screen pulsed the branch chip of every screen.
 */

import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { act, createElement as h } from "react";
import type { SessionMeta } from "@lyra/core";
import type { SessionSnapshot, WorkspaceInfo } from "../../electron/ipc-types.ts";
import type { BranchList } from "../../electron/git.ts";
import { LayoutProvider } from "../../src/app/layout.tsx";
import { SessionScope } from "../../src/app/session-scope.tsx";
import { Composer } from "../../src/features/composer/Composer.tsx";
import { BranchMenu } from "../../src/features/modals/BranchMenu.tsx";
import { I18nProvider } from "../../src/i18n/index.ts";
import { useApp, type AppState } from "../../src/store/index.ts";
import { click, mount, type Mounted } from "../helpers/mount.ts";

const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
const ALPHA: WorkspaceInfo = { path: "/work/alpha", name: "alpha-app", isGitRepo: true, branch: "main" };
const BETA: WorkspaceInfo = { path: "/work/beta", name: "beta-lib", isGitRepo: true, branch: "beta-work" };
const BRANCHES: Record<string, string[]> = { [ALPHA.path]: ["main", "alpha-feature"], [BETA.path]: ["beta-work", "beta-feature"] };

function meta(id: string, project: WorkspaceInfo): SessionMeta {
	return { id, title: id, cwd: project.path, projectId: project.path, projectName: project.name, createdAt: 1, updatedAt: 2, modelId: "", messageCount: 0, seq: 1, usage };
}

let asked: string[];
let switched: Array<[string, string]>;
let heads: Record<string, string>;
/** Holds `git switch` open until a test lets it finish, so what the chips show meanwhile can be read. */
let release: (() => void) | null;
let previous: AppState;
let views: Mounted[];

beforeEach(() => {
	asked = [];
	switched = [];
	heads = { [ALPHA.path]: "main", [BETA.path]: "beta-work" };
	release = null;
	views = [];
	previous = useApp.getState();
	Object.defineProperty(window, "lyra", {
		configurable: true,
		value: {
			git: {
				branches: async (path: string): Promise<BranchList> => {
					asked.push(path);
					return { local: BRANCHES[path] ?? [], remote: [], current: heads[path] ?? null };
				},
				switchBranch: async (path: string, branch: string) => {
					switched.push([path, branch]);
					await new Promise<void>((resolve) => (release = resolve));
					heads[path] = branch;
					return { ok: true };
				},
				generalScratch: async () => "/scratch",
				stat: async () => ({ added: 0, removed: 0, files: 0 }),
			},
			workspace: {
				info: async (path: string) => {
					const project = [ALPHA, BETA].find((one) => one.path === path);
					return project ? { ...project, branch: heads[path] } : null;
				},
			},
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
	// 甲 holds the live slot in alpha; 乙, beside it, is named from what beta was when it left the slot.
	useApp.setState({
		activeSessionId: "a", pendingSessionId: null, meta: meta("a", ALPHA), messages: [], toolRuns: {}, running: false,
		workspace: ALPHA, scratchCwd: null, scratchRoots: ["/scratch"], settings: null, switchingBranch: null,
		sessions: [meta("a", ALPHA), meta("b", BETA)], sessionCache: {}, workspaceByPath: { [BETA.path]: BETA },
		activity: {}, turns: {}, carried: {}, queued: {}, drafts: {}, notices: [], view: "chat",
	});
});

afterEach(async () => {
	release?.();
	for (const view of views) await view.unmount();
	useApp.setState(previous, true);
	Reflect.deleteProperty(window, "lyra");
});

async function menuIn(id: string): Promise<Mounted> {
	const view = await mount(h(I18nProvider, { locale: "zh-CN", children: h(SessionScope.Provider, { value: id }, h(BranchMenu, { anchor: { x: 20, y: 20 }, onClose: () => {} })) }));
	views.push(view);
	await act(async () => {});
	return view;
}

/** The menu's rows, which it draws in a portal on the body rather than inside the view. */
const rows = () => [...document.querySelectorAll<HTMLElement>('[role="menuitem"][data-ly-tip]')];
const names = () => rows().map((row) => row.getAttribute("data-ly-tip"));

test("the menu under a screen without focus lists that screen's branches", async () => {
	await menuIn("b");
	assert.deepEqual(asked, [BETA.path], "asked git for the focused conversation's repository");
	assert.deepEqual(names(), BRANCHES[BETA.path], "listed the branches of the repository beside it");
});

test("choosing a branch there switches that screen's repository, and that screen reads the new branch", async () => {
	await menuIn("b");
	const row = rows().find((one) => one.getAttribute("data-ly-tip") === "beta-feature");
	assert.ok(row, `no beta-feature row: ${JSON.stringify(names())}`);
	await click(row);
	release?.();
	for (let i = 0; i < 5; i++) await act(async () => {});
	assert.deepEqual(switched, [[BETA.path, "beta-feature"]], "ran git switch in the focused conversation's repository");
	assert.equal(useApp.getState().workspaceByPath[BETA.path]?.branch, "beta-feature", "the screen's project still names the branch it left");
	assert.equal(useApp.getState().workspace?.branch, "main", "the focused conversation's project moved branch");
});

test("two screens on one repository both read the branch it switched to", async () => {
	// 乙 in alpha as well: the same repository under both screens, the live slot's copy and the map's.
	useApp.setState({ sessions: [meta("a", ALPHA), meta("b", ALPHA)], workspaceByPath: { [ALPHA.path]: ALPHA } });
	await menuIn("b");
	const row = rows().find((one) => one.getAttribute("data-ly-tip") === "alpha-feature");
	assert.ok(row, `no alpha-feature row: ${JSON.stringify(names())}`);
	await click(row);
	release?.();
	for (let i = 0; i < 5; i++) await act(async () => {});
	assert.deepEqual(switched, [[ALPHA.path, "alpha-feature"]]);
	assert.equal(useApp.getState().workspace?.branch, "alpha-feature", "the focused screen still shows the branch the repository left");
	assert.equal(useApp.getState().workspaceByPath[ALPHA.path]?.branch, "alpha-feature");
});

test("while a switch runs, only the chip of the screen it runs in says so", async () => {
	const composer = async (id: string) => {
		const view = await mount(h(I18nProvider, { locale: "zh-CN", children: h(LayoutProvider, { children: h(SessionScope.Provider, { value: id }, h(Composer)) }) }));
		views.push(view);
		return view;
	};
	const a = await composer("a");
	const b = await composer("b");
	await act(async () => {});
	const chip = (view: Mounted, branch: string) => view.all<HTMLButtonElement>("button[aria-haspopup='menu']").find((one) => one.textContent?.includes(branch));
	const chipB = chip(b, "beta-work");
	assert.ok(chipB, `no branch chip under 乙: ${b.text().slice(0, 200)}`);
	await click(chipB);
	await act(async () => {});
	const row = rows().find((one) => one.getAttribute("data-ly-tip") === "beta-feature");
	assert.ok(row, `the menu under 乙 offered no beta-feature: ${JSON.stringify(names())}`);
	await click(row);
	// `git switch` is still running here.
	assert.equal(chip(b, "beta-work")?.getAttribute("aria-busy"), "true", "the switching screen's chip is not marked busy");
	assert.equal(chip(a, "main")?.getAttribute("aria-busy"), null, "the chip of the screen beside it pulsed as well");
});
