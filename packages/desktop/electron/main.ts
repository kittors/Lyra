import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { spawn as spawnPty } from "node-pty";
import { app, BrowserWindow, protocol } from "electron";
import {
	createContext,
	lyraHome,
	migratePreviousHome,
	loadCapabilityPlugins,
	loadPlugins,
	DEFAULT_PLUGINS,
	pruneSessionArtifacts,
	WINDOWS_RUNNER_FLAG,
	runSandboxRunner,
	registerSearchProvider,
	duckDuckGoProvider,
	instantAnswerProvider,
	keyedSearchProvider,
	BRAVE_PROVIDER_ID,
	EXA_PROVIDER_ID,
	TAVILY_PROVIDER_ID,
	useAgentLoop,
	useApprovalPolicy,
	useCompaction,
	useLlmRegistry,
	useSandbox,
	useScheduler,
	useSkillRegistry,
	useToolRegistry,
	useTurnPipeline,
	APPROVAL,
	COMPACTION,
	LLM,
	LOOP,
	SANDBOX,
	SCHEDULER,
	SESSION,
	SKILLS,
	STORAGE,
	TOOLS,
	SessionStore,
	type AgentLoop,
	type ApprovalPolicy,
	type CompactionStrategy,
	type Context as CapabilityContext,
	type LlmRegistry,
	type Sandbox,
	type Settings,
	type SessionStorage,
	type SkillRegistry,
	type TaskScheduler,
	type TurnPipeline,
	type ToolRegistry,
} from "@lyra/core";
import {
	broadcastSideChat,
	browsers,
	configureHub,
	getOrCreateSession,
	sessions,
	sideChats,
} from "./session-hub.ts";
import { containingRoot, resolveInside } from "./file-ops.ts";
import { captureLog } from "./screenshot-debug.ts";
import { registerFilesIpc } from "./ipc/files.ts";
import { registerFileOpsIpc } from "./ipc/file-ops.ts";
import { registerFormatIpc } from "./ipc/format.ts";
import { rescueLegacyWorkspaces } from "./scratch.ts";
import { applySettings, loadAppSettings, onSettingsChanged } from "./app-settings.ts";
import { registerServicesIpc } from "./ipc/services.ts";
import { registerWorkspaceIpc } from "./ipc/workspace.ts";
import { workspaceInfo } from "./workspace-info.ts";
import { configureSync, startSync, stopSync, syncStatusSource } from "./sync.ts";
import { fetchEndpointModels, idleSyncStatus, testProvider } from "./providers.ts";
import { registerSessionsIpc } from "./ipc/sessions.ts";
import { ensureLiveSession } from "./session-hub.ts";
import {
	appIconPath,
	applyNativeAppearance,
	createWindow,
	getWindow,
	registerWindowIpc,
	useSettingsSource,
} from "./window.ts";
import { MEDIA_SCHEME, PREVIEW_SCHEME, registerPreviewProtocols } from "./preview-protocol.ts";
import { guardWebviews, installPermissionHandlers } from "./window-security.ts";
import { registerGitIpc } from "./ipc/git.ts";
import { registerUsageIpc } from "./ipc/usage.ts";
import { registerRulesIpc } from "./ipc/rules.ts";
import { registerSideChatIpc } from "./ipc/side-chat.ts";
import { registerUpdateIpc } from "./ipc/updates.ts";
import { registerTerminalIpc, type LiveTerminal } from "./ipc/terminal.ts";
import { Scheduler } from "./scheduler.ts";
import { createTray, destroyTray, hasTray, refreshMenu, type TrayCommand } from "./tray.ts";
import { registerScreenshotIpc } from "./ipc/screenshot.ts";
import { destroyScreenshotOverlay, dismissStrayOverlay, isScreenshotOverlay, registerScreenshotShortcut, unregisterScreenshotShortcut, warmScreenshotOverlay } from "./screenshot.ts";

