/**
 * Everything that opens a panel from inside a screen opens it in that screen, for that screen's
 * conversation.
 *
 * A split window shows up to four conversations. The store's live slot describes only the focused
 * one, and `openScopedPanel` without a target opens in the focused screen. A press on a screen
 * focuses it first, so the mouse happened to be right; the keyboard reaches a control in another
 * screen without that press (Tab, then Enter), and every entry point below opened its panel beside
 * the conversation that had focus. Measured in a real window (`e2e/split-scope-more-probe.ts
 * links`): a relative link in the other screen opened the focused screen's project file, in the
 * focused screen, and 「在终端运行」 there opened the terminal in the focused screen.
 *
 * Some hand the panel something to do as well, and that followed the focus too: the command ran in
 * the shell of the conversation beside it, and a page became that conversation's tab.
 *
 * Every test stages the same split: 甲 (`a`, project alpha) holds the live slot and the focus; 乙
 * (`b`, project beta) is beside it, parked. The control is pressed inside 乙 without focusing it,
 * which is what the keyboard does.
 */

import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { act, createElement as h, Fragment, type ReactNode } from "react";
import { Terminal } from "@xterm/xterm";
import type { Message, SessionMeta, UserMessage as UserMessageType } from "@lyra/core";
import type { ContextBreakdown, WorkspaceInfo } from "../../electron/ipc-types.ts";
import type { TurnDelivery } from "../../electron/turn-delivery.ts";
import type { BrowserCommand, BrowserTab } from "../../shared/browser.ts";
import { LayoutProvider } from "../../src/app/layout.tsx";
import { DockScope, SessionScope } from "../../src/app/session-scope.tsx";
import { useBrowser, useBrowserWorkspace } from "../../src/features/browser/browser-store.ts";
import { Composer } from "../../src/features/composer/Composer.tsx";
import { ContextMemoryFiles } from "../../src/features/composer/ContextMemoryFiles.tsx";
import { QueuedMessages } from "../../src/features/composer/QueuedMessages.tsx";
import { CodeBlock } from "../../src/features/conversation/CodeBlock.tsx";
import { Markdown } from "../../src/features/conversation/Markdown.tsx";
import { TurnDeliveryCard } from "../../src/features/conversation/TurnDelivery.tsx";
import { UserMessage } from "../../src/features/conversation/UserMessage.tsx";
import { showTrace } from "../../src/features/conversation/trajectory/navigation.ts";
import { TrajectoryPanel } from "../../src/features/conversation/trajectory/TrajectoryPanel.tsx";
import { usePaneDock } from "../../src/features/dock/pane-store.ts";
import { provideScope } from "../../src/features/dock/popout.ts";
import { useSide } from "../../src/features/dock/sideStore.ts";
import { has, type PaneKind } from "../../src/features/dock/tree.ts";
import { FileTree } from "../../src/features/files/FileTree.tsx";
import { PreviewCard } from "../../src/features/files/PreviewCard.tsx";
import { SideComposer } from "../../src/features/sidechat/SideComposer.tsx";
import { RunDetail } from "../../src/features/task/RunDetail.tsx";
import { TerminalPane } from "../../src/features/terminal/TerminalPane.tsx";
import { I18nProvider } from "../../src/i18n/index.ts";
import { useApp, type AppState, type ToolRun } from "../../src/store/index.ts";
import type { Cache } from "../../src/store/derive.ts";
import { useOpenFile } from "../../src/store/openFile.ts";
import { useTerminals } from "../../src/store/terminals.ts";
import { click, fire, mount, type Mounted } from "../helpers/mount.ts";

/*
 * The stubbed xterm (`helpers/assets-hooks.mjs`) has what the typography tests needed; a mounted pane
 * also resets, focuses and listens to it.
 */
Object.assign(Terminal.prototype, { reset() {}, focus() {}, onData: () => ({ dispose() {} }), hasSelection: () => false, cols: 80, rows: 24 });

const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
const ALPHA: WorkspaceInfo = { path: "/work/alpha", name: "alpha-app", isGitRepo: true, branch: "main" };
const BETA: WorkspaceInfo = { path: "/work/beta", name: "beta-lib", isGitRepo: true, branch: "beta-work" };
const ROOMY = { width: 1200, height: 900 };

