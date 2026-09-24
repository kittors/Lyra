/**
 * Which screen a panel opens in, and a panel leaving for a real window and coming back.
 *
 * **A panel belongs to a conversation.** There is no window-level place for it: a single screen is
 * a split of one, and every request — a toolbar button, a shortcut, a file link in the transcript,
 * a page the address bar opened — lands in the dock of the screen it was made from. See
 * `docs/adr/0023-containers-belong-to-sessions.md` for the layer this replaced and what it cost.
 *
 * **Popping out only ever happens because a person pressed the button.** Which panels may go at all
 * is the panel's own answer — `detach` on its definition. A second renderer does not inherit a
 * `<webview>`, a store or a subscription; `docs/architecture/split-window-conflicts.md` §7 has the
 * table.
 *
 * **Coming back goes to the conversation it left from.** If that conversation is on screen the panel
 * returns to its old slot; if not, pressing 「收回」 brings the conversation back on screen first,
 * because docking a panel somewhere nobody can see looks exactly like losing it.
 */

import { create } from "zustand";
import { flushSync } from "react-dom";
import { bridge } from "../../services/index.ts";
import { applyFilePanelState, filePanelSnapshot } from "../../store/file-panel-handoff.ts";
import { paneFloor } from "./geometry.ts";
import { clearsFloors } from "./layout.ts";
import { dropFits, homeOf, placePanel } from "./place.ts";
import { emptyDockTree, usePaneDock, type Placement } from "./pane-store.ts";
import { has, insert, kinds, remove, type DockNode, type DropAt, type DropSide, type PaneKind } from "./tree.ts";
import { paneStorageKey, readTree, sanitize, writeTree } from "./persist.ts";
import { allPanels, detachOf } from "./panels/registry.ts";
import type { PanelKind } from "./sideStore.ts";

interface PanelWindowRef {
	kind: string;
	scope: string;
	sessionId?: string | null;
}

interface Home {
	/** Kept for records written before panels had a single home; `"window"` meant the old window layer. */
	dock?: "window" | "pane";
	scope: string;
	at: DropAt | null;
	before?: unknown;
	rest?: unknown;
}

/**
 * 面板弹出去之前是从哪儿走的——这份记录要活过刷新。
 *
 * 面板窗口的寿命独立于主窗口的刷新，所以这份记录的寿命也该如此：存 localStorage，和布局同一个
 * 去处。它很小（kind → scope/at），坏数据当作「没有记录」。
 */
const HOMES_KEY = "dw:homes";

function readHomes(): Record<string, Home> {
	try {
		const raw = window.localStorage.getItem(HOMES_KEY);
		if (!raw) return {};
		const parsed = JSON.parse(raw) as unknown;
		return parsed && typeof parsed === "object" ? (parsed as Record<string, Home>) : {};
	} catch {
		// 坏数据、存储关了、没有 window——都当作「没有记录」，收回时落默认位置而已。
		return {};
	}
}

function writeHomes(next: Record<string, Home>): void {
	try {
		window.localStorage.setItem(HOMES_KEY, JSON.stringify(next));
	} catch {
		// 存不下不该让弹出这件事失败。
	}
}

const homes = {
	get(key: string): Home | undefined {
		return readHomes()[key];
	},
	set(key: string, home: Home): void {
		writeHomes({ ...readHomes(), [key]: home });
	},
	delete(key: string): void {
		const all = readHomes();
		if (!(key in all)) return;
		delete all[key];
		writeHomes(all);
	},
};

const homeKey = (scope: string, kind: string): string => `${scope}:${kind}`;

export const usePanelWindows = create<{ panels: PanelWindowRef[]; opening: PanelWindowRef[] }>(() => ({ panels: [], opening: [] }));

function isPopped(scope: string, kind: string): boolean {
	const { panels, opening } = usePanelWindows.getState();
	return [...panels, ...opening].some((panel) => panel.scope === scope && panel.kind === kind);
}

function sessionOf(scope: string): string | null {
	return !scope || scope === "@draft" || scope === "window" ? null : scope;
}

/**
 * Is this renderer a detached panel, rather than a window with a workspace in it?
 *
 * Guarded because `bridge` throws when the preload has not run, and the answer for every caller
 * here is then "no" rather than an exception: a unit test drives these functions directly.
 */
function inPanelWindow(): boolean {
	try {
		return bridge.bootWindow?.kind === "panel";
	} catch {
		return false;
	}
}

