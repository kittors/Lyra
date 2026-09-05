/**
 * Everything the renderer may ask the main process to do.
 *
 * One interface, grouped by subject, and the only description of the boundary there is — the
 * preload builds `window.lyra` against it and the handlers are registered against the same
 * channel names, so a call that is not written here does not exist.
 *
 * The values it passes are in `ipc-shapes`, re-exported below so a caller still imports one thing.
 */

import type { TrajectoryEntry } from "@lyra/core";
import type { ForgeAccount, ForgeKind, ForgeKindInfo } from "./forge/types.ts";
import type {
	BranchList,
	GitCommit,
	GitOperation,
	GitStatus,
	ReleaseInfo,
	RemoteResult,
	RemoteState,
	RepoRef,
	WorkflowJob,
	WorkflowJobStep,
	WorkflowRunStatus,
	WorkflowRunSummary,
	WorktreeCreateOptions,
	WorktreeResult,
} from "./git.ts";
export type {
	BranchList,
	GitCommit,
	GitOperation,
	GitStatus,
	ReleaseInfo,
	RemoteResult,
	RemoteState,
	RepoRef,
	WorkflowJob,
	WorkflowJobStep,
	WorkflowRunStatus,
	WorkflowRunSummary,
	WorktreeCreateOptions,
	WorktreeResult,
};
/*
 * Re-exported under a name that means something on this side of the boundary.
 *
 * `DownloadPhase` is the downloader's word for its own state; from the renderer, the thing being
 * described is "where the update is up to". Same type, and it has to be the same type — the phase
 * crosses the wire verbatim, so two declarations would be two contracts with one of them free to
 * drift.
 */
import type { DownloadPhase } from "./ipc/update-download.ts";
import type { TrayCommand } from "./tray-menu.ts";
export type { DocumentData, DocumentSheet } from "./documents.ts";
import type { DocumentData } from "./documents.ts";
import type { UsageScan } from "./usage-scan.ts";
export type { DocumentKind } from "../shared/document-kind.ts";
export type { OpenTarget } from "./open-targets.ts";
import type { OpenTarget } from "./open-targets.ts";

export type UpdatePhase = DownloadPhase;

import type {
	AgentEvent,
	ApprovalDecision,
	BuiltinCommand,
	BundleKind,
	ContextBreakdown,
	CorrectionSuggestion,
	McpBundle,
	Registry,
	RegistryEntry,
	Plugin,
	DiffHunk,
	ExtensionDiagnostic,
	ExtensionStats,
	PluginDiagnostic,
	QueuedTask,
	RuleDestination,
	RuleEntry,
	SkillCandidate,
	ScreenshotSettings,
	SessionMeta,
	Settings,
	Skill,
	SkillDiagnostic,
	SlashCommand,
	SubAgentDetail,
	SubAgentSummary,
	ThinkingLevel,
	UserContent,
} from "@lyra/core";

import type {
	AgentCapabilities,
	PullRequestDetail,
	FileContents,
	FileEntry,
	FileOpResult,
	ProviderTestResult,
	PullRequestSummary,
	RefDiff,
	SessionSnapshot,
	SideChatSnapshot,
	SyncStatus,
	WorkspaceDiffFile,
	WorkspaceInfo,
} from "./ipc-shapes.ts";

export * from "./ipc-shapes.ts";
export type { CommandsList, SkillEntry } from "./ipc/commands.ts";
import type { SkillEntry } from "./ipc/commands.ts";

/*
 * The account types, re-exported so the renderer imports one module.
 *
 * `forge/types.ts` also declares the driver interface, which reaches into `node:` territory
 * conceptually if not in its imports. Only these three cross the boundary, and naming them keeps
 * that boundary a list rather than a habit.
 */
export type { ForgeAccount, ForgeKind, ForgeKindInfo } from "./forge/types.ts";

/** One shell in a directory, as the tab strip lists it. */
export interface TerminalTab {
	id: string;
	title: string;
}

/** What a pane gets back when it connects to a shell. */
export interface AttachedTerminal {
	id: string;
	title: string;
	pid: number;
	/** This connection's number, to be quoted back to `detach`. */
	epoch: number;
	/** Everything the shell has written, for redrawing a pane that came back. */
	replay: string;
}

/** What `format.external` can come back with. Mirrors `electron/format-external.ts`. */
export type ExternalFormatResult =
	| { ok: true; text: string; tool: string }
	| { ok: false; reason: "unsupported" }
	| { ok: false; reason: "failed"; message: string; tool: string }
	| { ok: false; reason: "missing"; tool: string; install: string };