/*
 * A profile is a whole app, Chromium's half included.
 *
 * `LYRA_HOME` moves everything this app stores — sessions, settings, scratch directories — and
 * until now Chromium's own directory stayed where it was, shared by every profile on the machine.
 * That was survivable while it only meant a shared `localStorage`; the lock below made it load
 * bearing, because a single-instance lock is keyed on exactly that directory. Two profiles would
 * have been one app, and the second one would refuse to start.
 *
 * Only when a home was asked for. Without it nothing moves, so no existing install has its window
 * size, its saved layout or its browser panel's cookies relocated out from under it.
 */
if (process.env.LYRA_HOME) app.setPath("userData", join(process.env.LYRA_HOME, "chromium"));

/**
 * One Lyra per machine, and every later launch reaches the one that is already running.
 *
 * Closing the window does not quit — that is the point of the status bar item, and it is what made
 * the second launch so easy to reach: the window is gone, so the app looks closed, and opening it
 * again started a *second copy*. On Windows that shows up as a row of identical tray icons, several
 * of which belong to processes nobody can see and which therefore answer no clicks at all.
 *
 * The icons are the visible half. Underneath, two copies share one `~/.lyra`: two schedulers firing
 * the same task twice, two sync servers fighting over one port, and two processes appending to the
 * same session log — which is how a transcript ends up interleaved with itself.
 *
 * `exit` rather than `quit` for the loser: it has initialised nothing yet, there is nothing to shut
 * down, and `quit` would let the rest of this file run first. The winner hears `second-instance`
 * instead and shows its window, so a double-click still does what a double-click looks like.
 */
if (!app.requestSingleInstanceLock()) app.exit(0);

app.on("second-instance", () => reveal());

/** Private scheme the renderer uses to preview images and video from the open project. */

/**
 * Previews get a scheme of their own, and deliberately not `file://`.
 *
 * A page the agent wrote is untrusted code. Served from its own origin it is subject to the
 * normal same-origin rules, cannot read the user's disk by walking `file:///`, and can be
 * pinned to a directory by the handler below — none of which is true of a file URL.
 */

/** Shared with the renderer's `<webview partition>`; they must name the same partition. */
const BROWSER_PARTITION = "persist:ly-browser";

/**
 * A path inside a project the user has opened, normalised — or null.
 *
 * The file panel exists to look at what you are working on. Without this check the renderer
 * could ask for any path on the disk, which is a materially different capability from the one
 * the panel advertises — and one the agent's own file tools gate behind approvals.
 *
 * Module scope because the IPC handlers and the media protocol both need it, and they must
 * agree: a boundary enforced in one of two doorways is not a boundary.
 *
 * `resolveInside` returns the resolved path so callers do their IO against the string that was
 * actually checked — see the note there on why comparing the raw one let `..` walk out.
 */
function projectPath(target: string): string | null {
	return resolveInside(
		target,
		(settings?.projects ?? []).map((project) => project.path),
	);
}

/**
 * Which open project a path belongs to, or null if none of them.
 *
 * `projectPath` answers whether a path is allowed; this answers where it lives, which is what
 * anything walking upward through directories needs in order to know when to stop.
 */
function projectRoot(target: string): string | null {
	const roots = (settings?.projects ?? []).map((project) => project.path);
	return containingRoot(target, roots);
}

/** The predicate form, for the doorways that only need a yes or no. */
function insideAProject(target: string): boolean {
	return projectPath(target) !== null;
}

/*
 * Resolved from the kernel once it is up.
 *
 * Declared here because everything in this file reaches for it, and assigned at boot so that a
 * plugin providing a different store is actually the one used.
 */
let store: SessionStorage = new SessionStore();
/** Live sessions keyed by session id. A session stays warm so MCP servers are not respawned per turn. */

/** The capability context: what the app can do, assembled from plugins at boot. */
let kernel: CapabilityContext | null = null;
/** Per-session browser instances, disposed alongside the session that owns them. */
/**
 * Live pseudo-terminals, one per project directory. Killed when the app quits.
 *
 * Deliberately outliving the panes that show them — see `ipc/terminal.ts` for why.
 */
const terminals = new Map<string, LiveTerminal>();
let settings: Settings;