/*
 * 「人此刻在哪一屏」和「把某个会话请上屏」——两个答案都由分屏那一层注入进来。
 *
 * 这里不直接去问 `useSplit`：dock 反过来依赖分屏会连出一个环（dock → split → dock），把这段挪进
 * 分屏那一域也一样。注入是两边都不破的解法。没有工作区的窗口（会话窗口、面板窗口）根本不加载
 * `SplitWorkspace`，于是默认答案 null 正好是它们的正确答案：那里没有可以开面板的地方。
 */
let readScope: () => string | null = () => null;
let revealScope: (scope: string) => void = () => {};

export function provideScope(fn: () => string | null): void {
	readScope = fn;
}

export function provideReveal(fn: (scope: string) => void): void {
	revealScope = fn;
}

/** The screen a request with no other answer belongs to: the one the person is working in. */
export function currentScope(): string | null {
	return readScope();
}

export async function popOutPanel(input: { scope: string; kind: PanelKind; sessionId: string | null }): Promise<boolean> {
	if (!bridge.windows?.openPanel) return false;
	// A panel that cannot survive a second renderer does not get moved into one. The header hides
	// the button for these, so this is the second line rather than the first.
	if (detachOf(input.kind) === "none") return false;
	if (isPopped(input.scope, input.kind)) return true;
	const tree = usePaneDock.getState().tree(input.scope);
	const previousHome = !has(tree, input.kind) ? homes.get(homeKey(input.scope, input.kind)) : undefined;
	const home: Home = previousHome ?? {
		scope: input.scope,
		at: has(tree, input.kind) ? homeOf(tree, input.kind) : null,
		before: tree,
		rest: remove(tree, input.kind),
	};
	homes.set(homeKey(input.scope, input.kind), home);
	// Commit the ownership transfer before another document can attach the same browser tab.
	flushSync(() => {
		usePanelWindows.setState((state) => ({ opening: [...state.opening, input] }));
		usePaneDock.getState().close(input.scope, input.kind);
	});
	let opened = false;
	try {
		opened = (await bridge.windows.openPanel({ kind: input.kind, scope: input.scope, sessionId: input.sessionId, ...(input.kind === "file" ? { fileState: filePanelSnapshot() } : {}) })).ok;
	} finally {
		if (!opened) {
			usePanelWindows.setState((state) => ({ opening: state.opening.filter((panel) => panel.scope !== input.scope || panel.kind !== input.kind) }));
			// Rollback is a transaction, not a new placement request: a failed window must not lose its pane.
			const current = usePaneDock.getState().tree(input.scope);
			if (has(tree, input.kind) && !has(current, input.kind)) {
				const at = home.at && (home.at.kind === null || has(current, home.at.kind)) ? home.at : ({ side: "right", kind: null } as const);
				const restored = JSON.stringify(home.rest) === JSON.stringify(current) ? tree : insert(current, input.kind, at);
				usePaneDock.getState().restoreLayout(input.scope, restored);
			}
			if (previousHome) homes.set(homeKey(input.scope, input.kind), previousHome);
			else homes.delete(homeKey(input.scope, input.kind));
		}
	}
	return opened;
}

/** Restore exact geometry only while the remaining dock still matches the departure snapshot. */
export function restoredHomeTree(home: { before?: unknown; rest?: unknown } | undefined, tree: DockNode, kind: PaneKind): DockNode | null {
	if (!home?.before || JSON.stringify(home.rest) !== JSON.stringify(tree)) return null;
	const restored = sanitize(home.before, [...kinds(tree), kind]);
	return has(restored, kind) ? restored : null;
}

/** Put the panel back into a screen that is on screen and has measured itself. */
function dockIntoLive(kind: PanelKind, scope: string, home: Home | undefined): boolean {
	const dock = usePaneDock.getState();
	const span = dock.size(scope);
	if (!span) return false;
	const tree = dock.tree(scope);
	if (has(tree, kind)) return true;
	const snapshot = restoredHomeTree(home, tree, kind);
	if (snapshot && clearsFloors(snapshot, span, paneFloor)) {
		dock.restoreLayout(scope, snapshot);
		return true;
	}
	const preferred = home?.at ?? null;
	const at = preferred && dropFits(tree, span, paneFloor, kind, preferred) ? preferred : placePanel(tree, span, paneFloor, kind);
	// A screen with no room still takes it back, drawn squeezed — the floors choose where, never whether.
	return dock.open(scope, kind, (at ?? preferred ?? undefined) as Placement | undefined);
}