function meta(id: string, cwd: string, name = cwd): SessionMeta {
	return { id, title: id, cwd, projectId: cwd, projectName: name, createdAt: 1, updatedAt: 2, modelId: "", messageCount: 2, seq: 3, usage };
}
const said = (id: string): Message[] => [
	{ role: "user", content: [{ type: "text", text: `${id} 的问题` }], timestamp: 1 },
	{ role: "assistant", content: [{ type: "text", text: `${id} 的回答` }], api: "anthropic-messages", provider: "t", model: "t", usage, stopReason: "stop", timestamp: 2 },
];
function parked(id: string, cwd: string): Cache[string] {
	return { meta: meta(id, cwd), messages: said(id), toolRuns: {}, state: { running: false, approvals: [], todos: [], compactions: [], commandRuns: [], hiccups: [], stopped: null, retrying: null, capabilities: null, pendingUserMessage: null } };
}

/** The paths handed to the window's one open-file store. */
let opened: string[];
let lyra: Record<string, unknown>;
let previous: {
	app: AppState;
	file: ReturnType<typeof useOpenFile.getState>;
	side: ReturnType<typeof useSide.getState>;
	terminals: ReturnType<typeof useTerminals.getState>;
	browser: ReturnType<typeof useBrowser.getState>;
};
let view: Mounted | undefined;

beforeEach(() => {
	opened = [];
	previous = { app: useApp.getState(), file: useOpenFile.getState(), side: useSide.getState(), terminals: useTerminals.getState(), browser: useBrowser.getState() };
	lyra = { system: { openTargets: async () => [], pathExists: async () => true } };
	Object.defineProperty(window, "lyra", { configurable: true, value: lyra });
	// 甲 holds the live slot in alpha; 乙, beside it, left the live slot earlier and is parked in beta.
	useApp.setState({
		activeSessionId: "a", pendingSessionId: null, meta: meta("a", ALPHA.path, ALPHA.name), messages: said("a"), toolRuns: {}, running: false, stopped: null,
		workspace: ALPHA, scratchCwd: null, scratchRoots: ["/scratch"], parkedDraft: null,
		sessions: [meta("a", ALPHA.path, ALPHA.name), meta("b", BETA.path, BETA.name)], sessionCache: { b: parked("b", BETA.path) }, workspaceByPath: { [BETA.path]: BETA },
		activity: {}, turns: {}, queued: {}, drafts: {}, notices: [],
		settings: { projects: [{ path: ALPHA.path, name: ALPHA.name }, { path: BETA.path, name: BETA.name }], editor: {}, browser: { openLinks: "builtin" } } as unknown as AppState["settings"],
		notify: () => {},
	});
	useOpenFile.setState({ open: async (entry) => { opened.push(entry.path); } });
	useTerminals.setState({ tabs: [], active: "", activeByScope: {} });
	useBrowser.setState({ tabs: [], activeId: null });
	window.localStorage.clear();
	usePaneDock.setState({ trees: {}, sizes: {}, drag: null, maximized: {}, focused: {}, crossRatio: {}, host: null });
	// Both screens measured, focus on 甲's — what `SplitWorkspace` reports for this split.
	usePaneDock.getState().rememberSize("a", ROOMY);
	usePaneDock.getState().rememberSize("b", ROOMY);
	provideScope(() => "a");
});

afterEach(async () => {
	await view?.unmount();
	view = undefined;
	// Whole states back, stand-in actions included, so nothing leaks into the next test.
	useApp.setState(previous.app, true);
	useOpenFile.setState(previous.file, true);
	useSide.setState(previous.side, true);
	useTerminals.setState(previous.terminals, true);
	useBrowser.setState(previous.browser, true);
	provideScope(() => null);
	Reflect.deleteProperty(window, "lyra");
});

/** What sits inside one screen: its dock and its conversation, both named. */
function screen(id: string, ...body: ReactNode[]): ReactNode {
	return h(DockScope.Provider, { value: id }, h(SessionScope.Provider, { value: id }, ...body));
}

function inWindow(...parts: ReactNode[]): Promise<Mounted> {
	return mount(h(I18nProvider, { locale: "zh-CN", children: h(LayoutProvider, { children: h(Fragment, null, ...parts) }) }));
}

