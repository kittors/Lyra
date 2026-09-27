/**
 * The project row above each screen's composer names that screen's project.
 *
 * It read `workspace`, which belongs to the live slot — the focused conversation. With two projects
 * side by side, the screen without focus wore the other one's project and branch, and swapped them
 * every time focus moved (measured in a real window: `e2e/split-scope-probe.ts project`). The website
 * script kept its split screenshot to one project to hide it. The blank screen was the same: opened
 * in alpha, it asked 「要在 beta-lib 内开发什么？」 as soon as beta took focus beside it.
 */

import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { act, createElement as h } from "react";
import type { Message, SessionMeta } from "@lyra/core";
import type { SessionSnapshot, WorkspaceInfo } from "../../electron/ipc-types.ts";
import { SessionScope } from "../../src/app/session-scope.tsx";
import { LayoutProvider } from "../../src/app/layout.tsx";
import { Composer } from "../../src/features/composer/Composer.tsx";
import { EmptyState } from "../../src/features/conversation/EmptyState.tsx";
import { I18nProvider } from "../../src/i18n/index.ts";
import { useApp, type AppState } from "../../src/store/index.ts";
import { mount, type Mounted } from "../helpers/mount.ts";

const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };

const ALPHA: WorkspaceInfo = { path: "/work/alpha", name: "alpha-app", isGitRepo: true, branch: "main" };
const BETA: WorkspaceInfo = { path: "/work/beta", name: "beta-lib", isGitRepo: true, branch: "beta-work" };

function meta(id: string, project: WorkspaceInfo): SessionMeta {
	return { id, title: id, cwd: project.path, projectId: project.path, projectName: project.name, createdAt: 1, updatedAt: 2, modelId: "", messageCount: 2, seq: 3, usage };
}

const A = meta("a", ALPHA);
const B = meta("b", BETA);
const said = (id: string): Message[] => [
	{ role: "user", content: [{ type: "text", text: `${id}'s question` }], timestamp: 1 },
	{ role: "assistant", content: [{ type: "text", text: `${id}'s answer` }], api: "anthropic-messages", provider: "t", model: "t", usage, stopReason: "stop", timestamp: 2 },
];

let infoReads: string[];
let previous: AppState;
let view: Mounted | undefined;

beforeEach(() => {
	infoReads = [];
	previous = useApp.getState();
	Object.defineProperty(window, "lyra", {
		configurable: true,
		value: {
			workspace: {
				info: async (path: string) => {
					infoReads.push(path);
					return [ALPHA, BETA].find((one) => one.path === path) ?? null;
				},
			},
			sessions: {
				transcript: async (_projectId: string, id: string): Promise<SessionSnapshot> => ({ meta: id === "a" ? A : B, messages: said(id), running: false, pendingApprovals: [] }),
				capabilities: async () => null,
				contextBreakdown: async () => null,
			},
			subAgents: { list: async () => [] },
			commands: { list: async () => ({ commands: [], skills: [], agents: [] }) },
			git: { stat: async () => ({ added: 0, removed: 0, files: 0 }) },
		},
	});
	useApp.setState({
		activeSessionId: null, pendingSessionId: null, meta: null, messages: [], toolRuns: {}, running: false,
		workspace: null, scratchCwd: null, scratchRoots: ["/scratch"], settings: null,
		sessions: [A, B], sessionCache: {}, activity: {}, turns: {}, carried: {}, queued: {}, drafts: {}, notices: [], view: "chat",
	});
});

afterEach(async () => {
	await view?.unmount();
	view = undefined;
	useApp.setState(previous, true);
});

/** Opened the way a click opens it, with the project it runs in arriving after the transcript. */
async function open(one: SessionMeta): Promise<void> {
	await useApp.getState().openSession(one);
	await act(async () => {});
}

/** One screen per conversation, each drawing its own composer — what `SplitPane` gives them. */
async function screens(ids: Array<string | null>, body: typeof Composer | typeof EmptyState = Composer): Promise<Mounted> {
	return mount(
		h(I18nProvider, {
			locale: "zh-CN",
			children: h(LayoutProvider, {
				children: ids.map((id) => h(SessionScope.Provider, { key: id ?? "@draft", value: id }, h("section", { "data-screen": id ?? "@draft" }, h(body)))),
			}),
		}),
	);
}

/** The project and branch chips on one screen, by their icons — what the row says, not what the store holds. */
function row(mounted: Mounted, id: string | null): { project: string | null; branch: string | null } {
	const screen = mounted.find(`[data-screen="${id ?? "@draft"}"]`);
	const buttons = [...screen.querySelectorAll<HTMLElement>("button[aria-haspopup='menu']")];
	const chip = (icon: string) => buttons.find((button) => button.querySelector(`svg[class*="${icon}"]`))?.getAttribute("data-ly-tip") ?? null;
	return { project: chip("lucide-folder"), branch: chip("lucide-git-branch") };
}

test("each screen's row names its own project and branch, and keeps them when focus moves", async () => {
	await open(A);
	await open(B);
	view = await screens(["a", "b"]);
	assert.deepEqual(row(view, "a"), { project: "alpha-app", branch: "main" }, "the screen without focus wore the focused one's project");
	assert.deepEqual(row(view, "b"), { project: "beta-lib", branch: "beta-work" });

	await act(async () => open(A));
	assert.deepEqual(row(view, "a"), { project: "alpha-app", branch: "main" });
	assert.deepEqual(row(view, "b"), { project: "beta-lib", branch: "beta-work" }, "focus moved, and the row on the other screen went with it");
});

test("a screen whose conversation never held the live slot reads its own project once", async () => {
	// Restored beside another after a restart, or warmed in: only its transcript was ever read.
	await open(B);
	infoReads.length = 0;
	view = await screens(["a", "b"]);
	await act(async () => {});
	assert.deepEqual(row(view, "a"), { project: "alpha-app", branch: "main" });
	assert.deepEqual(infoReads, [ALPHA.path], "read once, for the project nobody had described yet");
});

test("a blank screen keeps asking about the project it was opened in", async () => {
	// 新对话 in alpha, then beta dragged in beside it and holding focus.
	useApp.setState({ workspace: ALPHA });
	await open(B);
	view = await screens([null], EmptyState);
	assert.match(view.find('[data-screen="@draft"] h1').textContent ?? "", /alpha-app/, "the headline asked about beta-lib");
	assert.deepEqual(row(view, null), { project: "alpha-app", branch: "main" });
});