let scheduler: Scheduler | null = null;

/**
 * The conversations the status bar menu offers, newest first.
 *
 * Held rather than read when the menu opens, because on Windows and Linux the menu is handed to
 * the system in advance and there is no moment to read anything at. Refreshed whenever the window
 * appears or goes away, which is exactly when the menu becomes the thing being used.
 */
let recentSessions: { id: string; title: string }[] = [];

async function refreshRecentSessions(): Promise<void> {
	try {
		const sessions = await store.listSessions();
		recentSessions = sessions
			.filter((session) => !session.archived && session.messageCount > 0)
			.sort((a, b) => b.updatedAt - a.updatedAt)
			.slice(0, 8)
			.map((session) => ({ id: session.id, title: session.title }));
	} catch {
		// A menu is not worth failing a launch over; it simply lists nothing.
		recentSessions = [];
	}
	refreshMenu();
}

/*
 * The menu tracks the window, on every window this app ever makes.
 *
 * `browser-window-created` rather than hooking `createWindow`: the window is destroyed and rebuilt
 * — closing it on Windows leaves the app running behind the tray — and a listener attached to one
 * instance would stop working the first time that happened. Both facts the first item depends on
 * are here: whether a window is on screen, and what has been talked about recently.
 */
/*
 * Every webContents, including the ones a `<webview>` is about to create.
 *
 * `will-attach-webview` fires on the *embedder*, so this has to be attached to the renderer rather
 * than to the guest — and attaching it here rather than beside the window means a guest created by
 * any future surface is covered by the same rule.
 */
app.on("web-contents-created", (_event, contents) => guardWebviews(contents));

app.on("browser-window-created", (_event, window) => {
	const track = () => void refreshRecentSessions();
	window.on("show", track);
	window.on("hide", track);
	window.on("minimize", track);
	window.on("restore", track);
	window.on("closed", track);
});

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------

protocol.registerSchemesAsPrivileged([
	{ scheme: MEDIA_SCHEME, privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true, bypassCSP: true } },
	{ scheme: PREVIEW_SCHEME, privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true } },
]);

/*
 * The name, before anything can ask for it.
 *
 * Packaged, this comes from the bundle. Run from source it does not exist, so macOS falls back to
 * the binary's name — and the dock, the menu bar and the "force quit" list all say Electron. It
 * also decides where `app.getPath("userData")` points, which is why it is set here rather than
 * after the app is ready.
 */
/*
 * The one thing that has to happen before anything else.
 *
 * On Windows a confined command is run by spawning this same executable with a marker flag; that
 * process must do the Win32 work and exit, never become a second copy of the app. Checked here
 * because "before the app is ready" is not early enough — module side effects would already have
 * run by then.
 */
if (process.argv.includes(WINDOWS_RUNNER_FLAG)) {
	const start = process.argv.indexOf(WINDOWS_RUNNER_FLAG) + 1;
	process.exit(runSandboxRunner(process.argv.slice(start)));
}

app.setName("Lyra");

/*
 * Keep painting a window that something is covering.
 *
 * Chromium stops rendering a window it believes is hidden behind another one, and repaints it when
 * it comes back — which takes a frame. Usually nobody notices. The screenshot overlay makes it
 * conspicuous: it is a full-screen window over the main one, so the main window is judged occluded
 * for the length of the capture, and the moment the overlay goes away it is on screen *blank*
 * before its first repaint lands. That white rectangle appearing and vanishing is the "Lyra flashes
 * for an instant" at the end of every capture, and it gets worse the longer the capture took.
 *
 * The cost is that a covered window keeps drawing. For an app with one window that is a rounding
 * error, and it is the same trade every editor with a preview pane already makes.
 */
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");

/*
 * When the application gains and loses the foreground, in the capture log.
 *
 * macOS repaints every window of an application when it activates — traffic lights colour in,
 * shadows deepen — and if that lands before the overlay is covering the screen it reads as the
 * desktop shifting. Whether it does is a question about ordering on the user's machine, so the two
 * events are recorded next to the capture's own steps.
 */