const inScreen = (id: string, ...body: ReactNode[]) => inWindow(screen(id, ...body));

/** Which of the two screens has this panel in its dock. */
function openedIn(kind: PaneKind): { a: boolean; b: boolean } {
	const dock = usePaneDock.getState();
	return { a: has(dock.tree("a"), kind), b: has(dock.tree("b"), kind) };
}

/** Let what a press started come back, and React draw what it did. */
async function settle(ms = 0): Promise<void> {
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, ms));
	});
}

async function until(done: () => boolean): Promise<void> {
	for (let round = 0; round < 40 && !done(); round++) await settle(5);
}

/** A row of a menu, which draws into a portal outside the mounted tree. */
function menuItem(label: string): HTMLElement {
	const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((element) => element.textContent === label);
	assert.ok(item, `no menu row 「${label}」`);
	return item;
}

function buttonText(label: string): HTMLElement {
	const found = [...document.querySelectorAll<HTMLElement>("button")].find((element) => element.textContent?.trim() === label);
	assert.ok(found, `no button 「${label}」`);
	return found;
}

/*
 * The main process's half of the browser, as far as these tests need it: an opened page becomes a
 * tab of the conversation it was opened for, and a page a person opened is revealed.
 */
function fakeBrowser() {
	const commands: BrowserCommand[] = [];
	const listeners = new Set<(state: { tabs: BrowserTab[]; activeId: string | null; reveal?: boolean }) => void>();
	const tabs: BrowserTab[] = [];
	return {
		opened: () => commands.flatMap((command) => (command.type === "open" ? [{ url: command.url, sessionId: command.sessionId }] : [])),
		api: {
			onChanged: (listener: (state: { tabs: BrowserTab[]; activeId: string | null; reveal?: boolean }) => void) => {
				listeners.add(listener);
				return () => listeners.delete(listener);
			},
			state: async () => ({ tabs, activeId: null }),
			command: async (command: BrowserCommand) => {
				commands.push(command);
				if (command.type !== "open") return { tabs, activeId: null };
				const tab: BrowserTab = { id: `tab-${tabs.length + 1}`, sessionId: command.sessionId, url: command.url, title: "", loading: false, canGoBack: false, canGoForward: false, zoom: 1, viewport: null };
				tabs.push(tab);
				for (const listener of listeners) listener({ tabs: [...tabs], activeId: tab.id, reveal: true });
				return { tabs: [...tabs], activeId: tab.id };
			},
		},
	};
}

/** The one listener the app window keeps on the browser — see `useBrowserWorkspace`. */
function BrowserWorkspace() {
	useBrowserWorkspace();
	return null;
}

/** Each project's shell, already running; what was typed into which. */
function fakeShells() {
	const written: Array<[string, string]> = [];
	const attached: string[] = [];
	const tabs = [{ id: "sh-alpha", title: "zsh" }, { id: "sh-beta", title: "zsh" }];
	const byDirectory: Record<string, string> = { [ALPHA.path]: "sh-alpha", [BETA.path]: "sh-beta" };
	return {
		written,
		attached,
		api: {
			onExit: () => () => {},
			onData: () => () => {},
			listAll: async () => tabs,
			list: async (cwd: string) => tabs.filter((tab) => tab.id === byDirectory[cwd]),
			open: async (cwd: string) => ({ id: `sh-new:${cwd}`, title: "zsh" }),
			attach: async (id: string) => {
				attached.push(id);
				return { id, epoch: 1, replay: "" };
			},
			detach: () => {},
			resize: () => {},
			write: (id: string, data: string) => {
				written.push([id, data]);
			},
		},
	};
}

/** A screen's terminal pane, drawn once its dock holds one — what `DockView` does for a panel. */
function DockedTerminal({ screen: key }: { screen: string }) {
	const open = usePaneDock((state) => has(state.tree(key), "terminal"));
	return open ? h(TerminalPane) : null;
}

// ─── The transcript ────────────────────────────────────────────────────────────────────────────