export interface LyraApi {
	/**
	 * Which operating system this is, available before the first paint.
	 *
	 * `system.platform()` answers the same question over IPC, which is a round trip later — and the
	 * window's top row is drawn from this: macOS keeps its traffic lights at the top left, Windows
	 * and Linux paint their own controls at the top right, and a layout that starts out wrong and
	 * corrects itself is a visible jump on every launch.
	 */
	platform: NodeJS.Platform;
	/**
	 * What is displaying this interface.
	 *
	 * `"desktop"` — the Electron window, which has traffic lights, a mouse and a keyboard with
	 * modifiers. `"mobile"` — a WebView on a phone, which has none of those and a thumb instead.
	 * Absent means desktop, so nothing outside the phone has to be changed to read it.
	 *
	 * Deliberately not derived from the viewport. A narrow desktop window is still a desktop
	 * window: it keeps its window controls and its hover states, and treating it as a phone would
	 * take away both. This says which *device* is holding the app, which is a different question
	 * from how much room it has.
	 */
	host?: "desktop" | "mobile";
	settings: {
		get(): Promise<Settings>;
		save(settings: Settings): Promise<Settings>;
		/**
		 * Settings changed on the other side of the boundary.
		 *
		 * The renderer is not the only thing that writes them: installing an MCP bundle adds its
		 * servers, uninstalling takes them away, sync rotates its token, an approval appends to
		 * `alwaysAllow`. The main process has always broadcast this and nothing has ever listened,
		 * so the window went on showing the settings it last saved itself — install a server from
		 * the catalogue and the MCP page did not have it until the app was restarted.
		 */
		onChanged(handler: (settings: Settings) => void): () => void;
	};
	usage: {
		/**
		 * Everything spent, by day and by model, read from the session logs.
		 *
		 * Cached between calls against each log's size and mtime, so this is expensive once and
		 * cheap afterwards. The page does its own slicing; see `usage-aggregate.ts`.
		 */
		scan(): Promise<UsageScan>;
	};
	workspace: {
		/** Show the project directory in the OS file manager. */
		reveal(path: string): Promise<void>;
		pick(): Promise<WorkspaceInfo | null>;
		info(path: string): Promise<WorkspaceInfo | null>;
	};
	sessions: {
		list(): Promise<SessionMeta[]>;
		create(cwd: string, modelId: string): Promise<SessionSnapshot>;
		/** Start the agent for this session — skills, MCP servers, the lot. For running things. */
		open(projectId: string, sessionId: string): Promise<SessionSnapshot | null>;
		/** Read the stored transcript without starting anything. For looking at things. */
		transcript(projectId: string, sessionId: string): Promise<SessionSnapshot | null>;
		/** The same log, read as a trajectory: one entry per thing that happened, by source. */
		trajectory(projectId: string, sessionId: string): Promise<TrajectoryEntry[]>;
		/** Copy history up to `seq` into a new session, leaving this one untouched. */
		fork(projectId: string, sessionId: string, seq: number): Promise<{ meta: SessionMeta; messages: number } | null>;
		remove(projectId: string, sessionId: string): Promise<void>;
		/** Move a session in or out of the archive. Returns the whole list, already updated. */
		setArchived(projectId: string, sessionId: string, archived: boolean): Promise<SessionMeta[]>;
		/** Delete every archived session at once. Returns the remaining list. */
		removeArchived(): Promise<SessionMeta[]>;
		capabilities(sessionId: string): Promise<AgentCapabilities | null>;
		/** Rename a session and persist to disk/log. */
		rename(projectId: string, sessionId: string, title: string): Promise<SessionMeta | null>;
		/** Summarise now. `reason` says why not, when it declines. */
		compact(sessionId: string): Promise<{ ok: boolean; reason?: string; before?: number; after?: number }>;
		/** Null when the session is not open — this never boots one just to answer. */
		contextBreakdown(sessionId: string): Promise<ContextBreakdown | null>;
	};
	agent: {
		/**
		 * `synthetic` marks a message the app composed on the user's behalf — 「继续」 — so the
		 * transcript does not show it as something they typed. See `Session.prompt`.
		 */
		prompt(sessionId: string, content: UserContent[], options?: { synthetic?: boolean; deliver?: "steer" | "followUp" }): Promise<void>;
		/** Replace a message and re-run from there, discarding everything after it. */
		editMessage(sessionId: string, messageIndex: number, content: UserContent[]): Promise<void>;
		abort(sessionId: string): Promise<void>;
		approve(sessionId: string, requestId: string, decision: ApprovalDecision): Promise<void>;
		setModel(sessionId: string, modelId: string): Promise<void>;
		/**
		 * The reasoning level for this conversation, from here on. `null` returns it to the app
		 * default — which is not the same as pinning it to whatever that default is today.
		 */
		setThinking(sessionId: string, thinking: ThinkingLevel | null): Promise<void>;
		onEvent(handler: (payload: { sessionId: string; event: AgentEvent }) => void): () => void;
	};
	/**
	 * Work this session delegated: what each sub-agent is doing, and a way into a running one.
	 *
	 * The roster itself is not here — it rides `agent.onEvent` as a `subagents` event, so a window
	 * already receiving events is already in step and one that has been away is correct on the
	 * first event it gets. These are the things that must be asked for: a transcript, which is too
	 * big to broadcast on every tool call, and the two actions.
	 */
	subAgents: {
		list(sessionId: string): Promise<SubAgentSummary[]>;
		/** Everything one sub-agent has said. Null if the session is closed or the id is unknown. */
		detail(sessionId: string, id: string): Promise<SubAgentDetail | null>;
		/**
		 * Say something to a running sub-agent.
		 *
		 * Spliced between its turns, so it finishes the step it is on and carries on with its
		 * context intact. False when it has already finished — there is no loop left to read it.
		 */
		steer(sessionId: string, id: string, text: string): Promise<boolean>;
		/** Stop one. The parent and its siblings carry on. */
		abort(sessionId: string, id: string): Promise<boolean>;
		/**
		 * Take one off the roster.
		 *
		 * `"stopping"` when it was still running: dismissing does not orphan a live sub-agent, it
		 * stops it first and the row goes once the run has filed itself as aborted.
		 */
		dismiss(sessionId: string, id: string): Promise<"removed" | "stopping" | "unknown">;
		/** Clear the finished ones and leave anything still running. Returns how many went. */
		dismissFinished(sessionId: string): Promise<number>;
	};
	/**
	 * The second conversation attached to a session: reads its transcript, writes nothing back.
	 *
	 * Its events ride a separate channel from `agent.onEvent` for the obvious reason — they
	 * describe a different conversation, and mixing them would paint side-chat replies into
	 * the main transcript.
	 */
	sideChat: {
		/** Null when this session has never had one opened. */
		state(sessionId: string): Promise<SideChatSnapshot | null>;
		ask(sessionId: string, content: UserContent[]): Promise<void>;
		/**
		 * Replace a question already asked and answer from there, dropping everything after it.
		 *
		 * The same act as editing a message in the main conversation, and for the same reason: a
		 * question that came out wrong, re-asked below the old one, leaves the model reading both.
		 */
		editAndResend(sessionId: string, index: number, content: UserContent[]): Promise<void>;
		abort(sessionId: string): Promise<void>;
		/** Throw the conversation away and start fresh. The main session is untouched. */
		reset(sessionId: string): Promise<void>;
		onEvent(handler: (payload: { sessionId: string; event: AgentEvent }) => void): () => void;
	};
	/** Work the side chat handed to a session, waiting for it to be free. */
	tasks: {
		list(sessionId: string): Promise<QueuedTask[]>;
		/** Only a task that has not started can be withdrawn; stopping a running one is `abort`. */
		cancel(sessionId: string, taskId: string): Promise<boolean>;
		/**
		 * Take a finished task off the list without touching what it did.
		 *
		 * The list is a receipt for work the side chat handed over. Clearing a row you have already
		 * read — or one you cancelled yourself, whose outcome you knew when you clicked — leaves the
		 * transcript alone. Refuses anything still queued or running: that would read as cancelling
		 * and would not be.
		 */
		dismiss(sessionId: string, taskId: string): Promise<boolean>;
		/**
		 * Put a task that stopped back on the queue.
		 *
		 * For the two ways a task stops without finishing: the main session was paused under it, or
		 * it failed. Both are work you still want done, and both used to be terminal — the row said
		 * so and nothing could act on it.
		 */
		resume(sessionId: string, taskId: string): Promise<boolean>;
	};
	/**
	 * Reading the project's files, for the panel's file browser.
	 *
	 * Confined to the open project: both calls refuse a path outside it. The browser is for
	 * looking at what you are working on, and a file picker that can wander into the rest of
	 * the disk is a different, riskier thing than what was asked for.
	 */
	/**
	 * Formatting that the window cannot do alone.
	 *
	 * Prettier runs in the renderer — see `src/components/editor/format.ts`. What is here is the
	 * half that needs the machine: the language-owned binaries (`gofmt` and friends), and the
	 * project's own committed style, which outranks anything set in this app's settings.
	 */
	format: {
		/** Format via the language's own tool. See `electron/format-external.ts` for the outcomes. */
		external(extension: string, source: string): Promise<ExternalFormatResult>;
		/** Whether any external tool is even conceivable for this extension. */
		available(extension: string): Promise<boolean>;
		/**
		 * `.prettierrc` / `.editorconfig` / `package.json#prettier`, nearest first.
		 *
		 * Null when the file is outside every open project, or when the project says nothing —
		 * in both cases the app's own settings apply.
		 */
		config(file: string): Promise<(Record<string, unknown> & { __source?: string }) | null>;
	};
	files: {
		list(dir: string): Promise<FileEntry[]>;
		read(path: string): Promise<FileContents | null>;
		/**
		 * A spreadsheet or a SQLite database, as sheets of cells.
		 *
		 * Null when the path is outside every open project or is not a file. The reader's own
		 * failures come back inside the value, as `error` — a corrupt workbook is something to show,
		 * not something to throw. See `electron/documents.ts`.
		 */
		document(path: string): Promise<DocumentData | null>;
		/**
		 * The file's own bytes, for the formats the window parses itself — `.docx` is the one.
		 *
		 * Null outside every open project, for a directory, or past the size cap.
		 */
		bytes(path: string): Promise<Uint8Array | null>;
		/** Overwrite a file. Refused outside the open project, same as reading. */
		write(path: string, text: string): Promise<{ ok: boolean; error?: string }>;
		/**
		 * A URL the renderer can put in `src` for images, video and audio.
		 *
		 * Served over a private scheme whose handler re-checks the project boundary, so media
		 * streams (with range requests, so a video can seek) instead of being base64'd through
		 * IPC — a 40MB clip would otherwise have to become a 55MB string first.
		 */
		mediaUrl(path: string): string;

		/*
		 * Changing files, not just reading them.
		 *
		 * Every one of these is confined to the open project the same way reading is, and every one
		 * reports what happened as data — see `FileOpResult`. Implemented in `ipc/file-ops.ts`.
		 */
		create(dir: string, name: string, kind: "file" | "directory"): Promise<FileOpResult>;
		/** Rename or move; the two are the same call with a different parent. */
		rename(from: string, to: string, overwrite?: boolean): Promise<FileOpResult>;
		copy(from: string, to: string, overwrite?: boolean): Promise<FileOpResult>;
		/** To the OS trash, where it can be put back. */
		trash(paths: string[]): Promise<FileOpResult>;
		/** Permanently. Deliberately a different call from `trash`, not a flag on it. */
		remove(paths: string[]): Promise<FileOpResult>;
		/** A name nothing in `dir` uses yet — `report copy.md` — for duplicating and pasting. */
		uniquePath(dir: string, name: string): Promise<FileOpResult>;
		exists(path: string): Promise<boolean>;
		/** Copy paths in from outside the app; only the destination is inside the project. */
		importInto(sources: string[], dir: string): Promise<FileOpResult>;
		/**
		 * The path behind a dropped `File`.
		 *
		 * `File.path` was removed in Electron 32; `webUtils.getPathForFile` is what replaced it,
		 * and it only exists in the preload. Synchronous, because a drop handler has to read the
		 * transfer list before the event returns.
		 */
		pathForDrop(file: File): string;
	};
	/**
	 * The system clipboard, for text.
	 *
	 * Through the main process rather than `navigator.clipboard`, whose read half needs a
	 * permission prompt that never arrives in a packaged app — so paste in a context menu would
	 * work in dev and silently do nothing once shipped.
	 */
	clipboard: {
		read(): Promise<string>;
		write(text: string): Promise<void>;
	};
	/** A real pseudo-terminal, one per tab. */
	terminal: {
		/** Every shell this directory already has. */
		list(cwd: string): Promise<TerminalTab[]>;
		/**
		 * Every shell there is — the pane's tabs.
		 *
		 * Not filed under the current project: leaving a project is not a reason to stop showing a
		 * terminal that is still running. Where a *new* shell starts is the only thing the project
		 * decides. See `listAll` in `terminal-registry.ts`.
		 */
		listAll(): Promise<TerminalTab[]>;
		/** Start another shell here. Always a new one: this is what the tab strip's `+` does. */
		open(cwd: string, cols: number, rows: number): Promise<AttachedTerminal>;
		/**
		 * Start the app's first shell now, so opening the pane later costs nothing.
		 *
		 * Does nothing if any shell is already running. The shell is left unattached, so it does
		 * not send anything to a pane that is not showing it — it only records, and the first
		 * `attach` replays that recording into a prompt that is already finished.
		 */
		prewarm(cwd: string, cols: number, rows: number): void;
		/**
		 * Connect to a shell that already exists.
		 *
		 * `replay` is everything it has written so far, for redrawing a pane that was unmounted
		 * while the shell kept running. `null` if that shell is gone — it may have exited while
		 * the pane was away.
		 */
		attach(id: string, cols: number, rows: number): Promise<AttachedTerminal | null>;
		/**
		 * Stop listening. The shell keeps running, and `attach` picks it up again.
		 *
		 * `epoch` is the one `attach` returned: a cleanup that has already been superseded by a
		 * newer connection must not mute a shell that pane is still watching.
		 */
		detach(id: string, epoch: number): void;
		write(id: string, data: string): void;
		resize(id: string, cols: number, rows: number): void;
		kill(id: string): void;
		onData(handler: (payload: { id: string; data: string }) => void): () => void;
		onExit(handler: (payload: { id: string; code: number }) => void): () => void;
	};
	providers: {
		test(providerId: string, modelId?: string): Promise<ProviderTestResult>;
		fetchModels(providerId: string): Promise<{ ok: boolean; models: string[]; error?: string }>;
	};
	sync: {
		status(): Promise<SyncStatus>;
		start(): Promise<SyncStatus>;
		stop(): Promise<SyncStatus>;
		rotateToken(): Promise<SyncStatus>;
	};
	commands: {
		/**
		 * Every slash command that applies here, and the files that could not be read.
		 *
		 * Scanned on call rather than cached: these are text files people edit in another window,
		 * and a list that needed a restart to notice would be wrong more often than right.
		 */
		list(cwd: string): Promise<{
			commands: SlashCommand[];
			/** 内建命令：名字和说明在 core，动作由各个宿主实现。 */
			builtins: BuiltinCommand[];
			diagnostics: { path: string; message: string }[];
			/**
			 * The skills the same project can use, for the same menu.
			 *
			 * A bundle advertises its skills as callable by name — waza's manifest says
			 * 「/waza:think」 — and nothing could call one: the agent picked them up on its own
			 * judgement and there was no way to ask. Read from the same place the session reads
			 * them, so the menu cannot offer something the agent does not have.
			 */
			skills: SkillEntry[];
		}>;
		/** Write a starter file and answer with its path, or say why it could not be written. */
		create(
			scope: "workspace" | "user",
			name: string,
			cwd: string,
		): Promise<{ ok: true; path: string } | { ok: false; error: string }>;
		/** Absolute path to the commands directory, created if missing. */
		reveal(scope: "workspace" | "user", cwd: string): Promise<string>;
		/** Open one command file for editing. */
		open(path: string): Promise<void>;
	};
	plugins: {
		/** Scan plugin and skill directories without needing an open session. */
		list(cwd: string): Promise<{
			plugins: Plugin[];
			/** Directories that turned out to be MCP servers rather than plugins. */
			mcpBundles: McpBundle[];
			/** 同样带 `severity`：插件里一个描述太短的技能是提醒，不是「没能加载」。 */
			pluginDiagnostics: PluginDiagnostic[];
			skills: Skill[];
			/** 带 `severity`：设置页按它把「没加载」和「加载了但描述太短」分成两段。 */
			skillDiagnostics: SkillDiagnostic[];
			/**
			 * Skills that were found and lost to another of the same name.
			 *
			 * "Why is the skill I wrote not running" cannot be answered from the list of the ones
			 * that are: a shadowed skill is simply absent, which looks the same as one that failed
			 * to parse or was never found at all.
			 */
			shadowedSkills: { name: string; path: string; by: string; byLabel: string }[];
		}>;
		/** Absolute path to the plugins directory, created if missing. */
		revealDir(scope: "workspace" | "user", cwd: string): Promise<string>;
		/** Write a runnable example bundle so the format is discoverable. */
		/** Read a registry index. Failures come back as data — a bad URL is routine, not exceptional. */
		/** `force` skips the main process's cache — what 刷新 means, and the only thing that does. */
		fetchRegistry(
			url: string,
			force?: boolean,
		): Promise<{ ok: true; registry: Registry } | { ok: false; message: string }>;
		/** A registry logo as a data URL, or null. Fetched in the main process; see `registry:icon`. */
		icon(url: string): Promise<string | null>;
		/**
		 * A whole catalogue's logos at once, keyed by the URL each was asked for.
		 *
		 * Not a batched `icon` for the sake of fewer round trips — the answers differ. A picture that
		 * more than one entry claims is nobody's mark and comes back `null`, which is a fact about the
		 * batch and cannot be decided one URL at a time. See `dropShared`.
		 */
		icons(urls: string[]): Promise<Record<string, string | null>>;
		/**
		 * Clone an entry and file it by what it turns out to be.
		 *
		 * `kind` comes back because the index's claim is only a claim: install something listed as
		 * a plugin that holds nothing but a `.mcp.json` and what you have installed is an MCP
		 * server, whose servers are now in settings switched off, waiting to be turned on.
		 */
		/**
		 * `replace` turns the same call into an update.
		 *
		 * It skips the "already installed" check and overwrites what is there — safely, because the
		 * new bundle is downloaded and inspected in a staging directory first, so a failed update
		 * leaves the working copy untouched. Uninstall-then-install would not: it has a window in
		 * the middle where the user has neither version.
		 */
		installFromRegistry(
			entry: RegistryEntry,
			registryName?: string,
			replace?: boolean,
		): Promise<{ ok: true; dir: string; kind: BundleKind; servers: number } | { ok: false; message: string }>;
		uninstall(id: string): Promise<void>;
	};
	/**
	 * Tell the window itself what the theme is.
	 *
	 * Two things depend on it: the OS-drawn controls on Windows and Linux, and — on every
	 * platform — the window's own backing colour, which is what a fast resize exposes before
	 * the renderer catches up.
	 */
	setWindowTheme(colors: { color: string; symbolColor: string }): void;
	/**
	 * Native full screen, reported by the window because the page cannot detect it.
	 *
	 * macOS hides the traffic lights in full screen, and everything inset to clear them has to
	 * stop reserving that space. Fires on entry, on exit, and once after load.
	 */
	onFullScreenChange(handler: (fullScreen: boolean) => void): () => void;
	/**
	 * A menu item on the status bar icon was chosen.
	 *
	 * Sent only once the window can receive it, so a command given while the app was closed still
	 * lands — the renderer never has to care whether it was already running.
	 */
	/**
	 * What the status bar menu asked for. Typed, so a menu item cannot be added without the window
	 * being made to answer it — see `tray-menu.ts` and `src/tray-commands.ts`.
	 */
	onTrayCommand(handler: (command: TrayCommand) => void): () => void;
	/**
	 * Something failed in the main process with nowhere to report it.
	 *
	 * Surfaced rather than swallowed: an error the window cannot see is one the user cannot act on,
	 * and the alternative — Electron's own modal crash dialog — takes the whole app hostage over
	 * what is usually a dropped connection. Quiet I/O codes never get this far; see `QUIET_IO`.
	 */
	onMainError(handler: (payload: { origin: string; message: string }) => void): () => void;
	updates: {
		/** Whether a newer release exists. Never throws: offline is a normal answer, not an error. */
		check(force?: boolean): Promise<{
			current: string;
			latest: string;
			available: boolean;
			/**
			 * Whether GitHub actually answered.
			 *
			 * False means offline, rate-limited, or no releases yet — all of which return the running
			 * version as the newest, which is the same shape as "you are up to date" and must not be
			 * shown as it. The badge is right to treat both as nothing to announce; a surface that was
			 * asked the question directly is not.
			 */
			checked: boolean;
			notes: string;
			url: string;
			publishedAt: number | null;
			asset: { name: string; url: string; size: number } | null;
		}>;
		/**
		 * Where the download is right now, whoever started it.
		 *
		 * The main process owns this, not the window: a download outlives the dialog that began it
		 * and outlives the window itself. Asked once on mount, and kept current by `onProgress`.
		 */
		state(): Promise<UpdatePhase>;
		/**
		 * Start fetching, or carry on from a pause. Resumes from the bytes already on disk.
		 *
		 * Returns the phase it reached, and every change also arrives on `onProgress` — so a caller
		 * may await this or ignore it entirely and just draw what it is told.
		 */
		download(version: string): Promise<UpdatePhase>;
		/** Stop, keeping what has come down. Resuming asks the server only for the rest. */
		pause(): Promise<UpdatePhase>;
		/** Stop and throw the partial away. What 取消 means, as opposed to 暂停. */
		cancel(): Promise<UpdatePhase>;
		/** Put the staged update in place and come back up on it. Does not return if it works. */
		relaunch(): Promise<boolean>;
		/**
		 * Put the downloaded installer back on screen — Windows and Linux, where installing is a
		 * window this app does not own and is easy to dismiss by accident. False if there is none.
		 */
		reopen(): Promise<boolean>;
		/** Opens the release page in the browser. Refuses anything that is not a github.com URL. */
		open(url: string): Promise<boolean>;
		onProgress(listener: (phase: UpdatePhase) => void): () => void;
	};
	system: {
		openPath(path: string): Promise<void>;
		openExternal(url: string): Promise<void>;
		/** `target` is an id from `openTargets`; see `electron/open-targets.ts`. */
		openIn(target: string, path: string): Promise<void>;
		/**
		 * What 「用什么打开」 can mean on this machine: showing the file where it lives, plus the
		 * editors and terminals actually installed. Never empty — revealing always works.
		 */
		openTargets(): Promise<OpenTarget[]>;
		revealSkillsDir(scope: "workspace" | "user", cwd: string): Promise<string>;
		platform(): Promise<string>;
		/**
		 * An https image as a data URL, or null.
		 *
		 * For pictures a rendered document names. Fetched in the main process because the page's
		 * `img-src` is `self data: blob:` and stays that way — see `system:remoteImage`.
		 */
		remoteImage(url: string): Promise<string | null>;
	};
	screenshot: {
		start(settings?: ScreenshotSettings): Promise<void>;
		finish(dataUrl: string, settings?: ScreenshotSettings): Promise<{ ok: boolean; filePath?: string }>;
		cancel(): Promise<void>;
		pickDirectory(): Promise<string | null>;
		onInit(
			handler: (payload: {
				/**
				 * The screen, as raw RGBA pixels rather than an encoded image.
				 *
				 * Encoding it to PNG so it could be decoded again on the other side of this message
				 * measured 133ms — the largest single thing Lyra contributed to the wait before a
				 * capture appears, and the picture is taken before that wait, so it was time in which
				 * the screen could change and then appear to snap back when the frozen copy landed.
				 */
				snapshot: { pixels: Uint8Array; width: number; height: number };
				/**
				 * Which capture this is, counted in the main process.
				 *
				 * The overlay window is built once and then shown and hidden — building it per capture
				 * cost 147ms, and the picture it shows is taken before that, so the delay was visible as
				 * the desktop jumping back a moment when the overlay landed. The page therefore cannot
				 * tell a new capture from the last one by having just loaded, and cannot tell from the
				 * picture either: two captures of an unchanged screen are byte-identical.
				 */
				session: number;
				bounds: { x: number; y: number; width: number; height: number };
				scaleFactor: number;
				/** On-screen windows, front to back, in the overlay's own coordinates. Empty off macOS. */
				windows?: { x: number; y: number; width: number; height: number; app: string }[];
				/** Where the pointer was when the capture began, so the first highlight needs no movement. */
				cursor?: { x: number; y: number };
				settings?: ScreenshotSettings;
			}) => void,
		): () => void;
		/** Say the snapshot has been drawn, so the overlay can be shown without a blank frame. */
		ready(): void;
		/**
		 * The overlay has composited a frame, and may now be made visible.
		 *
		 * Sent from inside an animation frame. `ready` is not a substitute: it means the snapshot is
		 * in the canvas's bitmap, which is CPU-side work — the window's GPU surface is released while
		 * it is hidden, and one that is still being rebuilt is displayed stretched to the window's
		 * size. That is the "the whole screen scales for an instant" on the first capture and on the
		 * first one after a pause.
		 */
		painted(): void;
		/**
		 * A colour has been taken and the capture is leaving, but the confirmation is not.
		 *
		 * The overlay stays up for another moment showing nothing but 「已复制色值」 over the real
		 * desktop; this makes it click-through for that moment, so the screen behaves normally the
		 * instant it looks normal. `cancel` follows once the message has faded.
		 */
		colourPicked(): void;
		/** The window is on screen — from here a fade has frames to run in. Returns an unsubscribe. */
		onShown(handler: () => void): () => void;
		/**
		 * The capture is over and the window is off screen.
		 *
		 * Sent after the hide has landed, never before: the page answers it by dropping the frozen
		 * screen, which is a white canvas if it is still being looked at. Its other purpose is
		 * memory — the snapshot is a full-resolution copy of the display, and the window holding it
		 * now lives as long as the app does.
		 */
		onHidden(handler: () => void): () => void;
		/** Report a measurement into the capture log, for diagnosing what a recording only hints at. */
		debug(what: string, detail: Record<string, unknown>): void;
	};
	index: {
		stats(cwd: string): Promise<{ exists: boolean; builtAt?: number; files?: number; symbols?: number; bytes?: number }>;
		rebuild(cwd: string): Promise<{ exists: boolean; builtAt?: number; files?: number; symbols?: number; bytes?: number }>;
		search(cwd: string, query: string): Promise<{ name: string; kind: string; file: string; line: number }[]>;
	};
	scheduler: {
		/** Run a scheduled task immediately, through the same path the timer uses. */
		runNow(taskId: string): Promise<{ ok: boolean; error?: string }>;
	};
	/**
	 * Answering the card that offers to turn a correction into a rule.
	 *
	 * `preview` renders in the main process on purpose: the card shows the exact text that will be
	 * written, produced by the same function that writes it. A second renderer in the window would
	 * drift, and it would drift in the direction where somebody approves text that is not what
	 * lands on disk.
	 */
	extensions: {
		/**
		 * 扩展的可观测：有会话就是那个会话宿主里的数字，没有就只有磁盘上的清单（`live: false`）。
		 * 每个事件一行，包括一次都没派到过的——「0 次」是在说处理器没被够到。
		 */
		stats(sessionId: string | null, cwd: string): Promise<{ live: boolean; extensions: ExtensionStats[]; diagnostics: ExtensionDiagnostic[] }>;
	};