app.on("browser-window-focus", () => captureLog("app: browser-window-focus"));
app.on("browser-window-blur", () => captureLog("app: browser-window-blur"));
app.on("did-become-active", () => {
	captureLog("app: did-become-active");
	/*
	 * And check that what came back with the application is only what should have.
	 *
	 * macOS restores the windows of an application it unhides, and the capture overlay is a window
	 * that must never be restored: it covers the display, sits above the menu bar and shows nothing
	 * between captures, so a copy of it on screen reads as a machine that has stopped answering the
	 * mouse. It is `screenshot.ts` that must not leave one behind — this is the check that the
	 * user's desktop does not depend on that being got right.
	 */
	dismissStrayOverlay();
});

/**
 * Errors that reach the top of the main process without a home.
 *
 * Without this, Electron's own handler runs: a modal dialog reading "A JavaScript error occurred in
 * the main process" over the whole window, with a stack trace in it and one button. For a genuine
 * fault that is arguably right. For the ones that actually arrive it is not — they are asynchronous
 * I/O failures whose only meaning is "the other end went away", and they are unattributable at the
 * top level because the stack ends inside Node's stream machinery rather than anywhere in this app.
 *
 * `EPIPE` is the one that prompted this: a pty whose shell had just exited, written to in the
 * window before its exit event arrived. Both ends of that are now guarded at the source, which is
 * where a known failure belongs — this exists for the ones nobody has thought of yet, because the
 * cost of guessing wrong is the entire app becoming a crash report.
 *
 * Quiet only for the errors that carry no information. Anything else is reported to the window,
 * which surfaces it the way every other failure is surfaced — and, since the toast now offers it,
 * with a way to ask about it. The process stays up either way: a desktop app that dies on a
 * dropped socket loses whatever the person was in the middle of.
 */
const QUIET_IO = new Set(["EPIPE", "ECONNRESET", "ECONNABORTED", "ERR_STREAM_DESTROYED"]);

function reportToTopLevel(error: unknown, origin: string): void {
	const code = (error as NodeJS.ErrnoException | undefined)?.code;
	if (code && QUIET_IO.has(code)) return;

	const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
	console.error(`[${origin}]`, message);
	for (const win of BrowserWindow.getAllWindows()) {
		if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
			win.webContents.send("app:mainError", { origin, message });
		}
	}
}

process.on("uncaughtException", (error) => reportToTopLevel(error, "uncaughtException"));
process.on("unhandledRejection", (reason) => reportToTopLevel(reason, "unhandledRejection"));