test("a relative file link on the screen without focus opens that screen's project file, in that screen", async () => {
	view = await inScreen("b", h(Markdown, { text: "看这个文件：[README.md](README.md)" }));
	await click(view.find("[data-ly-file-link] a"));
	assert.deepEqual(opened, ["/work/beta/README.md"], "resolved against the project of the screen with focus");
	assert.deepEqual(openedIn("file"), { a: false, b: true }, "the file pane opened beside the conversation with focus");
});

test("a web link on the screen without focus opens in that conversation's browser, in that screen", async () => {
	const browser = fakeBrowser();
	lyra.browser = browser.api;
	view = await inWindow(h(BrowserWorkspace), screen("b", h(Markdown, { text: "文档在[这里](https://example.com/docs)" })));
	await click(view.find('a[href="https://example.com/docs"]'));
	await settle();
	assert.deepEqual(browser.opened(), [{ url: "https://example.com/docs", sessionId: "b" }], "the page became a tab of the conversation with focus");
	assert.deepEqual(openedIn("browser"), { a: false, b: true }, "the browser opened beside the conversation with focus");
});

test("「在终端运行」 on the screen without focus opens the terminal in that screen", async () => {
	view = await inScreen("b", h(CodeBlock, { lang: "bash", code: "$ pwd" }));
	await click(view.find('button[data-ly-tip="在终端运行"]'));
	assert.deepEqual(openedIn("terminal"), { a: false, b: true }, "the terminal opened beside the conversation with focus");
});

test("「在终端运行」 on the screen without focus runs in that screen's shell, not in the terminal open beside it", async () => {
	const shells = fakeShells();
	lyra.terminal = shells.api;
	// 甲 already has its terminal open and connected; 乙's opens when the button asks for it.
	usePaneDock.getState().open("a", "terminal");
	view = await inWindow(screen("a", h(DockedTerminal, { screen: "a" })), screen("b", h(CodeBlock, { lang: "bash", code: "pwd" }), h(DockedTerminal, { screen: "b" })));
	await until(() => shells.attached.includes("sh-alpha"));
	await click(view.find('button[data-ly-tip="在终端运行"]'));
	await until(() => shells.written.length > 0);
	// Long enough for any other terminal that was going to take it as well.
	await settle(30);
	assert.deepEqual(shells.written, [["sh-beta", "pwd\r"]], "the command ran in the shell of the conversation with focus");
});

// What did not change: the screen with focus asking, or nobody naming a screen, and exactly one shell runs it.
test("with the focus on the screen pressed, or a command that names no screen, the focused terminal runs it once", async () => {
	const shells = fakeShells();
	lyra.terminal = shells.api;
	usePaneDock.getState().open("a", "terminal");
	usePaneDock.getState().open("b", "terminal");
	view = await inWindow(screen("a", h(CodeBlock, { lang: "bash", code: "ls" }), h(DockedTerminal, { screen: "a" })), screen("b", h(DockedTerminal, { screen: "b" })));
	await until(() => shells.attached.includes("sh-alpha") && shells.attached.includes("sh-beta"));
	await click(view.find('button[data-ly-tip="在终端运行"]'));
	await until(() => shells.written.length > 0);
	await settle(30);
	assert.deepEqual(shells.written, [["sh-alpha", "ls\r"]], "the screen with focus is the one that asked");

	// Asked for by something outside any screen: the terminal with focus, as it always was.
	await act(async () => useSide.getState().runInTerminal("whoami"));
	await until(() => shells.written.length > 1);
	await settle(30);
	assert.deepEqual(shells.written, [["sh-alpha", "ls\r"], ["sh-alpha", "whoami\r"]]);
});

test("when the asking screen cannot take the terminal, the command follows the terminal to the screen that did", async () => {
	const shells = fakeShells();
	lyra.terminal = shells.api;
	usePaneDock.getState().open("a", "terminal");
	// 丙 is drawn but has not measured itself, so the request falls back to the screen with focus.
	useApp.setState({ sessions: [...useApp.getState().sessions, meta("c", BETA.path)], sessionCache: { ...useApp.getState().sessionCache, c: parked("c", BETA.path) } });
	view = await inWindow(screen("a", h(DockedTerminal, { screen: "a" })), screen("c", h(CodeBlock, { lang: "bash", code: "pwd" })));
	await until(() => shells.attached.includes("sh-alpha"));
	await click(view.find('button[data-ly-tip="在终端运行"]'));
	await until(() => shells.written.length > 0);
	await settle(30);
	assert.deepEqual(shells.written, [["sh-alpha", "pwd\r"]], "the command waited for a terminal in a screen that never got one");
});

