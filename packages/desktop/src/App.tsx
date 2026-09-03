/**
 * The window: a navigation pane, and a dock holding everything else.
 *
 * What is left here is the arrangement and the order things are mounted in. How the dock divides
 * itself is in `dock/`, the top edge and its buttons are in `WindowToolbar` — both of which are
 * mostly rules that were learned the hard way and are worth reading on their own.
 */

import { lazy, Suspense, useEffect, useState } from "react";
import { CalendarClock, GitPullRequest, MessageSquare, Puzzle } from "lucide-react";
import { BootScreen, MIN_BOOT_MS } from "./components/BootScreen.tsx";
import { Conversation, ConversationSkeleton } from "./components/Conversation.tsx";
import { EmptyState } from "./components/EmptyState.tsx";
import { ImageViewer } from "./components/image/ImageViewer.tsx";
import { InputMenu } from "./components/InputMenu.tsx";
import { SkeletonList } from "./components/Skeleton.tsx";
import { Toaster } from "./components/toast/Toaster.tsx";
import { Sidebar } from "./components/Sidebar.tsx";
import { DragBand, PanelMenu, WindowButtons } from "./components/WindowToolbar.tsx";
import { DockView } from "./dock/DockView.tsx";
import { LayoutProvider, NavPane, useLayout, useSidebarFit } from "./layout.tsx";
import { sessionTitle } from "./sessionTitle.ts";
import { useShortcuts } from "./shortcuts.ts";
import { useSide } from "./sideStore.ts";
import { useApp } from "./store.ts";
import { useTrayCommands } from "./tray-commands.ts";
import { useFileTreeStore } from "./store/fileTree.ts";

/*
 * The screens that are not a conversation, fetched when they are first opened.
 *
 * All four are reachable from the sidebar and none of them is where the window opens. Settings is
 * the largest by a distance — the appearance page alone carries the code themes and every font
 * preview — and until now all of it was in the bundle before the first message rendered.
 *
 * `lazy` rather than a hand-rolled dynamic import: React already knows how to hold the tree still
 * while a chunk arrives, and doing it by hand means a second state machine that has to agree with
 * the first about what "loading" means.
 *
 * The phone is why this is worth doing at all. It loads the same bundle over the network, and
 * through a relay that crosses the public internet twice.
 */
const PluginsView = lazy(() => import("./components/PluginsView.tsx").then((m) => ({ default: m.PluginsView })));
const PullRequestsView = lazy(() =>
	import("./components/PullRequestsView.tsx").then((m) => ({ default: m.PullRequestsView })),
);
const ScheduledView = lazy(() => import("./components/ScheduledView.tsx").then((m) => ({ default: m.ScheduledView })));
const SettingsShell = lazy(() =>
	import("./components/settings/SettingsShell.tsx").then((m) => ({ default: m.SettingsShell })),
);
import { useOpenFile } from "./store/openFile.ts";
import { useTerminalPrewarm } from "./terminal-prewarm.ts";
import { applyAppearance, watchSystemTheme } from "./theme.ts";
import { bridge } from "./services/index.ts";

export function App() {
	const ready = useApp((s) => s.ready);
	const bootstrap = useApp((s) => s.bootstrap);

	useEffect(() => {
		void bootstrap();
	}, [bootstrap]);

	// A shell running before the terminal is opened, so opening it costs nothing. Idle-scheduled
	// and idempotent — see `terminal-prewarm.ts`.
	useTerminalPrewarm();
	// Whose files these are. Owned here rather than by the file pane, which is not always mounted.
	useProjectFiles();

	const appearance = useApp((s) => s.settings?.appearance);
	useEffect(() => {
		if (appearance) applyAppearance(appearance);
	}, [appearance]);
	useEffect(() => watchSystemTheme(() => useApp.getState().settings?.appearance ?? appearance!), [appearance]);

	/*
	 * Failures from the main process, shown the way every other failure is.
	 *
	 * They used to have nowhere to go, so Electron showed them itself — a modal dialog over the
	 * whole app saying "A JavaScript error occurred in the main process", which is both alarming
	 * and useless: the stack ends in Node's internals and the one button just dismisses it. As a
	 * toast it is legible, it does not block anything, and it carries the same 「新开一个对话来排查」
	 * button as any other error, which is the first thing anyone wants when they see one.
	 *
	 * Only the ones worth reading arrive here; `QUIET_IO` in `main.ts` drops the rest.
	 */
	useEffect(
		() =>
			bridge.onMainError(({ message }) => {
				useApp.getState().notify(message.split("\n")[0] || "主进程出错", "error");
			}),
		[],
	);

	// Before the `ready` gate below, so a command sent to a window that is still booting is not
	// dropped for the one or two frames the boot screen is up.
	useTrayCommands();

	/*
	 * The boot screen has a floor as well as a ceiling.
	 *
	 * `ready` arrives in a few hundred milliseconds, which meant the screen it gates was mounted and
	 * unmounted faster than it could fade in — the launch read as a stutter rather than as a start.
	 * Holding it for `MIN_BOOT_MS` gives it time to be seen; the timer starts with the window, so it
	 * costs nothing that the boot was not already spending.
	 */
	const [settled, setSettled] = useState(false);
	useEffect(() => {
		const timer = window.setTimeout(() => setSettled(true), MIN_BOOT_MS);
		return () => window.clearTimeout(timer);
	}, []);

	if (!ready || !settled) return <BootScreen />;

	return (
		<LayoutProvider>
			<Shell />
			{/*
			 * One viewer for the whole window, outside the shell.
			 *
			 * Images are opened from the composer, from sent messages and from tool results, and all
			 * three want the same overlay over everything. Mounting it per call site would give a
			 * transcript with twelve screenshots in it twelve idle overlays.
			 */}
			<ImageViewer />
			{/*
			 * Cut/copy/paste for every plain text field, mounted once for the same reason.
			 *
			 * Electron draws no context menu of its own, so without this right-clicking the composer
			 * or a search box does nothing — in every window, on every screen, which is why it is
			 * here rather than attached to the fields one at a time.
			 */}
			<InputMenu />
			{/*
			 * Last, and outside the shell.
			 *
			 * A toast is frequently the answer to what the thing on top just did — a file operation
			 * refused from a menu, a save that failed behind the image viewer — so it is the one
			 * surface that has to outrank every other, including the viewer above it in this list.
			 * It does that by `TOAST_Z`, not by DOM order; being here is about it belonging to the
			 * window rather than to any one view.
			 */}
			<Toaster />
		</LayoutProvider>
	);
}