app.whenReady().then(async () => {
	/*
	 * Before anything reads or writes it: the home directory was called `.deepwise` until the app
	 * was renamed, and to someone who had been using it, a fresh empty one is indistinguishable
	 * from having lost every session.
	 */
	const migration = await migratePreviousHome(lyraHome());
	if (migration.moved) console.log(`[lyra] 已把 ${migration.from} 迁移到 ${migration.to}`);
	if (migration.error) console.warn(`[lyra] 旧目录迁移失败：${migration.error}`);

	await mkdir(lyraHome(), { recursive: true });

	/*
	 * Before the sweep below gets to them.
	 *
	 * Project-less conversations used to run in `scratch/`, which is also where `core` puts the
	 * throwaway files it names after a session and deletes when that session is gone. `general` and
	 * `owner-repo-6381` were never session ids, so every launch deleted the working directory of
	 * every such conversation. They live in `workspaces/` now; this carries over whatever the last
	 * launch had not yet destroyed, and has to run first for that to mean anything.
	 */
	const rescued = await rescueLegacyWorkspaces().catch(() => []);
	if (rescued.length > 0) console.log(`[lyra] 把 ${rescued.length} 个无项目会话的目录挪到了 workspaces/：${rescued.join("、")}`);

	/*
	 * The dock icon, which macOS otherwise takes from the bundle.
	 *
	 * In development there is no bundle, so it shows Electron's own logo — on the dock, in the
	 * app switcher and in the "force quit" list. Setting it here is the only way to be looking at
	 * this application rather than at Electron while developing it.
	 */
	if (process.platform === "darwin") {
		const icon = appIconPath();
		if (icon) app.dock?.setIcon(icon);
	}

	/*
	 * Capabilities first, everything else after.
	 *
	 * The model adapters, the tool set and the approval policy are contributed by plugins into a
	 * context, and the kernel is pointed at that context here — before any session exists. Nothing
	 * downstream imports a concrete implementation, so replacing one (a sandboxed shell, another
	 * model API, a stricter policy) is a change to this list rather than to the code that uses it.
	 */
	/*
	 * The kernel is built from the default set plus whatever the user has installed.
	 *
	 * Discovering plugins before the window exists is deliberate: a plugin that replaces the model
	 * registry or the sandbox has to be in place before the first session is built, not bolted on
	 * afterwards. A bundle that fails to load is recorded and skipped — someone else's broken
	 * plugin must not be why the app will not start.
	 */
	settings = await loadAppSettings();
	const bundles = await loadPlugins(
		[{ dir: join(lyraHome(), "plugins"), source: "user" as const }],
		settings.disabledPlugins,
	);
	const extra = await loadCapabilityPlugins(bundles.plugins);
	for (const diagnostic of extra.diagnostics) console.warn(`[plugin] ${diagnostic.path}: ${diagnostic.message}`);
	kernel = await createContext([...DEFAULT_PLUGINS, ...extra.plugins]);
	useLlmRegistry(kernel.require<LlmRegistry>(LLM));
	useToolRegistry(kernel.require<ToolRegistry>(TOOLS));
	useSandbox(kernel.require<Sandbox>(SANDBOX));
	store = kernel.require<SessionStorage>(STORAGE);
	useCompaction(kernel.require<CompactionStrategy>(COMPACTION));
	useApprovalPolicy(kernel.require<ApprovalPolicy>(APPROVAL));
	useSkillRegistry(kernel.require<SkillRegistry>(SKILLS));
	useScheduler(kernel.require<TaskScheduler>(SCHEDULER));
	useAgentLoop(kernel.require<AgentLoop>(LOOP));
	useTurnPipeline(kernel.require<TurnPipeline>(SESSION).all());

	/*
	 * What a settings change has to reach.
	 *
	 * Registered once, here, rather than repeated at each place that saves: every one of these
	 * was previously the caller's job to remember, and forgetting one is invisible until the
	 * setting appears not to work.
	 */
	onSettingsChanged(async (next) => {
		settings = next;
		applyNativeAppearance();
		registerScreenshotShortcut(
			() => settings,
			() => {
				const win = getWindow();
				if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) {
					win.webContents.send("screenshot:trigger");
				}
			},
		);
		for (const session of sessions.values()) session.updateSettings(next);
		for (const chat of sideChats.values()) chat.updateSettings(next);
		if (next.sync.enabled && !syncStatusSource()?.running) await startSync();
		else if (!next.sync.enabled && syncStatusSource()?.running) await stopSync();
		const win = getWindow();
		if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) {
			win.webContents.send("settings:changed", next);
		}
	});
	useSettingsSource(() => settings);
	configureHub({ store: () => store, settings: () => settings, window: getWindow, sync: syncStatusSource });
	configureSync(() => store);
	// Before the window exists, so its very first frame gets the right material.
	applyNativeAppearance();

	/*
	 * Before any window exists, so no page can race the handler.
	 *
	 * Electron's default grants whatever a page asks for. That is wrong here: the browser panel
	 * hosts other people's sites, and without a handler one of them can simply have the camera.
	 */
	installPermissionHandlers([BROWSER_PARTITION]);

	registerPreviewProtocols({ browserPartition: BROWSER_PARTITION, insideAProject });

	// Clear out sessions that were reserved and never used — including any left over from
	// when clicking "新对话" created one up front.
	const pruned = await store.pruneEmpty().catch(() => 0);
	if (pruned > 0) console.log(`[lyra] 清理了 ${pruned} 个空会话`);

	/*
	 * Previews outlive nothing. Anything belonging to a conversation that is gone goes with it,
	 * and what remains expires on its own after a month — otherwise every sketch ever rendered
	 * would sit in the app directory forever, since nothing else would ever think to remove it.
	 */
	void store
		.listSessions()
		.then((all) => pruneSessionArtifacts(lyraHome(), new Set(all.map((s) => s.id))))
		.then((gone) => {
			if (gone > 0) console.log(`[lyra] 清理了 ${gone} 个会话的临时文件`);
		})
		.catch(() => {});
	/*
	 * Search, working out of the box.
	 *
	 * The keyless provider is registered unconditionally so a fresh install can search at all; the
	 * keyed ones read their key at call time, so they become available the moment one is pasted in
	 * and stay out of the way until then. With more than one usable, the seam asks which — see
	 * `selectSearchProvider`.
	 */
	registerSearchProvider(duckDuckGoProvider());
	registerSearchProvider(instantAnswerProvider());
	registerSearchProvider(keyedSearchProvider(TAVILY_PROVIDER_ID, () => settings?.searchApiKeys?.tavily));
	registerSearchProvider(keyedSearchProvider(EXA_PROVIDER_ID, () => settings?.searchApiKeys?.exa));
	registerSearchProvider(keyedSearchProvider(BRAVE_PROVIDER_ID, () => settings?.searchApiKeys?.brave));

	registerIpc();
	createWindow();
	registerScreenshotShortcut(
		() => settings,
		() => {
			const win = getWindow();
			if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) {
				win.webContents.send("screenshot:trigger");
			}
		},
	);
	/*
	 * Build the capture overlay now, while nothing is waiting on it.
	 *
	 * It is one hidden window that is never destroyed, and having it ready is the difference between
	 * a capture appearing 170ms after the shortcut and 320ms after it. The picture it shows is taken
	 * at the start of that wait, so every millisecond of it is time in which the screen can change
	 * and then visibly snap back — see `ensureOverlay`. Deferred past first paint so it competes with
	 * nothing during startup.
	 */
	setTimeout(warmScreenshotOverlay, 3000);
	if (settings.sync.enabled) await startSync();

	scheduler = new Scheduler({
		getSettings: () => settings,
		saveSettings: async (next) => void (await applySettings(next)),
		createSession: (cwd, modelId) => getOrCreateSession(cwd, modelId),
		notify: (message, level) => {
			const win = getWindow();
			if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) {
				win.webContents.send("scheduler:notice", { message, level });
			}
		},
	});
	scheduler.start();

	/*
	 * The status bar item, once there is something behind it worth opening.
	 *
	 * Created after the kernel and the window rather than first: every one of its menu items ends
	 * up in the renderer, and an item that is clickable before anything can answer it is a menu
	 * that silently does nothing.
	 */
	createTray({
		window: getWindow,
		reveal,
		send: sendToRenderer,
		openSession: (id) => sendToRenderer(`open-session:${id}` as TrayCommand),
		/*
		 * Kept warm rather than read on demand.
		 *
		 * On Windows the menu is handed to the system in advance, so building it cannot wait for a
		 * disk read; `recentSessions` is refreshed whenever the list changes and read synchronously
		 * here. macOS builds the menu as it opens and would not need this, but one code path for
		 * both is worth more than a read it can afford.
		 */
		recent: () => recentSessions,
	});
	await refreshRecentSessions();

	app.on("activate", () => {
		/*
		 * The main window specifically, not "any window at all": the capture overlay is permanent and
		 * hidden, and counting it would mean clicking the dock icon of an app with no window visibly
		 * does nothing.
		 *
		 * And showing it, not merely checking it exists. A capture puts the main window away for its
		 * duration — activating the overlay activates Lyra, and macOS raises every window of an
		 * application it activates, which would park the main window on top of whatever was being
		 * screenshotted. Without this, the dock icon of an app whose window was hidden that way does
		 * nothing at all.
		 */
		const win = getWindow();
		if (!win) {
			createWindow();
			return;
		}
		if (win.isMinimized()) win.restore();
		if (!win.isVisible()) win.show();
	});
});