test("a file named in a message on the screen without focus opens in that screen", async () => {
	lyra.files = { mediaUrl: (path: string) => `ly-media://f/${encodeURIComponent(path)}` };
	const message: UserMessageType = {
		role: "user",
		content: [{ type: "text", text: "看看 【notes.md】" }],
		displayText: "看看 【notes.md】",
		attachments: [{ name: "notes.md", label: "notes.md", kind: "text", path: "/work/beta/notes.md" }],
		timestamp: 1,
	};
	view = await inScreen("b", h(UserMessage, { message, index: 0 }));
	await click(view.find(".ly-attachment-token"));
	assert.deepEqual(opened, ["/work/beta/notes.md"]);
	assert.deepEqual(openedIn("file"), { a: false, b: true }, "the file pane opened beside the conversation with focus");
});

test("the skill a message used, on the screen without focus, is looked up in that conversation's directory and opens in that screen", async () => {
	const listed: string[] = [];
	lyra.commands = {
		list: async (cwd: string) => {
			listed.push(cwd);
			return { commands: [], agents: [], skills: [{ name: "deploy", description: "", source: "workspace", path: `${cwd}/.claude/skills/deploy/SKILL.md` }] };
		},
	};
	const message: UserMessageType = { role: "user", content: [{ type: "text", text: "上线" }], displayText: "上线", skillRef: { name: "deploy" }, timestamp: 1 };
	view = await inScreen("b", h(UserMessage, { message, index: 0 }));
	await click(view.find('button[data-ly-tip="在侧边栏打开技能文件"]'));
	await until(() => opened.length > 0);
	assert.deepEqual(listed, ["/work/beta"], "the skills were listed for the project of the screen with focus");
	assert.deepEqual(opened, ["/work/beta/.claude/skills/deploy/SKILL.md"]);
	assert.deepEqual(openedIn("file"), { a: false, b: true }, "the skill file opened beside the conversation with focus");
	await view.unmount();

	// A conversation in no project lists from its own directory, the same way.
	listed.length = 0;
	useApp.setState({ sessions: [...useApp.getState().sessions, meta("c", "/scratch/c")], sessionCache: { ...useApp.getState().sessionCache, c: parked("c", "/scratch/c") } });
	usePaneDock.getState().rememberSize("c", ROOMY);
	view = await inScreen("c", h(UserMessage, { message, index: 0 }));
	await click(view.find('button[data-ly-tip="在侧边栏打开技能文件"]'));
	await until(() => listed.length > 0);
	assert.deepEqual(listed, ["/scratch/c"]);
});

test("the delivery card on the screen without focus names files by that project and opens its panes in that screen", async () => {
	const delivery: TurnDelivery = {
		files: [{ path: "/work/beta/src/lib.ts", added: 3, removed: 1, hunks: [], changeIds: ["c1"], canUndo: true }],
		commands: [], serviceJobIds: [], warnings: [], reportPath: "/work/beta/.lyra/report.md",
	};
	lyra.delivery = { get: async () => delivery };
	view = await inScreen("b", h(TurnDeliveryCard, { timestamp: 2 }));
	await until(() => view!.all("[data-delivery-file]").length > 0);
	const row = view.find('[data-delivery-file="/work/beta/src/lib.ts"]');
	assert.equal((row.textContent ?? "").split("+")[0], "src/lib.ts", "the file was named against the project of the screen with focus");

	await click(buttonText("报告"));
	assert.deepEqual(opened, ["/work/beta/.lyra/report.md"]);
	assert.deepEqual(openedIn("file"), { a: false, b: true }, "the report opened beside the conversation with focus");
	await click(buttonText("审核"));
	assert.deepEqual(openedIn("delivery"), { a: false, b: true }, "the review opened beside the conversation with focus");
});