/**
 * Put the panel back into a conversation that is not on screen: into its stored layout, where it
 * will be the next time that conversation is shown.
 */
function dockIntoStored(kind: PanelKind, scope: string, home: Home | undefined): void {
	const dock = usePaneDock.getState();
	const inMemory = dock.trees[scope];
	const allowed: PaneKind[] = ["conversation", ...allPanels().filter((panel) => !panel.ephemeral).map((panel) => panel.kind)];
	const tree = inMemory ?? readTree(paneStorageKey(scope), allowed) ?? emptyDockTree;
	if (has(tree, kind)) return;
	const snapshot = restoredHomeTree(home, tree, kind);
	const at = home?.at && (home.at.kind === null || has(tree, home.at.kind)) ? home.at : ({ side: "right", kind: null } as const);
	const next = snapshot ?? insert(tree, kind, at);
	if (inMemory) dock.restoreLayout(scope, next);
	else writeTree(paneStorageKey(scope), next);
}

/**
 * Bring a detached panel home.
 *
 * `reveal` is whether the person asked for it (the 「收回」 button) rather than the app tidying up
 * after a crash. A person asking wants to see it arrive, so a conversation that is off screen is
 * brought on screen first; tidying up must never rearrange the workspace behind anyone's back, so
 * it writes the panel into that conversation's stored layout instead.
 */
async function dockBack(kind: PanelKind, recorded: string, reveal: boolean): Promise<boolean> {
	const home = homes.get(homeKey(recorded, kind));
	// Records from before panels had one home named the old window layer, which no longer exists:
	// they go to the conversation the person is working in.
	const scope = recorded === "window" || home?.dock === "window" ? readScope() : recorded;
	if (!scope) return false;
	if (dockIntoLive(kind, scope, home)) {
		homes.delete(homeKey(recorded, kind));
		return true;
	}
	if (reveal && scope !== "@draft") {
		revealScope(scope);
		// The screen needs a frame or two to mount and measure itself before it can take the panel.
		for (let waited = 0; waited < 3_000; waited += 50) {
			await new Promise((resolve) => setTimeout(resolve, 50));
			if (dockIntoLive(kind, scope, home)) {
				homes.delete(homeKey(recorded, kind));
				return true;
			}
		}
	}
	dockIntoStored(kind, scope, home);
	homes.delete(homeKey(recorded, kind));
	return true;
}

/**
 * 从会话内容里打开一个面板——点一个文件链接、点「审核」、点子智能体、「在终端运行」、地址栏打开的网页。
 *
 * 和工具条上那排按钮走同一套规矩：开在人此刻所在的那一屏，那一屏就是这个请求所属的会话。
 */
export function openScopedPanel(kind: PanelKind, beside?: { kind: PaneKind; side: DropSide; share?: number }, target?: string): void {
	/*
	 * A panel window has no dock, so the request goes to the window that does.
	 *
	 * In this renderer nothing is subscribed to a dock — it draws one panel and nothing else. So
	 * clicking a file in a detached file tree would update a store nobody reads. See
	 * `docs/architecture/split-window-conflicts.md` §7.
	 */
	if (inPanelWindow()) {
		if (bridge.windows?.openPanelInMain) void bridge.windows.openPanelInMain({ kind, ...(beside ? { beside } : {}) });
		return;
	}
	/*
	 * `target` names the screen when the request is not a click in it — an announcement, a page an
	 * agent revealed. Anything a person clicked is already in the screen with the focus: pressing
	 * inside a screen focuses it first.
	 */
	const scope = target && usePaneDock.getState().size(target) ? target : readScope();
	if (!scope) return;
	if (isPopped(scope, kind)) {
		if (bridge.windows?.openPanel) void bridge.windows.openPanel({ kind, scope, sessionId: sessionOf(scope), ...(kind === "file" ? { fileState: filePanelSnapshot() } : {}) });
		return;
	}
	usePaneDock.getState().open(scope, kind, beside);
}

/**
 * The toolbar button and the shortcut: open it here, or put it away.
 *
 * In the narrow layout a panel that is open but behind the conversation is brought forward rather
 * than closed — pressing its button is asking to see it, and closing it would be the opposite.
 */
export function toggleScopedPanel(scope: string, kind: PanelKind, options: { compact?: boolean } = {}): void {
	if (isPopped(scope, kind)) {
		if (!bridge.windows?.openPanel) return;
		void bridge.windows.openPanel({ kind, scope, sessionId: sessionOf(scope) });
		return;
	}
	const dock = usePaneDock.getState();
	if (has(dock.tree(scope), kind)) {
		if (options.compact && dock.focused[scope] !== kind) dock.focus(scope, kind);
		else dock.close(scope, kind);
		return;
	}
	dock.open(scope, kind);
}