function Shell() {
	const view = useApp((s) => s.view);
	const { dismissNav } = useLayout();

	const settings = view === "settings";

	// Settings and the workspace each own a navigation pane; a drawer opened over one has no
	// meaning over the other, so leaving the view puts it away.
	useEffect(() => dismissNav(), [view, dismissNav]);

	/*
	 * Both shells stay mounted, and settings is drawn *over* the workspace rather than in place of
	 * it. Swapping them remounted the whole conversation on the way back, and a list that has only
	 * just been rebuilt has no height yet — so the cached scroll offset was applied to a transcript
	 * of zero pixels and landed at the top every time.
	 *
	 * Two things about how it is put away, both of which have already been got wrong once:
	 *
	 * `visibility`, not `display`. `display: none` throws the layout box away and takes the scroll
	 * position with it — the exact thing this is here to preserve — and it reports a `scrollHeight`
	 * of zero, which is what the composer measures itself against. `visibility: hidden` keeps the
	 * box, its height and its `scrollTop` untouched.
	 *
	 * And the wrapper is `h-full`, never `flex-1`. `#root` is not a flex container, so `flex-1`
	 * resolved to nothing: the box fell to `height: auto`, `ChatShell`'s own `h-full` had no
	 * percentage to resolve against, and the transcript grew until it pushed the composer off the
	 * bottom of the window. `absolute inset-0` then measures the same viewport `h-full` did, which
	 * is what keeps the offset valid while it is out of the flow.
	 */
	return (
		<>
			<div className={settings ? "pointer-events-none invisible absolute inset-0" : "h-full"}>
				<ChatShell settings={settings} />
			</div>
			{settings && (
				<LazyScreen>
					<SettingsShell />
				</LazyScreen>
			)}
		</>
	);
}

/**
 * The gap between asking for a screen and having it.
 *
 * A skeleton rather than a spinner, and rather than nothing. Nothing is worse than it sounds here:
 * the pane keeps its old contents until the chunk lands, so clicking 「插件」 would leave the
 * conversation on screen and look like the click was missed. A skeleton says the click was heard.
 *
 * Usually invisible — the chunk is on the same disk and arrives within a frame or two. It is the
 * phone, loading the same bundle across a relay, that this is for.
 */
function LazyScreen({ children }: { children: React.ReactNode }) {
	return <Suspense fallback={<SkeletonList count={6} label="正在打开" />}>{children}</Suspense>;
}

/**
 * What the conversation pane is called, and what it is showing.
 *
 * The pull request list, the plugin catalogue and the schedule are not conversations, but they
 * occupy the same pane: they are the main thread of whatever you are doing, and giving them a
 * pane of their own would mean the dock rearranged itself every time you glanced at a review.
 * The pane keeps its place and changes what is in it — which is exactly what it did before the
 * dock existed, when it was the `main` column.
 */