test("a preview on the screen without focus opens in that conversation's browser, in that screen", async () => {
	const browser = fakeBrowser();
	lyra.browser = browser.api;
	view = await inWindow(h(BrowserWorkspace), screen("b", h(PreviewCard, { preview: { id: "p1", sessionId: "b", title: "演示", entry: "index.html" } })));
	await click(view.find('button[aria-label="在侧栏中打开"]'));
	await settle();
	assert.deepEqual(browser.opened(), [{ url: "ly-preview://b/p1/index.html", sessionId: "b" }], "the page became a tab of the conversation with focus");
	assert.deepEqual(openedIn("browser"), { a: false, b: true }, "the browser opened beside the conversation with focus");
});

// ─── Panels and the composer ───────────────────────────────────────────────────────────────────

test("「在轨迹中查看」 opens the trace in the conversation's own screen, not the one with focus", () => {
	showTrace("b", "call-1");
	assert.deepEqual(openedIn("trajectory"), { a: false, b: true });
});

test("a tool run's raw output and its place in the trace, from the screen without focus, open in that screen", async () => {
	const exported: string[] = [];
	lyra.sessions = {
		exportTrajectory: async (_project: string, sessionId: string, format: string) => {
			exported.push(`${sessionId}:${format}`);
			return `/tmp/${sessionId}-${format}.txt`;
		},
	};
	const run: ToolRun = {
		toolCallId: "call-1", toolName: "bash", summary: "pwd", args: { command: "pwd" }, status: "done", startedAt: 1, finishedAt: 2,
		result: { content: [{ type: "text", text: "/work/beta" }], details: { outputPath: "/tmp/full.txt" } },
	};
	view = await inScreen("b", h(RunDetail, { run }));
	await click(view.find('button[aria-label="查看完整原始输出"]'));
	await until(() => openedIn("file").a || openedIn("file").b);
	assert.deepEqual(exported, ["b:output"]);
	assert.deepEqual(openedIn("file"), { a: false, b: true }, "the output opened beside the conversation with focus");
	await click(view.find('button[aria-label="在轨迹中查看这次调用"]'));
	assert.deepEqual(openedIn("trajectory"), { a: false, b: true }, "the trace opened beside the conversation with focus");
});

test("exporting from the trace panel of the screen without focus opens the file in that screen", async () => {
	lyra.sessions = {
		trajectoryChanges: async () => ({ cursor: "b:1", reset: true, upserts: [{ id: "one", seq: 1, ts: 1, source: "request", summary: "请求" }], removals: [] }),
		exportTrajectory: async (_project: string, sessionId: string, format: string) => `/tmp/${sessionId}.${format}`,
	};
	lyra.agent = { onEvent: () => () => {} };
	view = await inScreen("b", h(TrajectoryPanel));
	await settle();
	await click(view.find('button[aria-label="轨迹操作"]'));
	await click(menuItem("查看完整 Markdown 轨迹"));
	await until(() => openedIn("file").a || openedIn("file").b);
	assert.deepEqual(opened, ["/tmp/b.md"]);
	assert.deepEqual(openedIn("file"), { a: false, b: true }, "the export opened beside the conversation with focus");
});

test("a memory file in the context meter of the screen without focus opens in that screen", async () => {
	const detail: ContextBreakdown = { limit: 200_000, used: 10, measured: false, segments: [{ key: "memory", tokens: 10 }], memoryFiles: [{ path: "/work/beta/CLAUDE.md", tokens: 10 }] };
	view = await inScreen("b", h(ContextMemoryFiles, { detail, onOpen() {} }));
	await click(view.find("button[aria-expanded]"));
	await click(view.find('button[data-ly-tip="/work/beta/CLAUDE.md"]'));
	assert.deepEqual(opened, ["/work/beta/CLAUDE.md"]);
	assert.deepEqual(openedIn("file"), { a: false, b: true }, "the memory file opened beside the conversation with focus");
});

test("taking a queued message to the side chat, on the screen without focus, opens the side chat in that screen", async () => {
	const asked: Array<string | null> = [];
	useSide.setState({ ask: async (sessionId) => { asked.push(sessionId); } });
	useApp.getState().enqueue("b", { content: [{ type: "text", text: "先问问" }], draft: { text: "先问问", attachments: [], sessionRefs: [] }, preview: "先问问" });
	view = await inScreen("b", h(QueuedMessages, { sessionId: "b", running: true, onEdit() {} }));
	await click(view.find("[data-queue-more]"));
	await click(menuItem("在侧边聊天中打开"));
	assert.deepEqual(asked, ["b"]);
	assert.deepEqual(openedIn("chat"), { a: false, b: true }, "the side chat opened beside the conversation with focus");
});