/**
 * Bring the window up, building it first if there is none, and run `then` when it can listen.
 *
 * The second part is what makes a menu item work from cold. A freshly created window has a
 * `webContents` immediately but has not loaded the renderer yet, and anything sent in that gap is
 * dropped without a trace — the app would open on the default screen and simply ignore which item
 * had been clicked.
 */
function reveal(then?: () => void): void {
	const existing = getWindow();
	if (existing) {
		if (existing.isMinimized()) existing.restore();
		existing.show();
		existing.focus();
		then?.();
		return;
	}

	createWindow();
	const created = getWindow();
	if (!created) return;
	if (then) created.webContents.once("did-finish-load", then);
}

function sendToRenderer(command: TrayCommand): void {
	reveal(() => getWindow()?.webContents.send("tray:command", command));
}

app.on("window-all-closed", () => {
	/*
	 * With a status bar item, closing the window is not quitting.
	 *
	 * That is the whole point of having one: the agent goes on running, the schedule goes on
	 * firing, and the way back is the icon. macOS works this way for every app; Windows and Linux
	 * only should when there is something left on screen to return through — hence the check
	 * rather than an unconditional change. Quitting is on the tray menu.
	 */
	if (process.platform !== "darwin" && !hasTray()) app.quit();
});

/*
 * The same rule, for when the only window left is one the user cannot see.
 *
 * `window-all-closed` never fires once the capture overlay has been built, because the overlay is
 * never closed — so on Windows and Linux without a tray icon, closing the last real window would
 * leave the process running with nothing on screen and no way back to it.
 */