function useMainPane() {
	const view = useApp((s) => s.view);
	const meta = useApp((s) => s.meta);
	const messages = useApp((s) => s.messages);
	const loadingSession = useApp((s) => s.loadingSession);

	/*
	 * `solo` marks the screens that are not a conversation in a project.
	 *
	 * The panels are all about the project you are working in — its files, its terminal, its diff.
	 * A pull request is of someone else's branch in a repository this machine may never have
	 * cloned; the schedule and the plugin catalogue are not in a project at all. So the panes are
	 * not merely empty on those screens, they are about somewhere else, and they step aside.
	 */
	if (view === "pull-requests") {
		return { title: "拉取请求", icon: <GitPullRequest size={12.5} strokeWidth={1.8} />, body: <LazyScreen>{<PullRequestsView />}</LazyScreen>, solo: true };
	}
	if (view === "plugins") {
		return { title: "插件", icon: <Puzzle size={12.5} strokeWidth={1.8} />, body: <LazyScreen>{<PluginsView />}</LazyScreen>, solo: true };
	}
	if (view === "scheduled") {
		return { title: "计划任务", icon: <CalendarClock size={12.5} strokeWidth={1.8} />, body: <LazyScreen>{<ScheduledView />}</LazyScreen>, solo: true };
	}
	return {
		title: sessionTitle(meta?.title),
		icon: <MessageSquare size={12.5} strokeWidth={1.8} />,
		body: messages.length > 0 ? <Conversation /> : loadingSession ? <ConversationSkeleton /> : <EmptyState />,
		solo: false,
	};
}

function ChatShell({ settings }: { settings: boolean }) {
	const activeSessionId = useApp((s) => s.activeSessionId);
	const workspace = useApp((s) => s.workspace);
	const { compact, navOpen, toggleNav, dismissNav } = useLayout();
	const attach = useSide((s) => s.attach);
	const { drawn: sidebarDrawn, max: sidebarMax } = useSidebarFit();
	const main = useMainPane();

	// The side chat reads the session it is attached to, so it follows whichever one is open.
	useEffect(() => {
		void attach(activeSessionId);
	}, [activeSessionId, attach]);

	// Silent while settings is up. The workspace is still mounted behind it — it has to be, for the
	// transcript to keep its place — but ⌘P for a file pane nobody can see, or Escape unmaximising
	// one, is not what those keys mean on that screen.
	useShortcuts({ enabled: !settings, compact, navOpen, activeSessionId, workspace, toggleNav, dismissNav });

	return (
		<div className="ly-shell relative flex h-full overflow-hidden">
			<NavPane width={sidebarDrawn} maxWidth={sidebarMax} label="侧边栏">
				<Sidebar />
			</NavPane>

			{/*
			 * The draggable top edge, declared before anything that cuts a hole in it.
			 *
			 * Electron composites drag regions by walking the document in order, so a `drag` element
			 * after a `no-drag` one fills that hole straight back in. This used to sit after `main`,
			 * which was fine for as long as nothing inside `main` put controls in the top 44px — and
			 * then the pull request header did. Its buttons were drawn, were on top, passed every
			 * hit test the page can run, and did nothing at all: the press was going to the window
			 * manager as a drag.
			 *
			 * First, therefore. Everything after it — this view's own header, the panel controls,
			 * the window buttons — is a `no-drag` hole, and holes only stay open if nothing
			 * re-covers them.
			 */}
			<DragBand navOpen={navOpen && !compact} sidebarWidth={sidebarDrawn} />

			<main className="ly-opaque relative flex min-w-0 flex-1 flex-col">
				{/*
				 * The dock, holding the conversation and every panel alongside it, up to the window's
				 * top edge.
				 *
				 * There is no toolbar row above it. The first row of panes *is* the window's top row:
				 * their title bars are 44px and sit on the traffic lights' line, and the controls that
				 * used to need a strip of their own now ride on the conversation's own title bar. A
				 * separate row cost the height twice — once for the toolbar, once for the titles under
				 * it — and put the buttons on a different line from the panes they act on.
				 */}
				<DockView
					title={main.title}
					icon={main.icon}
					// No panel controls on a screen the panels do not belong to.
					actions={main.solo ? undefined : <PanelMenu />}
					solo={main.solo}
					renderConversation={() => main.body}
				/>
			</main>

			<WindowButtons navOpen={navOpen} compact={compact} onToggleNav={toggleNav} />
		</div>
	);
}

/**
 * Let go of the last project's files when the window moves to another one.
 *
 * Both halves of the file browser are panes that can be closed, and neither of them is the right
 * place to decide this: the tree used to do it in an effect of its own, so closing the tree and
 * then changing projects left the editor showing a file — and holding unsaved edits for it — from
 * a project that is no longer open. The paths mean nothing here, and the drafts belong to a file
 * this project does not have.
 *
 * Mounted at the root, which is the one place guaranteed to be watching.
 */
function useProjectFiles(): void {
	const root = useApp((s) => s.workspace?.path ?? null);

	useEffect(() => {
		useFileTreeStore.getState().setRoot(root);
		useOpenFile.getState().clear();
	}, [root]);
}