test("「在终端中打开」 in the file tree of the screen without focus opens that screen's terminal and runs there", async () => {
	const shells = fakeShells();
	lyra.terminal = shells.api;
	lyra.files = { list: async (dir: string) => (dir === BETA.path ? [{ name: "src", path: "/work/beta/src", isDirectory: true, size: 0 }] : []) };
	usePaneDock.getState().open("a", "terminal");
	const tree = h(FileTree, { roots: [BETA.path], openPath: null, dirtyPaths: new Set<string>(), onOpen() {}, onMoved() {}, onRemoved() {} });
	view = await inWindow(screen("a", h(DockedTerminal, { screen: "a" })), screen("b", tree, h(DockedTerminal, { screen: "b" })));
	await until(() => shells.attached.includes("sh-alpha") && view!.all('[data-path="/work/beta/src"]').length > 0);
	await fire(view.find('[data-path="/work/beta/src"]'), new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }));
	await click(menuItem("在终端中打开"));
	await until(() => shells.written.length > 0);
	await settle(30);
	assert.equal(openedIn("terminal").b, true, "no terminal opened in the screen whose tree was used");
	assert.deepEqual(shells.written, [["sh-beta", "cd '/work/beta/src'\r"]], "the cd ran in the shell of the conversation with focus");
});

/** A mark drawn in a composer's mirror, placed where a test can point at it — this DOM lays nothing out. */
function placeMark(host: HTMLElement): { x: number; y: number } {
	const token = host.querySelector<HTMLElement>("[data-command-mirror] .ly-attachment-token");
	assert.ok(token, "the composer drew no mark for the attachment");
	const rect = new DOMRect(10, 10, 60, 16);
	token.getClientRects = () => [rect] as unknown as DOMRectList;
	return { x: 20, y: 15 };
}

test("a file marked in the composer of the screen without focus opens in that screen", async () => {
	lyra.commands = { list: async () => ({ commands: [], skills: [], agents: [] }) };
	lyra.sessions = { contextBreakdown: async () => null, list: async () => [] };
	// A draft holding a dropped file: where it came from and what its mark says ride along with the body.
	const notes = { id: "f1", name: "notes.md", mimeType: "text/markdown", text: "# notes", isText: true, path: "/work/beta/notes.md", label: "notes.md" };
	useApp.setState({ drafts: { b: { text: "看看 【notes.md】", sessionRefs: [], attachments: [notes] } } });
	view = await inScreen("b", h(Composer));
	const at = placeMark(view.host);
	await fire(view.find("textarea"), new MouseEvent("click", { bubbles: true, cancelable: true, clientX: at.x, clientY: at.y }));
	assert.deepEqual(opened, ["/work/beta/notes.md"]);
	assert.deepEqual(openedIn("file"), { a: false, b: true }, "the file pane opened beside the conversation with focus");
});

test("a file marked in the side chat composer of the screen without focus opens in that screen", async () => {
	lyra.files = { pathForDrop: () => "/work/beta/notes.md" };
	view = await inScreen("b", h(SideComposer, { running: false, onSend() {}, onStop() {} }));
	const drop = new Event("drop", { bubbles: true, cancelable: true });
	Object.defineProperty(drop, "dataTransfer", { value: { files: [new File(["# notes"], "notes.md", { type: "text/markdown" })] } });
	await fire(view.find(".ly-composer"), drop);
	await until(() => view!.all("[data-command-mirror] .ly-attachment-token").length > 0);
	const at = placeMark(view.host);
	await fire(view.find("textarea"), new MouseEvent("click", { bubbles: true, cancelable: true, clientX: at.x, clientY: at.y }));
	assert.deepEqual(opened, ["/work/beta/notes.md"]);
	assert.deepEqual(openedIn("file"), { a: false, b: true }, "the file pane opened beside the conversation with focus");
});
