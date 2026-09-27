/**
 * A screen's file tree lists that screen's project, and keeps its own folders open while focus moves.
 *
 * Measured in a real window (`e2e/split-scope-more-probe.ts files`): with focus on 甲 (alpha-app), the
 * Files panel opened in 乙's screen (beta-lib) listed alpha-app, and went on listing it as focus moved
 * between the two. The panel took its project from the live slot, and the tree store kept one set of
 * source folders for the whole window, emptying itself whenever that set changed — so two trees on
 * two projects could only ever take turns.
 *
 * The same live project fed the tree under the open file's name and the composer's `@` list: a file
 * mentioned under 乙 was picked from alpha-app's listing.
 *
 * Which file is open stays one for the window (the file pane is shared by design this time); only the
 * trees and the listings are per screen.
 */

import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { act, createElement as h, useRef } from "react";
import type { Message, SessionMeta } from "@lyra/core";
import type { FileEntry, WorkspaceInfo } from "../../electron/ipc-types.ts";
import { LayoutProvider } from "../../src/app/layout.tsx";
import { DockScope, SessionScope } from "../../src/app/session-scope.tsx";
import { useMention } from "../../src/features/composer/useMention.ts";
import { usePaneDock } from "../../src/features/dock/pane-store.ts";
import { provideScope } from "../../src/features/dock/popout.ts";
import { has } from "../../src/features/dock/tree.ts";
import { FileBrowser } from "../../src/features/files/FileBrowser.tsx";
import { FileTitle } from "../../src/features/files/FileTitle.tsx";
import { I18nProvider } from "../../src/i18n/index.ts";
import { useApp, type AppState } from "../../src/store/index.ts";
import type { Cache } from "../../src/store/derive.ts";
import { useFileTreeStore } from "../../src/store/fileTree.ts";
import { useOpenFile } from "../../src/store/openFile.ts";
import { click, mount, type Mounted } from "../helpers/mount.ts";

const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
const ALPHA: WorkspaceInfo = { path: "/work/alpha", name: "alpha-app", isGitRepo: true, branch: "main" };
const BETA: WorkspaceInfo = { path: "/work/beta", name: "beta-lib", isGitRepo: true, branch: "beta-work" };

const file = (path: string): FileEntry => ({ name: path.split("/").pop()!, path, isDirectory: false, size: 1 });
const folder = (path: string): FileEntry => ({ name: path.split("/").pop()!, path, isDirectory: true, size: 0 });
const DISK: Record<string, FileEntry[]> = {
	[ALPHA.path]: [folder("/work/alpha/src"), file("/work/alpha/README.md")],
	"/work/alpha/src": [file("/work/alpha/src/app.ts")],
	[BETA.path]: [folder("/work/beta/docs"), file("/work/beta/README.md"), file("/work/beta/lib.ts")],
	"/work/beta/docs": [file("/work/beta/docs/guide.md")],
};

function meta(id: string, project: WorkspaceInfo): SessionMeta {
	return { id, title: id, cwd: project.path, projectId: project.path, projectName: project.name, createdAt: 1, updatedAt: 2, modelId: "", messageCount: 0, seq: 1, usage };
}
function parked(id: string, project: WorkspaceInfo, running: boolean): Cache[string] {
	const messages: Message[] = [];
	return { meta: meta(id, project), messages, toolRuns: {}, state: { running, approvals: [], todos: [], compactions: [], commandRuns: [], hiccups: [], stopped: null, retrying: null, capabilities: null, pendingUserMessage: null } };
}

let listed: string[];
let opened: string[];
let previous: AppState;
let previousFile: ReturnType<typeof useOpenFile.getState>;
let views: Mounted[];

beforeEach(() => {
	listed = [];
	opened = [];
	views = [];
	previous = useApp.getState();
	previousFile = useOpenFile.getState();
	Object.defineProperty(window, "lyra", {
		configurable: true,
		value: {
			files: {
				list: async (dir: string) => {
					listed.push(dir);
					return DISK[dir] ?? [];
				},
			},
			workspace: { info: async (path: string) => [ALPHA, BETA].find((one) => one.path === path) ?? null },
			commands: { list: async () => ({ commands: [], skills: [], agents: [] }) },
			sessions: { list: async () => [] },
			system: { openTargets: async () => [] },
		},
	});
	// 甲 holds the live slot in alpha; 乙, beside it, is in beta.
	useApp.setState({
		activeSessionId: "a", pendingSessionId: null, workspace: ALPHA, scratchCwd: null, scratchRoots: ["/scratch"], running: false,
		sessions: [meta("a", ALPHA), meta("b", BETA)], sessionCache: { b: parked("b", BETA, false) }, workspaceByPath: { [BETA.path]: BETA },
		activity: {}, settings: null,
	});
	useFileTreeStore.setState({ children: {}, expanded: new Set() });
	useOpenFile.setState({ path: null, name: null, drafts: {}, open: async (entry: { path: string }) => void opened.push(entry.path) });
	window.localStorage.clear();
	usePaneDock.setState({ trees: {}, sizes: {}, drag: null, maximized: {}, focused: {}, crossRatio: {}, host: null });
	usePaneDock.getState().rememberSize("a", { width: 1200, height: 900 });
	usePaneDock.getState().rememberSize("b", { width: 1200, height: 900 });
	provideScope(() => "a");
});

afterEach(async () => {
	for (const view of views) await view.unmount();
	useApp.setState(previous, true);
	useOpenFile.setState(previousFile, true);
	provideScope(() => null);
	Reflect.deleteProperty(window, "lyra");
});