/**
 * 启动时发现的孤儿：盘上有回家记录，却没有对应的面板窗口。
 *
 * 这只有一种来法——人把面板弹出去，然后**没有收回就退出了应用**。窗口列表从来不存盘，所以
 * 重开之后那个面板既不在任何一棵树里（弹出时已经从树上删了），也没有窗口。那条记录记着它属于
 * 哪个会话，就照它放回那个会话的布局里——那个会话在屏上就回到原位，不在屏上就等它下次出现。
 *
 * 「人主动关掉那个面板窗口」不会走到这里：那一刻应用还活着，`apply` 当场就把记录清了。
 *
 * 旧记录指着已经不存在的窗口层时，要等工作区告诉我们人在哪一屏，所以那一种重试几次。
 */
function adoptOrphans(deadline: number): void {
	const pending: string[] = [];
	for (const key of Object.keys(readHomes())) {
		const cut = key.lastIndexOf(":");
		if (cut <= 0) continue;
		const scope = key.slice(0, cut);
		const kind = key.slice(cut + 1) as PanelKind;
		if (isPopped(scope, kind)) continue;
		if ((scope === "window" || homes.get(key)?.dock === "window") && !readScope()) {
			pending.push(key);
			continue;
		}
		void dockBack(kind, scope, false);
	}
	if (pending.length === 0) return;
	if (typeof window === "undefined" || Date.now() >= deadline) {
		for (const key of pending) homes.delete(key);
		return;
	}
	window.setTimeout(() => adoptOrphans(deadline), 400);
}

export function watchPanelWindows(): () => void {
	if (!bridge.windows) return () => {};
	let first = true;
	const apply = (panels: PanelWindowRef[]) => {
		const before = usePanelWindows.getState().panels;
		usePanelWindows.setState((state) => ({ panels, opening: state.opening.filter((pending) => !panels.some((panel) => panel.scope === pending.scope && panel.kind === pending.kind)) }));
		if (first) {
			first = false;
			adoptOrphans(Date.now() + 6_000);
			return;
		}
		/*
		 * 一个面板窗口不见了，而它不是被「收回」收走的——那条路自己会清记录，清完窗口才关。
		 * 剩下的就是人主动关掉了它：关掉就是关掉，面板不该自己跑回来，但那条记录也不该留着。
		 */
		for (const gone of before) {
			if (panels.some((panel) => panel.scope === gone.scope && panel.kind === gone.kind)) continue;
			homes.delete(homeKey(gone.scope, gone.kind));
		}
	};
	void bridge.windows
		.list()
		.then((result) => { if (first) apply(result.panels ?? []); })
		.catch(() => {});
	const stopChanged = bridge.windows.onChanged((state) => apply(state.panels ?? []));
	/*
	 * A panel window asking this window to open something, since only this one has docks.
	 *
	 * Deliberately the same `openScopedPanel` the local callers use, so a file opened from a
	 * detached tree lands exactly where one opened from the transcript would.
	 */
	const stopOpen = bridge.windows.onOpenPanel?.(({ kind, beside }) => {
		openScopedPanel(kind as PanelKind, beside as { kind: PaneKind; side: DropSide; share?: number } | undefined);
	}) ?? (() => {});
	const stopRestore = bridge.windows.onRestorePanel(({ kind, scope, fileState }) => {
		const restore = async () => {
			if (!(await dockBack(kind as PanelKind, scope, true))) return;
			if (fileState) {
				const current = filePanelSnapshot();
				const paths = new Set(fileState.tabs.map((tab) => tab.path));
				await applyFilePanelState({ ...fileState, tabs: [...current.tabs.filter((tab) => !paths.has(tab.path)), ...fileState.tabs], drafts: { ...Object.fromEntries(Object.entries(current.drafts).filter(([path]) => !paths.has(path))), ...fileState.drafts } });
			}
			await bridge.windows.closePanel({ kind, scope });
		};
		void restore().catch((error: unknown) => {
			// oxlint-disable-next-line no-console -- a failed handoff must keep the native editor and its draft alive.
			console.error("Failed to restore panel", error);
		});
	});
	return () => {
		stopChanged();
		stopOpen();
		stopRestore();
	};
}