	capabilities: {
		/** 两份同名能力的差异，赢家在前输家在后；hunk 直接交给 DiffView。 */
		diff(
			kind: "rule" | "skill",
			winner: string,
			loser: string,
		): Promise<{ hunks: DiffHunk[]; added: number; removed: number; winner: string; loser: string }>;
		/** 「改用那个」：让 `path` 这一份赢下 `kind:name`。返回写到了哪个文件。 */
		prefer(kind: "rule" | "skill", name: string, path: string): Promise<{ wroteTo: string }>;
	};

	rules: {
		/** 这个项目现在有哪些规则，包括被关掉的和被同名文件盖掉的。 */
		list(cwd: string): Promise<{
			rules: RuleEntry[];
			diagnostics: { path: string; message: string }[];
			/** 有个人级规则可以勾的外部工具。 */
			foreignUserSources: { id: string; label: string; describe: string }[];
			/** 已经勾上的那些。 */
			enabledForeignUserRules: string[];
		}>;
		/** 关掉或打开一条。已经开着的会话会立刻跟上。 */
		setDisabled(name: string, disabled: boolean): Promise<void>;
		/** 勾或取消一个外部工具的个人规则目录。 */
		setForeignUser(id: string, enabled: boolean): Promise<void>;
		/** 从会话里总结出来、等着人点头的技能候选。 */
		pendingSkills(cwd: string): Promise<SkillCandidate[]>;
		/** 批准一个。`content` 是人编辑过的版本——「编辑后启用」跟「启用」是同一个动作。 */
		approveSkill(cwd: string, name: string, content?: string): Promise<string | null>;
		/** 否决一个。文件删掉，下次不再问。 */
		rejectSkill(cwd: string, name: string): Promise<boolean>;
		preview(suggestion: CorrectionSuggestion): Promise<string>;
		/** Save it and make it apply from the next turn. `renamed` when the name was taken. */
		keep(sessionId: string, scope: RuleDestination, name: string, content: string): Promise<{ path: string; renamed?: string }>;
		/** They said no. Two in a row and this session stops offering. */
		decline(sessionId: string): Promise<void>;
	};
	/**
	 * The code hosts this app is signed in to.
	 *
	 * Note what is not here: there is no way to read a token back. They go in through `signIn`,
	 * are verified before they are stored, and are only ever used by the main process — a channel
	 * that returned one would put every one of the user's credentials one devtools panel away.
	 */
	forge: {
		/** The hosts that can be added, and whether this machine can encrypt what it stores. */
		kinds(): Promise<{ kinds: ForgeKindInfo[] }>;
		accounts(): Promise<ForgeAccount[]>;
		/**
		 * Check a token against its host, and keep it if it works.
		 *
		 * Verified first, always: a token stored without being checked is an account that looks
		 * settled on the settings page and produces an empty list somewhere else entirely.
		 */
		signIn(input: { kind: ForgeKind; baseUrl: string; token: string; label?: string }): Promise<{
			account?: ForgeAccount;
			error?: string;
		}>;
		signOut(id: string): Promise<void>;
		/** Stop fetching this one without forgetting it. */
		setEnabled(id: string, enabled: boolean): Promise<ForgeAccount | null>;
		rename(id: string, label: string): Promise<ForgeAccount | null>;
	};
	git: {
		/**
		 * Every pull request that concerns you, across every repository and every account.
		 *
		 * Not scoped to the open folder: what is waiting on you on a Monday morning is spread
		 * across everything you work in, and these days across more than one host.
		 *
		 * `errors` is per account, and separate from `error` on purpose — one unreachable
		 * self-hosted instance must not empty a list the other accounts answered.
		 */
		myPullRequests(): Promise<{
			pullRequests: PullRequestSummary[];
			errors: Record<string, string>;
			error?: string;
		}>;
		pullRequest(accountId: string, repo: string, number: number): Promise<{ detail?: PullRequestDetail; error?: string }>;
		pullRequestDiff(accountId: string, repo: string, number: number): Promise<{ files: WorkspaceDiffFile[]; error?: string }>;
		/**
		 * A scratch directory for talking about this pull request, with `PR.md` written into it.
		 *
		 * Only used when the repository is not one of the user's projects. Stable across launches
		 * — sessions are keyed by their directory — so reopening the same review months later
		 * finds the same conversation.
		 */
		scratchForPullRequest(pr: {
			repo: string;
			number: number;
			title: string;
			author: string;
			url: string;
			headRefName: string;
			baseRefName: string;
			state: string;
			body: string;
		}): Promise<string>;
		/** The shared scratch directory for 「不在项目中工作」. */
		generalScratch(): Promise<string>;
		/**
		 * Every directory those conversations live under, so the sidebar can tell them from real
		 * projects. More than one because the directory has been renamed and stored sessions still
		 * record the old path.
		 */
		scratchRoots(): Promise<string[]>;
		/**
		 * Which of `candidates` has this repository as its `origin`, or null.
		 *
		 * Candidates are the user's own project paths. Matching is on the remote rather than the
		 * directory name, and a fork does not count: `origin` is what a working copy pushes to.
		 */
		findLocalCheckout(repo: string, candidates: string[]): Promise<string | null>;
		/**
		 * A GitHub account's avatar as a data URL, or null.
		 *
		 * Fetched in the main process on purpose: the renderer's CSP allows no remote images, and
		 * widening it for a decoration would widen it for rendered comment bodies as well.
		 */
		avatar(login: string): Promise<string | null>;
		/**
		 * The same, for every face a list is about to draw.
		 *
		 * One call rather than one per row: the main process has most of them cached already, and
		 * the cost that was actually being paid was the IPC round trips, one per avatar per mount.
		 * `url` is what the search result said; without one the login is turned into an address.
		 */
		avatars(people: { login: string; url?: string | null }[]): Promise<Record<string, string | null>>;
		commentOnPullRequest(accountId: string, repo: string, number: number, body: string): Promise<{ error?: string }>;
		reviewPullRequest(
			accountId: string,
			repo: string,
			number: number,
			verdict: "approve" | "request-changes" | "comment",
			body: string,
		): Promise<{ error?: string }>;
		/** Local and remote branches, for the composer's branch switcher. */
		branches(cwd: string): Promise<BranchList>;
		switchBranch(cwd: string, branch: string): Promise<{ ok: boolean; error?: string }>;
		createWorktree(cwd: string, branch: string, options?: WorktreeCreateOptions): Promise<WorktreeResult>;
		removeWorktree(cwd: string, worktreePath: string): Promise<{ ok: boolean; error?: string }>;
		pruneWorktrees(cwd: string): Promise<{ ok: boolean; error?: string }>;
		/**
		 * How much is uncommitted, as three numbers.
		 *
		 * Deliberately separate from `diff.workspaceDiff`: this one is on screen the whole
		 * session and re-runs after every turn, so it counts without building any diffs.
		 */
		stat(cwd: string): Promise<{ branch: string | null; added: number; removed: number; files: number }>;
		/** Stage everything and commit it — the change the bar is counting. */
		commit(cwd: string, message: string): Promise<{ ok: boolean; error?: string }>;

		/* The Git panel's surface. Reading first, then the operations that write. */

		/** Every repository under the workspace — people keep more than one side by side. */
		repos(root: string): Promise<RepoRef[]>;
		/** Linked checkouts of one repository, each on its own branch. */
		worktrees(cwd: string): Promise<RepoRef[]>;
		init(cwd: string): Promise<{ ok: boolean; error?: string }>;
		/** Working tree split by index, with upstream distance. */
		status(cwd: string): Promise<GitStatus>;
		log(cwd: string, limit?: number, ref?: string): Promise<GitCommit[]>;
		/** What one commit changed, against its parent. */
		commitDiff(cwd: string, sha: string): Promise<RefDiff>;
		/** A commit's file list without its contents, for showing the list before the diffs arrive. */
		commitDiffSummary(cwd: string, sha: string): Promise<{ files: WorkspaceDiffFile[] }>;
		/** Any two points in history; `head` of null diffs the index against `base`. */
		diffRefs(cwd: string, base: string, head: string | null): Promise<RefDiff>;

		stage(cwd: string, paths: string[]): Promise<{ ok: boolean; error?: string }>;
		unstage(cwd: string, paths: string[]): Promise<{ ok: boolean; error?: string }>;
		/** Irreversible: untracked paths are deleted, not restored. */
		discard(cwd: string, paths: string[]): Promise<{ ok: boolean; error?: string }>;
		/** Commits exactly what the panel shows as staged. */
		commitStaged(cwd: string, message: string): Promise<{ ok: boolean; error?: string }>;
		/** A commit message from the configured model, about the staged (or unstaged) patch. */
		generateCommitMessage(cwd: string): Promise<{ ok: boolean; message?: string; error?: string }>;
		createBranch(cwd: string, name: string, from?: string): Promise<{ ok: boolean; error?: string }>;
		deleteBranch(cwd: string, name: string, force?: boolean): Promise<{ ok: boolean; error?: string }>;
		/**
		 * The three calls that touch a remote.
		 *
		 * Each takes a `token` the renderer makes up, and `cancelRemote` stops whichever call is
		 * holding it. An `AbortSignal` cannot cross the IPC boundary, so the identity of the running
		 * operation has to, and the renderer is the side that knows which button was pressed twice.
		 *
		 * They answer with `cancelled` and `timedOut` alongside `error` because the panel treats the
		 * three differently: a cancellation says nothing, a timeout says so plainly, and a failure
		 * gets whatever `explainGitFailure` made of git's own words.
		 */
		push(cwd: string, token?: string): Promise<RemoteResult>;
		pull(cwd: string, token?: string): Promise<RemoteResult>;
		/** `fetch --prune`, so `ahead` / `behind` describe the remote as it is now. */
		fetch(cwd: string, token?: string, quiet?: boolean): Promise<RemoteResult>;
		/** Stop the push / pull / fetch running under this token. Unknown tokens are ignored. */
		cancelRemote(token: string): Promise<void>;

		/* Release workflow operations */
		releaseInfo(cwd: string): Promise<ReleaseInfo | null>;
		bumpVersion(cwd: string, newVersion: string): Promise<{ ok: boolean; error?: string }>;
		triggerDryRun(cwd: string): Promise<{ ok: boolean; runId?: number; error?: string }>;
		listWorkflowRuns(cwd: string, limit?: number): Promise<WorkflowRunSummary[]>;
		workflowRunStatus(cwd: string, runId: number): Promise<WorkflowRunStatus | null>;
		publishReleaseTag(cwd: string, version: string): Promise<{ ok: boolean; tag?: string; error?: string }>;
	};
	memory: {
		/** 每条带来源与最后一次注入提示词的时间（没注入过就没有）。 */
		load(): Promise<{ entries: { id: string; content: string; createdAt: number; updatedAt: number; source?: "user" | "auto" | "session"; lastInjectedAt?: number }[] }>;
		add(content: string): Promise<{ id: string; content: string; createdAt: number; updatedAt: number }>;
		remove(id: string): Promise<boolean>;
		clear(): Promise<void>;
	};
	/**
	 * 这个项目的记忆——跟上面那个跨项目的偏好库是两回事。
	 *
	 * 上面那个是「我这个人的习惯」，存在 `~/.lyra/memory.json`；这个是「这个仓库怎么回事」，
	 * 由后台抽取从历史会话里读出来，存在项目自己的记忆目录。
	 */
	projectMemory: {
		/**
		 * 现在该不该跑一遍抽取。
		 *
		 * `never-asked` 不是「不跑」——它是**去问**的信号。窗口拿到这个才弹征询，
		 * 而不是每次空闲都弹。
		 */
		status(cwd: string): Promise<{ run: boolean; reason?: string }>;
		/** 跑一遍。返回写了什么、读了几个会话，或者为什么没跑。 */
		extract(cwd: string): Promise<{ memory: string; sessions: number; skipped?: string }>;
		/** 这个项目记住的：`learn` 写的每一条，和抽取出来的那一份，各带写入时间与最后注入时间。 */
		list(cwd: string): Promise<{
			lessons: { text: string; context?: string; at: number; lastInjectedAt?: number }[];
			extracted: { text: string; updatedAt?: number; lastInjectedAt?: number } | null;
		}>;
	};
	diff: {
		/** Uncommitted changes for the review panel. */
		workspaceDiff(cwd: string): Promise<{ files: WorkspaceDiffFile[]; added: number; removed: number; branch: string | null }>;
		/**
		 * One side of a binary file, as a data URL, for the review to draw rather than describe.
		 *
		 * Null when there is nothing worth drawing — a `.zip`, a file too large to move, or a side
		 * that does not exist (the working copy of a deleted file). See `readDiffBlob`.
		 */
		blob(cwd: string, path: string, side: "head" | "work"): Promise<{ dataUrl: string; bytes: number } | null>;
	};
}

/**
 * The Window Controls Overlay API, which TypeScript's DOM library does not describe.
 *
 * Chromium exposes it whenever a window is created with `titleBarOverlay` — Windows and Linux
 * here — and it is the only way to find out how much of the top row the system's own buttons have
 * taken. See `useTitlebar`.
 */
interface WindowControlsOverlay extends EventTarget {
	readonly visible: boolean;
	getTitlebarAreaRect(): DOMRect;
}

declare global {
	interface Window {
		lyra: LyraApi;
	}
	interface Navigator {
		readonly windowControlsOverlay?: WindowControlsOverlay;
	}
}