/** Long enough for directory listings to come back and be drawn. */
const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });

async function inScreen(id: string, body: ReturnType<typeof h>): Promise<Mounted> {
	const view = await mount(h(I18nProvider, { locale: "zh-CN", children: h(LayoutProvider, { children: h(DockScope.Provider, { value: id }, h(SessionScope.Provider, { value: id }, body)) }) }));
	views.push(view);
	await settle();
	return view;
}

const rows = (view: Mounted) => view.all("[data-path]").map((row) => row.getAttribute("data-path"));
const row = (view: Mounted, path: string) => view.all("[data-path]").find((one) => one.getAttribute("data-path") === path);

test("two screens' Files panels each list their own project", async () => {
	const a = await inScreen("a", h(FileBrowser));
	const b = await inScreen("b", h(FileBrowser));
	assert.ok(rows(b).includes("/work/beta/lib.ts") && !rows(b).some((path) => path?.startsWith(ALPHA.path)), `乙's panel listed ${JSON.stringify(rows(b))}`);
	assert.ok(rows(a).includes("/work/alpha/README.md") && !rows(a).some((path) => path?.startsWith(BETA.path)), `甲's panel listed ${JSON.stringify(rows(a))}`);
});

test("folders opened in two screens' trees stay open as focus moves between them", async () => {
	const a = await inScreen("a", h(FileBrowser));
	const b = await inScreen("b", h(FileBrowser));
	const src = row(a, "/work/alpha/src");
	const docs = row(b, "/work/beta/docs");
	assert.ok(src && docs, `a folder is missing: 甲 ${JSON.stringify(rows(a))} 乙 ${JSON.stringify(rows(b))}`);
	await click(src);
	await click(docs);
	await settle();
	// Focus to 乙 and back, the way pressing in each screen moves the live slot.
	await act(async () => useApp.setState({ activeSessionId: "b", workspace: BETA, sessionCache: { a: parked("a", ALPHA, false) }, workspaceByPath: { [ALPHA.path]: ALPHA, [BETA.path]: BETA } }));
	await settle();
	await act(async () => useApp.setState({ activeSessionId: "a", workspace: ALPHA, sessionCache: { b: parked("b", BETA, false) } }));
	await settle();
	assert.ok(rows(a).includes("/work/alpha/src/app.ts"), `甲's open folder shut: ${JSON.stringify(rows(a))}`);
	assert.ok(rows(b).includes("/work/beta/docs/guide.md"), `乙's open folder shut: ${JSON.stringify(rows(b))}`);
});

test("a turn that ends re-reads the tree of its own screen, not the others'", async () => {
	useApp.setState({ sessionCache: { b: parked("b", BETA, true) } });
	await inScreen("b", h(FileBrowser));
	listed = [];
	// The focused conversation finishing a turn is not news to 乙's tree.
	await act(async () => useApp.setState({ running: true }));
	await act(async () => useApp.setState({ running: false }));
	await settle();
	// A copy: asserting on `listed` itself would narrow it to an empty tuple for the lines below.
	assert.deepEqual([...listed], [], "re-read 乙's tree when the focused conversation finished");
	// 乙 finishing its own is.
	await act(async () => useApp.setState({ sessionCache: { b: parked("b", BETA, false) } }));
	await settle();
	assert.ok(listed.includes(BETA.path), `乙's tree was not re-read when its turn ended: ${JSON.stringify(listed)}`);
});

test("a file opened from a screen's Files panel opens the file pane in that screen", async () => {
	const b = await inScreen("b", h(FileBrowser));
	const lib = row(b, "/work/beta/lib.ts");
	assert.ok(lib, `no lib.ts under 乙: ${JSON.stringify(rows(b))}`);
	await click(lib);
	await settle();
	assert.deepEqual(opened, ["/work/beta/lib.ts"]);
	assert.ok(has(usePaneDock.getState().tree("b"), "file"), "the file pane did not open in the screen the file was opened from");
	assert.ok(!has(usePaneDock.getState().tree("a"), "file"), "it opened beside the conversation that has focus");
});

test("the tree under the open file's name lists that screen's project, and hands off to that screen", async () => {
	useOpenFile.setState({ path: "/work/beta/lib.ts", name: "lib.ts" });
	const b = await inScreen("b", h(FileTitle));
	await click(b.find("button"));
	await settle();
	const listedHere = [...document.querySelectorAll("[data-path]")].map((one) => one.getAttribute("data-path"));
	assert.ok(listedHere.includes("/work/beta/lib.ts") && !listedHere.some((path) => path?.startsWith(ALPHA.path)), `the dropdown listed ${JSON.stringify(listedHere)}`);
	const handOff = [...document.querySelectorAll("button")].find((one) => one.textContent?.includes("在面板中打开"));
	assert.ok(handOff, "no 「在面板中打开」 in the dropdown");
	await click(handOff);
	assert.ok(has(usePaneDock.getState().tree("b"), "files"), "the tree pane did not open in this screen");
	assert.ok(!has(usePaneDock.getState().tree("a"), "files"), "it opened beside the conversation that has focus");
});

test("the composer's @ list under a screen lists that screen's project", async () => {
	function Mentions() {
		const field = useRef<HTMLTextAreaElement>(null);
		// What 乙's composer hands it: the text so far and its own working directory.
		useMention("@", BETA.path, field, () => {});
		return h("textarea", { ref: field });
	}
	await inScreen("b", h(Mentions));
	assert.deepEqual(listed, [BETA.path], "listed the focused conversation's project for 乙's @");
});