app.on("browser-window-created", (_event, win) => {
	win.on("closed", () => {
		if (process.platform === "darwin" || hasTray()) return;
		const left = BrowserWindow.getAllWindows().filter((other) => !other.isDestroyed() && !isScreenshotOverlay(other));
		if (left.length === 0) app.quit();
	});
});

app.on("before-quit", async () => {
	unregisterScreenshotShortcut();
	// The overlay outlives every capture on purpose, so it has to be let go of here or the process
	// has a window left open and never finishes quitting.
	destroyScreenshotOverlay();
	destroyTray();
	scheduler?.stop();
	for (const dispose of browsers.values()) dispose();
	browsers.clear();
	// Shells are real child processes; without this they outlive the window that opened them.
	for (const terminal of terminals.values()) terminal.pty.kill();
	terminals.clear();
	await Promise.all([...sessions.values()].map((s) => s.dispose()));
	await stopSync();
	// Unwinds every capability the plugins installed, in the reverse of the order they arrived.
	useLlmRegistry(null);
	useToolRegistry(null);
	useSandbox(null);
	useCompaction(null);
	useApprovalPolicy(null);
	useSkillRegistry(null);
	useScheduler(null);
	useAgentLoop(null);
	useTurnPipeline(null);
	await kernel?.dispose();
	kernel = null;
});

function registerIpc(): void {
	registerWorkspaceIpc({ workspaceInfo });

	registerWindowIpc();

	registerSessionsIpc({
		store: () => store,
		settings: () => settings,
		saveSettings: async (next) => void (await applySettings(next)),
	});

	registerSideChatIpc({ sideChats, sessions, settings: () => settings, ensureSession: (id: string) => ensureLiveSession(id), broadcastSideChat });

	registerFilesIpc({ projectPath });
	registerFileOpsIpc({ projectPath });
	registerFormatIpc({ projectPath, projectRoot });

	registerTerminalIpc({ terminals, spawnPty, projectPath, insideAProject, window: () => getWindow() });
	registerUpdateIpc();

	registerServicesIpc({
		testProvider,
		fetchEndpointModels,
		sync: syncStatusSource,
		startSync,
		idleSyncStatus,
		scheduler: () => scheduler,
	});

	registerScreenshotIpc({
		settings: () => settings,
		saveSettings: async (next) => void (await applySettings(next)),
	});

	registerGitIpc({ insideAProject });
	registerUsageIpc();
	registerRulesIpc();
}
